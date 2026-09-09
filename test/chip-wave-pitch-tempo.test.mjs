import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadModules(worklet = false) {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-chip-wave-pitch-tempo-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        worklet ? 'import "./synth/audio-worklet.ts";' : "",
        'export {Event, EventPoint, Instrument, Note, Pattern, Song, Synth, SynthEngine, makeNotePin} from "./synth/synth.ts";',
        'export {TimeStretch} from "./synth/TimeStretch.ts";',
        'export {Config, EffectType, InstrumentType, parseAssetDefinition} from "./synth/SynthConfig.ts";',
        'export {SongRenderer} from "./src/SongRenderer.ts";',
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

function configureCatchUpSong(module, instrumentType) {
  const { Config, makeNotePin } = module;
  const { asset, song } = configureShortSong(
    module,
    instrumentType,
    137,
    83,
  );
  song.tempo = 125;
  const instrument = song.channels[0].instruments[0];
  const settings =
    instrumentType == module.InstrumentType.chip
      ? instrument.chipWaveSettings
      : instrument.operators[0].chipWaveSettings;
  settings.offset = 0.125;
  settings.loopStart = 0.0625;
  settings.loopEnd = 0.9375;
  const note = song.channels[0].patterns[0].notes[0];
  note.pins = [
    makeNotePin(0, 0, Config.noteSizeMax),
    makeNotePin(12, Config.partsPerBeat / 2, Config.noteSizeMax),
    makeNotePin(-5, Config.partsPerBeat, Config.noteSizeMax),
  ];
  return { asset, song };
}

function renderCatchUpState(module, instrumentType, seekToMiddle) {
  const { asset, song } = configureCatchUpSong(module, instrumentType);
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(48000);
  const samples = new Float32Array(65536);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((i * Math.PI * 2) / 97);
  }
  engine.setAsset(asset.id, samples, 48000);
  const seekFraction = 0.75;
  const samplesBeforeSeek = engine.getSamplesPerBar() * seekFraction;
  assert.equal(Number.isInteger(samplesBeforeSeek), true);
  if (seekToMiddle) engine.playhead = seekFraction;
  engine.play();
  const renderedSamples = seekToMiddle ? 1 : samplesBeforeSeek + 1;
  const { output, raw } = renderSignal(module, engine, renderedSamples);
  assert.equal(raw.length, renderedSamples, "catchup must not render skipped audio");
  assert.ok(output.every(Number.isFinite));
  const tone = engine.channels[0].instruments[0].activeTones.get(0);
  assert.notEqual(tone, undefined);
  return {
    phase: tone.phases[0],
    stretchPosition: tone.chipWaveStretchers[0].position,
  };
}

function assertCatchUpApproximatesContinuousPlayback(module, instrumentType) {
  const continuous = renderCatchUpState(module, instrumentType, false);
  const caughtUp = renderCatchUpState(module, instrumentType, true);
  assert.ok(
    Math.abs(caughtUp.phase - continuous.phase) < 3e-5,
    `caught-up phase ${caughtUp.phase} should match continuous phase ${continuous.phase}`,
  );
  assert.ok(
    caughtUp.stretchPosition < module.TimeStretch.frameSize,
    "catchup starts a fresh stretch window at the estimated source cursor",
  );
}

