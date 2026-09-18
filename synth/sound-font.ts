// Distributed under the Unlicense.
// SF2 record parsing follows the MIT-licensed @logue/sf2synth parser embedded in
// UltraBox's website/sample_extractor.html. Zone resolution and playback data are
// Intentionally native GoopBox code.

export interface SoundFontEnvelopeSettings {
  readonly target: "noteVolume" | "noteFilterAllFreqs";
  readonly envelope: "decay" | "tremolo";
  readonly speed: number;
  readonly a: number;
  readonly b: number;
}

export interface SoundFontInstrumentSettings {
  readonly pan: number;
  readonly fadeInSeconds: number;
  readonly fadeOutSeconds: number;
  readonly vibrato: "none" | "light" | "delayed" | "heavy";
  readonly filterCutoffHz: number | null;
  readonly filterGain: number;
  readonly envelopes: readonly SoundFontEnvelopeSettings[];
}

export interface SoundFontSample {
  readonly name: string;
  readonly data: Int16Array;
  readonly sampleRate: number;
  readonly start: number;
  readonly end: number;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly originalPitch: number;
  readonly pitchCorrection: number;
  readonly sampleLink: number;
  readonly sampleType: number;
}

export interface SoundFontZone {
  readonly index: number;
  readonly keyLow: number;
  readonly keyHigh: number;
  readonly velocityLow: number;
  readonly velocityHigh: number;
  readonly sample: SoundFontSample;
  readonly start: number;
  readonly end: number;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly loopMode: number;
  readonly rootKey: number;
  readonly fixedKey: number | null;
  readonly tuneCents: number;
  readonly scaleTuning: number;
  readonly generators: ReadonlyMap<number, number>;
}

export interface SoundFontPreset {
  readonly index: number;
  readonly name: string;
  readonly bankMSB: number;
  readonly bankLSB: number;
  readonly program: number;
  readonly isDrum: boolean;
  readonly zones: readonly SoundFontZone[];
}

export interface SoundFontBank {
  readonly presets: readonly SoundFontPreset[];
}

const matchingZoneCaches = new WeakMap<SoundFontPreset, Map<number, readonly SoundFontZone[]>>();

export enum SoundFontGenerator {
  startAddrsOffset = 0,
  endAddrsOffset = 1,
  startloopAddrsOffset = 2,
  endloopAddrsOffset = 3,
  startAddrsCoarseOffset = 4,
  modLfoToPitch = 5,
  vibLfoToPitch = 6,
  modEnvToPitch = 7,
  initialFilterFc = 8,
  initialFilterQ = 9,
  modLfoToFilterFc = 10,
  modEnvToFilterFc = 11,
  endAddrsCoarseOffset = 12,
  modLfoToVolume = 13,
  chorusEffectsSend = 15,
  reverbEffectsSend = 16,
  pan = 17,
  delayModLFO = 21,
  freqModLFO = 22,
  delayVibLFO = 23,
  freqVibLFO = 24,
  delayModEnv = 25,
  attackModEnv = 26,
  holdModEnv = 27,
  decayModEnv = 28,
  sustainModEnv = 29,
  releaseModEnv = 30,
  keynumToModEnvHold = 31,
  keynumToModEnvDecay = 32,
  delayVolEnv = 33,
  attackVolEnv = 34,
  holdVolEnv = 35,
  decayVolEnv = 36,
  sustainVolEnv = 37,
  releaseVolEnv = 38,
  keynumToVolEnvHold = 39,
  keynumToVolEnvDecay = 40,
  instrument = 41,
  keyRange = 43,
  velRange = 44,
  startloopAddrsCoarseOffset = 45,
  keynum = 46,
  velocity = 47,
  initialAttenuation = 48,
  endloopAddrsCoarseOffset = 50,
  coarseTune = 51,
  fineTune = 52,
  sampleID = 53,
  sampleModes = 54,
  scaleTuning = 56,
  exclusiveClass = 57,
  overridingRootKey = 58,
}

interface Chunk {
  readonly id: string;
  readonly offset: number;
  readonly size: number;
}

interface Header {
  readonly name: string;
  readonly program: number;
  readonly bank: number;
  readonly bagIndex: number;
}

interface Bag {
  readonly generatorIndex: number;
}

interface InstrumentHeader {
  readonly name: string;
  readonly bagIndex: number;
}

