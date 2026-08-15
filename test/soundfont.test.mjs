import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadModule(entryPoint, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(directory, { recursive: true }) };
}

async function loadRendererModule() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-soundfont-renderer-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: `
				export { SongRenderer } from ${JSON.stringify(join(process.cwd(), "src/SongRenderer.ts"))};
				export { Note, Song } from ${JSON.stringify(join(process.cwd(), "synth/synth.ts"))};
				export { Config, InstrumentType } from ${JSON.stringify(join(process.cwd(), "synth/SynthConfig.ts"))};
			`,
      loader: "ts",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(directory, { recursive: true }) };
}

function chunk(id, payload) {
  const result = Buffer.alloc(8 + payload.length + (payload.length & 1));
  result.write(id, 0, 4, "ascii");
  result.writeUInt32LE(payload.length, 4);
  payload.copy(result, 8);
  return result;
}

function list(type, chunks) {
  return chunk("LIST", Buffer.concat([Buffer.from(type, "ascii"), ...chunks]));
}

function fixedName(name, length) {
  const result = Buffer.alloc(length);
  result.write(name, 0, length, "ascii");
  return result;
}

function presetHeader(name, program, bank, bagIndex) {
  const result = Buffer.alloc(38);
  fixedName(name, 20).copy(result);
  result.writeUInt16LE(program, 20);
  result.writeUInt16LE(bank, 22);
  result.writeUInt16LE(bagIndex, 24);
  return result;
}

function instrumentHeader(name, bagIndex) {
  const result = Buffer.alloc(22);
  fixedName(name, 20).copy(result);
  result.writeUInt16LE(bagIndex, 20);
  return result;
}

function bag(generatorIndex) {
  const result = Buffer.alloc(4);
  result.writeUInt16LE(generatorIndex, 0);
  return result;
}

function generator(type, amount) {
  const result = Buffer.alloc(4);
  result.writeUInt16LE(type, 0);
  result.writeInt16LE(amount, 2);
  return result;
}

function rangeGenerator(type, low, high) {
  const result = Buffer.alloc(4);
  result.writeUInt16LE(type, 0);
  result.writeUInt8(low, 2);
  result.writeUInt8(high, 3);
  return result;
}

function sampleHeader(
  name,
  start,
  end,
  loopStart,
  loopEnd,
  sampleRate,
  originalPitch = 60,
) {
  const result = Buffer.alloc(46);
  fixedName(name, 20).copy(result);
  result.writeUInt32LE(start, 20);
  result.writeUInt32LE(end, 24);
  result.writeUInt32LE(loopStart, 28);
  result.writeUInt32LE(loopEnd, 32);
  result.writeUInt32LE(sampleRate, 36);
  result.writeUInt8(originalPitch, 40);
  result.writeInt8(0, 41);
  result.writeUInt16LE(0, 42);
  result.writeUInt16LE(1, 44);
  return result;
}