function configureExtendedCatchUpSong(module, instrumentType) {
  const { Config, Note, Pattern, makeNotePin } = module;
  const { asset, song } = configureShortSong(
    module,
    instrumentType,
    137,
    83,
  );
  song.tempo = 250;
  song.barCount = 17;
  song.loopStart = 0;
  song.loopLength = song.barCount;
  for (let channelIndex = 0; channelIndex < song.channels.length; channelIndex++) {
    const channel = song.channels[channelIndex];
    channel.bars.length = song.barCount;
    channel.bars.fill(0);
  }

  const channel = song.channels[0];
  channel.patterns.length = 0;
  let pitch = 48;
  const partsPerBar = song.beatsPerBar * Config.partsPerBeat;
  for (let bar = 0; bar < song.barCount; bar++) {
    const pattern = new Pattern();
    const note = new Note(
      pitch,
      0,
      partsPerBar,
      Config.noteSizeMax,
    );
    note.pins = [
      makeNotePin(0, 0, Config.noteSizeMax),
      makeNotePin(bar % 2 == 0 ? 4 : -2, partsPerBar / 2, Config.noteSizeMax),
      makeNotePin(1, partsPerBar, Config.noteSizeMax),
    ];
    note.continuesLastPattern = bar > 0;
    pattern.notes.push(note);
    channel.patterns.push(pattern);
    channel.bars[bar] = bar + 1;
    pitch++;
  }

  const instrument = channel.instruments[0];
  const settings =
    instrumentType == module.InstrumentType.chip
      ? instrument.chipWaveSettings
      : instrument.operators[0].chipWaveSettings;
  settings.offset = 0.125;
  settings.loopStart = 0.0625;
  settings.loopEnd = 0.9375;
  return { asset, song };
}

function renderExtendedCatchUpState(module, instrumentType, seekToBar16) {
  const { asset, song } = configureExtendedCatchUpSong(module, instrumentType);
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  const samples = new Float32Array(65536);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((i * Math.PI * 2) / 97);
  }
  engine.setAsset(asset.id, samples, 8000);
  if (seekToBar16) engine.playhead = 16;
  engine.play();
  const samplesBeforeSeek = engine.getSamplesPerBar() * 16;
  assert.equal(Number.isInteger(samplesBeforeSeek), true);
  const renderedSamples = seekToBar16 ? 1 : samplesBeforeSeek + 1;
  const { output, raw } = renderSignal(module, engine, renderedSamples);
  assert.equal(raw.length, renderedSamples, "catchup must not render skipped bars");
  assert.ok(output.every(Number.isFinite));
  const tone = engine.channels[0].instruments[0].activeTones.get(0);
  assert.notEqual(tone, undefined);
  return {
    phase: tone.phases[0],
    stretchPosition: tone.chipWaveStretchers[0].position,
  };
}