interface Range {
  readonly low: number;
  readonly high: number;
}

interface GeneratorSet {
  readonly values: Map<number, number>;
  keyRange: Range | null;
  velocityRange: Range | null;
}

const fullRange = (): Range => ({ low: 0, high: 127 });

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function readName(bytes: Uint8Array, offset: number, length: number): string {
  let end: number = offset;
  while (end < offset + length && bytes[end]! !== 0) {
    end++;
  }
  let name = "";
  for (let i: number = offset; i < end; i++) {
    name += String.fromCharCode(bytes[i]!);
  }
  return name.trim();
}

function readChunks(bytes: Uint8Array, view: DataView, start: number, end: number): Chunk[] {
  const chunks: Chunk[] = [];
  let offset: number = start;
  while (offset < end) {
    if (offset + 8 > end) {
      throw new Error("Truncated SoundFont chunk header.");
    }
    const size: number = view.getUint32(offset + 4, true),
      dataOffset: number = offset + 8;
    if (size > end - dataOffset) {
      throw new Error("SoundFont chunk exceeds its container.");
    }
    chunks.push({ id: readFourCC(bytes, offset), offset: dataOffset, size });
    offset = dataOffset + size + (size & 1);
  }
  if (offset !== end) {
    throw new Error("Invalid SoundFont chunk padding.");
  }
  return chunks;
}

function findList(bytes: Uint8Array, chunks: readonly Chunk[], type: string): Chunk {
  const chunk: Chunk | undefined = chunks.find(
    (candidate: Chunk): boolean =>
      candidate.id === "LIST" &&
      candidate.size >= 4 &&
      readFourCC(bytes, candidate.offset) === type,
  );
  if (chunk === undefined) {
    throw new Error(`Missing SoundFont ${type} list.`);
  }
  return chunk;
}

function findChunk(chunks: readonly Chunk[], id: string): Chunk {
  const chunk: Chunk | undefined = chunks.find((candidate: Chunk): boolean => candidate.id === id);
  if (chunk === undefined) {
    throw new Error(`Missing SoundFont ${id} chunk.`);
  }
  return chunk;
}

function recordCount(chunk: Chunk, recordSize: number, terminalRequired = false): number {
  if (chunk.size % recordSize !== 0) {
    throw new Error(`Invalid SoundFont ${chunk.id} table size.`);
  }
  const count: number = chunk.size / recordSize;
  if (terminalRequired && count < 1) {
    throw new Error(`SoundFont ${chunk.id} table is empty.`);
  }
  return count;
}

function parsePresetHeaders(bytes: Uint8Array, view: DataView, chunk: Chunk): Header[] {
  const count: number = recordCount(chunk, 38, true),
    headers: Header[] = [];
  for (let i = 0; i < count; i++) {
    const offset: number = chunk.offset + i * 38;
    headers.push({
      name: readName(bytes, offset, 20),
      program: view.getUint16(offset + 20, true),
      bank: view.getUint16(offset + 22, true),
      bagIndex: view.getUint16(offset + 24, true),
    });
  }
  return headers;
}

function parseBags(view: DataView, chunk: Chunk): Bag[] {
  const count: number = recordCount(chunk, 4, true),
    bags: Bag[] = [];
  for (let i = 0; i < count; i++) {
    bags.push({ generatorIndex: view.getUint16(chunk.offset + i * 4, true) });
  }
  return bags;
}

function parseInstrumentHeaders(
  bytes: Uint8Array,
  view: DataView,
  chunk: Chunk,
): InstrumentHeader[] {
  const count: number = recordCount(chunk, 22, true),
    headers: InstrumentHeader[] = [];
  for (let i = 0; i < count; i++) {
    const offset: number = chunk.offset + i * 22;
    headers.push({
      name: readName(bytes, offset, 20),
      bagIndex: view.getUint16(offset + 20, true),
    });
  }
  return headers;
}

