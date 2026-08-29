import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadAutomationModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-automation-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./synth/synth.ts";',
        'export { Config, EffectType, FilterType, InstrumentType } from "./synth/SynthConfig.ts";',
        'export { decodeSongBinary, encodeSongBinary } from "./synth/SongBinary.ts";',
        'export { decodeBinaryValue, encodeBinaryValue } from "./synth/BinaryCodec.ts";',
        'export { SongRenderer } from "./src/SongRenderer.ts";',
        'export { bendEvent, clipEvent, deleteEventRange, editEventTime, eventPath, nearestEventPointIndex, repeatEvents } from "./src/EventEditing.ts";',
        'export { AutomationRowSelectionState } from "./src/AutomationSelection.ts";',
        'export { trackChannelKindsAreCompatible } from "./src/ChannelCompatibility.ts";',
        'export { encodeSongUrl, decodeSongUrlHash } from "./src/SongUrl.ts";',
        'export { createMidiExportTracks } from "./src/MidiExport.ts";',
        'export { ChangeAutomationTargetElement, ChangeBeatsPerBar, ChangeChannelCount, ChangeChannelOrder, ChangeFilterAddPoint, ChangeMoveNotesSideways, ChangeRemoveChannelInstrument, ChangeToggleEffects } from "./src/changes.ts";',
        'export { KeyboardLayout } from "./src/KeyboardLayout.ts";',
        'export { MidiInputHandler } from "./src/MidiInput.ts";',
        'export { SongPerformance } from "./src/SongPerformance.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "automation-test-entry.ts",
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

function addAutomationChannel(module, song, rowCount = 1) {
  const channel = song.createChannel(module.ChannelKind.automation);
  song.channels.push(channel);
  song.automationChannelCount++;
  song.setAutomationRowCount(song.channels.length - 1, rowCount);
  return channel;
}

function event(module, start, end, values) {
  return new module.Event(
    start,
    end,
    values.map(([time, value]) => new module.EventPoint(time, value)),
  );
}

function setPatternEvents(channel, patternIndex, rowIndex, events) {
  channel.patterns[patternIndex].ensureAutomationRowCount(
    channel.automationRows.length,
  );
  channel.patterns[patternIndex].automationEvents[rowIndex] = events;
  channel.bars[0] = patternIndex + 1;
}

function makeChangeDocument(song, channel = 0) {
  return {
    song,
    channel,
    bar: 0,
    barScrollPos: 0,
    channelScrollPos: 0,
    viewedInstrument: Array(song.getChannelCount()).fill(0),
    notifier: { changed() {} },
    selection: {
      resetBoxSelection() {},
      scrollToSelectedPattern() {},
    },
    prefs: {
      rememberScaleChoice: false,
      defaultScale: 0,
    },
    getCurrentInstrument() {
      return this.viewedInstrument[this.channel] ?? 0;
    },
  };
}

test("old songs default to zero Automation channels", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const oldSong = new module.Song();
  const oldBinary = oldSong.toBinary();
  assert.equal(module.decodeSongBinary(oldBinary)[0], 1);
  const restored = new module.Song(oldBinary);
  assert.equal(restored.automationChannelCount, 0);
  assert.equal(restored.getChannelCount(), restored.pitchChannelCount + restored.noiseChannelCount);
});

test("Automation rows, surfaces, floating point events, and invalid references round-trip", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const channel = addAutomationChannel(module, song, 2);
  assert.equal(channel.instruments.length, 0);
  channel.automationRows[0].setInstrumentTarget(song, 0, 0, "pan");
  channel.automationRows[1].targetChannel = 99;
  channel.automationRows[1].targetChannelKind = module.ChannelKind.pitch;
  channel.automationRows[1].targetChannelMissing = true;
  channel.automationRows[1].targetInstrument = 27;
  channel.automationRows[1].targetInstrumentMissing = true;
  channel.automationRows[1].targetId = "removed-target";
  channel.automationRows[1].targetElementMissing = true;
  setPatternEvents(channel, 0, 0, [
    event(module, 0, 24, [[0, 3.125], [7.5, 1.75], [24, 2.125]]),
  ]);

  const binary = song.toBinary();
  assert.equal(binary[4], 1, "the outer container version is unchanged");
  const restored = new module.Song(binary);
  assert.equal(restored.automationChannelCount, 1);
  assert.equal(restored.channels.at(-1).instruments.length, 0);
  assert.deepEqual(
    restored.channels.at(-1).patterns[0].automationEvents[0][0].points.map((point) => [point.time, point.value]),
    [[0, 3.125], [7.5, 1.75], [24, 2.125]],
  );
  const missing = restored.channels.at(-1).automationRows[1];
  assert.equal(missing.targetChannel, 99);
  assert.equal(missing.targetInstrument, 27);
  assert.equal(missing.targetId, "removed-target");
  assert.equal(missing.targetChannelMissing, true);
  assert.equal(missing.targetInstrumentMissing, true);
  assert.equal(missing.targetElementMissing, true);
  assert.deepEqual(restored.toBinary(), binary);

  const structured = new module.Song(
    module.encodeSongBinary(song.toBinaryObject()),
  );
  assert.deepEqual(structured.toBinary(), binary);
  const hash = module.encodeSongUrl(binary);
  assert.deepEqual(module.decodeSongUrlHash(hash), binary);
  assert.deepEqual(new module.Song(module.decodeSongUrlHash(hash)).toBinary(), binary);
});