function makeSoundFont({
  sampleModes = 0,
  sampleLength = 4096,
  offsets = false,
} = {}) {
  const pcm = Buffer.alloc(sampleLength * 2);
  for (let i = 0; i < sampleLength; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i * 0.17) * 12000), i * 2);

  const presetGlobal = [
    generator(17, 250),
    generator(52, 40),
    generator(8, -1200),
    rangeGenerator(43, 0, 60),
  ];
  const presetLocal = [
    generator(52, 20),
    rangeGenerator(43, 30, 90),
    generator(41, 0),
  ];
  const instrumentGlobal = [
    generator(34, -1200),
    generator(36, 0),
    generator(37, 600),
    generator(38, 1200),
    generator(6, 45),
    generator(23, -2400),
    generator(52, 30),
    rangeGenerator(43, 0, 80),
  ];
  const instrumentLocal = [
    generator(34, -2400),
    generator(52, -10),
    rangeGenerator(43, 20, 100),
    rangeGenerator(44, 1, 127),
    ...(offsets
      ? [generator(0, 1), generator(1, -1), generator(2, 1), generator(3, -1)]
      : []),
    generator(54, sampleModes),
    generator(58, 60),
    generator(53, 0),
  ];
  const pgen = [...presetGlobal, ...presetLocal];
  const igen = [...instrumentGlobal, ...instrumentLocal];
  const loopStart = 16;
  const loopEnd = Math.min(sampleLength, 96);
  const pdta = list("pdta", [
    chunk(
      "phdr",
      Buffer.concat([
        presetHeader("Native SF", 4, 0, 0),
        presetHeader("EOP", 0, 0, 2),
      ]),
    ),
    chunk(
      "pbag",
      Buffer.concat([bag(0), bag(presetGlobal.length), bag(pgen.length)]),
    ),
    chunk("pmod", Buffer.alloc(0)),
    chunk("pgen", Buffer.concat(pgen)),
    chunk(
      "inst",
      Buffer.concat([
        instrumentHeader("Native instrument", 0),
        instrumentHeader("EOI", 2),
      ]),
    ),
    chunk(
      "ibag",
      Buffer.concat([bag(0), bag(instrumentGlobal.length), bag(igen.length)]),
    ),
    chunk("imod", Buffer.alloc(0)),
    chunk("igen", Buffer.concat(igen)),
    chunk(
      "shdr",
      Buffer.concat([
        sampleHeader(
          "Native sample",
          0,
          sampleLength,
          loopStart,
          loopEnd,
          8000,
        ),
        sampleHeader(
          "EOS",
          sampleLength,
          sampleLength,
          sampleLength,
          sampleLength,
          8000,
        ),
      ]),
    ),
  ]);
  const riffPayload = Buffer.concat([
    Buffer.from("sfbk", "ascii"),
    list("INFO", []),
    list("sdta", [chunk("smpl", pcm)]),
    pdta,
  ]);
  const file = chunk("RIFF", riffPayload);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

test("native SoundFont parsing resolves samples, loops, generators, and visible settings", async (context) => {
  const { module, cleanup } = await loadModule(
    "synth/SoundFont.ts",
    "goopbox-soundfont-parser-test-",
  );
  context.after(cleanup);
  const bank = module.parseSoundFont(
    makeSoundFont({ sampleModes: 3, sampleLength: 128, offsets: true }),
  );
  assert.equal(bank.presets.length, 1);
  const preset = bank.presets[0];
  assert.deepEqual(
    {
      name: preset.name,
      program: preset.program,
      bankMSB: preset.bankMSB,
      bankLSB: preset.bankLSB,
      isDrum: preset.isDrum,
    },
    {
      name: "Native SF",
      program: 4,
      bankMSB: 0,
      bankLSB: 0,
      isDrum: false,
    },
  );
  assert.equal(preset.zones.length, 1);
  const zone = preset.zones[0];
  assert.equal(zone.sample.data.length, 128);
  assert.equal(zone.sample.sampleRate, 8000);
  assert.deepEqual(
    {
      start: zone.start,
      end: zone.end,
      loopStart: zone.loopStart,
      loopEnd: zone.loopEnd,
      loopMode: zone.loopMode,
      rootKey: zone.rootKey,
    },
    {
      start: 1,
      end: 127,
      loopStart: 17,
      loopEnd: 95,
      loopMode: 3,
      rootKey: 60,
    },
  );
  assert.deepEqual(
    { keyLow: zone.keyLow, keyHigh: zone.keyHigh, tuneCents: zone.tuneCents },
    { keyLow: 30, keyHigh: 90, tuneCents: 10 },
  );
  const matchingZones = module.getSoundFontZones(preset, 60, 100);
  assert.equal(matchingZones[0], zone);
  assert.equal(module.getSoundFontZones(preset, 60, 100), matchingZones);
  assert.equal(module.getSoundFontZones(preset, 20, 100).length, 0);
  assert.equal(module.getSoundFontZones(preset, 60, 0).length, 0);
  assert.equal(
    module.parseSoundFont(makeSoundFont({ sampleModes: 1, sampleLength: 16 }))
      .presets[0].zones[0].loopMode,
    0,
  );

  const settings = module.getSoundFontInstrumentSettings(preset);
  assert.equal(Object.hasOwn(settings, "volume"), false);
  assert.equal(settings.fadeInSeconds, 0.25);
  assert.equal(settings.fadeOutSeconds, 2);
  assert.equal(settings.pan, 75);
  assert.equal(settings.vibrato, "delayed");
  assert.ok(
    Math.abs(settings.filterCutoffHz - 8.176 * Math.pow(2, 12300 / 1200)) <
      0.001,
  );
  assert.deepEqual(settings.envelopes[0], {
    target: "noteVolume",
    envelope: "decay",
    speed: 8,
    a: 1,
    b: 0.001,
  });
  const truncated = makeSoundFont().slice(0, -1);
  assert.throws(
    () => module.parseSoundFont(truncated),
    /size exceeds file bounds/,
  );
});

