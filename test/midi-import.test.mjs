import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class FakeNode {}

class FakeElement extends FakeNode {
  constructor() {
    super();
    this.files = [];
    this.value = "";
    this.style = { setProperty() {} };
    this._listeners = new Map();
  }

  setAttribute() {}
  removeAttribute() {}
  click() {}
  appendChild(child) {
    return child;
  }

  addEventListener(name, listener) {
    const listeners = this._listeners.get(name) ?? [];
    listeners.push(listener);
    this._listeners.set(name, listeners);
  }

  removeEventListener(name, listener) {
    const listeners = this._listeners.get(name) ?? [];
    this._listeners.set(
      name,
      listeners.filter((candidate) => candidate !== listener),
    );
  }
}

async function loadModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-midi-import-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export { ImportFile } from "./src/Import.ts";',
        'export { Song } from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "midi-import-test-entry.ts",
      loader: "ts",
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

function makeTrack(port, pitch) {
  const events = Buffer.from([
    0x00,
    0xff,
    0x21,
    0x01,
    port,
    0x00,
    0xc0,
    0x00,
    0x00,
    0x90,
    pitch,
    0x5a,
    0x18,
    0x80,
    pitch,
    0x00,
    0x00,
    0xff,
    0x2f,
    0x00,
  ]);
  const header = Buffer.alloc(8);
  header.write("MTrk", 0, "ascii");
  header.writeUInt32BE(events.length, 4);
  return Buffer.concat([header, events]);
}

function makeMidi() {
  const header = Buffer.alloc(14);
  header.write("MThd", 0, "ascii");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(2, 10);
  header.writeUInt16BE(24, 12);
  return Buffer.concat([header, makeTrack(0, 60), makeTrack(1, 64)]);
}

test("MIDI import keeps equal channel numbers on different ports separate", async (context) => {
  const globalNames = [
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "document",
    "window",
  ];
  const originalGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  context.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor == undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  });

  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.SVGElement = FakeElement;
  globalThis.document = {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    createTextNode: (text) => ({ textContent: String(text) }),
    documentElement: new FakeElement(),
    head: new FakeElement(),
    querySelector: () => null,
  };
  globalThis.window = { alert() {} };

  const { module, cleanup } = await loadModules();
  context.after(cleanup);
  const song = new module.Song();
  const doc = {
    song,
    bar: 0,
    channel: 0,
    selection: { scrollToSelectedPattern() {} },
    notifier: { changed() {} },
    goBackToStart() {},
    record() {},
    renderNow() {},
  };
  const importer = new module.ImportFile(doc);
  const bytes = makeMidi();

  importer._parseMidiFile(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

  assert.equal(song.pitchChannelCount, 2);
  assert.equal(song.noiseChannelCount, 0);
  assert.deepEqual(
    song.channels.map((channel) => channel.patterns[0].notes[0].pitches[0]),
    [48, 52],
  );
  importer.cleanUp();
});
