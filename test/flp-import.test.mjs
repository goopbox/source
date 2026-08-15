import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PATTERN_BASE = 20480;
const PARTS_PER_BEAT = 24;

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

function leb128(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function u8Event(opcode, value) {
  return Buffer.from([opcode, value]);
}

function u16Event(opcode, value) {
  const event = Buffer.alloc(3);
  event[0] = opcode;
  event.writeUInt16LE(value, 1);
  return event;
}

function u32Event(opcode, value) {
  const event = Buffer.alloc(5);
  event[0] = opcode;
  event.writeUInt32LE(value, 1);
  return event;
}

function blobEvent(opcode, payload) {
  return Buffer.concat([
    Buffer.from([opcode]),
    leb128(payload.length),
    payload,
  ]);
}

function fixedThreeByteEvent(opcode, a, b, c) {
  return Buffer.from([opcode, a, b, c]);
}

function utf16(value) {
  return Buffer.from(`${value}\0`, "utf16le");
}

function vstWrapperInfo({ name, vendor, state }) {
  const records = [];
  for (const [id, value] of [
    [53, state],
    [54, name],
    [56, vendor],
  ]) {
    if (value == null) continue;
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const header = Buffer.alloc(12);
    header.writeUInt32LE(id, 0);
    header.writeBigUInt64LE(BigInt(data.length), 4);
    records.push(header, data);
  }
  return Buffer.concat([Buffer.from([12, 0, 0, 0]), ...records]);
}

function fruitySoundFontState(path, presetNumber) {
  const header = Buffer.alloc(64, 0xff);
  header.writeUInt32LE(2, 0);
  header.writeUInt32LE(presetNumber, 4);
  return Buffer.concat([
    header,
    Buffer.from(`\\${path}`, "ascii"),
    Buffer.from([0, 0xff, 0xff, 0xff, 0xff]),
  ]);
}

function noteRecord({
  position = 0,
  length = 96,
  key = 60,
  channelId = 0,
  velocity = 100,
  flags = 0x4000,
  group = 0,
  finePitch = 120,
  release = 64,
  midiChannel = 0,
  pan = 64,
  modX = 128,
  modY = 128,
} = {}) {
  const note = Buffer.alloc(24);
  note.writeUInt32LE(position, 0);
  note.writeUInt16LE(flags, 4);
  note.writeUInt16LE(channelId, 6);
  note.writeUInt32LE(length, 8);
  note.writeUInt16LE(key, 12);
  note.writeUInt16LE(group, 14);
  note[16] = finePitch;
  note[18] = release;
  note[19] = midiChannel;
  note[20] = pan;
  note[21] = velocity;
  note[22] = modX;
  note[23] = modY;
  return note;
}

function playlistRecord({
  position = 0,
  length = 384,
  patternId = 1,
  track = 0,
  reversedTrack = null,
  startOffset = null,
  endOffset = null,
  unsetOffset = 0xffffffff,
  recordSize = 80,
} = {}) {
  const clip = Buffer.alloc(recordSize);
  clip.writeUInt32LE(position, 0);
  clip.writeUInt16LE(PATTERN_BASE, 4);
  clip.writeUInt16LE(PATTERN_BASE + patternId, 6);
  clip.writeUInt32LE(length, 8);
  clip.writeUInt16LE(reversedTrack ?? 499 - track, 12);
  clip.writeUInt16LE(120, 16);
  clip.writeUInt16LE(64, 18);
  clip[20] = 64;
  clip[21] = 100;
  clip[22] = 128;
  clip[23] = 128;
  // FL pattern clip offsets are raw project ticks. FL uses all-one bits,
  // or the legacy -1.0f bit pattern, when an offset was not explicitly set.
  clip.writeUInt32LE(startOffset ?? unsetOffset, 24);
  clip.writeUInt32LE(endOffset ?? unsetOffset, 28);
  if (recordSize >= 72) clip.writeDoubleLE(1, 64);
  return clip;
}

function flpContainer(
  eventData,
  { ppq = 96, declaredDataLength = eventData.length } = {},
) {
  const header = Buffer.alloc(14);
  header.write("FLhd", 0, "ascii");
  header.writeUInt32LE(6, 4);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(ppq, 12);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("FLdt", 0, "ascii");
  dataHeader.writeUInt32LE(declaredDataLength, 4);
  return exactArrayBuffer(Buffer.concat([header, dataHeader, eventData]));
}

function makeFlp({
  ppq = 96,
  versionMajor = 25,
  tempo = 120,
  beatsPerBar = 4,
  channels = [{ id: 0, name: "Channel 1" }],
  patterns = [{ id: 1, notes: [noteRecord()] }],
  clips = [{ patternId: 1 }],
  includeArrangement = true,
  includeArrangementMarker = true,
  arrangementId = 0,
  tracks = [],
  extraEvents = [],
  recordSize = versionMajor >= 25 ? 80 : versionMajor >= 21 ? 60 : 32,
  noteOpcode = versionMajor >= 25 ? 0xe0 : 0xd0,
} = {}) {
  const events = [
    blobEvent(0xc7, Buffer.from(`${versionMajor}.0.0.0\0`, "ascii")),
    u32Event(0x9c, Math.round(tempo * 1000)),
    u8Event(0x11, beatsPerBar),
    u8Event(0x12, 4),
  ];
  for (const channel of channels) {
    events.push(u16Event(0x40, channel.id));
    if (channel.name != null) events.push(blobEvent(0xcb, utf16(channel.name)));
  }
  events.push(...extraEvents);
  for (const pattern of patterns) {
    events.push(u16Event(0x41, pattern.id));
    if (pattern.name != null) events.push(blobEvent(0xc1, utf16(pattern.name)));
    if (pattern.length != null) events.push(u32Event(0xa4, pattern.length));
    events.push(
      blobEvent(pattern.noteOpcode ?? noteOpcode, Buffer.concat(pattern.notes)),
    );
  }
  if (includeArrangement) {
    if (includeArrangementMarker) events.push(u16Event(0x63, arrangementId));
    for (const track of tracks) {
      events.push(blobEvent(versionMajor >= 25 ? 0xee : 0xde, Buffer.alloc(0)));
      if (track.name != null)
        events.push(
          blobEvent(versionMajor >= 25 ? 0xef : 0xdf, utf16(track.name)),
        );
    }
    if (clips.length > 0) {
      events.push(
        blobEvent(
          0xe9,
          Buffer.concat(
            clips.map((clip) =>
              playlistRecord({
                ...clip,
                recordSize: clip.recordSize ?? recordSize,
              }),
            ),
          ),
        ),
      );
    }
  }
  return flpContainer(Buffer.concat(events), { ppq });
}

const loadedModule = (async () => {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-flp-import-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {parseFlpProject} from "./src/FlpParser.ts";',
        'export {convertFlpProject, importFlp, FlpImportError} from "./src/FlpImport.ts";',
        'export {Config} from "./synth/SynthConfig.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "flp-import-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { ...module, directory };
})();

after(async () => {
  const { directory } = await loadedModule;
  await rm(directory, { recursive: true });
});

function absoluteNotes(channel, beatsPerBar = 4) {
  const partsPerBar = beatsPerBar * PARTS_PER_BEAT;
  const result = [];
  for (let bar = 0; bar < channel.bars.length; bar++) {
    const patternNumber = channel.bars[bar];
    if (patternNumber === 0) continue;
    for (const note of channel.patterns[patternNumber - 1].notes) {
      result.push({
        start: bar * partsPerBar + note.start,
        end: bar * partsPerBar + note.end,
        pitches: [...note.pitches],
        size: note.pins[0].size,
        continuesLastPattern: note.continuesLastPattern,
      });
    }
  }
  return result;
}

async function assertFlpError(callback, kind) {
  const { FlpImportError } = await loadedModule;
  assert.throws(callback, (error) => {
    assert.ok(error instanceof FlpImportError);
    assert.equal(error.kind, kind);
    return true;
  });
}

test("imports one arranged pattern, channel, and note end to end", async () => {
  const { importFlp, parseFlpProject } = await loadedModule;
  const buffer = makeFlp({
    tempo: 137,
    channels: [{ id: 7, name: "Plain source" }],
    patterns: [
      {
        id: 3,
        notes: [
          noteRecord({ channelId: 7, key: 60, length: 96, velocity: 127 }),
        ],
      },
    ],
    clips: [{ patternId: 3, position: 0, length: 384, track: 4 }],
  });
  const project = parseFlpProject(buffer);
  assert.deepEqual(project.channels, [{ id: 7, name: "Plain source" }]);
  assert.deepEqual(project.arrangements[0].clips[0], {
    position: 0,
    length: 384,
    patternId: 3,
    track: 4,
    startOffset: null,
    endOffset: null,
  });
  const song = importFlp(buffer);
  assert.equal(song.tempo, 137);
  assert.equal(song.pitchChannels.length, 1);
  assert.deepEqual(absoluteNotes(song.pitchChannels[0]), [
    {
      start: 0,
      end: 24,
      pitches: [48],
      size: 10,
      continuesLastPattern: false,
    },
  ]);
});

test("keeps a simultaneous chord in one goopbox note", async () => {
  const { importFlp } = await loadedModule;
  const notes = [60, 64, 67].map((key) =>
    noteRecord({ key, length: 192, velocity: 100 }),
  );
  const song = importFlp(
    makeFlp({
      patterns: [{ id: 1, notes }],
      clips: [{ patternId: 1, length: 192 }],
    }),
  );
  assert.equal(song.pitchChannels.length, 1);
  const imported = absoluteNotes(song.pitchChannels[0]);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0].pitches, [48, 52, 55]);
});