function parseGenerators(view: DataView, chunk: Chunk): GeneratorSet[] {
  const count: number = recordCount(chunk, 4),
    generators: GeneratorSet[] = [];
  for (let i = 0; i < count; i++) {
    const offset: number = chunk.offset + i * 4,
      type: number = view.getUint16(offset, true),
      generator: GeneratorSet = {
        values: new Map(),
        keyRange: null,
        velocityRange: null,
      };
    if (type === SoundFontGenerator.keyRange) {
      generator.keyRange = {
        low: view.getUint8(offset + 2),
        high: view.getUint8(offset + 3),
      };
    } else if (type === SoundFontGenerator.velRange) {
      generator.velocityRange = {
        low: view.getUint8(offset + 2),
        high: view.getUint8(offset + 3),
      };
    } else {
      const unsigned: boolean =
        type === SoundFontGenerator.instrument || type === SoundFontGenerator.sampleID;
      generator.values.set(
        type,
        unsigned ? view.getUint16(offset + 2, true) : view.getInt16(offset + 2, true),
      );
    }
    generators.push(generator);
  }
  return generators;
}

function intersect(first: Range, second: Range): Range {
  return {
    low: Math.max(first.low, second.low),
    high: Math.min(first.high, second.high),
  };
}

const overridingGenerators: ReadonlySet<number> = new Set([
  SoundFontGenerator.instrument,
  SoundFontGenerator.keynum,
  SoundFontGenerator.velocity,
  SoundFontGenerator.sampleID,
  SoundFontGenerator.sampleModes,
  SoundFontGenerator.exclusiveClass,
  SoundFontGenerator.overridingRootKey,
]);

function overlayGenerators(...sets: readonly GeneratorSet[]): GeneratorSet {
  const merged: GeneratorSet = {
    values: new Map(),
    keyRange: null,
    velocityRange: null,
  };
  for (const set of sets) {
    if (set.keyRange != null) {
      merged.keyRange = set.keyRange;
    }
    if (set.velocityRange != null) {
      merged.velocityRange = set.velocityRange;
    }
    for (const [type, value] of set.values) {
      merged.values.set(type, value);
    }
  }
  return merged;
}

const generatorDefaults: ReadonlyMap<number, number> = new Map([
  [SoundFontGenerator.initialFilterFc, 13_500],
  [SoundFontGenerator.delayModLFO, -12_000],
  [SoundFontGenerator.delayVibLFO, -12_000],
  [SoundFontGenerator.delayModEnv, -12_000],
  [SoundFontGenerator.attackModEnv, -12_000],
  [SoundFontGenerator.holdModEnv, -12_000],
  [SoundFontGenerator.decayModEnv, -12_000],
  [SoundFontGenerator.releaseModEnv, -12_000],
  [SoundFontGenerator.delayVolEnv, -12_000],
  [SoundFontGenerator.attackVolEnv, -12_000],
  [SoundFontGenerator.holdVolEnv, -12_000],
  [SoundFontGenerator.decayVolEnv, -12_000],
  [SoundFontGenerator.releaseVolEnv, -12_000],
  [SoundFontGenerator.scaleTuning, 100],
]);

function combinePresetAndInstrument(preset: GeneratorSet, instrument: GeneratorSet): GeneratorSet {
  const combined: GeneratorSet = {
      values: new Map(),
      keyRange: intersect(preset.keyRange ?? fullRange(), instrument.keyRange ?? fullRange()),
      velocityRange: intersect(
        preset.velocityRange ?? fullRange(),
        instrument.velocityRange ?? fullRange(),
      ),
    },
    types = new Set<number>([
      ...generatorDefaults.keys(),
      ...preset.values.keys(),
      ...instrument.values.keys(),
    ]);
  for (const type of types) {
    if (overridingGenerators.has(type)) {
      const value: number | undefined = instrument.values.get(type);
      if (value !== undefined) {
        combined.values.set(type, value);
      }
    } else {
      combined.values.set(
        type,
        (instrument.values.get(type) ?? generatorDefaults.get(type) ?? 0) +
          (preset.values.get(type) ?? 0),
      );
    }
  }
  return combined;
}

function readBagGenerators(
  bags: readonly Bag[],
  generators: readonly GeneratorSet[],
  bagIndex: number,
): GeneratorSet {
  if (bagIndex < 0 || bagIndex + 1 >= bags.length) {
    throw new Error("Invalid SoundFont bag index.");
  }
  const start: number = bags[bagIndex]!.generatorIndex,
    end: number = bags[bagIndex + 1]!.generatorIndex;
  if (start > end || end > generators.length) {
    throw new Error("Invalid SoundFont generator index.");
  }
  return overlayGenerators(...generators.slice(start, end));
}

