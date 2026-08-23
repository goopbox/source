import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-chip-wave-pitch-tempo-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {Instrument, Note, Song, Synth, SynthEngine} from "./synth/synth.ts";',
        'export {Config, EffectType, InstrumentType, parseAssetDefinition} from "./synth/SynthConfig.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "chip-wave-pitch-tempo-entry.ts",
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

function addSampleAsset(module, song) {
  const asset = module.parseAssetDefinition("https://example.com/chip-wave.wav");
  assert.notEqual(asset, null);
  song.assets.push(asset);
  module.Config.configureAssets(song.assets);
  const waveIndex = module.Config.chipWaves.findIndex(
    (wave) => wave.sampleId == asset.id,
  );
  assert.ok(waveIndex >= module.Config.assetChipWaveStart);
  return { asset, waveIndex };
}

function configureShortSong(module, instrumentType, pitch, tempo) {
  const { Config, InstrumentType, Note, Song } = module;
  const song = new Song();
  const { asset, waveIndex } = addSampleAsset(module, song);
  song.tempo = 300;
  song.beatsPerBar = 1;
  song.barCount = 1;
  song.loopStart = 0;
  song.loopLength = 1;
  for (let channelIndex = 0; channelIndex < song.channels.length; channelIndex++) {
    const channel = song.channels[channelIndex];
    channel.bars.length = 1;
    channel.bars[0] = channelIndex == 0 ? 1 : 0;
    channel.muted = channelIndex != 0;
  }
  const instrument = song.channels[0].instruments[0];
  instrument.setTypeAndReset(instrumentType, false);
  if (instrumentType == InstrumentType.chip) {
    instrument.chipWave = waveIndex;
    instrument.chipWaveSettings.pitch = pitch;
    instrument.chipWaveSettings.tempo = tempo;
  } else {
    instrument.operators[0].wave = waveIndex + 1;
    instrument.operators[0].chipWaveSettings.pitch = pitch;
    instrument.operators[0].chipWaveSettings.tempo = tempo;
  }
  song.channels[0].patterns[0].notes.push(
    new Note(48, 0, Config.partsPerBeat, Config.noteSizeMax),
  );
  return { asset, song };
}

function renderSourcePhase(module, instrumentType, pitch, tempo) {
  const { asset, song } = configureShortSong(
    module,
    instrumentType,
    pitch,
    tempo,
  );
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  const samples = new Float32Array(4096);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = ((i % 97) / 48) - 1;
  }
  engine.setAsset(asset.id, samples, 8000);
  engine.play();
  const left = new Float32Array(256);
  engine.synthesize(left, new Float32Array(left.length), left.length);
  assert.ok(left.every(Number.isFinite));
  const tone = engine.channels[0].instruments[0].activeTones.get(0);
  assert.notEqual(tone, undefined);
  return tone.phases[0];
}

test("pitch and notes are separate effect categories without a pitch/tempo effect", async (context) => {
  const { Config, EffectType, cleanup } = await loadModules();
  context.after(cleanup);
  const pitch = Config.effectGroups.find((group) => group.name == "Pitch");
  const notes = Config.effectGroups.find((group) => group.name == "Notes");
  assert.notEqual(pitch, undefined);
  assert.notEqual(notes, undefined);
  assert.equal(Config.effectGroups.some((group) => group.name == "Pitch & Notes"), false);
  assert.deepEqual(pitch.effects, [EffectType.pitchShift, EffectType.detune]);
  assert.deepEqual(notes.effects, [EffectType.chord, EffectType.transition]);
  assert.equal(Config.effectNames.includes("pitch/tempo"), false);
});