test("row count grows empty rows at the bottom and removes bottom rows", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const channel = addAutomationChannel(module, song, 3);
  channel.patterns[0].automationEvents[2] = [
    event(module, 0, 1, [[0, 120], [1, 120]]),
  ];
  const channelIndex = song.getChannelCount() - 1;
  song.setAutomationRowCount(channelIndex, 2);
  assert.equal(channel.automationRows.length, 2);
  assert.equal(channel.patterns[0].automationEvents.length, 2);
  song.setAutomationRowCount(channelIndex, 3);
  assert.equal(channel.automationRows.length, 3);
  assert.deepEqual(channel.patterns[0].automationEvents[2], []);
  assert.throws(
    () => song.setAutomationRowCount(channelIndex, module.Config.automationRowCountMax + 1),
    RangeError,
  );
});

test("malformed Automation payloads reject finite, ordering, and allocation violations", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const channel = addAutomationChannel(module, song);
  channel.automationRows[0].setSongTarget("tempo");
  setPatternEvents(channel, 0, 0, [
    event(module, 0, 12, [[0, 120], [12, 180]]),
  ]);
  const source = song.toBinaryObject();
  const rejects = (mutate) => {
    const value = structuredClone(source);
    mutate(value);
    assert.throws(() => new module.Song(module.encodeSongBinary(value)));
  };
  const automationChannel = (value) => value.channels.at(-1);
  const firstEvent = (value) =>
    automationChannel(value).patterns[0].rows[0][0];

  rejects((value) => { firstEvent(value).points[0].value = Number.NaN; });
  rejects((value) => { firstEvent(value).points[0].value = Number.POSITIVE_INFINITY; });
  rejects((value) => { firstEvent(value).points[1].time = 0; });
  rejects((value) => { firstEvent(value).end = song.beatsPerBar * module.Config.partsPerBeat + 1; });
  rejects((value) => {
    automationChannel(value).automationRows = Array.from(
      { length: module.Config.automationRowCountMax + 1 },
      () => structuredClone(automationChannel(source).automationRows[0]),
    );
  });
  rejects((value) => {
    automationChannel(value).patterns[0].rows[0] = Array.from(
      { length: module.Config.automationEventsPerRowMax + 1 },
      () => structuredClone(firstEvent(source)),
    );
  });
  rejects((value) => {
    firstEvent(value).points = Array.from(
      { length: module.Config.automationPointsPerEventMax + 1 },
      (_unused, index) => ({
        time: (12 * index) / module.Config.automationPointsPerEventMax,
        value: 120,
      }),
    );
  });
});

test("Automation interpolation and latching reconstruct through bar history and pattern reuse", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const channel = addAutomationChannel(module, song);
  const channelIndex = song.getChannelCount() - 1;
  channel.automationRows[0].setSongTarget("tempo");
  setPatternEvents(channel, 0, 0, [event(module, 4, 20, [[0, 100], [16, 200]])]);
  channel.bars[1] = 0;
  channel.bars[2] = 1;
  const runtime = new module.AutomationRuntime();

  runtime.update(song, 0, 2, false);
  assert.equal(runtime.getLatchedOperand(channelIndex, 0), null);
  assert.equal(runtime.getEffectiveTempo(), song.tempo);
  runtime.update(song, 0, 12, true);
  assert.equal(runtime.getLatchedOperand(channelIndex, 0), 150);
  assert.equal(runtime.getEffectiveTempo(), 150);
  runtime.update(song, 0, 23, true);
  assert.equal(runtime.getLatchedOperand(channelIndex, 0), 200);
  runtime.update(song, 1, 12, true);
  assert.equal(runtime.getEffectiveTempo(), 200, "the final value holds across an empty bar");
  runtime.update(song, 2, 12, false);
  assert.equal(runtime.getEffectiveTempo(), 150, "a manual seek reconstructs the reused pattern");
});

test("later events replace held values and continuous loop latches differ from manual seeks", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  song.tempo = 120;
  song.barCount = 2;
  for (const musical of song.channels) musical.bars.length = 2;
  const channel = addAutomationChannel(module, song);
  channel.bars.length = 2;
  channel.bars[0] = 0;
  channel.bars[1] = 1;
  channel.automationRows[0].setSongTarget("tempo");
  channel.patterns[0].automationEvents[0] = [
    event(module, 10, 12, [[0, 180], [2, 200]]),
    event(module, 20, 22, [[0, 90], [2, 100]]),
  ];
  const runtime = new module.AutomationRuntime();
  const channelIndex = song.getChannelCount() - 1;

  runtime.update(song, 1, 11, false);
  assert.equal(runtime.getEffectiveTempo(), 190);
  runtime.update(song, 1, 16, true);
  assert.equal(runtime.getEffectiveTempo(), 200);
  runtime.update(song, 1, 21, true);
  assert.equal(runtime.getEffectiveTempo(), 95);
  runtime.update(song, 1, 24, true);
  assert.equal(runtime.getEffectiveTempo(), 100);

  runtime.update(song, 1, 0, true);
  assert.equal(
    runtime.getLatchedOperand(channelIndex, 0),
    100,
    "continuous loop playback keeps the previous iteration's latch",
  );
  runtime.update(song, 1, 0, false);
  assert.equal(runtime.getLatchedOperand(channelIndex, 0), null);
  assert.equal(runtime.getEffectiveTempo(), 120);
});