function parseSamples(
  bytes: Uint8Array,
  view: DataView,
  sampleChunk: Chunk,
  headerChunk: Chunk,
): SoundFontSample[] {
  if (sampleChunk.id !== "smpl" || (sampleChunk.size & 1) !== 0) {
    throw new Error("Invalid SoundFont sample data chunk.");
  }
  const samplePointCount: number = sampleChunk.size >> 1,
    sampleData: Int16Array = new Int16Array(view.buffer, sampleChunk.offset, samplePointCount),
    headerCount: number = recordCount(headerChunk, 46, true),
    samples: SoundFontSample[] = [];
  for (let i = 0; i < headerCount - 1; i++) {
    const offset: number = headerChunk.offset + i * 46,
      start: number = view.getUint32(offset + 20, true),
      end: number = view.getUint32(offset + 24, true),
      absoluteLoopStart: number = view.getUint32(offset + 28, true),
      absoluteLoopEnd: number = view.getUint32(offset + 32, true);
    if (start > end || end > samplePointCount) {
      throw new Error("SoundFont sample range is out of bounds.");
    }
    const loopStart: number = Math.max(start, Math.min(end, absoluteLoopStart)),
      loopEnd: number = Math.max(loopStart, Math.min(end, absoluteLoopEnd));
    samples.push({
      name: readName(bytes, offset, 20),
      data: sampleData,
      sampleRate: view.getUint32(offset + 36, true),
      start,
      end,
      loopStart,
      loopEnd,
      originalPitch: view.getUint8(offset + 40),
      pitchCorrection: view.getInt8(offset + 41),
      sampleLink: view.getUint16(offset + 42, true),
      sampleType: view.getUint16(offset + 44, true),
    });
  }
  return samples;
}

function generatorValue(
  generators: ReadonlyMap<number, number>,
  type: SoundFontGenerator,
  fallback = 0,
): number {
  return generators.get(type) ?? fallback;
}

function createZone(
  index: number,
  generators: GeneratorSet,
  samples: readonly SoundFontSample[],
): SoundFontZone | null {
  const sampleIndex: number | undefined = generators.values.get(SoundFontGenerator.sampleID);
  if (sampleIndex === undefined || sampleIndex < 0 || sampleIndex >= samples.length) {
    return null;
  }
  const keyRange: Range = generators.keyRange ?? fullRange(),
    velocityRange: Range = generators.velocityRange ?? fullRange();
  if (keyRange.low > keyRange.high || velocityRange.low > velocityRange.high) {
    return null;
  }
  const sample: SoundFontSample = samples[sampleIndex]!;
  if (sample.sampleRate <= 0 || sample.end <= sample.start || (sample.sampleType & 0x80_00) !== 0) {
    return null;
  }
  const startOffset: number =
      generatorValue(generators.values, SoundFontGenerator.startAddrsOffset) +
      generatorValue(generators.values, SoundFontGenerator.startAddrsCoarseOffset) * 32_768,
    endOffset: number =
      generatorValue(generators.values, SoundFontGenerator.endAddrsOffset) +
      generatorValue(generators.values, SoundFontGenerator.endAddrsCoarseOffset) * 32_768,
    loopStartOffset: number =
      generatorValue(generators.values, SoundFontGenerator.startloopAddrsOffset) +
      generatorValue(generators.values, SoundFontGenerator.startloopAddrsCoarseOffset) * 32_768,
    loopEndOffset: number =
      generatorValue(generators.values, SoundFontGenerator.endloopAddrsOffset) +
      generatorValue(generators.values, SoundFontGenerator.endloopAddrsCoarseOffset) * 32_768,
    start: number = Math.max(0, Math.min(sample.data.length, sample.start + startOffset)),
    end: number = Math.max(start, Math.min(sample.data.length, sample.end + endOffset)),
    loopStart: number = Math.max(start, Math.min(end, sample.loopStart + loopStartOffset)),
    loopEnd: number = Math.max(loopStart, Math.min(end, sample.loopEnd + loopEndOffset)),
    sampleRootKey: number =
      sample.originalPitch >= 0 && sample.originalPitch <= 127 ? sample.originalPitch : 60,
    rootKeyGenerator: number | undefined = generators.values.get(
      SoundFontGenerator.overridingRootKey,
    ),
    rootKey: number =
      rootKeyGenerator !== undefined && rootKeyGenerator >= 0 && rootKeyGenerator <= 127
        ? rootKeyGenerator
        : sampleRootKey,
    fixedKeyGenerator: number | undefined = generators.values.get(SoundFontGenerator.keynum),
    tuneCents: number =
      generatorValue(generators.values, SoundFontGenerator.coarseTune) * 100 +
      generatorValue(generators.values, SoundFontGenerator.fineTune) +
      sample.pitchCorrection,
    requestedLoopMode: number =
      generatorValue(generators.values, SoundFontGenerator.sampleModes) & 3;
  return {
    index,
    keyLow: keyRange.low,
    keyHigh: keyRange.high,
    velocityLow: velocityRange.low,
    velocityHigh: velocityRange.high,
    sample,
    start,
    end,
    loopStart,
    loopEnd,
    loopMode: loopEnd - loopStart >= 2 ? requestedLoopMode : 0,
    rootKey,
    fixedKey:
      fixedKeyGenerator !== undefined && fixedKeyGenerator >= 0 && fixedKeyGenerator <= 127
        ? fixedKeyGenerator
        : null,
    tuneCents,
    scaleTuning: Math.max(
      0,
      Math.min(1200, generatorValue(generators.values, SoundFontGenerator.scaleTuning, 100)),
    ),
    generators: generators.values,
  };
}