function assertExtendedCatchUpApproximatesContinuousPlayback(module, instrumentType) {
  const continuous = renderExtendedCatchUpState(module, instrumentType, false);
  const caughtUp = renderExtendedCatchUpState(module, instrumentType, true);
  assert.ok(
    Math.abs(caughtUp.phase - continuous.phase) < 2e-4,
    `16-bar caught-up phase ${caughtUp.phase} should match continuous phase ${continuous.phase}`,
  );
  assert.ok(
    caughtUp.stretchPosition < module.TimeStretch.frameSize,
    "continued notes start a fresh stretch window at the estimated source cursor",
  );
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
  chip.chipWaveSettings.offset = 0.625;
  chip.chipWaveSettings.loopStart = 0.25;
  chip.chipWaveSettings.loopEnd = 0.875;
  chip.chipWaveSettings.oneshot = true;
  const chipSettings = chip.toSettingsObject();
  assert.equal(chipSettings.pitchPercent, 12345.6789);
  assert.equal(chipSettings.tempoPercent, -9876.54321);
  assert.equal(chipSettings.sampleOffset, 0.625);
  assert.equal(chipSettings.sampleLoopStart, 0.25);
  assert.equal(chipSettings.sampleLoopEnd, 0.875);
  assert.equal(chipSettings.sampleOneshot, true);
  const restoredChip = new Instrument(false);
  restoredChip.fromSettingsObject(chipSettings, false);
  assert.equal(restoredChip.chipWaveSettings.pitch, 12345.6789);
  assert.equal(restoredChip.chipWaveSettings.tempo, -9876.54321);
  assert.equal(restoredChip.chipWaveSettings.offset, 0.625);
  assert.equal(restoredChip.chipWaveSettings.loopStart, 0.25);
  assert.equal(restoredChip.chipWaveSettings.loopEnd, 0.875);
  assert.equal(restoredChip.chipWaveSettings.oneshot, true);

  const fm = new Instrument(false);
  fm.setTypeAndReset(InstrumentType.fm, false);
  assert.equal(fm.operators[0].chipWaveSettings.pitch, 100);
  assert.equal(fm.operators[0].chipWaveSettings.tempo, 100);
  fm.operators[0].chipWaveSettings.pitch = -4321.123456;
  fm.operators[0].chipWaveSettings.tempo = 7654.654321;
  fm.operators[0].chipWaveSettings.offset = 0.5;
  fm.operators[0].chipWaveSettings.loopStart = 0.2;
  fm.operators[0].chipWaveSettings.loopEnd = 0.6;
  fm.operators[0].chipWaveSettings.oneshot = true;
  const fmSettings = fm.toSettingsObject();
  assert.equal(fmSettings.operators[0].pitchPercent, -4321.123456);
  assert.equal(fmSettings.operators[0].tempoPercent, 7654.654321);
  const restoredFm = new Instrument(false);
  restoredFm.fromSettingsObject(fmSettings, false);
  assert.equal(restoredFm.operators[0].chipWaveSettings.pitch, -4321.123456);
  assert.equal(restoredFm.operators[0].chipWaveSettings.tempo, 7654.654321);
  assert.equal(restoredFm.operators[0].chipWaveSettings.offset, 0.5);
  assert.equal(restoredFm.operators[0].chipWaveSettings.loopStart, 0.2);
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
  instrument.chipWaveSettings.offset = 0.7;
  instrument.chipWaveSettings.loopStart = 0.2;
  instrument.chipWaveSettings.loopEnd = 0.9;
  instrument.chipWaveSettings.oneshot = true;
  instrument.operators[0].chipWaveSettings.offset = 0.6;
  instrument.operators[0].chipWaveSettings.loopStart = 0.3;
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
  assert.equal(restoredInstrument.chipWaveSettings.offset, 0.7);
  assert.equal(restoredInstrument.chipWaveSettings.loopStart, 0.2);
  assert.equal(restoredInstrument.chipWaveSettings.loopEnd, 0.9);
  assert.equal(restoredInstrument.chipWaveSettings.oneshot, true);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.offset, 0.6);
  assert.equal(restoredInstrument.operators[0].chipWaveSettings.loopStart, 0.3);
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
    Synth.interpolateChipWaveSample(wave, 6.25, 2, 6, false),
    2.25,
  );
  assert.equal(
    Synth.interpolateChipWaveSample(wave, 6.25, 2, 6, true),
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
    settings.offset = 0.625;
    settings.loopStart = 0.25;
    settings.loopEnd = 0.75;
    const engine = new module.SynthEngine(song);
    engine.setSampleRate(8000);
    engine.setAsset(asset.id, new Float32Array(1024).fill(1), 8000);
    engine.play();
    engine.synthesize(new Float32Array(64), new Float32Array(64), 64);
    const tone = engine.channels[0].instruments[0].activeTones.get(0);
    assert.notEqual(tone, undefined);
    assert.ok(Math.abs(tone.phases[0] - 0.625) < 1e-9);
  }
});

test("sample-backed chip and FM paths share one sampler and decouple source tempo from pitch", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  const originalSampler = module.TimeStretch.prototype.prepare;
  let calls = 0;
  module.TimeStretch.prototype.prepare = function (...args) {
    calls++;
    return originalSampler.apply(this, args);
  };
  context.after(() => {
    module.TimeStretch.prototype.prepare = originalSampler;
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

test("sample-backed chip waves catch up through pitch bends when playback starts mid-note", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));

  assertCatchUpApproximatesContinuousPlayback(module, module.InstrumentType.chip);
});

test("sample-backed FM operator waves catch up through pitch bends when playback starts mid-note", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));

  assertCatchUpApproximatesContinuousPlayback(module, module.InstrumentType.fm);
});

test("extended chip waves catch up across 16 continued bars and their pitch bends", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));

  assertExtendedCatchUpApproximatesContinuousPlayback(
    module,
    module.InstrumentType.chip,
  );
});