test("routes notes from multiple FL channels in one pattern to separate output channels", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      channels: [{ id: 2 }, { id: 9 }],
      patterns: [
        {
          id: 1,
          notes: [
            noteRecord({ channelId: 2, key: 60 }),
            noteRecord({ channelId: 9, key: 72 }),
          ],
        },
      ],
    }),
  );
  assert.equal(song.pitchChannels.length, 2);
  assert.deepEqual(
    song.pitchChannels.map((channel) => absoluteNotes(channel)[0].pitches),
    [[48], [60]],
  );
});

test("expands every repeated playlist use of a pattern", async () => {
  const { importFlp } = await loadedModule;
  const clips = Array.from({ length: 10 }, (_, index) => ({
    patternId: 1,
    position: index * 384,
    length: 384,
  }));
  const song = importFlp(makeFlp({ clips }));
  assert.deepEqual(
    absoluteNotes(song.pitchChannels[0]).map((note) => note.start),
    Array.from({ length: 10 }, (_, index) => index * 96),
  );
});

test("resolves multiple playlist patterns into the same source channel timeline", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [
        { id: 1, notes: [noteRecord({ key: 60 })] },
        { id: 8, notes: [noteRecord({ key: 62 })] },
      ],
      clips: [
        { patternId: 1, position: 0, length: 384 },
        { patternId: 8, position: 384, length: 384 },
      ],
    }),
  );
  assert.equal(song.pitchChannels.length, 1);
  assert.deepEqual(
    absoluteNotes(song.pitchChannels[0]).map(({ start, pitches }) => ({
      start,
      pitches,
    })),
    [
      { start: 0, pitches: [48] },
      { start: 96, pitches: [50] },
    ],
  );
});

