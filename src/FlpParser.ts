// Portions adapted from flpdiff.
// Copyright (c) 2026 Roman Pronskiy. Used under the MIT License; see LICENSE-MIT.

export type FlpErrorKind = "invalid" | "corrupt" | "empty";

export class FlpImportError extends Error {
  public readonly kind: FlpErrorKind;

  public constructor(kind: FlpErrorKind, message: string) {
    super(message);
    this.name = "FlpImportError";
    this.kind = kind;
  }
}

export interface FlpNote {
  readonly position: number;
  readonly length: number;
  readonly key: number;
  readonly velocity: number;
  readonly channelId: number;
  readonly flags: number;
  readonly slide: boolean;
  readonly midiChannel: number;
  readonly finePitch: number;
  readonly pan: number;
  readonly modX: number;
  readonly modY: number;
}

export interface FlpPattern {
  readonly id: number;
  name?: string;
  length?: number;
  readonly notes: FlpNote[];
}

export interface FlpChannel {
  readonly id: number;
  name?: string;
  kind?: "sampler" | "instrument" | "layer" | "automation" | "unknown";
  samplePath?: string;
  plugin?: FlpChannelPlugin;
}

export interface FlpChannelPlugin {
  readonly internalName: string;
  name?: string;
  vendor?: string;
  statePath?: string;
  statePreset?: string;
}

export interface FlpPlaylistClip {
  readonly position: number;
  readonly length: number;
  readonly patternId: number;
  readonly track: number;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
}

export interface FlpArrangement {
  readonly id: number;
  readonly tracks: FlpPlaylistTrack[];
  readonly clips: FlpPlaylistClip[];
}

export interface FlpPlaylistTrack {
  readonly index: number;
  name?: string;
}

export interface FlpProject {
  readonly ppq: number;
  readonly tempo: number;
  readonly beatsPerBar: number;
  versionMajor?: number;
  currentArrangementId?: number;
  readonly channels: FlpChannel[];
  readonly patterns: FlpPattern[];
  readonly arrangements: FlpArrangement[];
}

type FlpEvent =
  | { readonly opcode: number; readonly kind: "u8"; readonly value: number }
  | { readonly opcode: number; readonly kind: "u16"; readonly value: number }
  | { readonly opcode: number; readonly kind: "u32"; readonly value: number }
  | {
      readonly opcode: number;
      readonly kind: "blob";
      readonly payload: Uint8Array;
    };

interface FlpVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface PatternBuilder extends FlpPattern {
  readonly modernNotePayloads: Uint8Array[];
  readonly legacyNotePayloads: Uint8Array[];
}

const FLHD_MAGIC: readonly number[] = [0x46, 0x4c, 0x68, 0x64];
const FLDT_MAGIC: readonly number[] = [0x46, 0x4c, 0x64, 0x74];
const FLHD_LENGTH = 6;
const NOTE_RECORD_SIZE = 24;
const NOTE_FLAG_SLIDE = 0x08;
const PLAYLIST_PATTERN_BASE = 20480;
const PLAYLIST_UNSET_OFFSET = 0xffffffff;
const LEGACY_PLAYLIST_UNSET_OFFSET = 0xbf800000;
const MODERN_PLAYLIST_MAX_TRACK = 499;
const LEGACY_PLAYLIST_MAX_TRACK = 198;

function corrupt(message: string): never {
  throw new FlpImportError("corrupt", message);
}

function requireBytes(
  offset: number,
  length: number,
  end: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > end - length
  ) {
    corrupt(`Truncated ${label}.`);
  }
}

function matchesMagic(
  view: DataView,
  offset: number,
  expected: readonly number[],
): boolean {
  if (offset < 0 || offset > view.byteLength - expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (view.getUint8(offset + i) !== expected[i]) return false;
  }
  return true;
}

function readVarInt(
  view: DataView,
  state: { offset: number },
  end: number,
): number {
  let value = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 5; byteIndex++) {
    requireBytes(state.offset, 1, end, "FLP event length");
    const byte = view.getUint8(state.offset++);
    const digit = byte & 0x7f;
    value += digit * multiplier;
    if (!Number.isSafeInteger(value) || value > 0xffffffff) {
      corrupt("FLP event length is out of range.");
    }
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
  }
  corrupt("FLP event length varint is too long.");
}