test("active events in lower rows override holdovers", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  song.tempo = 120;
  const channel = addAutomationChannel(module, song, 2);
  channel.bars[0] = 1;
  channel.patterns[0].ensureAutomationRowCount(2);
  for (const row of channel.automationRows) row.setSongTarget("tempo");
  channel.patterns[0].automationEvents[0] = [event(module, 0, 4, [[0, 200], [4, 200]])];
  channel.patterns[0].automationEvents[1] = [event(module, 8, 12, [[0, 90], [4, 90]])];
  const runtime = new module.AutomationRuntime();
  runtime.update(song, 0, 6, false);
  assert.equal(runtime.getEffectiveTempo(), 200);
  runtime.update(song, 0, 10, true);
  assert.equal(runtime.getEffectiveTempo(), 90, "the lower row overrides the upper row's holdover");
  runtime.update(song, 0, 14, true);
  assert.equal(runtime.getEffectiveTempo(), 90, "the lower row becomes the new holdover");
});

test("muted Automation channels are ignored and unmuting reconstructs at the playhead", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  song.tempo = 120;
  const channel = addAutomationChannel(module, song);
  channel.automationRows[0].setSongTarget("tempo");
  setPatternEvents(channel, 0, 0, [event(module, 0, 8, [[0, 180], [8, 180]])]);
  const runtime = new module.AutomationRuntime();
  runtime.update(song, 0, 12, false);
  assert.equal(runtime.getEffectiveTempo(), 180);
  channel.muted = true;
  runtime.update(song, 0, 16, true);
  assert.equal(runtime.getEffectiveTempo(), 120);
  channel.muted = false;
  runtime.update(song, 0, 16, true);
  assert.equal(runtime.getEffectiveTempo(), 180);
});

test("zero-valued enabled effects become active, echo allocation is bounded, and Automation owns no tone state", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = makeOneBarSong(module);
  const instrument = song.channels[0].instruments[0];
  const effectTypes = [
    module.EffectType.distortion,
    module.EffectType.chorus,
    module.EffectType.echo,
    module.EffectType.reverb,
  ];
  for (const effectType of effectTypes) instrument.effects |= 1 << effectType;
  instrument.distortion = 0;
  instrument.chorus = 0;
  instrument.echoSustain = 0;
  instrument.echoDelay = 0;
  instrument.reverb = 0;
  const note = new module.Note(24, 0, module.Config.partsPerBeat, module.Config.noteSizeMax);
  song.channels[0].patterns[0].notes.push(note);
  song.channels[0].bars[0] = 1;

  const automation = addAutomationChannel(module, song, 5);
  const targetValues = [
    ["distortion", 4],
    ["chorus", 3],
    ["echoSustain", 6],
    ["echoDelay", module.Config.echoDelayRange - 1],
    ["reverb", 3],
  ];
  automation.bars[0] = 1;
  automation.patterns[0].ensureAutomationRowCount(targetValues.length);
  for (let rowIndex = 0; rowIndex < targetValues.length; rowIndex++) {
    const [targetId, value] = targetValues[rowIndex];
    automation.automationRows[rowIndex].setInstrumentTarget(
      song,
      0,
      0,
      targetId,
    );
    automation.patterns[0].automationEvents[rowIndex] = [
      event(module, 0, 1, [[0, value], [1, value]]),
    ];
  }

  const synth = new module.Synth(song);
  synth.setSampleRate(8000);
  const left = new Float32Array(256);
  const right = new Float32Array(256);
  synth.synthesize(left, right, left.length, true);
  const state = synth.channels[0].instruments[0];
  for (const effectType of effectTypes)
    assert.notEqual(state.effects & (1 << effectType), 0);
  const maximumSamplesPerTick =
    8000 /
    ((module.Config.tempoMin / 60) *
      module.Config.partsPerBeat *
      module.Config.ticksPerPart);
  const requiredEchoSamples =
    module.Config.echoDelayRange *
    module.Config.echoDelayStepTicks *
    maximumSamplesPerTick;
  assert.ok(state.echoDelayLineL.length >= requiredEchoSamples);

  const automationIndex = song.getChannelCount() - 1;
  assert.equal(synth.channels[automationIndex], null);
  synth.liveInputChannel = automationIndex;
  synth.liveInputPitches = [60];
  synth.liveInputInstruments = [0];
  synth.liveInputDuration = 100;
  synth.synthesize(left, right, left.length, false);
  for (let channelIndex = 0; channelIndex < automationIndex; channelIndex++) {
    for (const instrumentState of synth.channels[channelIndex].instruments)
      assert.equal(instrumentState.liveInputTones.count(), 0);
  }
  assert.ok(left.every(Number.isFinite));
  assert.ok(right.every(Number.isFinite));
});