test("extended FM operator waves catch up across 16 continued bars and their pitch bends", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));

  assertExtendedCatchUpApproximatesContinuousPlayback(
    module,
    module.InstrumentType.fm,
  );
});

test("song rendering includes loaded custom sample PCM", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) =>
    setImmediate(() => callback(performance.now()));
  context.after(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  const { asset, song } = configureShortSong(
    module,
    module.InstrumentType.chip,
    137,
    83,
  );
  const samples = new Float32Array(4096);
  for (let index = 0; index < samples.length; index++)
    samples[index] = Math.sin((index * Math.PI * 2) / 97);
  let assetLoadCount = 0;
  const renderer = new module.SongRenderer({
    loadAssetsInto: async (synth) => {
      assetLoadCount++;
      synth.setAsset(asset.id, samples, 8000);
    },
  });

  for await (const _completionRate of renderer.generate(
    song,
    8000,
    true,
    true,
    1,
  )) {
  }

  assert.equal(assetLoadCount, 1);
  assert.ok(renderer.outputSamplesL.some((sample) => sample != 0));
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  engine.setAsset(asset.id, samples, 8000);
  engine.loopRepeatCount = 0;
  assertAudioClose(renderer.outputSamplesL,
    renderSignal(module, engine, renderer.outputSamplesL.length, 37).output);
});

function makeSignalEngine(
  module,
  type,
  pitch = 100,
  tempo = 100,
  oneshot = true,
) {
  const { asset, song } = configureShortSong(module, type, pitch, tempo);
  song.tempo = 120;
  song.beatsPerBar = 8;
  const instrument = song.channels[0].instruments[0];
  instrument.effects = 0;
  for (let i = 1; i < instrument.operators.length; i++)
    instrument.operators[i].amplitude = 0;
  const settings =
    type == module.InstrumentType.chip
      ? instrument.chipWaveSettings
      : instrument.operators[0].chipWaveSettings;
  settings.oneshot = oneshot;
  const note = song.channels[0].patterns[0].notes[0];
  note.end = 8 * module.Config.partsPerBeat;
  note.pins[1].time = note.end;
  const samples = Float32Array.from(
    { length: 4096 },
    (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 8000),
  );
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  engine.setAsset(asset.id, samples, 8000);
  engine.play();
  return { engine, samples, settings, instrument, song };
}

function renderSignal(module, engine, length, chunk = length) {
  const output = new Float32Array(length);
  const raw = [];
  const apply = module.Synth.applyFilters;
  module.Synth.applyFilters = function (input, ...rest) {
    raw.push(input);
    return apply(input, ...rest);
  };
  try {
    for (let offset = 0; offset < length; offset += chunk) {
      const count = Math.min(chunk, length - offset);
      engine.synthesize(
        output.subarray(offset, offset + count),
        new Float32Array(count),
        count,
      );
    }
  } finally {
    module.Synth.applyFilters = apply;
  }
  return { output, raw: Float32Array.from(raw) };
}

function fundamental(samples, sampleRate = 8000) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0)
      crossings.push(i - samples[i] / (samples[i] - samples[i - 1]));
  }
  assert.ok(crossings.length > 10, "fixture must contain a measurable tone");
  return (
    (sampleRate * (crossings.length - 1)) / (crossings.at(-1) - crossings[0])
  );
}

function assertAudioClose(actual, expected, tolerance = 2e-6) {
  assert.equal(actual.length, expected.length);
  let error = 0;
  for (let i = 0; i < actual.length; i++)
    error = Math.max(error, Math.abs(actual[i] - expected[i]));
  assert.ok(
    Number.isFinite(error) && error < tolerance,
    `maximum audio error ${error} exceeds ${tolerance}`,
  );
}