test("chip instruments and FM operators use the same decimal pitch/tempo settings", async (context) => {
  const { Instrument, InstrumentType, cleanup } = await loadModules();
  context.after(cleanup);

  const chip = new Instrument(false);
  chip.setTypeAndReset(InstrumentType.chip, false);
  assert.equal(chip.chipWaveSettings.pitch, 100);
  assert.equal(chip.chipWaveSettings.tempo, 100);
  assert.equal(chip.chipWaveSettings.offset, 0);
  assert.equal(chip.chipWaveSettings.loopStart, 0);
  assert.equal(chip.chipWaveSettings.loopEnd, 1);
  assert.equal(chip.chipWaveSettings.oneshot, false);
  chip.chipWaveSettings.pitch = 12345.6789;
  chip.chipWaveSettings.tempo = -9876.54321;
  chip.chipWaveSettings.offset = 0.125;
  chip.chipWaveSettings.loopStart = 0.25;
  chip.chipWaveSettings.loopEnd = 0.875;
  chip.chipWaveSettings.oneshot = true;
  const chipSettings = chip.toSettingsObject();
  assert.equal(chipSettings.pitchPercent, 12345.6789);
  assert.equal(chipSettings.tempoPercent, -9876.54321);
  assert.equal(chipSettings.sampleOffset, 0.125);
  assert.equal(chipSettings.sampleLoopStart, 0.25);
  assert.equal(chipSettings.sampleLoopEnd, 0.875);
  assert.equal(chipSettings.sampleOneshot, true);
  const restoredChip = new Instrument(false);
  restoredChip.fromSettingsObject(chipSettings, false);
  assert.equal(restoredChip.chipWaveSettings.pitch, 12345.6789);
  assert.equal(restoredChip.chipWaveSettings.tempo, -9876.54321);
  assert.equal(restoredChip.chipWaveSettings.offset, 0.125);
  assert.equal(restoredChip.chipWaveSettings.loopStart, 0.25);
  assert.equal(restoredChip.chipWaveSettings.loopEnd, 0.875);
  assert.equal(restoredChip.chipWaveSettings.oneshot, true);

  const fm = new Instrument(false);
  fm.setTypeAndReset(InstrumentType.fm, false);
  assert.equal(fm.operators[0].chipWaveSettings.pitch, 100);
  assert.equal(fm.operators[0].chipWaveSettings.tempo, 100);
  fm.operators[0].chipWaveSettings.pitch = -4321.123456;
  fm.operators[0].chipWaveSettings.tempo = 7654.654321;
  fm.operators[0].chipWaveSettings.offset = 0.2;
  fm.operators[0].chipWaveSettings.loopStart = 0.4;
  fm.operators[0].chipWaveSettings.loopEnd = 0.6;
  fm.operators[0].chipWaveSettings.oneshot = true;
  const fmSettings = fm.toSettingsObject();
  assert.equal(fmSettings.operators[0].pitchPercent, -4321.123456);
  assert.equal(fmSettings.operators[0].tempoPercent, 7654.654321);
  const restoredFm = new Instrument(false);
  restoredFm.fromSettingsObject(fmSettings, false);
  assert.equal(restoredFm.operators[0].chipWaveSettings.pitch, -4321.123456);
  assert.equal(restoredFm.operators[0].chipWaveSettings.tempo, 7654.654321);
  assert.equal(restoredFm.operators[0].chipWaveSettings.offset, 0.2);
  assert.equal(restoredFm.operators[0].chipWaveSettings.loopStart, 0.4);
  assert.equal(restoredFm.operators[0].chipWaveSettings.loopEnd, 0.6);
  assert.equal(restoredFm.operators[0].chipWaveSettings.oneshot, true);
});

test("chip-wave pitch/tempo keeps song version 1 and round-trips unrestricted binary values", async (context) => {
  const { InstrumentType, Song, cleanup } = await loadModules();
  context.after(cleanup);
  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  instrument.setTypeAndReset(InstrumentType.fm, false);
  instrument.chipWaveSettings.pitch = 123456789.125;
  instrument.chipWaveSettings.tempo = -98765432.875;
  instrument.operators[0].chipWaveSettings.pitch = -24680.13579;
  instrument.operators[0].chipWaveSettings.tempo = 13579.2468;
  instrument.chipWaveSettings.offset = 0.1;
  instrument.chipWaveSettings.loopStart = 0.2;
  instrument.chipWaveSettings.loopEnd = 0.9;
  instrument.chipWaveSettings.oneshot = true;
  instrument.operators[0].chipWaveSettings.offset = 0.3;
  instrument.operators[0].chipWaveSettings.loopStart = 0.4;
  instrument.operators[0].chipWaveSettings.loopEnd = 0.8;
  instrument.operators[0].chipWaveSettings.oneshot = true;

  const binary = song.toBinary();
  assert.equal(binary[4], 1);
  const restored = new Song(binary);
  const restoredInstrument = restored.channels[0].instruments[0];
  assert.equal(restoredInstrument.chipWaveSettings.pitch, 123456789.125);
  assert.equal(restoredInstrument.chipWaveSettings.tempo, -98765432.875);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.pitch, -24680.13579);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.tempo, 13579.2468);
  assert.equal(restoredInstrument.chipWaveSettings.offset, 0.1);
  assert.equal(restoredInstrument.chipWaveSettings.loopStart, 0.2);
  assert.equal(restoredInstrument.chipWaveSettings.loopEnd, 0.9);
  assert.equal(restoredInstrument.chipWaveSettings.oneshot, true);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.offset, 0.3);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.loopStart, 0.4);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.loopEnd, 0.8);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.oneshot, true);
  assert.deepEqual(restored.toBinary(), binary);
});