test("keyboard, MIDI recording, and performance input ignore Automation channels", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  addAutomationChannel(module, song);
  const channel = song.getChannelCount() - 1;
  const calls = { add: 0, remove: 0, record: 0, live: 0 };
  const doc = {
    song,
    channel,
    performance: {
      preferLowLatency() {},
      addPerformedPitch() { calls.add++; },
      removePerformedPitch() { calls.remove++; },
    },
    synth: {
      snapToBar() { calls.record++; },
      maintainLiveInput() { calls.live++; },
      setLiveInputPitches() { calls.live++; },
    },
  };
  assert.equal(
    module.KeyboardLayout.keyPosToPitch(doc, 0, 0, "pianoAtC"),
    null,
  );

  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  });
  context.after(() => {
    if (previousStorage == undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", previousStorage);
  });
  const midi = new module.MidiInputHandler(doc);
  midi._takeMidiHandlerFocus();
  midi._onMidiMessage({ data: new Uint8Array([0x90, 60, 127]) });
  assert.equal(calls.add, 0);

  const performance = Object.create(module.SongPerformance.prototype);
  performance._doc = doc;
  performance.record();
  performance.addPerformedPitch(60);
  performance.setTemporaryPitches([60], 10);
  assert.deepEqual(calls, { add: 0, remove: 0, record: 0, live: 0 });
});

test("instrument targets stay independent and Automation-only metadata is filtered", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const base = song.channels[0].instruments[0];
  base.pan = 3;
  base.volume = 1;
  const channel = addAutomationChannel(module, song, 2);
  channel.automationRows[0].setInstrumentTarget(song, 0, 0, "pan");
  channel.automationRows[1].setInstrumentTarget(song, 0, 0, "mixVolume");
  channel.bars[0] = 1;
  channel.patterns[0].ensureAutomationRowCount(2);
  channel.patterns[0].automationEvents[0] = [event(module, 0, 1, [[0, 8.25], [1, 8.25]])];
  channel.patterns[0].automationEvents[1] = [event(module, 0, 1, [[0, 4.5], [1, 4.5]])];
  const runtime = new module.AutomationRuntime();
  runtime.update(song, 0, 0.5, false);
  const effective = runtime.getEffectiveInstrument(song, 0, 0);
  assert.equal(effective.pan, 8.25);
  assert.equal(effective.volume, 4.5);
  assert.equal(base.pan, 3);
  assert.equal(base.volume, 1);

  const choices = module.Config.getAutomationTargetsForInstrument(base);
  assert.ok(choices.some(({ target }) => target.name == "pan"));
  assert.ok(choices.some(({ target }) => target.name == "mixVolume"));
  assert.equal(module.Config.automationTargets.dictionary.mixVolume.supportsEnvelope, false);
  assert.equal(base.supportsEnvelopeTarget(module.Config.automationTargets.dictionary.mixVolume.index, 0), false);
});

test("all required instrument target families bind to effective runtime values", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const musical = song.channels[0];
  const makeInstrument = (type) => {
    const instrument = new module.Instrument(false);
    instrument.setTypeAndReset(type, false);
    musical.instruments.push(instrument);
    return musical.instruments.length - 1;
  };
  const generalIndex = 0;
  const general = musical.instruments[generalIndex];
  general.effects = (1 << module.EffectType.eqFilter) |
    (1 << module.EffectType.noteFilter) |
    (1 << module.EffectType.distortion) |
    (1 << module.EffectType.bitcrusher) |
    (1 << module.EffectType.chorus) |
    (1 << module.EffectType.echo) |
    (1 << module.EffectType.reverb) |
    (1 << module.EffectType.pitchShift) |
    (1 << module.EffectType.detune) |
    (1 << module.EffectType.vibrato);
  general.eqFilter.addPoint(module.FilterType.peak, 10, 8);
  general.noteFilter.addPoint(module.FilterType.lowPass, 12, 7);
  const pwmIndex = makeInstrument(module.InstrumentType.pwm);
  const stringIndex = makeInstrument(module.InstrumentType.pickedString);
  const fmIndex = makeInstrument(module.InstrumentType.fm);
  const supersawIndex = makeInstrument(module.InstrumentType.supersaw);

  const bindings = [
    [generalIndex, "mixVolume", 0, 3.25, (value) => value.volume],
    [generalIndex, "pan", 0, 6.5, (value) => value.pan],
    [generalIndex, "eqFilterFreq", 0, 14.5, (value) => value.eqFilter.controlPoints[0].freq],
    [generalIndex, "eqFilterGain", 0, 9.5, (value) => value.eqFilter.controlPoints[0].gain],
    [generalIndex, "noteFilterFreq", 0, 15.5, (value) => value.noteFilter.controlPoints[0].freq],
    [generalIndex, "noteFilterGain", 0, 10.5, (value) => value.noteFilter.controlPoints[0].gain],
    [generalIndex, "distortion", 0, 4.5, (value) => value.distortion],
    [generalIndex, "bitcrusherQuantization", 0, 3.5, (value) => value.bitcrusherQuantization],
    [generalIndex, "bitcrusherFrequency", 0, 5.5, (value) => value.bitcrusherFreq],
    [generalIndex, "chorus", 0, 2.5, (value) => value.chorus],
    [generalIndex, "echoSustain", 0, 8.5, (value) => value.echoSustain],
    [generalIndex, "echoDelay", 0, 7.5, (value) => value.echoDelay],
    [generalIndex, "reverb", 0, 2.5, (value) => value.reverb],
    [generalIndex, "pitchShift", 0, 8.5, (value) => value.pitchShift],
    [generalIndex, "detune", 0, 10.5, (value) => value.detune],
    [generalIndex, "vibrato", 0, 2, (value) => value.vibrato],
    [pwmIndex, "pulseWidth", 0, 4.25, (value) => value.pulseWidth],
    [stringIndex, "stringSustain", 0, 7.25, (value) => value.stringSustain],
    [fmIndex, "operatorFrequency", 2, 3.75, (value) => value.operators[2].frequency],
    [fmIndex, "operatorAmplitude", 1, 9, (value) => value.operators[1].amplitude],
    [fmIndex, "feedbackAmplitude", 0, 6, (value) => value.feedbackAmplitude],
    [supersawIndex, "supersawDynamism", 0, 4.25, (value) => value.supersawDynamism],
    [supersawIndex, "supersawSpread", 0, 5.25, (value) => value.supersawSpread],
    [supersawIndex, "supersawShape", 0, 5.75, (value) => value.supersawShape],
    [supersawIndex, "pulseWidth", 0, 3.25, (value) => value.pulseWidth],
  ];
  const automation = addAutomationChannel(module, song, bindings.length);
  automation.bars[0] = 1;
  automation.patterns[0].ensureAutomationRowCount(bindings.length);
  for (let rowIndex = 0; rowIndex < bindings.length; rowIndex++) {
    const [instrumentIndex, targetId, targetIndex, value] = bindings[rowIndex];
    automation.automationRows[rowIndex].setInstrumentTarget(
      song,
      0,
      instrumentIndex,
      targetId,
      targetIndex,
    );
    assert.equal(automation.automationRows[rowIndex].isTargetValid(song), true);
    automation.patterns[0].automationEvents[rowIndex] = [
      event(module, 0, 1, [[0, value], [1, value]]),
    ];
  }
  const runtime = new module.AutomationRuntime();
  runtime.update(song, 0, 0.5, false);
  for (const [instrumentIndex, _targetId, _targetIndex, expected, getter] of bindings) {
    assert.equal(
      getter(runtime.getEffectiveInstrument(song, 0, instrumentIndex)),
      expected,
      _targetId,
    );
  }
  assert.equal(general.pan, module.Config.panCenter);
  assert.equal(musical.instruments[fmIndex].operators[2].frequency, 1);
});