test("100% pitch and tempo bypass the stretcher and reproduce direct sample playback", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  module.TimeStretch.prototype.prepare = () =>
    assert.fail("identity playback must never run DSP");
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const { engine, samples } = makeSignalEngine(module, type);
    const { raw } = renderSignal(module, engine, 3000, 37);
    const gain = raw[1] / samples[1];
    assert.ok(gain > 0);
    assertAudioClose(
      raw,
      Float32Array.from(
        samples.subarray(0, raw.length),
        (sample) => sample * gain,
      ),
    );
    const tone = engine.channels[0].instruments[0].activeTones.get(0);
    assert.ok(tone.chipWaveStretchers.every((stretcher) => stretcher == null));
  }
});

test("chip and FM samples independently stretch duration and shift fundamental pitch", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    for (const [pitch, tempo] of [
      [100, 100],
      [100, 200],
      [100, 50],
      [200, 100],
      [50, 100],
      [137, 83],
    ]) {
      const { engine, samples } = makeSignalEngine(module, type, pitch, tempo);
      const { raw } = renderSignal(module, engine, 12000, 127);
      assert.equal(raw.length, 12000);
      const expectedEnd = Math.ceil((samples.length * 100) / tempo);
      const end = raw.findLastIndex((sample) => Math.abs(sample) > 1e-6) + 1;
      assert.ok(
        Math.abs(end - expectedEnd) <= 2,
        `${type}: ${pitch}/${tempo} ends at ${end}, expected ${expectedEnd}`,
      );
      const frequency = fundamental(
        raw.subarray(512, Math.min(expectedEnd - 256, 3000)),
      );
      assert.ok(
        Math.abs(frequency - (220 * pitch) / 100) < 2,
        `${type}: ${pitch}/${tempo} fundamental ${frequency}`,
      );
    }
  }
});

test("stretch output stays continuous across arbitrary synthesize chunk sizes and loop wraps", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const render = (chunk) => {
      const { engine, settings, instrument } = makeSignalEngine(
        module,
        type,
        137,
        83,
        false,
      );
      settings.offset = 0.125;
      settings.loopStart = 0.25;
      settings.loopEnd = 0.75;
      instrument.effects |= 1 << module.EffectType.unison;
      instrument.unison = 2;
      if (type == module.InstrumentType.fm) {
        instrument.operators[1].amplitude = 8;
        instrument.feedbackAmplitude = 4;
      }
      return renderSignal(module, engine, 12000, chunk).output;
    };
    const reference = render(12000);
    assert.ok(
      reference.subarray(10000).some((sample) => Math.abs(sample) > 0.01),
      "loop keeps sounding",
    );
    for (const chunk of [1, 17, 128, 511, 4096])
      assertAudioClose(render(chunk), reference);
  }
});

test("seeking a running engine clears previous DSP and FM feedback state", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const makeEngine = () => {
      const { engine, instrument } = makeSignalEngine(module, type, 137, 83, false);
      instrument.effects |= 1 << module.EffectType.unison;
      instrument.unison = 2;
      if (type == module.InstrumentType.fm) instrument.feedbackAmplitude = 7;
      return engine;
    };
    const engine = makeEngine();
    const reference = renderSignal(module, engine, 16000, 127).output;
    const fresh = makeEngine();
    fresh.playhead = 0.25;
    engine.playhead = 0.25;
    assertAudioClose(
      renderSignal(module, engine, 2000, 31).output,
      renderSignal(module, fresh, 2000, 127).output,
    );
    engine.playhead = 0;
    assertAudioClose(
      renderSignal(module, engine, 2000, 53).output,
      reference.subarray(0, 2000),
    );
  }
});