test("applies a nonzero playlist pattern start offset", async () => {
  const { importFlp, parseFlpProject, convertFlpProject } = await loadedModule;
  const buffer = makeFlp({
    patterns: [
      {
        id: 1,
        notes: [
          noteRecord({ position: 0, length: 48, key: 60 }),
          noteRecord({ position: 96, length: 96, key: 64 }),
        ],
      },
    ],
    clips: [{ patternId: 1, length: 96, startOffset: 96 }],
  });
  const project = parseFlpProject(buffer);
  assert.equal(project.arrangements[0].clips[0].startOffset, 96);
  assert.deepEqual(
    absoluteNotes(convertFlpProject(project).pitchChannels[0]).map(
      ({ start, end, pitches }) => ({ start, end, pitches }),
    ),
    [{ start: 0, end: 24, pitches: [52] }],
  );
  assert.equal(importFlp(buffer).pitchChannels.length, 1);
});

test("excludes notes outside clip bounds and truncates a note at the right boundary", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [
        {
          id: 1,
          notes: [
            noteRecord({ position: 0, length: 48, key: 60 }),
            noteRecord({ position: 96, length: 144, key: 62 }),
            noteRecord({ position: 240, length: 48, key: 64 }),
          ],
        },
      ],
      clips: [{ patternId: 1, length: 96, startOffset: 96, endOffset: 192 }],
    }),
  );
  assert.deepEqual(
    absoluteNotes(song.pitchChannels[0]).map(({ start, end, pitches }) => ({
      start,
      end,
      pitches,
    })),
    [{ start: 0, end: 24, pitches: [50] }],
  );
});