test("cross-target numeric mapping snaps integer targets and preserves continuous fractions", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  assert.equal(
    module.mapAutomationValueBetweenDomains(
      2.5,
      { min: 0, max: 10, integer: false },
      { min: 0, max: 3, integer: true },
    ),
    1,
  );
  assert.equal(
    module.mapAutomationValueBetweenDomains(
      2.5,
      { min: 0, max: 10, integer: false },
      { min: -1, max: 1, integer: false },
    ),
    -0.5,
  );
  assert.equal(
    module.mapAutomationClipboardValue(
      2.375,
      true,
      { min: 0, max: 10, integer: false },
      { min: 0, max: 10, integer: false },
    ),
    2.375,
    "same-target paste preserves the exact operand",
  );
  assert.equal(
    module.mapAutomationClipboardValue(
      2.5,
      false,
      { min: 0, max: 10, integer: false },
      { min: 0, max: 3, integer: true },
    ),
    1,
  );

  const song = new module.Song();
  const automation = addAutomationChannel(module, song, 1);
  const row = automation.automationRows[0];
  row.setInstrumentTarget(song, 0, 0, "pan");
  const panDomain = row.getValueDomain();
  setPatternEvents(automation, 0, 0, [
    event(module, 0, 1, [[0, 12.375], [1, 64.125]]),
  ]);
  const mixTarget = module.Config.automationTargets.dictionary.mixVolume;
  const mixDomain = module.Config.getAutomationValueDomain(mixTarget);
  const expected = automation.patterns[0].automationEvents[0][0].points.map(
    (point) =>
      module.mapAutomationValueBetweenDomains(point.value, panDomain, mixDomain),
  );
  const doc = makeChangeDocument(song, song.getChannelCount() - 1);
  new module.ChangeAutomationTargetElement(doc, 0, "mixVolume", 0);
  assert.deepEqual(
    automation.patterns[0].automationEvents[0][0].points.map(
      (point) => point.value,
    ),
    expected,
    "changing a surface target remaps stored operands into its new domain",
  );
});

test("Automation pattern content, Track compatibility, and MIDI skipping use channel kind", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const pattern = new module.Pattern();
  pattern.ensureAutomationRowCount(1);
  pattern.automationEvents[0].push(
    event(module, 0, 1, [[0, 1.25], [1, 1.25]]),
  );
  assert.equal(pattern.hasContent(module.ChannelKind.automation), true);
  assert.equal(pattern.hasContent(module.ChannelKind.pitch), false);
  assert.equal(pattern.hasContent(module.ChannelKind.noise), false);

  for (const source of Object.values(module.ChannelKind)) {
    for (const destination of Object.values(module.ChannelKind)) {
      assert.equal(
        module.trackChannelKindsAreCompatible(source, destination),
        source == destination,
      );
    }
  }

  const song = new module.Song();
  const automation = addAutomationChannel(module, song);
  automation.patterns[0] = pattern;
  automation.bars[0] = 1;
  const automationIndex = song.getChannelCount() - 1;
  const tracks = module.createMidiExportTracks(song);
  assert.equal(
    tracks.some((track) => track.channel == automationIndex),
    false,
  );
});