test("sample catchup respects one-shot endings, frozen tempo, and reverse loops", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    for (const [tempo, oneshot, expectedPhase] of [
      [83, true, 0.75],
      [0, false, 0.5],
      // A one-second seek advances 6640 source frames through a 2048-frame loop.
      [83, false, (2544 + 0.83) / 4096],
      [-83, false, (1552 - 0.83) / 4096],
    ]) {
      const { engine, settings } = makeSignalEngine(module, type, 137, tempo, oneshot);
      settings.offset = 0.5;
      settings.loopStart = 0.25;
      settings.loopEnd = 0.75;
      engine.playhead = 0.25;
      const { output, raw } = renderSignal(module, engine, 1);
      assert.equal(raw.length, 1, "catchup must not render skipped audio");
      assert.ok(output.every(Number.isFinite));
      const tone = engine.channels[0].instruments[0].activeTones.get(0);
      assert.ok(Math.abs(tone.phases[0] - expectedPhase) < 1e-9);
      const resumed = renderSignal(module, engine, 1000, 127).output;
      assert.ok(resumed.every(Number.isFinite));
      if (oneshot) {
        assert.ok(resumed.every((sample) => sample == 0), "finished one-shots stay silent");
        assert.ok(tone.chipWaveStretchers.every((stretch) => stretch == null));
      } else {
        assert.ok(resumed.some((sample) => Math.abs(sample) > 0.01));
      }
    }
  }
});

test("returning to 100% pitch and tempo immediately bypasses existing DSP state", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const { engine, settings } = makeSignalEngine(module, type, 137, 83, false);
    renderSignal(module, engine, 4000);
    settings.pitch = settings.tempo = 100;
    const prepare = module.TimeStretch.prototype.prepare;
    module.TimeStretch.prototype.prepare = () =>
      assert.fail("returning to identity must bypass DSP");
    try {
      assert.ok(
        renderSignal(module, engine, 4000).output.every(Number.isFinite),
      );
    } finally {
      module.TimeStretch.prototype.prepare = prepare;
    }
  }
});

test("zero and reverse rates preserve source transport and produce finite chunk-independent audio", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    for (const [pitch, tempo] of [
      [100, 0],
      [0, 100],
      [-137, -83],
      [137, -83],
    ]) {
      const render = (chunk) => {
        const { engine, settings } = makeSignalEngine(
          module,
          type,
          pitch,
          tempo,
          false,
        );
        settings.offset = 0.75;
        const result = renderSignal(module, engine, 2000, chunk);
        const tone = engine.channels[0].instruments[0].activeTones.get(0);
        if (tempo == 0) {
          assert.equal(tone.phases[0], 0.75);
          assert.ok(
            result.raw.some((value) => Math.abs(value) > 0.01),
            "freezing tempo must keep sounding",
          );
        } else if (pitch == 0) {
          assert.ok(
            tone.phases[0] != 0.75,
            "zero pitch must not freeze the source timeline",
          );
        }
        return result.output;
      };
      assertAudioClose(render(19), render(2000));
    }
  }
});

test("all FM sample operators retain independent stretch state through bends and feedback", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  const render = (chunk) => {
    const { engine, instrument, song } = makeSignalEngine(
      module,
      module.InstrumentType.fm,
      137,
      83,
      false,
    );
    instrument.effects |= 1 << module.EffectType.unison;
    instrument.unison = 2;
    instrument.feedbackAmplitude = 8;
    for (let i = 0; i < instrument.operators.length; i++) {
      const operator = instrument.operators[i];
      operator.wave = instrument.operators[0].wave;
      operator.amplitude = i == 0 ? 15 : 3;
      operator.chipWaveSettings.pitch = 120 + i * 13;
      operator.chipWaveSettings.tempo = 85 + i * 9;
    }
    const note = song.channels[0].patterns[0].notes[0];
    note.pins = [
      module.makeNotePin(0, 0, 10),
      module.makeNotePin(12, note.end, 6),
    ];
    const output = renderSignal(module, engine, 5000, chunk).output;
    const tone = engine.channels[0].instruments[0].activeTones.get(0);
    for (let i = 0; i < module.Config.operatorCount * 2; i++)
      assert.ok(tone.chipWaveStretchers[i] instanceof module.TimeStretch);
    return output;
  };
  const reference = render(5000);
  assert.ok(reference.some((sample) => Math.abs(sample) > 0.01));
  assertAudioClose(render(1), reference);
  assertAudioClose(render(127), reference);
});