function makeSong(module, transition) {
  const { Config, InstrumentType, Note, Song } = module;
  const song = new Song();
  const soundFontId = "test-soundfont";
  song.assets.push({
    source: "test.sf2",
    id: soundFontId,
    url: "test.sf2",
    name: "test",
    rootKey: 60,
    type: "soundFont",
  });
  song.tempo = 300;
  song.barCount = 1;
  song.beatsPerBar = 1;
  song.loopStart = 0;
  song.loopLength = 1;
  for (
    let channelIndex = 0;
    channelIndex < song.channels.length;
    channelIndex++
  ) {
    const channel = song.channels[channelIndex];
    channel.bars.length = 1;
    channel.bars[0] = channelIndex == 0 ? 1 : 0;
    channel.muted = channelIndex != 0;
  }
  const instrument = song.channels[0].instruments[0];
  instrument.setTypeAndReset(InstrumentType.soundFont, false);
  instrument.soundFontId = soundFontId;
  instrument.soundFontPreset = 0;
  instrument.volume = 50;
  if (transition != "normal") {
    instrument.effects |= 1 << 9;
    instrument.transition = Config.transitions.dictionary[transition].index;
  }
  const pattern = song.channels[0].patterns[0];
  pattern.notes.push(
    new Note(48, 0, Config.partsPerBeat / 2, Config.noteSizeMax),
  );
  pattern.notes.push(
    new Note(
      48,
      Config.partsPerBeat / 2,
      Config.partsPerBeat,
      Config.noteSizeMax,
    ),
  );
  return { song, soundFontId };
}

async function getTransitionState(module, transition) {
  const { song, soundFontId } = makeSong(module, transition);
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  engine.setSoundFont(soundFontId, makeSoundFont());
  engine.play();
  const halfBar = Math.round(engine.getSamplesPerBar() / 2);
  engine.synthesize(
    new Float32Array(halfBar),
    new Float32Array(halfBar),
    halfBar,
  );
  const instrumentState = engine.channels[0].instruments[0];
  const firstTone = instrumentState.activeTones.get(0);
  const phaseBefore = firstTone.soundFontVoices[0].phaseA;
  engine.synthesize(new Float32Array(64), new Float32Array(64), 64);
  const secondTone = instrumentState.activeTones.get(0);
  return {
    firstTone,
    secondTone,
    phaseBefore,
    phaseAfter: secondTone.soundFontVoices[0].phaseA,
  };
}