test("Automation time selections remain independent per row", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const selection = new module.AutomationRowSelectionState();
  selection.setRange(0, 6, 18);
  selection.setRange(1, 24, 12);
  assert.equal(selection.activeRow, 1);
  assert.deepEqual(selection.getRange(0), { start: 6, end: 18 });
  assert.deepEqual(selection.getRange(1), { start: 12, end: 24 });
  assert.equal(selection.contains(0, 12), true);
  assert.equal(selection.contains(1, 6), false);
  assert.deepEqual(selection.rangeRows(), [0, 1]);
  selection.trim(2, 20);
  assert.deepEqual(selection.getRange(1), { start: 12, end: 20 });
});

test("Automation time selections clip, split, and value-bend events", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const source = event(module, 0, 24, [[0, 0], [12, 6], [24, 0]]);

  const clipped = module.clipEvent(source, 6, 18);
  assert.deepEqual(
    [clipped.start, clipped.end, ...clipped.points.map((point) => point.value)],
    [6, 18, 3, 6, 3],
  );

  const split = module.deleteEventRange([source], 6, 18);
  assert.deepEqual(split.map((automationEvent) => [automationEvent.start, automationEvent.end]), [
    [0, 6],
    [18, 24],
  ]);
  assert.equal(split[0].getFinalValue(), 3);
  assert.equal(split[1].points[0].value, 3);

  const bent = module.bendEvent(
    source,
    6,
    2,
    (value) => Math.max(0, Math.min(10, value)),
    false,
    module.Config.automationPointsPerEventMax,
  );
  assert.deepEqual(
    bent.points.map((point) => [point.time, point.value]),
    [[0, 0], [6, 5], [12, 6], [24, 0]],
  );
  assert.deepEqual(
    source.points.map((point) => [point.time, point.value]),
    [[0, 0], [12, 6], [24, 0]],
    "bending leaves the original event intact",
  );
});

test("notes and Automation share the Event model and range handlers", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const note = new module.Note(24, 0, 24, 8);
  note.pins = [
    module.makeNotePin(0, 0, 8),
    module.makeNotePin(4, 12, 4),
    module.makeNotePin(4, 24, 2),
  ];

  assert.equal(note instanceof module.Event, true);
  assert.equal(note.pins[0] instanceof module.EventPoint, true);
  assert.equal(note.points, note.pins);
  note.points[0].value = 6;
  assert.equal(note.pins[0].size, 6);

  const clipped = module.clipEvent(note, 6, 18);
  assert.equal(clipped instanceof module.Note, true);
  assert.deepEqual([clipped.start, clipped.end], [6, 18]);
  assert.equal(clipped.pins[0].interval, 0);
  assert.equal(clipped.pitches[0], 26);
  assert.deepEqual(
    Object.keys(JSON.parse(JSON.stringify(note))).sort(),
    ["continuesLastPattern", "end", "pins", "pitches", "start"],
  );
});

test("shared event edits clip collisions, flatten values, repeat, and render", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const events = [
    event(module, 0, 6, [[0, 1], [6, 1]]),
    event(module, 8, 12, [[0, 2], [4, 2]]),
    event(module, 14, 20, [[0, 3], [6, 3]]),
  ];
  const extended = module.editEventTime(events, 1, 1, 6, 1, 24, 32);
  assert.deepEqual(
    extended.map((candidate) => [candidate.start, candidate.end]),
    [[0, 6], [8, 18], [18, 20]],
  );

  const endpointMerged = module.editEventTime(
    [event(module, 0, 12, [[0, 1], [6, 4], [12, 2]])],
    0,
    1,
    6,
    1,
    24,
    32,
  )[0];
  assert.deepEqual(
    endpointMerged.points.map((point) => [point.time, point.value]),
    [[0, 1], [12, 4]],
    "moving an interior point onto the endpoint replaces the endpoint",
  );

  const crowdedEnd = event(module, 0, 96, [
    [0, 30],
    [90, 300],
    [95.999, 229],
    [96, 300],
  ]);
  assert.equal(
    module.nearestEventPointIndex(crowdedEnd, 95.85, 0.8),
    crowdedEnd.points.length - 1,
    "the endpoint wins when multiple points render within its hit radius",
  );

  const shaped = event(module, 0, 12, [[0, 1], [6, 4], [12, 2]]);
  const flattened = module.bendEvent(
    shaped,
    6,
    2,
    (value) => Math.max(0, Math.min(10, value)),
    true,
    32,
  );
  assert.deepEqual(flattened.points.map((point) => point.value), [6, 6, 6]);

  const repeated = module.repeatEvents(
    [event(module, 0, 12, [[0, 5], [12, 5]])],
    12,
    { start: 3, end: 28 },
  );
  assert.deepEqual(
    repeated.map((candidate) => [candidate.start, candidate.end]),
    [[3, 15], [15, 27], [27, 28]],
  );

  const note = new module.Note(24, 0, 12, 5);
  const options = {
    partWidth: 2,
    radius: 4,
    centerY: () => 10,
    valueScale: (point) => point.value / 5,
  };
  assert.equal(module.eventPath(note, options), module.eventPath(
    event(module, 0, 12, [[0, 5], [12, 5]]),
    options,
  ));
});