test("preserves raw lengths and velocities and maps them deterministically", async () => {
  const { parseFlpProject, convertFlpProject } = await loadedModule;
  const buffer = makeFlp({
    patterns: [
      {
        id: 1,
        notes: [
          noteRecord({ position: 0, length: 48, key: 60, velocity: 1 }),
          noteRecord({ position: 96, length: 192, key: 62, velocity: 127 }),
        ],
      },
    ],
  });
  const project = parseFlpProject(buffer);
  assert.deepEqual(
    project.patterns[0].notes.map(({ position, length, velocity }) => ({
      position,
      length,
      velocity,
    })),
    [
      { position: 0, length: 48, velocity: 1 },
      { position: 96, length: 192, velocity: 127 },
    ],
  );
  assert.deepEqual(
    absoluteNotes(convertFlpProject(project).pitchChannels[0]).map(
      ({ start, end, size }) => ({ start, end, size }),
    ),
    [
      { start: 0, end: 12, size: 1 },
      { start: 24, end: 72, size: 10 },
    ],
  );
});

test("retains zero-length FL step triggers as minimum-length notes", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    patterns: [
      {
        id: 1,
        notes: [
          noteRecord({
            position: 48,
            length: 0,
            key: 60,
          }),
        ],
      },
    ],
  });
  assert.equal(parseFlpProject(buffer).patterns[0].notes[0].length, 0);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0]).map(({ start, end }) => ({
      start,
      end,
    })),
    [{ start: 12, end: 13 }],
  );
});

test("splits sustained notes across bars with continuation metadata", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [{ id: 1, notes: [noteRecord({ length: 480 })] }],
      clips: [{ patternId: 1, length: 480 }],
    }),
  );
  assert.deepEqual(
    absoluteNotes(song.pitchChannels[0]).map(
      ({ start, end, continuesLastPattern }) => ({
        start,
        end,
        continuesLastPattern,
      }),
    ),
    [
      { start: 0, end: 96, continuesLastPattern: false },
      { start: 96, end: 120, continuesLastPattern: true },
    ],
  );
});

test("splits staggered overlaps into exactly two lanes without splitting a chord", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [
        {
          id: 1,
          notes: [
            noteRecord({ position: 0, length: 192, key: 60 }),
            noteRecord({ position: 0, length: 192, key: 64 }),
            noteRecord({ position: 96, length: 192, key: 67 }),
          ],
        },
      ],
    }),
  );
  assert.equal(song.pitchChannels.length, 2);
  const allPitches = song.pitchChannels.flatMap((channel) =>
    absoluteNotes(channel).map((note) => note.pitches),
  );
  assert.ok(
    allPitches.some(
      (pitches) =>
        pitches.length === 2 && pitches.includes(48) && pitches.includes(52),
    ),
  );
  assert.ok(
    allPitches.some((pitches) => pitches.length === 1 && pitches[0] === 55),
  );
});

test("skips unknown events without losing note data", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      extraEvents: [
        u8Event(0x3f, 0xa5),
        blobEvent(0xfe, Buffer.from([1, 2, 3, 4, 5])),
      ],
    }),
  );
  assert.equal(absoluteNotes(song.pitchChannels[0]).length, 1);
});

