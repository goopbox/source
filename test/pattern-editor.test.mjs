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
  const gradientStops = [];
  const drawing = {
    setTransform() {}, clearRect() {}, fill() {}, stroke() {}, fillRect() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop(offset, color) {
      gradientStops.push([offset, color]);
    } }),
  };
  const railDrawing = Object.create(drawing);
  const pattern = {};
  const note = {
    start: 0, end: 24,
    pins: [{ time: 0, interval: 0, size: 3 }, { time: 24, interval: 0, size: 3 }],
  };
  Object.assign(editor, {
    _hitCanvas: { width: 100, height: 100, getContext: () => drawing },
    _railCanvas: { width: 100, height: 100, getContext: () => railDrawing },
    _expandingCanvas: { width: 100, height: 100, getContext: () => drawing },
    container: { isConnected: true },
    _svgPlayhead: { getAttribute: () => "" },
    _editorWidth: 100, _editorHeight: 100, _partWidth: 1,
    _pitchHeight: 10, _pitchCount: 12,
    _hitNotes: [{ note, pitch: 0, offset: 0, channel: 0, color: "#88aaff", path: {} }],
    _hitCopies: [], _lastHitPosition: null, _lastHitBar: -1,
    _barOffset: 0,
    _doc: {
      bar: 0,
      synth: { playing: true, playhead: 0 },
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
  assert.equal(railDrawing.globalAlpha, 0.9, "rail starts at full opacity");
  assert.deepEqual(gradientStops, [[0, "white"], [1, "#88aaff00"]]);
  editor._doc.synth.playhead = 0.3;
  editor._animateNoteHits(249);
  assert.equal(editor._hitCopies.length, 1, "copy survives after the short note ends");
  editor._animateNoteHits(250);
  assert.equal(editor._hitCopies.length, 0);
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