test("existing version 1 songs default missing chip-wave pitch/tempo without changing bytes", async (context) => {
  const { Song, cleanup } = await loadModules();
  context.after(cleanup);
  const version1 = new Uint8Array(
    Buffer.from(
      "U0xERwG7wyDIyMDAcGYaiwAHIwMLM+OEKZNYJs5jYDjL8v4c+weGBIbTDhNAKhgYTh9oYIEwHBIkoCIFTFCRAAWYFA+MIQBlFMB0NbCBGZOYJ04FmQ9iMiGYDBOnMjGBmUcgZuEBR1jB9gIAYuxYYg==",
      "base64",
    ),
  );
  const song = new Song(version1);
  const instrument = song.channels[0].instruments[0];
  assert.equal(instrument.chipWaveSettings.pitch, 100);
  assert.equal(instrument.chipWaveSettings.tempo, 100);
  assert.equal(instrument.chipWaveSettings.offset, 0);
  assert.equal(instrument.chipWaveSettings.loopStart, 0);
  assert.equal(instrument.chipWaveSettings.loopEnd, 1);
  assert.equal(instrument.chipWaveSettings.oneshot, false);
  for (const operator of instrument.operators) {
    assert.equal(operator.chipWaveSettings.pitch, 100);
    assert.equal(operator.chipWaveSettings.tempo, 100);
    assert.equal(operator.chipWaveSettings.offset, 0);
    assert.equal(operator.chipWaveSettings.loopStart, 0);
    assert.equal(operator.chipWaveSettings.loopEnd, 1);
    assert.equal(operator.chipWaveSettings.oneshot, false);
  }
  assert.deepEqual(song.toBinary(), version1);
});

test("chip-wave sampler wraps at loop points and one-shot stops at loop end", async (context) => {
  const { Synth, cleanup } = await loadModules();
  context.after(cleanup);
  const wave = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);

  assert.equal(Synth.advanceChipWavePhase(5.5, 1, 2, 6, false), 2.5);
  assert.equal(Synth.advanceChipWavePhase(5.5, 1, 2, 6, true), 6);
  assert.equal(
    Synth.sampleChipWave(wave, 6.25, 1, 1, 0, 64, 2, 6, false),
    2.25,
  );
  assert.equal(
    Synth.sampleChipWave(wave, 6.25, 1, 1, 0, 64, 2, 6, true),
    0,
  );
});

test("sample-backed chip and FM tones initialize at their configured offsets", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));

  for (const instrumentType of [
    module.InstrumentType.chip,
    module.InstrumentType.fm,
  ]) {
    const { asset, song } = configureShortSong(module, instrumentType, 100, 0);
    const settings =
      instrumentType == module.InstrumentType.chip
        ? song.channels[0].instruments[0].chipWaveSettings
        : song.channels[0].instruments[0].operators[0].chipWaveSettings;
    settings.offset = 0.375;
    settings.loopStart = 0.5;
    settings.loopEnd = 0.75;
    const engine = new module.SynthEngine(song);
    engine.setSampleRate(8000);
    engine.setAsset(asset.id, new Float32Array(1024).fill(1), 8000);
    engine.play();
    engine.synthesize(new Float32Array(64), new Float32Array(64), 64);
    const tone = engine.channels[0].instruments[0].activeTones.get(0);
    assert.notEqual(tone, undefined);
    assert.ok(Math.abs(tone.phases[0] - 0.375) < 1e-9);
  }
});

test("sample-backed chip and FM paths share one sampler and decouple source tempo from pitch", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  const originalSampler = module.Synth.sampleChipWave;
  let calls = 0;
  module.Synth.sampleChipWave = (...args) => {
    calls++;
    return originalSampler(...args);
  };
  context.after(() => {
    module.Synth.sampleChipWave = originalSampler;
    module.Config.configureAssets([]);
  });

  const chipPitchA = renderSourcePhase(module, module.InstrumentType.chip, 70, 125);
  assert.ok(calls > 0, "chip sample playback must use the shared chip-wave sampler");
  calls = 0;
  const chipPitchB = renderSourcePhase(module, module.InstrumentType.chip, 230, 125);
  assert.ok(calls > 0, "chip sample playback must keep using the shared sampler");
  assert.ok(Math.abs(chipPitchA - chipPitchB) < 1e-9, "chip source tempo must not change with pitch");
  const chipTempoB = renderSourcePhase(module, module.InstrumentType.chip, 70, 80);
  assert.ok(Math.abs(chipPitchA - chipTempoB) > 1e-4, "chip source position must change with tempo");

  calls = 0;
  const fmPitchA = renderSourcePhase(module, module.InstrumentType.fm, 70, 125);
  assert.ok(calls > 0, "FM sample operators must use the shared chip-wave sampler");
  calls = 0;
  const fmPitchB = renderSourcePhase(module, module.InstrumentType.fm, 230, 125);
  assert.ok(calls > 0, "FM sample operators must keep using the shared sampler");
  assert.ok(Math.abs(fmPitchA - fmPitchB) < 1e-9, "FM source tempo must not change with pitch");
  const fmTempoB = renderSourcePhase(module, module.InstrumentType.fm, 70, 80);
  assert.ok(Math.abs(fmPitchA - fmTempoB) > 1e-4, "FM source position must change with tempo");
});