test("keeps event alignment across FL 25's fixed-three-byte 0xAC event", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({ extraEvents: [fixedThreeByteEvent(0xac, 1, 1, 0)] });
  const project = parseFlpProject(buffer);
  assert.equal(project.patterns[0].notes.length, 1);
  assert.equal(absoluteNotes(importFlp(buffer).pitchChannels[0]).length, 1);
});

test("rejects malformed and physically truncated note events as controlled corruption", async () => {
  const { parseFlpProject } = await loadedModule;
  const malformed = makeFlp({
    patterns: [{ id: 1, notes: [Buffer.alloc(23)] }],
  });
  await assertFlpError(() => parseFlpProject(malformed), "corrupt");

  const truncatedEvent = Buffer.concat([
    u16Event(0x41, 1),
    Buffer.from([0xe0, 24]),
    Buffer.alloc(8),
  ]);
  await assertFlpError(
    () => parseFlpProject(flpContainer(truncatedEvent)),
    "corrupt",
  );
  await assertFlpError(
    () =>
      parseFlpProject(
        flpContainer(truncatedEvent, {
          declaredDataLength: truncatedEvent.length + 16,
        }),
      ),
    "corrupt",
  );
});

test("converts a non-default 480 PPQ timebase exactly", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    ppq: 480,
    patterns: [{ id: 1, notes: [noteRecord({ position: 120, length: 240 })] }],
    clips: [{ patternId: 1, position: 480, length: 480 }],
  });
  assert.equal(parseFlpProject(buffer).ppq, 480);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0]).map(({ start, end }) => ({
      start,
      end,
    })),
    [{ start: 30, end: 42 }],
  );
});

test("parses FL channel instruments and carries their source details to every output lane", async () => {
  const { importFlp, parseFlpProject } = await loadedModule;
  const buffer = makeFlp({
    channels: [{ id: 0, name: "Lead Rack" }],
    patterns: [
      {
        id: 1,
        notes: [
          noteRecord({ position: 0, length: 192 }),
          noteRecord({ position: 96, length: 192 }),
        ],
      },
    ],
    clips: [{ patternId: 1, track: 4 }],
    tracks: [{}, {}, {}, {}, { name: "Lead Bus" }],
    extraEvents: [
      u8Event(0x15, 4),
      blobEvent(0xc4, utf16("%FLStudioFactoryData%/Packs/Lead.wav")),
      blobEvent(0xc9, utf16("Fruity Wrapper")),
      blobEvent(
        0xd5,
        vstWrapperInfo({ name: "Serum", vendor: "Xfer Records" }),
      ),
    ],
  });
  const project = parseFlpProject(buffer);
  assert.equal(project.arrangements[0].tracks[4].name, "Lead Bus");
  assert.deepEqual(project.channels, [
    {
      id: 0,
      name: "Lead Rack",
      kind: "instrument",
      samplePath: "%FLStudioFactoryData%/Packs/Lead.wav",
      plugin: {
        internalName: "Fruity Wrapper",
        name: "Serum",
        vendor: "Xfer Records",
      },
    },
  ]);
  const song = importFlp(buffer);
  assert.equal(song.pitchChannels.length, 2);
  assert.deepEqual(
    song.channelSources,
    [0, 1].map((laneIndex) => ({
      sourceChannelId: 0,
      name: "Lead Rack",
      kind: "instrument",
      samplePath: "%FLStudioFactoryData%/Packs/Lead.wav",
      plugin: {
        internalName: "Fruity Wrapper",
        name: "Serum",
        vendor: "Xfer Records",
      },
      playlistTracks: [4],
      playlistTrackNames: ["Lead Bus"],
      laneIndex,
      laneCount: 2,
    })),
  );
  assert.equal(absoluteNotes(song.pitchChannels[0]).length, 1);
});

