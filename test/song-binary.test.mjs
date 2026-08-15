import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { deflateSync } from "fflate";

async function loadSongModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-song-binary-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {Note, Song} from "./synth/synth.ts";',
        'export {decodeBinaryValue, encodeBinaryValue} from "./synth/BinaryCodec.ts";',
        'export {decodeSongBinary, encodeSongBinary} from "./synth/SongBinary.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "song-binary-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { ...module, cleanup: () => rm(directory, { recursive: true }) };
}

function crc32(bytes) {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = (value & 1) != 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  let checksum = 0xffffffff;
  for (const byte of bytes)
    checksum = table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function encodeLegacySongBinary(body) {
  const result = new Uint8Array(10 + body.length + 4);
  result.set([0x53, 0x4c, 0x44, 0x47, 1, 0], 0);
  const view = new DataView(result.buffer);
  view.setUint32(6, body.length);
  result.set(body, 10);
  view.setUint32(10 + body.length, crc32(result.subarray(0, 10 + body.length)));
  return result;
}

function encodeVersion2SongBinary(body) {
  const compressed = deflateSync(body, { level: 9 });
  const result = new Uint8Array(5 + compressed.length + 4);
  result.set([0x53, 0x4c, 0x44, 0x47, 2], 0);
  result.set(compressed, 5);
  const view = new DataView(result.buffer);
  view.setUint32(
    result.length - 4,
    crc32(result.subarray(0, result.length - 4)),
  );
  return result;
}

test("songs round-trip as deterministic compressed binary", async (context) => {
  const { Note, Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  song.tempo = 217;
  song.channels[0].octave = 5;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(new Note(24, 0, 12, 7));

  const first = song.toBinary();
  const second = song.toBinary();
  assert.ok(first instanceof Uint8Array);
  assert.deepEqual(first, second);
  assert.deepEqual(Array.from(first.subarray(0, 4)), [0x53, 0x4c, 0x44, 0x47]);
  assert.equal(first[4], 1);
  assert.throws(() => JSON.parse(new TextDecoder().decode(first)), SyntaxError);

  const restored = new Song(first);
  assert.equal(restored.tempo, 217);
  assert.equal(restored.channels[0].octave, 5);
  assert.deepEqual(restored.channels[0].patterns[0].notes[0].pitches, [24]);
  assert.deepEqual(restored.toBinary(), first);
});

test("song binary rejects the old uncompressed version 1 format", async (context) => {
  const { Song, decodeSongBinary, encodeBinaryValue, cleanup } =
    await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  song.tempo = 203;
  const legacy = encodeLegacySongBinary(
    encodeBinaryValue(song.toBinaryObject()),
  );
  assert.throws(() => new Song(legacy));
});

test("song binary rejects the old compressed version 2 format", async (context) => {
  const { Song, encodeBinaryValue, cleanup } = await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  song.tempo = 203;
  song.channels[0].octave = 5;
  const legacy = encodeVersion2SongBinary(
    encodeBinaryValue(song.toBinaryObject(), true),
  );
  assert.throws(() => new Song(legacy), /Unsupported \.goop version: 2/);
});

test("song binary rejects the old version 3 container", async (context) => {
  const { Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const version3 = new Uint8Array(
    Buffer.from(
      "U0xERwO7wyDIxMDAcOY0iwAHIwMLM+OEKZNYJk5lYDjLAhSexIxgMiGYDBOnMjGBmUcUBIAkPnCEcy/H2cWzQUwAEuwPYw==",
      "base64",
    ),
  );
  assert.throws(() => new Song(version3), /Unsupported \.goop version: 3/);
});

test("song binary rejects the old compact song body", async (context) => {
  const { Note, Song, encodeSongBinary, cleanup } = await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  song.tempo = 203;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(new Note(24, 0, 12, 7));
  const object = song.toBinaryObject();
  const compact = [
    1,
    object.scale,
    object.key,
    object.composingKey,
    object.tempo,
    object.beatsPerBar,
    object.barCount,
    object.patternsPerChannel,
    object.rhythm,
    object.loopStart,
    object.loopLength,
    object.pitchChannelCount,
    object.noiseChannelCount,
    object.assets,
    object.channels.map((channel) => [
      channel.octave,
      channel.instruments.map((instrument) => [
        instrument.type,
        instrument.preset,
        instrument.effects,
        0,
        0,
      ]),
      channel.patterns.map((pattern) =>
        pattern.notes.map((note) => [
          note.start,
          note.continuesLastPattern,
          note.pitches,
          note.pins.flatMap((pin) => [pin.interval, pin.time, pin.size]),
        ]),
      ),
      channel.bars,
    ]),
  ];
  assert.throws(
    () => new Song(encodeSongBinary(compact)),
    /Invalid compact \.goop song data/,
  );
});

test("compact song binary omits default instrument state and keeps links small", async (context) => {
  const { Note, Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const empty = new Song().toBinary();
  assert.ok(
    empty.length < 100,
    `default song should stay compact, got ${empty.length} bytes`,
  );

  const song = new Song();
  for (let patternIndex = 0; patternIndex < 8; patternIndex++) {
    song.channels[0].bars[patternIndex] = patternIndex + 1;
    for (let noteIndex = 0; noteIndex < 8; noteIndex++) {
      const start = noteIndex * 12;
      song.channels[0].patterns[patternIndex].notes.push(
        new Note(24 + (noteIndex % 5), start, start + 12, 7),
      );
    }
  }
  const binary = song.toBinary();
  assert.ok(
    binary.length < 200,
    `64-note song should stay compact, got ${binary.length} bytes`,
  );
  assert.deepEqual(new Song(binary).toBinary(), binary);
});

test("compact song binary preserves fractional note sizes", async (context) => {
  const { Note, Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  const note = new Note(24, 0, 12, 2.5);
  note.pins[1].size = 7.25;
  song.channels[0].patterns[0].notes.push(note);
  const restored = new Song(song.toBinary());
  assert.deepEqual(
    restored.channels[0].patterns[0].notes[0].pins.map((pin) => pin.size),
    [2.5, 7.25],
  );
});

test("compact song binary preserves mixed note sizes", async (context) => {
  const { Note, Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const song = new Song();
  const sizes = [8, 7, 9, 6, 5, 10, 8, 7];
  for (let patternIndex = 0; patternIndex < sizes.length; patternIndex++) {
    song.channels[0].bars[patternIndex] = patternIndex + 1;
    const note = new Note(
      24 + (patternIndex % 5),
      0,
      6 + (patternIndex % 4) * 3,
      sizes[patternIndex],
    );
    song.channels[0].patterns[patternIndex].notes.push(note);
  }
  const restored = new Song(song.toBinary());
  assert.deepEqual(
    restored.channels[0].patterns
      .slice(0, sizes.length)
      .map((pattern) => pattern.notes[0].pins[0].size),
    sizes,
  );
});

test("compact song binary resolves SoundFont asset references through the asset table", async (context) => {
  const { Song, decodeSongBinary, encodeSongBinary, cleanup } =
    await loadSongModules();
  context.after(cleanup);
  const source = "https://example.com/soundfonts/test.sf2";
  const songObject = new Song().toBinaryObject();
  songObject.assets = [source];
  songObject.channels[0].instruments[0].soundFontId = `asset:${source}`;
  const song = new Song(encodeSongBinary(songObject));
  const compact = decodeSongBinary(song.toBinary());
  assert.equal(compact[0], 1);
  const restored = new Song(song.toBinary());
  assert.equal(
    restored.channels[0].instruments[0].soundFontId,
    `asset:${source}`,
  );
  assert.deepEqual(
    restored.assets.map((asset) => asset.source),
    [source],
  );
});

test("song binary rejects unsupported, corrupt, and truncated files", async (context) => {
  const { Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const valid = new Song().toBinary();

  const unsupportedVersion = valid.slice();
  unsupportedVersion[4] = 255;
  assert.throws(
    () => new Song(unsupportedVersion),
    /Unsupported \.goop version: 255/,
  );

  const corrupt = valid.slice();
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => new Song(corrupt), /Corrupt \.goop file checksum/);

  assert.throws(() => new Song(valid.subarray(0, 9)), /Truncated \.goop file/);
  assert.throws(
    () => new Song(valid.subarray(0, valid.length - 1)),
    /Corrupt \.goop file checksum|Truncated \.goop file/,
  );
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  assert.throws(() => new Song(trailing), /Corrupt \.goop file checksum/);
});

test("song binary preserves Unicode asset and SoundFont identifiers", async (context) => {
  const { Song, decodeSongBinary, encodeSongBinary, cleanup } =
    await loadSongModules();
  context.after(cleanup);
  const songObject = new Song().toBinaryObject();
  songObject.assets = [
    "https://example.com/音源.sf2",
    "!r61!https://example.com/échantillon.wav",
  ];
  songObject.channels[0].instruments[0].soundFontId = "音源-é";
  songObject.channels[0].instruments[0].soundFontPreset = 0x12345;
  const songData = encodeSongBinary(songObject);
  const restored = new Song(songData);

  assert.deepEqual(
    restored.assets.map((asset) => asset.source),
    songObject.assets,
  );
  assert.equal(restored.channels[0].instruments[0].soundFontId, "音源-é");
  assert.equal(restored.channels[0].instruments[0].soundFontPreset, 0x12345);
  assert.deepEqual(
    new Song(restored.toBinary()).toBinaryObject(),
    restored.toBinaryObject(),
  );
});

test("binary codec works without TextEncoder and TextDecoder globals", async (context) => {
  const originalTextEncoder = globalThis.TextEncoder;
  const originalTextDecoder = globalThis.TextDecoder;
  try {
    globalThis.TextEncoder = undefined;
    globalThis.TextDecoder = undefined;
    const { decodeBinaryValue, encodeBinaryValue, cleanup } =
      await loadSongModules();
    context.after(cleanup);
    const value = { label: "Goop \ufeff 音源 🎛️" };
    assert.deepEqual(decodeBinaryValue(encodeBinaryValue(value)), value);
  } finally {
    globalThis.TextEncoder = originalTextEncoder;
    globalThis.TextDecoder = originalTextDecoder;
  }
});

test("compact binary object schemas round-trip and reduce repeated field names", async (context) => {
  const { decodeBinaryValue, encodeBinaryValue, cleanup } =
    await loadSongModules();
  context.after(cleanup);
  const value = {
    channels: Array.from({ length: 16 }, (_, index) => ({
      octave: index & 7,
      patterns: [
        {
          notes: [
            { start: 0, pitches: [12, 16, 19], continuesLastPattern: false },
          ],
        },
      ],
    })),
  };
  const verbose = encodeBinaryValue(value);
  const compact = encodeBinaryValue(value, true);
  assert.deepEqual(decodeBinaryValue(compact), value);
  assert.ok(
    compact.length < verbose.length,
    `${compact.length} should be smaller than ${verbose.length}`,
  );
});

test("binary codec stores byte arrays without expanding them into number arrays", async (context) => {
  const { decodeBinaryValue, encodeBinaryValue, cleanup } =
    await loadSongModules();
  context.after(cleanup);
  const bytes = Uint8Array.from({ length: 200 }, (_, index) => index);
  const encoded = encodeBinaryValue(bytes);
  assert.equal(encoded[0], 0xc4);
  assert.equal(encoded.length, bytes.length + 2);
  const decoded = decodeBinaryValue(encoded);
  assert.ok(decoded instanceof Uint8Array);
  assert.deepEqual(decoded, bytes);
});

test("binary codec rejects malformed UTF-8", async (context) => {
  const { decodeBinaryValue, cleanup } = await loadSongModules();
  context.after(cleanup);

  for (const bytes of [
    Uint8Array.of(0xa2, 0xc0, 0x80),
    Uint8Array.of(0xa3, 0xed, 0xa0, 0x80),
    Uint8Array.of(0xa4, 0xf4, 0x90, 0x80, 0x80),
  ]) {
    assert.throws(() => decodeBinaryValue(bytes), /invalid UTF-8/);
  }
});

test("binary values preserve a leading BOM and reject impossible array lengths", async (context) => {
  const { decodeBinaryValue, encodeBinaryValue, cleanup } =
    await loadSongModules();
  context.after(cleanup);

  const leadingBom = "\ufeffname";
  assert.equal(decodeBinaryValue(encodeBinaryValue(leadingBom)), leadingBom);

  const impossibleArray = Uint8Array.of(0xdd, 0x00, 0x0f, 0x42, 0x40);
  assert.throws(
    () => decodeBinaryValue(impossibleArray),
    /Truncated binary value/,
  );
});

test("song binary rejects JSON and invalid signatures", async (context) => {
  const { Song, cleanup } = await loadSongModules();
  context.after(cleanup);
  const json = new TextEncoder().encode('{"format":"goopbox-1","channels":[]}');
  assert.throws(() => new Song(json), /Invalid \.goop file signature/);

  const invalidSignature = new Song().toBinary();
  invalidSignature[0] = 0;
  assert.throws(
    () => new Song(invalidSignature),
    /Invalid \.goop file signature/,
  );
});