test("target filtering follows instrument type, enabled effects, and filter points", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const instrument = song.channels[0].instruments[0];
  const names = () =>
    module.Config.getAutomationTargetsForInstrument(instrument).map(
      ({ target }) => target.name,
    );
  assert.ok(names().includes("pan"));
  assert.equal(names().includes("echoDelay"), false);
  assert.equal(names().includes("reverb"), false);
  assert.equal(names().includes("bitcrusherFrequency"), false);
  assert.equal(names().includes("noteFilterFreq"), false);

  instrument.effects |=
    (1 << module.EffectType.echo) |
    (1 << module.EffectType.reverb) |
    (1 << module.EffectType.bitcrusher) |
    (1 << module.EffectType.noteFilter);
  instrument.noteFilter.controlPointCount = 1;
  const enabled = names();
  assert.ok(enabled.includes("echoDelay"));
  assert.ok(enabled.includes("reverb"));
  assert.ok(enabled.includes("bitcrusherFrequency"));
  assert.ok(enabled.includes("noteFilterFreq"));
});

test("channel and instrument reference remapping preserves identity and marks deletion missing", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const automation = addAutomationChannel(module, song, 2);
  const first = automation.automationRows[0];
  first.setInstrumentTarget(song, 1, 0, "pan");
  song.remapAutomationChannelReferences([1, 0, 2, 3, 4]);
  assert.equal(first.targetChannel, 0);
  assert.equal(first.targetChannelMissing, false);

  const second = automation.automationRows[1];
  second.setInstrumentTarget(song, 0, 0, "pan");
  song.remapAutomationChannelReferences([null, 1, 2, 3, 4]);
  assert.equal(second.targetChannelMissing, true);
  const deletedAddress = second.targetChannel;
  song.remapAutomationChannelReferences([0, 1, 2, 3, 4]);
  assert.equal(second.targetChannel, deletedAddress);
  assert.equal(second.targetChannelMissing, true, "a replacement at the same index does not inherit the surface");

  first.targetChannelMissing = false;
  first.targetInstrumentMissing = false;
  first.targetChannel = 0;
  first.targetInstrument = 1;
  song.remapAutomationInstrumentReferences(0, [1, 0]);
  assert.equal(first.targetInstrument, 0);
  song.remapAutomationInstrumentReferences(0, [null, 1]);
  assert.equal(first.targetInstrumentMissing, true);
});

test("real channel, instrument, effect, and filter edits preserve or invalidate references", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const song = new module.Song();
  const doc = makeChangeDocument(song);
  new module.ChangeChannelCount(
    doc,
    song.pitchChannelCount,
    song.noiseChannelCount,
    1,
  );
  const automationIndex = song.getChannelCount() - 1;
  const rows = song.channels[automationIndex].automationRows;
  rows[0].setInstrumentTarget(song, song.pitchChannelCount, 0, "pan");
  const targetedNoise = song.channels[rows[0].targetChannel];

  new module.ChangeChannelCount(
    doc,
    song.pitchChannelCount + 1,
    song.noiseChannelCount,
    song.automationChannelCount,
  );
  assert.equal(song.channels[rows[0].targetChannel], targetedNoise);
  const firstPitch = song.channels[0];
  rows[1].setInstrumentTarget(song, 0, 0, "pan");
  new module.ChangeChannelOrder(doc, 0, 0, 1);
  assert.equal(song.channels[rows[1].targetChannel], firstPitch);

  doc.channel = rows[1].targetChannel;
  const instrument = song.channels[doc.channel].instruments[0];
  const extraInstrument = new module.Instrument(false);
  song.channels[doc.channel].instruments.push(extraInstrument);
  rows[2].setInstrumentTarget(song, doc.channel, 1, "pan");
  doc.viewedInstrument[doc.channel] = 0;
  new module.ChangeRemoveChannelInstrument(doc);
  assert.equal(rows[2].targetInstrument, 0);
  assert.equal(rows[2].targetInstrumentMissing, false);
  doc.viewedInstrument[doc.channel] = 0;
  new module.ChangeRemoveChannelInstrument(doc);
  assert.equal(
    rows[2].targetInstrumentMissing,
    false,
    "the minimum instrument guard keeps the surviving target valid",
  );

  const targetInstrument = song.channels[doc.channel].instruments[0];
  targetInstrument.effects |= 1 << module.EffectType.reverb;
  rows[2].setInstrumentTarget(song, doc.channel, 0, "reverb");
  new module.ChangeToggleEffects(doc, module.EffectType.reverb);
  assert.equal(rows[2].targetElementMissing, true);
  new module.ChangeToggleEffects(doc, module.EffectType.reverb);
  assert.equal(
    rows[2].targetElementMissing,
    true,
    "reenabling an effect does not let a replacement inherit the reference",
  );

  targetInstrument.effects |= 1 << module.EffectType.eqFilter;
  targetInstrument.eqFilter.reset();
  targetInstrument.eqFilter.addPoint(module.FilterType.lowPass, 10, 7);
  targetInstrument.eqFilter.addPoint(module.FilterType.peak, 20, 8);
  rows[3].setInstrumentTarget(song, doc.channel, 0, "eqFilterFreq", 1);
  const insertedPoint = new module.FilterControlPoint();
  insertedPoint.type = module.FilterType.highPass;
  insertedPoint.set(5, 6);
  new module.ChangeFilterAddPoint(
    doc,
    targetInstrument.eqFilter,
    insertedPoint,
    0,
    false,
  );
  assert.equal(rows[3].targetIndex, 2);
  const deletedPoint = targetInstrument.eqFilter.controlPoints[2];
  new module.ChangeFilterAddPoint(
    doc,
    targetInstrument.eqFilter,
    deletedPoint,
    2,
    false,
    true,
  );
  assert.equal(rows[3].targetElementMissing, true);
  const replacementPoint = new module.FilterControlPoint();
  replacementPoint.type = module.FilterType.peak;
  replacementPoint.set(20, 8);
  new module.ChangeFilterAddPoint(
    doc,
    targetInstrument.eqFilter,
    replacementPoint,
    2,
    false,
  );
  assert.equal(rows[3].targetElementMissing, true);
});

