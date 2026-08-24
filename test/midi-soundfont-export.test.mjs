import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class FakeNode {
  constructor() {
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.style = { setProperty() {} };
    this._listeners = new Map();
  }

  setAttribute(name, value) {
    if (name == "value") this.value = String(value);
    if (name == "disabled") this.disabled = true;
  }

  removeAttribute(name) {
    if (name == "disabled") this.disabled = false;
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
      listeners.filter((candidate) => candidate != listener),
    );
  }

  click() {}
  select() {}
  focus() {}
}

async function loadModules() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-midi-soundfont-export-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {ExportPrompt} from "./src/ExportPrompt.ts";',
        'export {getSoundFontMidiProgram} from "./src/Midi.ts";',
        'export {InstrumentType} from "./synth/SynthConfig.ts";',
        'export {Song} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "midi-soundfont-export-entry.ts",
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

function withImmediateTimers(callback) {
  const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "setTimeout",
  );
  const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "clearTimeout",
  );
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: (scheduled) => {
      scheduled();
      return 1;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  try {
    callback();
  } finally {
    Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
    Object.defineProperty(globalThis, "clearTimeout", clearTimeoutDescriptor);
  }
}

function readVariableLength(bytes, state) {
  let value = 0;
  let byte = 0;
  do {
    byte = bytes[state.index++];
    value = (value << 7) | (byte & 0x7f);
  } while ((byte & 0x80) != 0);
  return value;
}

function readMidiPrograms(bytes) {
  const programs = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let chunkStart = 14;
  while (chunkStart < bytes.length) {
    const chunkLength = view.getUint32(chunkStart + 4, false);
    const state = { index: chunkStart + 8 };
    const chunkEnd = state.index + chunkLength;
    while (state.index < chunkEnd) {
      readVariableLength(bytes, state);
      const status = bytes[state.index++];
      if (status == 0xff) {
        state.index++;
        const eventLength = readVariableLength(bytes, state);
        state.index += eventLength;
      } else {
        const eventType = status & 0xf0;
        if (eventType == 0xc0) programs.push(bytes[state.index]);
        state.index += eventType == 0xc0 || eventType == 0xd0 ? 1 : 2;
      }
    }
    chunkStart = chunkEnd;
  }
  return programs;
}

test("SoundFont instruments export to MIDI programs", async (context) => {
  const globalNames = [
    "window",
    "document",
    "URL",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLDialogElement",
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

  let savedBlob = null;
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLDialogElement = FakeElement;
  globalThis.document = {
    createElement: (name) => new FakeElement(name),
    createElementNS: (_namespace, name) => new FakeElement(name),
    createTextNode: (text) =>
      Object.assign(new FakeNode(), { textContent: String(text) }),
    head: new FakeElement("head"),
    querySelector: () => null,
  };
  globalThis.window = {
    localStorage: { getItem: () => null, setItem() {} },
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      savedBlob = blob;
      return "blob:midi-export";
    },
    revokeObjectURL() {},
  };

  const { module, cleanup } = await loadModules();
  context.after(cleanup);

  async function exportSoundFont(presets) {
    savedBlob = null;
    const song = new module.Song();
    song.pitchChannelCount = 1;
    song.noiseChannelCount = 0;
    song.channels.length = 1;
    const instrument = song.channels[0].instruments[0];
    instrument.setTypeAndReset(module.InstrumentType.soundFont, false);
    instrument.soundFontId = "test-soundfont";
    instrument.soundFontPreset = 7;
    withImmediateTimers(() => {
      const prompt = new module.ExportPrompt(
        {
          song,
          synth: { getSoundFontPresets: () => presets },
          closePrompt() {},
        },
        "midi",
      );
      assert.doesNotThrow(() => prompt._export());
    });
    assert.equal(savedBlob.type, "audio/midi");
    return new Uint8Array(await savedBlob.arrayBuffer());
  }

  await context.test("uses the selected SoundFont preset program", async () => {
    const bytes = await exportSoundFont([
      { index: 2, program: 4 },
      { index: 7, program: 42 },
    ]);
    assert.deepEqual(readMidiPrograms(bytes), [42]);
  });

  await context.test("falls back to square lead before presets load", async () => {
    const bytes = await exportSoundFont(null);
    assert.deepEqual(readMidiPrograms(bytes), [80]);
  });

  assert.equal(
    module.getSoundFontMidiProgram([{ index: 7, program: 128 }], 7),
    80,
  );
});