test("extracts the chosen SoundFont and preset number from Fruity Soundfont Player state", async () => {
  const { importFlp, parseFlpProject } = await loadedModule;
  const statePath =
    "%SystemDrive%\\Program Files\\Image-Line\\FL Studio\\Data\\Patches\\Soundfonts\\EarthBound.sf2";
  const buffer = makeFlp({
    channels: [{ id: 0, name: "od" }],
    extraEvents: [
      blobEvent(0xc9, utf16("Fruity soundfont player")),
      blobEvent(0xd5, fruitySoundFontState(statePath, 20)),
    ],
  });
  assert.deepEqual(parseFlpProject(buffer).channels[0].plugin, {
    internalName: "Fruity soundfont player",
    statePath,
    statePreset: "Preset 20",
  });
  assert.equal(importFlp(buffer).channelSources[0].plugin.statePath, statePath);
});

test("ignores VST wrapper preset state while preserving the FL channel and plugin names", async () => {
  const { parseFlpProject } = await loadedModule;
  const buffer = makeFlp({
    channels: [{ id: 0, name: "shreddage" }],
    extraEvents: [
      u16Event(0x40, 0),
      blobEvent(0xc9, utf16("Fruity Wrapper")),
      blobEvent(
        0xd5,
        vstWrapperInfo({
          name: "Kontakt 5",
          vendor: "Native Instruments",
          state: Buffer.from(
            "C:\\Libraries\\Shreddage X\\Shreddage X.nki\0",
            "ascii",
          ),
        }),
      ),
    ],
  });
  const project = parseFlpProject(buffer);
  assert.deepEqual(project.channels[0], {
    id: 0,
    name: "shreddage",
    plugin: {
      internalName: "Fruity Wrapper",
      name: "Kontakt 5",
      vendor: "Native Instruments",
    },
  });
});
test("keeps malformed native plugin state opaque after reading its instrument name", async () => {
  const { importFlp, parseFlpProject } = await loadedModule;
  const buffer = makeFlp({
    extraEvents: [
      blobEvent(0xc9, utf16("Unsupported Generator")),
      blobEvent(0xd5, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0, 1, 2, 3])),
    ],
  });
  assert.deepEqual(parseFlpProject(buffer).channels[0].plugin, {
    internalName: "Unsupported Generator",
  });
  const song = importFlp(buffer);
  assert.equal(
    song.channelSources[0].plugin.internalName,
    "Unsupported Generator",
  );
  assert.equal(absoluteNotes(song.pitchChannels[0]).length, 1);
});

test("recognizes FL's instrument-typed sampler placeholder", async () => {
  const { parseFlpProject } = await loadedModule;
  const project = parseFlpProject(
    makeFlp({
      extraEvents: [
        u8Event(0x15, 4),
        blobEvent(0xc4, utf16("Packs/Snare.wav")),
        blobEvent(0xc9, Buffer.alloc(0)),
      ],
    }),
  );
  assert.equal(project.channels[0].kind, "sampler");
});

test("decodes slide, note-color, fine-pitch, pan, and modulation fields", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    patterns: [
      {
        id: 1,
        notes: [
          noteRecord({ length: 192 }),
          noteRecord({
            position: 96,
            flags: 0x4008,
            midiChannel: 7,
            finePitch: 137,
            pan: 23,
            modX: 45,
            modY: 231,
          }),
        ],
      },
    ],
  });
  const note = parseFlpProject(buffer).patterns[0].notes[1];
  assert.deepEqual(
    {
      flags: note.flags,
      slide: note.slide,
      midiChannel: note.midiChannel,
      finePitch: note.finePitch,
      pan: note.pan,
      modX: note.modX,
      modY: note.modY,
    },
    {
      flags: 0x4008,
      slide: true,
      midiChannel: 7,
      finePitch: 137,
      pan: 23,
      modX: 45,
      modY: 231,
    },
  );
  assert.equal(absoluteNotes(importFlp(buffer).pitchChannels[0]).length, 1);
});

test("converts FL slide notes into persistent goopbox pitch-bend pins", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [
        {
          id: 1,
          notes: [
            noteRecord({ position: 0, length: 384, key: 60, midiChannel: 3 }),
            noteRecord({
              position: 96,
              length: 96,
              key: 72,
              midiChannel: 3,
              flags: 0x4008,
            }),
          ],
        },
      ],
    }),
  );
  const note = song.pitchChannels[0].patterns[0].notes[0];

  assert.deepEqual(note.pitches, [48]);
  assert.deepEqual(
    note.pins.map(({ time, interval }) => ({ time, interval })),
    [
      { time: 0, interval: 0 },
      { time: 24, interval: 0 },
      { time: 48, interval: 12 },
      { time: 96, interval: 12 },
    ],
  );
});

