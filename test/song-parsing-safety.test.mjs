import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynth() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-song-parsing-test-"));
  const outfile = join(directory, "synth.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./synth/synth.ts";',
        'export {decodeSongBinary, encodeSongBinary} from "./synth/SongBinary.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "song-parsing-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const synth = await import(pathToFileURL(outfile).href);
  return { synth, cleanup: () => rm(directory, { recursive: true }) };
}

function captureSong(song, Config) {
  return {
    serialized: song.toBinary(),
    assets: song.assets,
    channels: song.channels,
    channel: song.channels[0],
    instrument: song.channels[0].instruments[0],
    pattern: song.channels[0].patterns[0],
    note: song.channels[0].patterns[0].notes[0],
    chipWaves: Config.chipWaves,
  };
}

function assertSongUnchanged(song, Config, before) {
  assert.deepEqual(song.toBinary(), before.serialized);
  assert.strictEqual(song.assets, before.assets);
  assert.strictEqual(song.channels, before.channels);
  assert.strictEqual(song.channels[0], before.channel);
  assert.strictEqual(song.channels[0].instruments[0], before.instrument);
  assert.strictEqual(song.channels[0].patterns[0], before.pattern);
  assert.strictEqual(song.channels[0].patterns[0].notes[0], before.note);
  assert.strictEqual(Config.chipWaves, before.chipWaves);
}

test("invalid and unsupported binary songs do not mutate the current song", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Config, Note, Song, decodeSongBinary, encodeSongBinary } = synth;
  const song = new Song();
  song.tempo = 211;
  song.channels[0].muted = true;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(new Note(24, 0, 12, 7));

  let before = captureSong(song, Config);
  assert.throws(
    () => song.fromBinary(new TextEncoder().encode('{"format":"goopbox-1"}')),
    /Invalid \.goop file signature/,
  );
  assertSongUnchanged(song, Config, before);

  const unsupported = song.toBinary().slice();
  unsupported[4] = 255;
  before = captureSong(song, Config);
  assert.throws(
    () => song.fromBinary(unsupported),
    /Unsupported \.goop version: 255/,
  );
  assertSongUnchanged(song, Config, before);

  const emptyChannels = song.toBinaryObject();
  emptyChannels.channels = [];
  before = captureSong(song, Config);
  assert.throws(
    () => song.fromBinary(encodeSongBinary(emptyChannels)),
    /Invalid \.goop channel or instrument structure/,
  );
  assertSongUnchanged(song, Config, before);

  const emptyInstruments = song.toBinaryObject();
  emptyInstruments.channels[0].instruments = [];
  before = captureSong(song, Config);
  assert.throws(
    () => song.fromBinary(encodeSongBinary(emptyInstruments)),
    /Invalid \.goop channel or instrument structure/,
  );
  assertSongUnchanged(song, Config, before);
});

test("a late nested parse error restores both the song and asset chip waves", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Config, Note, Song, decodeSongBinary, encodeSongBinary } = synth;
  const song = new Song();
  const original = song.toBinaryObject();
  original.assets = ["https://example.com/original.wav"];
  song.fromBinary(encodeSongBinary(original));
  song.tempo = 211;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(new Note(24, 0, 12, 7));
  const before = captureSong(song, Config);
  const malformed = song.toBinaryObject();
  malformed.assets = ["https://example.com/replacement.wav"];
  malformed.channels = [null];

  assert.throws(
    () => song.fromBinary(encodeSongBinary(malformed)),
    /Invalid \.goop channel or instrument structure/,
  );
  assertSongUnchanged(song, Config, before);
});

test("a valid serialized song still replaces the current song", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song } = synth;
  const song = new Song();
  const replacement = new Song();
  replacement.tempo = 217;
  replacement.channels[0].octave = 5;

  song.fromBinary(replacement.toBinary());

  assert.equal(song.tempo, 217);
  assert.equal(song.channels[0].octave, 5);
  assert.deepEqual(song.toBinary(), replacement.toBinary());
});