function readEvents(
  buffer: ArrayBuffer,
  view: DataView,
  start: number,
  end: number,
): FlpEvent[] {
  const events: FlpEvent[] = [];
  const state = { offset: start };
  while (state.offset < end) {
    requireBytes(state.offset, 1, end, "FLP event opcode");
    const opcode = view.getUint8(state.offset++);
    if (opcode === 0xac) {
      requireBytes(state.offset, 3, end, "FLP 0xAC event");
      events.push({
        opcode,
        kind: "blob",
        payload: new Uint8Array(buffer, state.offset, 3),
      });
      state.offset += 3;
      continue;
    }
    if (opcode < 0x40) {
      requireBytes(state.offset, 1, end, "FLP byte event");
      events.push({ opcode, kind: "u8", value: view.getUint8(state.offset) });
      state.offset++;
      continue;
    }
    if (opcode < 0x80) {
      requireBytes(state.offset, 2, end, "FLP word event");
      events.push({
        opcode,
        kind: "u16",
        value: view.getUint16(state.offset, true),
      });
      state.offset += 2;
      continue;
    }
    if (opcode < 0xc0) {
      requireBytes(state.offset, 4, end, "FLP dword event");
      events.push({
        opcode,
        kind: "u32",
        value: view.getUint32(state.offset, true),
      });
      state.offset += 4;
      continue;
    }

    const length = readVarInt(view, state, end);
    requireBytes(state.offset, length, end, "FLP data event");
    events.push({
      opcode,
      kind: "blob",
      payload: new Uint8Array(buffer, state.offset, length),
    });
    state.offset += length;
  }
  if (state.offset !== end) corrupt("FLP event stream exceeds its data block.");
  return events;
}

function decodeAscii(payload: Uint8Array): string {
  let end = payload.length;
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    payload.subarray(0, end),
  );
}

