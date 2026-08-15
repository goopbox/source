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