test("sample catchup uses tempo automation at the seek destination without replay", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const { engine, song } = makeSignalEngine(module, type, 137, 83, false);
    const channel = song.channels.at(-1);
    channel.muted = false;
    channel.bars[0] = 1;
    channel.automationRows[0].setSongTarget("tempo");
    channel.patterns[0].automationEvents[0] = [
      new module.Event(0, 192, [
        new module.EventPoint(0, 121),
        new module.EventPoint(192, 243),
      ]),
    ];
    engine.playhead = 0.25;
    const { output, raw } = renderSignal(module, engine, 1);
    assert.equal(raw.length, 1, "tempo automation must not replay skipped ticks");
    assert.ok(output.every(Number.isFinite));
    assert.equal(engine.automationRuntime.getEffectiveTempo(), 151.5);
    const tone = engine.channels[0].instruments[0].activeTones.get(0);
    const sourceFrames = (2 * 60 / 151.5 * 8000 + 1) * 0.83;
    assert.ok(Math.abs(tone.phases[0] - (sourceFrames % 4096) / 4096) < 1e-9,
      "estimate uses the current tempo for the elapsed note duration");
    const resumed = renderSignal(module, engine, 1000, 127).output;
    assert.ok(resumed.every(Number.isFinite));
    assert.ok(resumed.some((sample) => Math.abs(sample) > 0.01));
  }
});

test("AudioWorklet sample playback matches SynthEngine offline output", async (context) => {
  let Processor;
  const previous = {
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor,
    registerProcessor: globalThis.registerProcessor,
    sampleRate: globalThis.sampleRate,
  };
  globalThis.sampleRate = 8000;
  globalThis.AudioWorkletProcessor = class {
    port = { onmessage: null, postMessage() {} };
  };
  globalThis.registerProcessor = (_name, constructor) => {
    Processor = constructor;
  };
  context.after(() => Object.assign(globalThis, previous));
  const module = await loadModules(true);
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  for (const type of [module.InstrumentType.chip, module.InstrumentType.fm]) {
    const { engine, song, samples } = makeSignalEngine(
      module,
      type,
      137,
      83,
      false,
    );
    const processor = new Processor();
    const send = (data) => processor.port.onmessage({ data });
    send({
      type: "initialize",
      song: song.toBinary(),
      mutedChannels: song.channels.map((channel) => channel.muted),
      playhead: 0,
      loopRepeatCount: -1,
      metronomeEnabled: false,
      countInEnabled: false,
      playing: true,
      recording: false,
      liveInput: {
        channel: 0,
        pitches: [],
        instruments: [],
        duration: 0,
        started: false,
      },
    });
    send({
      type: "setAsset",
      sampleId: song.assets[0].id,
      samples: samples.slice().buffer,
      sampleRate: 8000,
    });
    const output = new Float32Array(4096);
    for (let offset = 0; offset < output.length; offset += 128)
      assert.equal(
        processor.process(
          [],
          [[output.subarray(offset, offset + 128), new Float32Array(128)]],
        ),
        true,
      );
    assertAudioClose(
      output,
      renderSignal(module, engine, output.length, 37).output,
    );
    send({ type: "setPlayhead", playhead: 0.25 });
    engine.playhead = 0.25;
    const resumed = new Float32Array(128);
    assert.equal(processor.process([], [[resumed, new Float32Array(128)]]), true);
    assertAudioClose(resumed, renderSignal(module, engine, resumed.length, 37).output);
  }
});

test("extreme stretch ratios preserve pitch and chunk-independent audio", async (context) => {
  const module = await loadModules();
  context.after(module.cleanup);
  context.after(() => module.Config.configureAssets([]));
  const render = (chunk) => {
    const { engine } = makeSignalEngine(
      module,
      module.InstrumentType.chip,
      100,
      0.1,
      false,
    );
    return renderSignal(module, engine, 4000, chunk).raw;
  };
  const reference = render(4000);
  assertAudioClose(render(31), reference);
  assert.ok(Math.abs(fundamental(reference.subarray(1000)) - 220) < 2);
});