export function parseSoundFont(data: ArrayBuffer): SoundFontBank {
  const bytes: Uint8Array = new Uint8Array(data),
    view: DataView = new DataView(data);
  if (bytes.length < 12 || readFourCC(bytes, 0) !== "RIFF" || readFourCC(bytes, 8) !== "sfbk") {
    throw new Error("Invalid SoundFont RIFF header.");
  }
  const riffSize: number = view.getUint32(4, true);
  if (riffSize < 4 || riffSize > bytes.length - 8) {
    throw new Error("SoundFont RIFF size exceeds file bounds.");
  }
  const rootChunks: Chunk[] = readChunks(bytes, view, 12, 8 + riffSize),
    sampleList: Chunk = findList(bytes, rootChunks, "sdta"),
    presetList: Chunk = findList(bytes, rootChunks, "pdta"),
    sampleChunks: Chunk[] = readChunks(
      bytes,
      view,
      sampleList.offset + 4,
      sampleList.offset + sampleList.size,
    ),
    presetChunks: Chunk[] = readChunks(
      bytes,
      view,
      presetList.offset + 4,
      presetList.offset + presetList.size,
    ),
    presetHeaders: Header[] = parsePresetHeaders(bytes, view, findChunk(presetChunks, "phdr")),
    presetBags: Bag[] = parseBags(view, findChunk(presetChunks, "pbag")),
    presetGenerators: GeneratorSet[] = parseGenerators(view, findChunk(presetChunks, "pgen")),
    instrumentHeaders: InstrumentHeader[] = parseInstrumentHeaders(
      bytes,
      view,
      findChunk(presetChunks, "inst"),
    ),
    instrumentBags: Bag[] = parseBags(view, findChunk(presetChunks, "ibag")),
    instrumentGenerators: GeneratorSet[] = parseGenerators(view, findChunk(presetChunks, "igen")),
    samples: SoundFontSample[] = parseSamples(
      bytes,
      view,
      findChunk(sampleChunks, "smpl"),
      findChunk(presetChunks, "shdr"),
    );
  if (presetHeaders.length < 2) {
    throw new Error("SoundFont contains no preset terminal record.");
  }
  if (instrumentHeaders.length < 2) {
    throw new Error("SoundFont contains no instrument terminal record.");
  }

  const presets: SoundFontPreset[] = [];
  let zoneIndex = 0;
  for (let presetIndex = 0; presetIndex < presetHeaders.length - 1; presetIndex++) {
    const header: Header = presetHeaders[presetIndex]!,
      nextHeader: Header = presetHeaders[presetIndex + 1]!;
    if (header.bagIndex > nextHeader.bagIndex || nextHeader.bagIndex >= presetBags.length) {
      throw new Error("Invalid SoundFont preset bag range.");
    }
    let presetGlobal: GeneratorSet = overlayGenerators();
    const presetZones: GeneratorSet[] = [];
    for (let bagIndex: number = header.bagIndex; bagIndex < nextHeader.bagIndex; bagIndex++) {
      const generators: GeneratorSet = readBagGenerators(presetBags, presetGenerators, bagIndex);
      if (generators.values.has(SoundFontGenerator.instrument)) {
        presetZones.push(generators);
      } else if (bagIndex === header.bagIndex) {
        presetGlobal = generators;
      }
    }

    const zones: SoundFontZone[] = [];
    for (const presetZone of presetZones) {
      const instrumentIndex: number = generatorValue(
        presetZone.values,
        SoundFontGenerator.instrument,
        -1,
      );
      if (instrumentIndex < 0 || instrumentIndex + 1 >= instrumentHeaders.length) {
        continue;
      }
      const instrumentHeader: InstrumentHeader = instrumentHeaders[instrumentIndex]!,
        nextInstrumentHeader: InstrumentHeader = instrumentHeaders[instrumentIndex + 1]!;
      if (
        instrumentHeader.bagIndex > nextInstrumentHeader.bagIndex ||
        nextInstrumentHeader.bagIndex >= instrumentBags.length
      ) {
        throw new Error("Invalid SoundFont instrument bag range.");
      }
      let instrumentGlobal: GeneratorSet = overlayGenerators();
      const instrumentZones: GeneratorSet[] = [];
      for (
        let bagIndex: number = instrumentHeader.bagIndex;
        bagIndex < nextInstrumentHeader.bagIndex;
        bagIndex++
      ) {
        const generators: GeneratorSet = readBagGenerators(
          instrumentBags,
          instrumentGenerators,
          bagIndex,
        );
        if (generators.values.has(SoundFontGenerator.sampleID)) {
          instrumentZones.push(generators);
        } else if (bagIndex === instrumentHeader.bagIndex) {
          instrumentGlobal = generators;
        }
      }
      const resolvedPreset: GeneratorSet = overlayGenerators(presetGlobal, presetZone);
      for (const instrumentZone of instrumentZones) {
        const resolvedInstrument: GeneratorSet = overlayGenerators(
            instrumentGlobal,
            instrumentZone,
          ),
          zone: SoundFontZone | null = createZone(
            zoneIndex++,
            combinePresetAndInstrument(resolvedPreset, resolvedInstrument),
            samples,
          );
        if (zone != null) {
          zones.push(zone);
        }
      }
    }

    presets.push({
      index: presetIndex,
      name: header.name || `Preset ${presetIndex + 1}`,
      bankMSB: header.bank & 127,
      bankLSB: header.bank >> 8,
      program: header.program,
      isDrum: (header.bank & 128) !== 0,
      zones,
    });
  }
  return { presets };
}