test("native SoundFont playback obeys normal and continue transitions", async (context) => {
  const { module, cleanup } = await loadModule(
    "synth/synth.ts",
    "goopbox-soundfont-synth-test-",
  );
  context.after(cleanup);
  const normal = await getTransitionState(module, "normal");
  assert.ok(normal.phaseAfter < normal.phaseBefore);

  const continuous = await getTransitionState(module, "continue");
  assert.equal(continuous.secondTone, continuous.firstTone);
  assert.ok(continuous.phaseAfter > continuous.phaseBefore);
});

async function getReleasedLoopPhase(module, sampleModes) {
  const { song, soundFontId } = makeSong(module, "normal");
  song.channels[0].patterns[0].notes.pop();
  song.channels[0].instruments[0].fadeOut =
    module.SynthEngine.ticksToFadeOutSetting(48);
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  engine.setSoundFont(
    soundFontId,
    makeSoundFont({ sampleModes, sampleLength: 128 }),
  );
  engine.play();
  const halfBar = Math.round(engine.getSamplesPerBar() / 2);
  engine.synthesize(
    new Float32Array(halfBar),
    new Float32Array(halfBar),
    halfBar,
  );
  engine.synthesize(new Float32Array(64), new Float32Array(64), 64);
  const releasedTone = engine.channels[0].instruments[0].releasedTones.get(0);
  assert.equal(releasedTone.released, true);
  return releasedTone.soundFontVoices[0].phaseA;
}

test("native SoundFont loop-until-release leaves the loop immediately", async (context) => {
  const { module, cleanup } = await loadModule(
    "synth/synth.ts",
    "goopbox-soundfont-loop-test-",
  );
  context.after(cleanup);
  const continuousPhase = await getReleasedLoopPhase(module, 1);
  const releasePhase = await getReleasedLoopPhase(module, 3);
  assert.ok(continuousPhase >= 16 && continuousPhase < 96);
  assert.ok(releasePhase >= 96);
});

test("native SoundFont playback emits PCM and restarts after the song ends", async (context) => {
  const { module, cleanup } = await loadModule(
    "synth/synth.ts",
    "goopbox-soundfont-restart-test-",
  );
  context.after(cleanup);
  const { song, soundFontId } = makeSong(module, "normal");
  const engine = new module.SynthEngine(song);
  engine.setSampleRate(8000);
  engine.setSoundFont(soundFontId, makeSoundFont({ sampleModes: 1 }));
  engine.loopRepeatCount = 0;
  engine.play();
  const samplesPerBar = Math.ceil(engine.getSamplesPerBar());
  const first = new Float32Array(samplesPerBar);
  engine.synthesize(first, new Float32Array(samplesPerBar), samplesPerBar);
  assert.ok(first.some((sample) => sample != 0));

  engine.snapToStart();
  engine.loopRepeatCount = 0;
  engine.play();
  const second = new Float32Array(256);
  engine.synthesize(second, new Float32Array(256), 256);
  const firstOnset = first.subarray(0, second.length);
  const referenceLevel =
    firstOnset.reduce((sum, sample) => sum + Math.abs(sample), 0) /
    firstOnset.length;
  const restartError =
    second.reduce(
      (sum, sample, index) => sum + Math.abs(sample - firstOnset[index]),
      0,
    ) / second.length;
  assert.ok(restartError < referenceLevel * 0.05);
});

test("song rendering loads SoundFonts and emits their PCM", async (context) => {
  const { module, cleanup } = await loadRendererModule();
  context.after(cleanup);
  const { song } = makeSong(module, "normal");
  const soundFont = makeSoundFont({ sampleModes: 1 });
  const originalFetch = globalThis.fetch;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async (url) => {
    assert.equal(url, "test.sf2");
    return new Response(soundFont);
  };
  globalThis.requestAnimationFrame = (callback) =>
    setImmediate(() => callback(performance.now()));
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  const renderer = new module.SongRenderer();
  for await (const _completionRate of renderer.generate(
    song,
    8000,
    true,
    true,
    1,
  )) {
  }

  assert.ok(renderer.outputSamplesL.some((sample) => sample != 0));
});
