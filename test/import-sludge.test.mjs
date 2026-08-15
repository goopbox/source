import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class FakeNode {}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.files = [];
    this.value = "";
    this.style = { setProperty() {} };
    this._listeners = new Map();
    this.clickCalls = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

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

  dispatch(name) {
    for (const listener of this._listeners.get(name) ?? [])
      listener({ type: name, target: this });
  }

  click() {
    this.clickCalls++;
  }
}

class FakeFileReader {
  static reads = [];

  constructor() {
    this.error = null;
    this.result = null;
    this._listeners = new Map();
  }

  addEventListener(name, listener) {
    const listeners = this._listeners.get(name) ?? [];
    listeners.push(listener);
    this._listeners.set(name, listeners);
  }

  readAsArrayBuffer(file) {
    const bytes = file.bytes;
    this.result = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    FakeFileReader.reads.push({ file, result: this.result });
    for (const listener of this._listeners.get("load") ?? [])
      listener({ type: "load", target: this });
  }
}

async function loadImportFile() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-import-goop-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {ImportFile} from "./src/Import.ts";',
        'export {Song} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "import-goop-entry.ts",
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

function makeDocument(Song) {
  const calls = {
    goBackToStart: 0,
    record: [],
    renderNow: 0,
    selection: 0,
    changed: 0,
  };
  const doc = {
    song: new Song(),
    bar: 0,
    channel: 0,
    selection: {
      scrollToSelectedPattern() {
        calls.selection++;
      },
    },
    notifier: {
      changed() {
        calls.changed++;
      },
    },
    goBackToStart() {
      calls.goBackToStart++;
    },
    record(...args) {
      calls.record.push(args);
    },
    renderNow() {
      calls.renderNow++;
    },
  };
  return { calls, doc };
}

function attachInputFile(createdElements, ImportFile, doc, file) {
  const previousCount = createdElements.length;
  const importer = new ImportFile(doc);
  const input = createdElements
    .slice(previousCount)
    .find((element) => element.tagName == "INPUT");
  assert.notEqual(input, undefined);
  input.files = [file];
  return { importer, input };
}

test("ImportFile handles binary .goop songs atomically", async (context) => {
  const globalNames = [
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "document",
    "window",
    "FileReader",
  ];
  const originalGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const errorDescriptor = Object.getOwnPropertyDescriptor(console, "error");
  context.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor == undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
    if (errorDescriptor == undefined) delete console.error;
    else Object.defineProperty(console, "error", errorDescriptor);
  });

  const createdElements = [];
  const alerts = [];
  const errors = [];
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.SVGElement = FakeElement;
  globalThis.document = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      createdElements.push(element);
      return element;
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
    documentElement: new FakeElement("html"),
    head: new FakeElement("head"),
    querySelector() {
      return null;
    },
  };
  globalThis.window = { alert: (message) => alerts.push(String(message)) };
  globalThis.FileReader = FakeFileReader;
  Object.defineProperty(console, "error", {
    configurable: true,
    writable: true,
    value: (...args) => errors.push(args),
  });

  const api = await loadImportFile();
  context.after(api.cleanup);
  const { ImportFile, Song } = api;

  await context.test("the picker advertises .goop but not .json", () => {
    const { doc } = makeDocument(Song);
    const { importer, input } = attachInputFile(
      createdElements,
      ImportFile,
      doc,
      { name: "unused", bytes: new Uint8Array() },
    );
    const acceptedTypes = input.getAttribute("accept").split(",");
    assert.ok(acceptedTypes.includes(".goop"));
    assert.equal(acceptedTypes.includes(".json"), false);
    assert.equal(acceptedTypes.includes("application/json"), false);
    importer.cleanUp();
  });

  for (const fileName of ["song.goop", "song.GOOP"]) {
    await context.test(`${fileName} is read as binary and applied`, () => {
      FakeFileReader.reads.length = 0;
      const { calls, doc } = makeDocument(Song);
      const replacement = new Song();
      replacement.tempo = fileName.endsWith(".goop") ? 211 : 217;
      const bytes = replacement.toBinary();
      let receivedSongData = null;
      const fromBinary = doc.song.fromBinary.bind(doc.song);
      doc.song.fromBinary = (songData) => {
        receivedSongData = songData;
        fromBinary(songData);
      };
      const file = { name: fileName, bytes };
      const { importer, input } = attachInputFile(
        createdElements,
        ImportFile,
        doc,
        file,
      );
      input.value = fileName;

      input.dispatch("change");

      assert.equal(input.value, "", "the same file can be selected again");
      assert.equal(FakeFileReader.reads.length, 1);
      assert.strictEqual(FakeFileReader.reads[0].file, file);
      assert.ok(FakeFileReader.reads[0].result instanceof ArrayBuffer);
      assert.ok(receivedSongData instanceof Uint8Array);
      assert.deepEqual(receivedSongData, bytes);
      assert.equal(doc.song.tempo, replacement.tempo);
      assert.equal(calls.goBackToStart, 1);
      assert.equal(calls.record.length, 1);
      assert.equal(calls.record[0][1], false);
      assert.equal(calls.record[0][2], true);
      assert.equal(calls.renderNow, 1);
      assert.deepEqual(alerts, []);
      importer.cleanUp();
    });
  }

  await context.test(
    "corrupt .goop data alerts without changing the current song",
    () => {
      FakeFileReader.reads.length = 0;
      alerts.length = 0;
      errors.length = 0;
      const { calls, doc } = makeDocument(Song);
      doc.song.tempo = 193;
      const before = doc.song.toBinary();
      const corrupt = before.slice();
      corrupt[corrupt.length - 1] ^= 1;
      const { importer, input } = attachInputFile(
        createdElements,
        ImportFile,
        doc,
        { name: "corrupt.goop", bytes: corrupt },
      );
      input.value = "corrupt.goop";

      input.dispatch("change");

      assert.equal(input.value, "", "a failed file can be retried");
      assert.equal(FakeFileReader.reads.length, 1);
      assert.deepEqual(doc.song.toBinary(), before);
      assert.equal(calls.goBackToStart, 0);
      assert.equal(calls.record.length, 0);
      assert.equal(calls.renderNow, 0);
      assert.deepEqual(alerts, ["Invalid or unsupported .goop file."]);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], "Could not import goopbox song.");
      importer.cleanUp();
    },
  );

  await context.test(".json files are unsupported", () => {
    FakeFileReader.reads.length = 0;
    alerts.length = 0;
    errors.length = 0;
    const { calls, doc } = makeDocument(Song);
    doc.song.tempo = 181;
    const before = doc.song.toBinary();
    const json = new TextEncoder().encode('{"format":"goopbox-1"}');
    const { importer, input } = attachInputFile(
      createdElements,
      ImportFile,
      doc,
      { name: "legacy.json", bytes: json },
    );
    input.value = "legacy.json";

    input.dispatch("change");

    assert.equal(FakeFileReader.reads.length, 0);
    assert.deepEqual(doc.song.toBinary(), before);
    assert.equal(calls.goBackToStart, 0);
    assert.equal(calls.record.length, 0);
    assert.equal(calls.renderNow, 0);
    assert.deepEqual(alerts, []);
    assert.equal(input.value, "");
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "Unrecognized file extension.");
    importer.cleanUp();
  });
});