export function getSoundFontZones(
  preset: SoundFontPreset,
  key: number,
  velocity: number,
): readonly SoundFontZone[] {
  const normalizedKey: number = Math.max(0, Math.min(127, Math.round(key))),
    normalizedVelocity: number = Math.max(0, Math.min(127, Math.round(velocity)));
  let cache: Map<number, readonly SoundFontZone[]> | undefined = matchingZoneCaches.get(preset);
  if (cache === undefined) {
    cache = new Map();
    matchingZoneCaches.set(preset, cache);
  }
  const cacheKey: number = (normalizedKey << 7) | normalizedVelocity;
  let zones: readonly SoundFontZone[] | undefined = cache.get(cacheKey);
  if (zones === undefined) {
    zones = preset.zones.filter(
      (zone: SoundFontZone): boolean =>
        normalizedKey >= zone.keyLow &&
        normalizedKey <= zone.keyHigh &&
        normalizedVelocity >= zone.velocityLow &&
        normalizedVelocity <= zone.velocityHigh,
    );
    cache.set(cacheKey, zones);
  }
  return zones;
}

const timecentsToSeconds = (timecents: number): number =>
    timecents <= -12_000 ? 0 : 2 ** (timecents / 1200),
  centsToHz = (cents: number): number => 8.176 * 2 ** (cents / 1200);

function getRepresentativeZones(preset: SoundFontPreset): readonly SoundFontZone[] {
  for (const key of [60, 64, 48, 72, 36, 84]) {
    const zones: readonly SoundFontZone[] = getSoundFontZones(preset, key, 100);
    if (zones.length > 0) {
      return zones;
    }
  }
  return preset.zones;
}

