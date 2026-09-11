import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class FakeNode {
  constructor() {
    this.style = {};
  }
  setAttribute() {}
  appendChild(child) {
    return child;
  }
}

async function loadPatternEditor() {
  globalThis.Node = FakeNode;
  globalThis.Element = FakeNode;
  globalThis.HTMLElement = FakeNode;
  globalThis.SVGElement = FakeNode;
  globalThis.DOMPoint = class {};
  globalThis.DOMMatrix = class {};
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    createElement: () => new FakeNode(),
    createElementNS: () => new FakeNode(),
    head: new FakeNode(),
    querySelector: () => null,
  };

  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-pattern-editor-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["src/PatternEditor.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    PatternEditor: module.PatternEditor,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

async function loadHitAnimation() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-hit-animation-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["src/NoteHitAnimation.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(directory, { recursive: true }) };
}

test("unrestricted and drum pitches do not look up a named scale", async (context) => {
  const { PatternEditor, cleanup } = await loadPatternEditor();
  context.after(cleanup);
  const editor = Object.create(PatternEditor.prototype);
  editor._doc = {
    channel: 0,
    prefs: { notesOutsideScale: true },
    song: {
      composingKey: 0,
      key: 0,
      scale: Number.MAX_SAFE_INTEGER,
      getChannelIsNoise: () => false,
    },
  };

  assert.equal(editor._snapToPitch(3.8, 0, 10), 3);
  editor._doc.prefs.notesOutsideScale = false;
  editor._doc.song.getChannelIsNoise = () => true;
  assert.equal(editor._snapToPitch(12.8, 0, 10), 10);
});

test("note hit effects start immediately, expire after 250ms, repeat on loops, and clear on stop", async (context) => {
  const { PatternEditor, cleanup } = await loadPatternEditor();
  context.after(cleanup);
  const editor = Object.create(PatternEditor.prototype);
  const drawing = {
    setTransform() {}, clearRect() {}, fill() {}, stroke() {}, fillRect() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  const ghostDrawing = Object.create(drawing);
  const expandingDrawing = Object.create(drawing);
  const canvasFor = (context) => context.canvas = {
    width: 100, height: 100, getContext: () => context,
  };
  const pattern = { notes: [] };
  const note = {
    start: 0, end: 24,
    pitches: [0],
    pins: [{ time: 0, interval: 0, size: 3 }, { time: 24, interval: 0, size: 3 }],
  };
  Object.assign(editor, {
    _hitCanvas: canvasFor(drawing),
    _ghostHitCanvas: canvasFor(ghostDrawing),
    _expandingCanvas: canvasFor(expandingDrawing),
    container: { isConnected: true },
    _svgPlayhead: { getAttribute: () => "" },
    _editorWidth: 100, _editorHeight: 100, _partWidth: 1,
    _pitchHeight: 10, _pitchCount: 12,
    _hitNotes: [{ note, pitch: 0, offset: 0, channel: 0, color: "#88aaff", path: {} }],
    _hitCopies: [], _lastHitPosition: null, _lastHitBar: -1,
    _barOffset: 0,
    _doc: {
      bar: 0, channel: 0,
      synth: {
        playing: true, playhead: 0, previousBar: null,
        getPreviousBar() { return this.previousBar; },
      },
      song: {
        beatsPerBar: 4, pitchChannelCount: 1, noiseChannelCount: 0,
        channels: [{ muted: false }], getPattern: () => pattern,
        getChannelIsPitch: () => true, getChannelIsNoise: () => false, getChannelIsAutomation: () => false,
      },
    },
  });
  window.devicePixelRatio = 1;
  editor._animateNoteHits(0);
  assert.equal(editor._hitCopies.length, 1);
  editor._doc.synth.playhead = 0.125;
  editor._animateNoteHits(125);
  editor._doc.synth.playhead = 0.12;
  editor._animateNoteHits(130);
  assert.equal(editor._hitCopies.length, 1, "a backward playhead correction does not repeat an active note hit");
  note.pins[1].interval = 4;
  note.pins[1].size = 10;
  editor._animateNoteHits(150);
  note.pins[1].interval = 0;
  note.pins[1].size = 3;
  editor._doc.synth.playhead = 0.3;
  editor._animateNoteHits(249);
  assert.equal(editor._hitCopies.length, 1, "copy survives after the short note ends");
  editor._animateNoteHits(250);
  assert.equal(editor._hitCopies.length, 0);
  note.continuesLastPattern = true;
  editor._doc.synth.playhead = 1;
  editor._animateNoteHits(1000);
  assert.equal(editor._hitCopies.length, 1, "a stale continuation flag still produces a hit");
  pattern.notes = [{
    end: 96,
    pitches: [0],
    pins: [{ interval: 0 }],
  }];
  editor._lastHitBar = 0;
  editor._doc.synth.previousBar = 0;
  editor._animateNoteHits(1250);
  assert.equal(editor._hitCopies.length, 0, "a valid tie from the previous bar does not hit again");
  for (const lastRenderedBar of [-1, 1, 7]) {
    editor._lastHitBar = lastRenderedBar;
    editor._lastHitPosition = null;
    editor._animateNoteHits(1300);
    assert.equal(editor._hitCopies.length, 0, "ties survive hidden views, redraws, and missed frames");
  }
  editor._doc.synth.playhead = 0;
  editor._lastHitBar = 0;
  editor._lastHitPosition = null;
  editor._animateNoteHits(1400);
  assert.equal(editor._hitCopies.length, 0, "ties also survive a single-bar loop");
  editor._doc.synth.previousBar = 7;
  editor._lastHitBar = -1;
  editor._animateNoteHits(1450);
  assert.equal(editor._hitCopies.length, 0, "loop ties use the audio predecessor even without a rendered loop end");
  pattern.notes[0].end = 95;
  assert.equal(editor._noteContinuesFromPreviousBar(note, 0, 0), false, "a gap breaks the tie");
  pattern.notes[0].end = 96;
  pattern.notes[0].pitches = [1];
  assert.equal(editor._noteContinuesFromPreviousBar(note, 0, 0), false, "different pitches break the tie");
  pattern.notes[0].pins[0].interval = -1;
  assert.equal(editor._noteContinuesFromPreviousBar(note, 0, 0), true, "pitch bends ending on the next pitch preserve the tie");
  editor._doc.synth.previousBar = null;
  editor._lastHitPosition = null;
  editor._animateNoteHits(1500);
  assert.equal(editor._hitCopies.length, 1, "starting playback on a tied note still hits without an audio predecessor");
  editor._animateNoteHits(1750);
  assert.equal(editor._hitCopies.length, 0);
  note.continuesLastPattern = false;
  editor._lastHitBar = 0;
  for (let loop = 1; loop <= 1000; loop++) {
    editor._doc.synth.playhead = loop;
    editor._animateNoteHits(loop * 1000);
    assert.equal(editor._hitCopies.length, 1, "looping does not accumulate expired copies");
  }
  editor._doc.synth.playing = false;
  editor._animateNoteHits(1000001);
  assert.equal(editor._hitCopies.length, 0);
  assert.equal(editor._lastHitPosition, null);
  editor._doc.synth.playing = true;
  editor._doc.song.channels[0].muted = true;
  editor._animateNoteHits(1000002);
  assert.equal(editor._hitCopies.length, 0, "muted notes do not flash");
  editor._doc.song.channels[0].muted = false;
  editor._lastHitPosition = 0;
  editor._lastHitBar = 0;
  note.start = 12;
  note.end = 13;
  editor._doc.synth.playhead = 0.2;
  editor._animateNoteHits(1000003);
  assert.equal(editor._hitCopies.length, 1, "short hits between frames still flash");
  editor._doc.song.getChannelIsAutomation = () => true;
  editor._animateNoteHits(1000004);
  assert.equal(editor._hitCopies.length, 0, "switching to automation clears effects");
  editor._hitNotes = [];
  editor._cacheHitNote(note, 0, 0, 0, {});
  assert.equal(editor._hitNotes.length, 0, "automation is excluded from the note cache");

  editor._doc.song.getChannelIsAutomation = () => false;
  editor._doc.song.channels.push({ muted: false });
  editor._doc.synth.playhead = 0.125;
  note.start = 0;
  note.end = 24;
  const mainPath = {};
  const ghostPath = {};
  editor._hitNotes = [
    { note, pitch: 0, offset: 0, channel: 1, color: "#ffaa88", path: ghostPath },
    { note, pitch: 0, offset: 0, channel: 0, color: "#88aaff", path: mainPath },
  ];
  const calls = new Map();
  for (const layer of [drawing, ghostDrawing, expandingDrawing]) {
    calls.set(layer, { fills: [], rails: 0, copies: 0, clears: 0 });
    layer.fill = (path) => calls.get(layer).fills.push(path);
    layer.fillRect = () => calls.get(layer).rails++;
    layer.drawImage = () => calls.get(layer).copies++;
    layer.clearRect = () => calls.get(layer).clears++;
  }
  expandingDrawing.lineJoin = "miter";
  editor._animateNoteHits(1000010);
  assert.deepEqual(calls.get(drawing).fills, [mainPath], "main sustain uses the main layer");
  assert.deepEqual(calls.get(ghostDrawing).fills, [ghostPath], "ghost sustain uses the ghost layer");
  assert.equal(calls.get(drawing).copies, 1, "main expanding copy uses the main layer");
  assert.equal(calls.get(ghostDrawing).copies, 1, "ghost expanding copy uses the ghost layer");
  assert.equal(expandingDrawing.lineJoin, "miter", "expanding copies retain sharp corners");
  editor._doc.synth.playing = false;
  editor._animateNoteHits(1000011);
  for (const layer of [drawing, ghostDrawing]) {
    assert.equal(calls.get(layer).clears, 2, "every effect layer clears on stop");
  }
  assert.equal(editor._hitCopies.length, 0);
});

test("hit effect fades start immediately and end after 250ms", async (context) => {
  const { module, cleanup } = await loadHitAnimation();
  context.after(cleanup);

  assert.equal(module.hitOpacity(0, 0), 1);
  assert.equal(module.hitOpacity(125, 0), 0.5);
  assert.equal(module.hitIsActive(249, 0), true);
  assert.equal(module.hitIsActive(250, 0), false);
  assert.equal(module.hitOpacity(250, 0), 0);
});

test("deleting any channel during playback tolerates cached hit notes until redraw", async (context) => {
  const { PatternEditor, cleanup } = await loadPatternEditor();
  context.after(cleanup);
  window.devicePixelRatio = 1;

  for (const deletedChannel of [0, 1, 2]) {
    const editor = Object.create(PatternEditor.prototype);
    const makeCanvas = () => {
      const drawing = {
        setTransform() {}, clearRect() {}, fill() {}, stroke() {}, drawImage() {},
      };
      return drawing.canvas = { width: 100, height: 100, getContext: () => drawing };
    };
    const channels = Array.from({ length: 3 }, () => ({
      muted: false,
      pattern: { notes: [{ start: 0, end: 24 }] },
    }));
    const cacheNotes = () => channels.map((channel, index) => ({
      note: channel.pattern.notes[0], channel: index, color: "#88aaff", path: {},
    }));
    Object.assign(editor, {
      _hitCanvas: makeCanvas(), _ghostHitCanvas: makeCanvas(), _expandingCanvas: makeCanvas(),
      container: { isConnected: true },
      _svgPlayhead: { getAttribute: () => "" },
      _editorWidth: 100, _editorHeight: 100, _barOffset: 0,
      _hitNotes: cacheNotes(), _hitCopies: [], _lastHitPosition: null, _lastHitBar: -1,
      _doc: {
        bar: 0, channel: deletedChannel,
        synth: { playing: true, playhead: 0.125 },
        song: {
          beatsPerBar: 4, channels,
          getChannelIsAutomation: () => false,
          getPattern: (channel) => channels[channel].pattern,
        },
      },
    });

    editor._animateNoteHits(0);
    assert.equal(editor._hitCopies.length, 3);

    // Deletion changes channel indexes before the next redraw refreshes the cache.
    channels.splice(deletedChannel, 1);
    editor._doc.channel = Math.max(0, deletedChannel - 1);
    editor._doc.synth.playhead = 0.2;
    assert.doesNotThrow(() => editor._animateNoteHits(100), `deleting channel ${deletedChannel}`);

    editor._hitNotes = cacheNotes();
    editor._doc.synth.playhead = 1;
    editor._animateNoteHits(300);
    assert.equal(editor._hitCopies.length, 2, "remaining channels still animate after the cache refreshes");
    editor._animateNoteHits(550);
    assert.equal(editor._hitCopies.length, 0, "effects continue to expire");
  }
});
