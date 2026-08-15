import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynth() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-envelope-test-"));
  const outfile = join(directory, "synth.mjs");
  await build({
    entryPoints: ["synth/synth.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const synth = await import(pathToFileURL(outfile).href);
  return { synth, cleanup: () => rm(directory, { recursive: true }) };
}

test("envelope types are unnumbered", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  assert.deepEqual(
    synth.Config.envelopes.map((envelope) => envelope.name),
    [
      "none",
      "velocity",
      "punch",
      "flare",
      "twang",
      "swell",
      "tremolo",
      "decay",
    ],
  );
});

test("note velocity ranges from 0 to 10", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  assert.equal(synth.Config.noteSizeMax, 10);
});

test("velocity envelope defaults from one at maximum note size to zero at minimum note size", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const velocity = synth.Config.envelopes.dictionary.velocity;
  assert.equal(velocity.type, synth.EnvelopeType.noteSize);
  assert.equal(velocity.a, 1);
  assert.equal(velocity.b, 0);
});

test("velocity envelope maps maximum and minimum note sizes to A and B", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const envelope = synth.Config.envelopes.dictionary.velocity;
  const { noteSizeMax } = synth.Config;

  assert.equal(
    synth.EnvelopeComputer.computeEnvelope(
      envelope,
      0,
      0,
      noteSizeMax,
      0,
      1.75,
      0.25,
    ),
    1.75,
  );
  assert.equal(
    synth.EnvelopeComputer.computeEnvelope(envelope, 0, 0, 0, 0, 1.75, 0.25),
    0.25,
  );
  assert.equal(
    synth.EnvelopeComputer.computeEnvelope(
      envelope,
      0,
      0,
      noteSizeMax / 2,
      0,
      1.75,
      0.25,
    ),
    1,
  );
});

test("note velocities survive raw binary serialization", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song, Note, makeNotePin } = synth;
  const song = new Song();
  const pattern = song.channels[0].patterns[0];
  const note = new Note(24, 0, 12, 1);
  note.pins = [
    makeNotePin(0, 0, 1),
    makeNotePin(0, 4, 5),
    makeNotePin(0, 8, 10),
    makeNotePin(0, 12, 0),
  ];
  pattern.notes.push(note);

  const restored = new Song(song.toBinary());
  assert.deepEqual(
    restored.channels[0].patterns[0].notes[0].pins.map((pin) => pin.size),
    [1, 5, 10, 0],
  );
});

test("echo sustain preserves the old curve through 100 and eases to unity at 200", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const oldMaximumSetting = synth.Config.echoSustainRange - 1;
  const oldMaximumVolume =
    Math.pow(oldMaximumSetting / synth.Config.echoSustainRange, 1.1) * 0.9;
  assert.equal(
    synth.Synth.echoSustainToVolumeMult(oldMaximumSetting),
    oldMaximumVolume,
  );
  assert.ok(
    synth.Synth.echoSustainToVolumeMult(oldMaximumSetting * 1.5) >
      oldMaximumVolume,
  );
  assert.equal(synth.Synth.echoSustainToVolumeMult(oldMaximumSetting * 2), 1);
});

test("envelope parameters survive raw binary serialization", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song, Config } = synth;
  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  instrument.addEnvelope(
    Config.instrumentAutomationTargets.dictionary.noteVolume.index,
    0,
    Config.envelopes.dictionary.twang.index,
    32.25,
    -0.5,
    3.75,
  );

  const restoredEnvelope = new Song(song.toBinary()).channels[0].instruments[0]
    .envelopes[0];
  assert.equal(
    restoredEnvelope.target,
    Config.instrumentAutomationTargets.dictionary.noteVolume.index,
  );
  assert.equal(restoredEnvelope.index, 0);
  assert.equal(
    restoredEnvelope.envelope,
    Config.envelopes.dictionary.twang.index,
  );
  assert.equal(restoredEnvelope.speed, 32.25);
  assert.equal(restoredEnvelope.a, -0.5);
  assert.equal(restoredEnvelope.b, 3.75);
});

test("drumset envelope parameters survive serialization", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song, Config } = synth;
  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  instrument.setTypeAndReset(synth.InstrumentType.drumset, true);
  instrument.drumsetEnvelopes[0] = Config.envelopes.dictionary.flare.index;
  instrument.drumsetEnvelopeSpeeds[0] = 3.25;
  instrument.drumsetEnvelopeAs[0] = 0.125;
  instrument.drumsetEnvelopeBs[0] = 1.75;

  const restoredInstrument = new Song(song.toBinary()).channels[0]
    .instruments[0];
  assert.equal(
    restoredInstrument.drumsetEnvelopes[0],
    Config.envelopes.dictionary.flare.index,
  );
  assert.equal(restoredInstrument.drumsetEnvelopeSpeeds[0], 3.25);
  assert.equal(restoredInstrument.drumsetEnvelopeAs[0], 0.125);
  assert.equal(restoredInstrument.drumsetEnvelopeBs[0], 1.75);
});

test("fractional and out-of-range effect slider values survive serialization", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song, Config } = synth;
  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  const values = {
    pitchShift: 27.25,
    detune: -2.5,
    distortion: 8.75,
    bitcrusherFreq: -1.125,
    bitcrusherQuantization: 9.5,
    chorus: 3.375,
    echoSustain: 8.25,
    echoDelay: 25.75,
    reverb: 4.5,
  };
  Object.assign(instrument, values);
  for (const name of [
    "pitch shift",
    "detune",
    "distortion",
    "bitcrusher",
    "chorus",
    "echo",
    "reverb",
  ]) {
    instrument.effects |= 1 << Config.effectNames.indexOf(name);
  }

  const snapshotInstrument = new Song(song.toBinary()).channels[0]
    .instruments[0];
  for (const [name, value] of Object.entries(values)) {
    assert.ok(
      Math.abs(snapshotInstrument[name] - value) < 0.00001,
      `${name} should round-trip`,
    );
  }
});