test("Automation events survive beat stretching, splicing, overflow, and wrap movement", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);

  const stretchedSong = new module.Song();
  const stretchedChannel = addAutomationChannel(module, stretchedSong);
  setPatternEvents(stretchedChannel, 0, 0, [
    event(module, 8, 72, [[0, 100.5], [64, 200.5]]),
  ]);
  const stretchedDoc = makeChangeDocument(
    stretchedSong,
    stretchedSong.getChannelCount() - 1,
  );
  new module.ChangeBeatsPerBar(stretchedDoc, 2, "stretch");
  const stretched = stretchedChannel.patterns[0].automationEvents[0][0];
  assert.deepEqual(
    [stretched.start, stretched.end, stretched.points[1].time],
    [4, 36, 32],
  );
  new module.ChangeBeatsPerBar(stretchedDoc, 1, "splice");
  assert.equal(
    stretchedChannel.patterns[0].automationEvents[0][0].end,
    module.Config.partsPerBeat,
  );

  const wrappedSong = new module.Song();
  const wrappedChannel = addAutomationChannel(module, wrappedSong);
  const partsPerBar = wrappedSong.beatsPerBar * module.Config.partsPerBeat;
  setPatternEvents(wrappedChannel, 0, 0, [
    event(module, partsPerBar - 8, partsPerBar, [[0, 1.25], [8, 2.75]]),
  ]);
  const wrappedDoc = makeChangeDocument(
    wrappedSong,
    wrappedSong.getChannelCount() - 1,
  );
  new module.ChangeMoveNotesSideways(wrappedDoc, 1, "wrapAround");
  const wrapped = wrappedChannel.patterns[0].automationEvents[0];
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].start, module.Config.partsPerBeat - 8);
  assert.equal(wrapped[0].points[1].value, 2.75);

  const overflowSong = new module.Song();
  overflowSong.barCount = 2;
  for (const channel of overflowSong.channels) channel.bars.length = 2;
  const overflowChannel = addAutomationChannel(module, overflowSong);
  const overflowRowCount = overflowChannel.automationRows.length;
  overflowChannel.bars.length = 2;
  setPatternEvents(overflowChannel, 0, 0, [
    event(module, partsPerBar - 4, partsPerBar, [[0, 3.5], [4, 4.5]]),
  ]);
  const overflowDoc = makeChangeDocument(
    overflowSong,
    overflowSong.getChannelCount() - 1,
  );
  new module.ChangeMoveNotesSideways(overflowDoc, 1, "overflow");
  const movedAutomation = overflowDoc.song.channels.at(-1);
  assert.ok(
    movedAutomation.patterns.some((pattern) =>
      pattern.automationEvents[0]?.some(
        (automationEvent) =>
          automationEvent.start == module.Config.partsPerBeat - 4,
      ),
    ),
  );
  assert.equal(movedAutomation.automationRows.length, overflowRowCount);
});

async function renderSong(module, song, sampleRate = 8000) {
  const renderer = new module.SongRenderer({
    async loadAssetsInto() {},
  });
  for await (const _progress of renderer.generate(song, sampleRate, true, true, 1)) {
    // Exhaust the async renderer.
  }
  return renderer.outputSamplesL.length;
}

function makeOneBarSong(module) {
  const song = new module.Song();
  song.barCount = 1;
  song.loopStart = 0;
  song.loopLength = 1;
  for (const channel of song.channels) channel.bars.length = 1;
  return song;
}

test("growable rendering respects automation, clamping, and the non-automated duration", async (context) => {
  const module = await loadAutomationModules();
  context.after(module.cleanup);
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) =>
    setImmediate(() => callback(performance.now()));
  context.after(() => {
    globalThis.requestAnimationFrame = previousAnimationFrame;
  });

  const baseline = makeOneBarSong(module);
  baseline.tempo = 120;
  const baselineLength = await renderSong(module, baseline);
  assert.equal(baselineLength, 16000);

  const automated = makeOneBarSong(module);
  automated.tempo = 120;
  const automatedChannel = addAutomationChannel(module, automated);
  automatedChannel.automationRows[0].setSongTarget("tempo");
  const automatedParts = automated.beatsPerBar * module.Config.partsPerBeat;
  setPatternEvents(automatedChannel, 0, 0, [
    event(module, 0, automatedParts, [[0, 240], [automatedParts, 240]]),
  ]);
  assert.equal(await renderSong(module, automated), 8000);

  const clamped = makeOneBarSong(module);
  clamped.tempo = 120;
  const channel = addAutomationChannel(module, clamped);
  channel.automationRows[0].setSongTarget("tempo");
  const parts = clamped.beatsPerBar * module.Config.partsPerBeat;
  setPatternEvents(channel, 0, 0, [
    event(module, 0, parts, [[0, 400], [parts, 400]]),
  ]);
  assert.equal(await renderSong(module, clamped), 6401);
});