test("uses the highest same-color chord tone as an FL slide reference", async () => {
  const { importFlp } = await loadedModule;
  const song = importFlp(
    makeFlp({
      patterns: [
        {
          id: 1,
          notes: [
            noteRecord({ position: 0, length: 384, key: 60, midiChannel: 2 }),
            noteRecord({ position: 0, length: 384, key: 64, midiChannel: 2 }),
            noteRecord({
              position: 96,
              length: 96,
              key: 72,
              midiChannel: 2,
              flags: 0x4008,
            }),
          ],
        },
      ],
    }),
  );
  const note = song.pitchChannels[0].patterns[0].notes[0];

  assert.deepEqual(note.pitches, [48, 52]);
  assert.deepEqual(
    note.pins.map(({ time, interval }) => ({ time, interval })),
    [
      { time: 0, interval: 0 },
      { time: 24, interval: 0 },
      { time: 48, interval: 8 },
      { time: 96, interval: 8 },
    ],
  );
});

test("supports an FL 24 D0 note stream and 60-byte playlist clips", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    versionMajor: 24,
    patterns: [
      {
        id: 2,
        noteOpcode: 0xd0,
        notes: [noteRecord({ position: 48, length: 48, key: 65 })],
      },
    ],
    clips: [{ patternId: 2, position: 96, length: 192 }],
  });
  const project = parseFlpProject(buffer);
  assert.equal(project.versionMajor, 24);
  assert.equal(project.arrangements[0].clips.length, 1);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0]).map(
      ({ start, end, pitches }) => ({ start, end, pitches }),
    ),
    [{ start: 36, end: 48, pitches: [53] }],
  );
});

test("supports an FL 20 E0 note stream and 32-byte playlist clips", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    versionMajor: 20,
    patterns: [{ id: 1, noteOpcode: 0xe0, notes: [noteRecord({ key: 69 })] }],
  });
  const project = parseFlpProject(buffer);
  assert.equal(project.patterns[0].notes[0].key, 69);
  assert.equal(project.arrangements[0].clips.length, 1);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0])[0].pitches,
    [57],
  );
});

test("imports a legacy playlist with no explicit arrangement marker", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    versionMajor: 12,
    includeArrangementMarker: false,
    patterns: [{ id: 1, noteOpcode: 0xe0, notes: [noteRecord({ key: 67 })] }],
    clips: [{ patternId: 1, reversedTrack: 197 }],
  });
  const project = parseFlpProject(buffer);
  assert.equal(project.arrangements.length, 1);
  assert.equal(project.arrangements[0].clips.length, 1);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0])[0].pitches,
    [55],
  );
});

test("recognizes legacy negative-one float playlist offsets as unset", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  const buffer = makeFlp({
    versionMajor: 12,
    patterns: [{ id: 1, noteOpcode: 0xe0, notes: [noteRecord({ key: 71 })] }],
    clips: [{ patternId: 1, reversedTrack: 197, unsetOffset: 0xbf800000 }],
  });
  const clip = parseFlpProject(buffer).arrangements[0].clips[0];
  assert.equal(clip.startOffset, null);
  assert.equal(clip.endOffset, null);
  assert.deepEqual(
    absoluteNotes(importFlp(buffer).pitchChannels[0])[0].pitches,
    [59],
  );
});

test("reports invalid FLP magic and projects with no arrangement data", async () => {
  const { parseFlpProject, importFlp } = await loadedModule;
  await assertFlpError(
    () => parseFlpProject(exactArrayBuffer(Buffer.from("not an FLP"))),
    "invalid",
  );
  await assertFlpError(
    () => importFlp(makeFlp({ includeArrangement: false })),
    "empty",
  );
  await assertFlpError(() => importFlp(makeFlp({ clips: [] })), "empty");
});