export function getSoundFontInstrumentSettings(
  preset: SoundFontPreset,
): SoundFontInstrumentSettings {
  const zones: readonly SoundFontZone[] = getRepresentativeZones(preset),
    generator = (type: SoundFontGenerator, fallback = 0): number => {
      if (zones.length === 0) {
        return fallback;
      }
      return (
        zones.reduce(
          (sum: number, zone: SoundFontZone): number =>
            sum + generatorValue(zone.generators, type, fallback),
          0,
        ) / zones.length
      );
    },
    delaySeconds: number = timecentsToSeconds(generator(SoundFontGenerator.delayVolEnv, -12_000)),
    attackSeconds: number = timecentsToSeconds(generator(SoundFontGenerator.attackVolEnv, -12_000)),
    decaySeconds: number = timecentsToSeconds(generator(SoundFontGenerator.decayVolEnv, -12_000)),
    releaseSeconds: number = timecentsToSeconds(
      generator(SoundFontGenerator.releaseVolEnv, -12_000),
    ),
    sustainGain: number = 10 ** (-Math.max(0, generator(SoundFontGenerator.sustainVolEnv)) / 200),
    pan: number = Math.max(
      0,
      Math.min(100, Math.round(50 + generator(SoundFontGenerator.pan) / 10)),
    ),
    vibratoLfoDepth: number = Math.abs(generator(SoundFontGenerator.vibLfoToPitch)),
    modulationLfoDepth: number = Math.abs(generator(SoundFontGenerator.modLfoToPitch)),
    vibratoDepth: number = Math.max(vibratoLfoDepth, modulationLfoDepth) / 100,
    vibratoDelay: number = timecentsToSeconds(
      generator(
        vibratoLfoDepth >= modulationLfoDepth
          ? SoundFontGenerator.delayVibLFO
          : SoundFontGenerator.delayModLFO,
        -12_000,
      ),
    );
  let vibrato: SoundFontInstrumentSettings["vibrato"] = "none";
  if (vibratoDepth >= 0.05) {
    vibrato = vibratoDelay >= 0.1 ? "delayed" : vibratoDepth >= 0.35 ? "heavy" : "light";
  }

  const envelopes: SoundFontEnvelopeSettings[] = [];
  if (decaySeconds > 0 && sustainGain < 0.999) {
    envelopes.push({
      target: "noteVolume",
      envelope: "decay",
      speed: Math.min(64, 8 / decaySeconds),
      a: 1,
      b: sustainGain,
    });
  }

  const filterCents: number = generator(SoundFontGenerator.initialFilterFc, 13_500),
    filterCutoffHz: number | null = filterCents < 13_499 ? centsToHz(filterCents) : null,
    filterDepth: number = generator(SoundFontGenerator.modEnvToFilterFc),
    filterDecaySeconds: number = timecentsToSeconds(
      generator(SoundFontGenerator.decayModEnv, -12_000),
    ),
    filterSustain: number =
      1 - Math.max(0, Math.min(1000, generator(SoundFontGenerator.sustainModEnv))) / 1000;
  if (filterCutoffHz != null && Math.abs(filterDepth) >= 25 && filterDecaySeconds > 0) {
    const peakRatio: number = 2 ** (filterDepth / 1200),
      sustainRatio: number = 2 ** ((filterDepth * filterSustain) / 1200);
    envelopes.push({
      target: "noteFilterAllFreqs",
      envelope: "decay",
      speed: Math.min(64, 8 / filterDecaySeconds),
      a: peakRatio,
      b: sustainRatio,
    });
  }

  const tremoloDepth: number = Math.abs(generator(SoundFontGenerator.modLfoToVolume));
  if (
    tremoloDepth >= 10 &&
    !envelopes.some(
      (envelope: SoundFontEnvelopeSettings): boolean => envelope.target === "noteVolume",
    )
  ) {
    const frequencyCents: number = generator(SoundFontGenerator.freqModLFO),
      frequencyHz: number = centsToHz(frequencyCents);
    envelopes.push({
      target: "noteVolume",
      envelope: "tremolo",
      speed: Math.max(0.05, Math.min(16, frequencyHz)),
      a: 10 ** (-tremoloDepth / 200),
      b: 1,
    });
  }

  return {
    pan,
    fadeInSeconds: delaySeconds + attackSeconds,
    fadeOutSeconds: releaseSeconds,
    vibrato,
    filterCutoffHz,
    filterGain: Math.min(
      8,
      10 ** (Math.max(0, generator(SoundFontGenerator.initialFilterQ)) / 200),
    ),
    envelopes,
  };
}