function decodeUtf16Le(payload: Uint8Array): string {
  if (payload.length < 2) return "";
  let end = payload.length - (payload.length % 2);
  for (let i = 0; i + 1 < payload.length; i += 2) {
    if (payload[i] === 0 && payload[i + 1] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder("utf-16le", { fatal: false }).decode(
    payload.subarray(0, end),
  );
}

function parseVersion(events: readonly FlpEvent[]): FlpVersion | undefined {
  for (const event of events) {
    if (event.opcode !== 0xc7 || event.kind !== "blob") continue;
    const version = decodeAscii(event.payload).trim();
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(version);
    if (match === null) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = match[3] === undefined ? 0 : Number(match[3]);
    if (
      Number.isSafeInteger(major) &&
      Number.isSafeInteger(minor) &&
      Number.isSafeInteger(patch)
    ) {
      return { major, minor, patch };
    }
  }
  return undefined;
}

function usesLegacyText(version: FlpVersion | undefined): boolean {
  return (
    version !== undefined &&
    (version.major < 11 || (version.major === 11 && version.minor < 5))
  );
}

function decodeName(payload: Uint8Array, legacy: boolean): string | undefined {
  const name = legacy ? decodeAscii(payload) : decodeUtf16Le(payload);
  return name.length === 0 ? undefined : name;
}

function decodeChannelKind(
  value: number,
): Exclude<FlpChannel["kind"], undefined> {
  switch (value) {
    case 0:
      return "sampler";
    case 2:
    case 4:
      return "instrument";
    case 3:
      return "layer";
    case 5:
      return "automation";
    default:
      return "unknown";
  }
}

interface PrintableAsciiRun {
  readonly offset: number;
  readonly text: string;
}

function printableAsciiRuns(
  payload: Uint8Array,
  minimumLength: number = 4,
): PrintableAsciiRun[] {
  const runs: PrintableAsciiRun[] = [];
  for (let start = 0; start < payload.length;) {
    while (
      start < payload.length &&
      (payload[start] < 0x20 || payload[start] > 0x7e)
    )
      start++;
    let end = start;
    while (end < payload.length && payload[end] >= 0x20 && payload[end] <= 0x7e)
      end++;
    if (end - start >= minimumLength) {
      runs.push({
        offset: start,
        text: new TextDecoder("ascii").decode(payload.subarray(start, end)),
      });
    }
    start = end + 1;
  }
  return runs;
}

function cleanStatePath(candidate: string): string {
  const environmentVariable = candidate.indexOf("%");
  if (environmentVariable >= 0)
    candidate = candidate.slice(environmentVariable);
  const drivePath = /[A-Za-z]:[\\/]/.exec(candidate);
  if (drivePath?.index != null) candidate = candidate.slice(drivePath.index);
  return candidate.replace(/^[^A-Za-z0-9%._~\\/-]+/, "").trim();
}

function findStatePath(
  payload: Uint8Array,
  extensions: readonly string[],
): string | undefined {
  for (const run of printableAsciiRuns(payload)) {
    const lower = run.text.toLowerCase();
    for (const extension of extensions) {
      const extensionIndex = lower.lastIndexOf(extension);
      if (extensionIndex < 0) continue;
      return cleanStatePath(
        run.text.slice(0, extensionIndex + extension.length),
      );
    }
  }
  return undefined;
}

function decodeSoundFontPlayerState(payload: Uint8Array): {
  statePath?: string;
  statePreset?: string;
} {
  const info: { statePath?: string; statePreset?: string } = {};
  const statePath = findStatePath(payload, [".sf2", ".sf3"]);
  if (statePath != null) info.statePath = statePath;
  if (payload.byteLength >= 8) {
    const presetNumber = new DataView(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    ).getUint32(4, true);
    if (presetNumber <= 0xffff) info.statePreset = `Preset ${presetNumber}`;
  }
  return info;
}

function decodeVstWrapper(payload: Uint8Array): {
  name?: string;
  vendor?: string;
} {
  const info: { name?: string; vendor?: string } = {};
  if (payload.byteLength < 4) return info;
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  let offset = 4;
  while (offset + 12 <= payload.byteLength) {
    const id = view.getUint32(offset, true);
    const length = view.getBigUint64(offset + 4, true);
    const remaining = BigInt(payload.byteLength - offset - 12);
    if (length > remaining) break;
    const dataLength = Number(length);
    const data = payload.subarray(offset + 12, offset + 12 + dataLength);
    if (id === 54) {
      const name = decodeAscii(data);
      if (name !== "") info.name = name;
    } else if (id === 56) {
      const vendor = decodeAscii(data);
      if (vendor !== "") info.vendor = vendor;
    }
    offset += 12 + dataLength;
  }
  return info;
}

function buildChannels(
  events: readonly FlpEvent[],
  legacyText: boolean,
): FlpChannel[] {
  const channels: FlpChannel[] = [];
  const channelsById = new Map<number, FlpChannel>();
  const preferredNames = new Set<number>();
  const pluginEvents = new Set<number>();
  let current: FlpChannel | undefined;
  let inChannelScope = false;

  for (const event of events) {
    if (event.opcode === 0x40 && event.kind === "u16") {
      current = channelsById.get(event.value);
      if (current === undefined) {
        current = { id: event.value };
        channelsById.set(event.value, current);
        channels.push(current);
      }
      inChannelScope = true;
      continue;
    }
    if (
      event.opcode === 0x62 ||
      event.opcode === 0x93 ||
      event.opcode === 0xec
    ) {
      inChannelScope = false;
      continue;
    }
    if (!inChannelScope || current === undefined || event.kind !== "blob") {
      if (
        inChannelScope &&
        current !== undefined &&
        event.opcode === 0x15 &&
        event.kind === "u8"
      ) {
        current.kind = decodeChannelKind(event.value);
      }
      continue;
    }

    if (event.opcode === 0xc4) {
      const samplePath = decodeName(event.payload, legacyText);
      if (samplePath !== undefined) current.samplePath = samplePath;
    } else if (event.opcode === 0xc9 && current.plugin === undefined) {
      pluginEvents.add(current.id);
      const internalName = decodeName(event.payload, legacyText);
      if (internalName !== undefined) current.plugin = { internalName };
    } else if (event.opcode === 0xd5 && current.plugin != null) {
      if (current.plugin.internalName === "Fruity Wrapper") {
        const wrapper = decodeVstWrapper(event.payload);
        if (wrapper.name !== undefined) current.plugin.name = wrapper.name;
        if (wrapper.vendor !== undefined)
          current.plugin.vendor = wrapper.vendor;
      } else if (
        current.plugin.internalName.toLowerCase() === "fruity soundfont player"
      ) {
        const state = decodeSoundFontPlayerState(event.payload);
        if (state.statePath !== undefined)
          current.plugin.statePath = state.statePath;
        if (state.statePreset !== undefined)
          current.plugin.statePreset = state.statePreset;
      }
    } else if (event.opcode === 0xcb && !preferredNames.has(current.id)) {
      const name = decodeName(event.payload, legacyText);
      if (name !== undefined) {
        current.name = name;
        preferredNames.add(current.id);
      }
    } else if (
      event.opcode === 0xc0 &&
      current.name === undefined &&
      !preferredNames.has(current.id)
    ) {
      const name = decodeName(event.payload, legacyText);
      if (name !== undefined) current.name = name;
    }
  }
  for (const channel of channels) {
    if (
      channel.kind === "instrument" &&
      channel.samplePath !== undefined &&
      pluginEvents.has(channel.id) &&
      channel.plugin === undefined
    ) {
      channel.kind = "sampler";
    }
  }

  return channels;
}

function decodeNotes(payload: Uint8Array): FlpNote[] {
  if (payload.byteLength % NOTE_RECORD_SIZE !== 0) {
    corrupt("Malformed FLP piano-roll note records.");
  }
  const notes: FlpNote[] = [];
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  for (
    let offset = 0;
    offset < payload.byteLength;
    offset += NOTE_RECORD_SIZE
  ) {
    const flags = view.getUint16(offset + 4, true);
    notes.push({
      position: view.getUint32(offset, true),
      length: view.getUint32(offset + 8, true),
      key: view.getUint16(offset + 12, true),
      velocity: view.getUint8(offset + 21),
      channelId: view.getUint16(offset + 6, true),
      flags,
      slide: (flags & NOTE_FLAG_SLIDE) !== 0,
      midiChannel: view.getUint8(offset + 19),
      finePitch: view.getUint8(offset + 16),
      pan: view.getUint8(offset + 20),
      modX: view.getUint8(offset + 22),
      modY: view.getUint8(offset + 23),
    });
  }
  return notes;
}

function buildPatterns(
  events: readonly FlpEvent[],
  version: FlpVersion | undefined,
  legacyText: boolean,
): FlpPattern[] {
  const builders: PatternBuilder[] = [];
  const byId = new Map<number, PatternBuilder>();
  let current: PatternBuilder | undefined;

  for (const event of events) {
    if (event.opcode === 0x41 && event.kind === "u16") {
      current = byId.get(event.value);
      if (current === undefined) {
        current = {
          id: event.value,
          notes: [],
          modernNotePayloads: [],
          legacyNotePayloads: [],
        };
        byId.set(event.value, current);
        builders.push(current);
      }
      continue;
    }
    if (current === undefined) continue;
    if (
      event.opcode === 0xc1 &&
      event.kind === "blob" &&
      current.name === undefined
    ) {
      const name = decodeName(event.payload, legacyText);
      if (name !== undefined) current.name = name;
      continue;
    }
    if (
      event.opcode === 0xa4 &&
      event.kind === "u32" &&
      current.length === undefined
    ) {
      current.length = event.value;
      continue;
    }
    if (event.opcode === 0xe0 && event.kind === "blob") {
      current.modernNotePayloads.push(event.payload);
      continue;
    }
    if (event.opcode === 0xd0 && event.kind === "blob") {
      current.legacyNotePayloads.push(event.payload);
    }
  }

  const allowLegacyNotes = version === undefined || version.major < 25;
  for (const builder of builders) {
    const payloads =
      builder.modernNotePayloads.length > 0
        ? builder.modernNotePayloads
        : allowLegacyNotes
          ? builder.legacyNotePayloads
          : [];
    for (const payload of payloads) builder.notes.push(...decodeNotes(payload));
  }

  return builders.map((builder: PatternBuilder): FlpPattern => {
    const pattern: FlpPattern = { id: builder.id, notes: builder.notes };
    if (builder.name !== undefined) pattern.name = builder.name;
    if (builder.length !== undefined) pattern.length = builder.length;
    return pattern;
  });
}

function playlistRecordSize(
  payloadLength: number,
  version: FlpVersion | undefined,
): number | undefined {
  if (payloadLength === 0) return undefined;
  if (version !== undefined) {
    const expected = version.major >= 25 ? 80 : version.major >= 21 ? 60 : 32;
    if (payloadLength % expected !== 0) {
      corrupt(`Malformed FLP playlist records for FL Studio ${version.major}.`);
    }
    return expected;
  }

  const candidates = [80, 60, 32].filter(
    (recordSize: number): boolean => payloadLength % recordSize === 0,
  );
  if (candidates.length !== 1) {
    corrupt(
      "FLP playlist record size is missing or ambiguous without a version.",
    );
  }
  return candidates[0];
}

function playlistMaxTrack(version: FlpVersion | undefined): number {
  if (
    version !== undefined &&
    (version.major < 12 ||
      (version.major === 12 &&
        (version.minor < 9 || (version.minor === 9 && version.patch < 1))))
  ) {
    return LEGACY_PLAYLIST_MAX_TRACK;
  }
  return MODERN_PLAYLIST_MAX_TRACK;
}

function decodePlaylistOffset(value: number): number | null {
  return value === PLAYLIST_UNSET_OFFSET ||
    value === LEGACY_PLAYLIST_UNSET_OFFSET
    ? null
    : value;
}

function decodePlaylistClips(
  payload: Uint8Array,
  version: FlpVersion | undefined,
  patternIds: ReadonlySet<number>,
): FlpPlaylistClip[] {
  const recordSize = playlistRecordSize(payload.byteLength, version);
  if (recordSize === undefined) return [];
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const maxTrack = playlistMaxTrack(version);
  const clips: FlpPlaylistClip[] = [];
  for (let offset = 0; offset < payload.byteLength; offset += recordSize) {
    const itemIndex = view.getUint16(offset + 6, true);
    const reversedTrack = view.getUint16(offset + 12, true);
    if (itemIndex <= PLAYLIST_PATTERN_BASE || reversedTrack > maxTrack)
      continue;
    const patternId = itemIndex - PLAYLIST_PATTERN_BASE;
    if (!patternIds.has(patternId)) continue;
    const startOffset = view.getUint32(offset + 24, true);
    const endOffset = view.getUint32(offset + 28, true);
    clips.push({
      position: view.getUint32(offset, true),
      length: view.getUint32(offset + 8, true),
      patternId,
      track: maxTrack - reversedTrack,
      startOffset: decodePlaylistOffset(startOffset),
      endOffset: decodePlaylistOffset(endOffset),
    });
  }
  return clips;
}

function buildArrangements(
  events: readonly FlpEvent[],
  version: FlpVersion | undefined,
  patterns: readonly FlpPattern[],
  legacyText: boolean,
): FlpArrangement[] {
  const arrangements: FlpArrangement[] = [];
  const byId = new Map<number, FlpArrangement>();
  const patternIds = new Set(
    patterns.map((pattern: FlpPattern): number => pattern.id),
  );
  const hasArrangementMarkers = events.some(
    (event: FlpEvent): boolean => event.opcode === 0x63 && event.kind === "u16",
  );
  const trackDataOpcode =
    version !== undefined && version.major < 25 ? 0xde : 0xee;
  const trackNameOpcode =
    version !== undefined && version.major < 25 ? 0xdf : 0xef;
  let current: FlpArrangement | undefined;

  for (const event of events) {
    if (event.opcode === 0x63 && event.kind === "u16") {
      current = byId.get(event.value);
      if (current === undefined) {
        current = { id: event.value, tracks: [], clips: [] };
        byId.set(event.value, current);
        arrangements.push(current);
      }
      continue;
    }
    if (
      current === undefined &&
      !hasArrangementMarkers &&
      event.kind === "blob" &&
      (event.opcode === trackDataOpcode ||
        event.opcode === trackNameOpcode ||
        event.opcode === 0xe9)
    ) {
      // FL versions from before multiple arrangements store one project-wide
      // playlist without announcing it with an arrangement marker.
      current = { id: 0, tracks: [], clips: [] };
      arrangements.push(current);
    }
    if (
      event.opcode === trackDataOpcode &&
      event.kind === "blob" &&
      current !== undefined
    ) {
      current.tracks.push({ index: current.tracks.length });
      continue;
    }
    if (
      event.opcode === trackNameOpcode &&
      event.kind === "blob" &&
      current !== undefined
    ) {
      const track = current.tracks[current.tracks.length - 1];
      const name = decodeName(event.payload, legacyText);
      if (track !== undefined && name !== undefined) track.name = name;
      continue;
    }
    if (
      event.opcode === 0xe9 &&
      event.kind === "blob" &&
      current !== undefined
    ) {
      current.clips.push(
        ...decodePlaylistClips(event.payload, version, patternIds),
      );
    }
  }
  return arrangements;
}

function findTempo(events: readonly FlpEvent[]): number {
  for (const event of events) {
    if (event.opcode === 0x9c && event.kind === "u32" && event.value > 0) {
      return event.value / 1000;
    }
  }

  let coarse: number | undefined;
  let fine: number | undefined;
  for (const event of events) {
    if (event.opcode === 0x42 && event.kind === "u16" && coarse === undefined) {
      coarse = event.value;
    } else if (
      event.opcode === 0x5d &&
      event.kind === "u16" &&
      fine === undefined
    ) {
      fine = event.value / 1000;
    }
  }
  if (coarse === undefined) return 120;
  const legacyTempo = coarse + (fine ?? 0);
  return legacyTempo > 0 ? legacyTempo : 120;
}

function findBeatsPerBar(events: readonly FlpEvent[]): number {
  let numerator: number | undefined;
  let denominator: number | undefined;
  for (const event of events) {
    if (
      event.opcode === 0x11 &&
      event.kind === "u8" &&
      numerator === undefined
    ) {
      numerator = event.value;
    } else if (
      event.opcode === 0x12 &&
      event.kind === "u8" &&
      denominator === undefined
    ) {
      denominator = event.value;
    }
  }
  if (
    numerator === undefined ||
    denominator === undefined ||
    denominator === 0
  ) {
    return 4;
  }
  const beatsPerBar = (numerator * 4) / denominator;
  return Number.isSafeInteger(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
}

function findCurrentArrangementId(
  events: readonly FlpEvent[],
): number | undefined {
  for (const event of events) {
    if (event.opcode === 0x64 && event.kind === "u16") return event.value;
  }
  return undefined;
}

function parseFlpProjectInternal(buffer: ArrayBuffer): FlpProject {
  const view = new DataView(buffer);
  if (!matchesMagic(view, 0, FLHD_MAGIC)) {
    throw new FlpImportError("invalid", "Invalid FLP file header.");
  }

  let offset = FLHD_MAGIC.length;
  requireBytes(offset, 4, view.byteLength, "FLhd length");
  const headerLength = view.getUint32(offset, true);
  offset += 4;
  if (headerLength !== FLHD_LENGTH) {
    corrupt(`Unsupported or corrupt FLhd length ${headerLength}.`);
  }
  requireBytes(offset, headerLength, view.byteLength, "FLhd data");
  // The legacy format and channel-count header fields are not authoritative.
  offset += 4;
  const ppq = view.getUint16(offset, true);
  offset += 2;
  if (ppq === 0) corrupt("FLP project PPQ must be greater than zero.");

  if (!matchesMagic(view, offset, FLDT_MAGIC)) {
    corrupt("Missing or corrupt FLdt block.");
  }
  offset += FLDT_MAGIC.length;
  requireBytes(offset, 4, view.byteLength, "FLdt length");
  const dataLength = view.getUint32(offset, true);
  offset += 4;
  requireBytes(offset, dataLength, view.byteLength, "FLdt data");
  const dataEnd = offset + dataLength;
  if (dataEnd !== view.byteLength) {
    corrupt("FLP file contains data outside its FLdt block.");
  }

  const events = readEvents(buffer, view, offset, dataEnd);
  const version = parseVersion(events);
  const legacyText = usesLegacyText(version);
  const channels = buildChannels(events, legacyText);
  const patterns = buildPatterns(events, version, legacyText);
  const arrangements = buildArrangements(events, version, patterns, legacyText);
  const project: FlpProject = {
    ppq,
    tempo: findTempo(events),
    beatsPerBar: findBeatsPerBar(events),
    channels,
    patterns,
    arrangements,
  };
  if (version !== undefined) project.versionMajor = version.major;
  const currentArrangementId = findCurrentArrangementId(events);
  if (currentArrangementId !== undefined) {
    project.currentArrangementId = currentArrangementId;
  }
  return project;
}

export function parseFlpProject(buffer: ArrayBuffer): FlpProject {
  try {
    return parseFlpProjectInternal(buffer);
  } catch (error: unknown) {
    if (error instanceof FlpImportError) throw error;
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new FlpImportError(
      "corrupt",
      `Unsupported or corrupt FLP structure.${detail}`,
    );
  }
}
