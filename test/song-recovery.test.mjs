import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class MemoryStorage {
  _items = new Map();
  removedKeys = [];

  get length() {
    return this._items.size;
  }

  getItem(key) {
    return this._items.get(key) ?? null;
  }

  setItem(key, value) {
    this._items.set(key, String(value));
  }

  removeItem(key) {
    this.removedKeys.push(key);
    this._items.delete(key);
  }

  key(index) {
    return [...this._items.keys()][index] ?? null;
  }

  seed(key, value) {
    this._items.set(key, String(value));
  }
}

class RetryQuotaStorage extends MemoryStorage {
  constructor(failuresBeforeSuccess) {
    super();
    this._failuresBeforeSuccess = failuresBeforeSuccess;
  }

  setItem(key, value) {
    if (this._failuresBeforeSuccess > 0) {
      this._failuresBeforeSuccess--;
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError",
      );
    }
    super.setItem(key, value);
  }
}

class FullStorage extends MemoryStorage {
  setItem() {
    throw new DOMException(
      "The quota has been exceeded.",
      "QuotaExceededError",
    );
  }
}

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

  select() {}
  focus() {}
}

async function loadSongRecovery() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-song-recovery-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {SongRecovery, versionToKey} from "./src/SongRecovery.ts";',
        'export {encodeSongUrl, decodeSongUrlHash} from "./src/SongUrl.ts";',
        'export {ExportPrompt} from "./src/ExportPrompt.ts";',
        'export {Song} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "song-recovery-entry.ts",
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
    if (setTimeoutDescriptor == undefined) delete globalThis.setTimeout;
    else Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
    if (clearTimeoutDescriptor == undefined) delete globalThis.clearTimeout;
    else
      Object.defineProperty(globalThis, "clearTimeout", clearTimeoutDescriptor);
  }
}

test("song recovery ignores corrupt metadata and handles storage quota without crashing", async (context) => {
  const globalNames = [
    "localStorage",
    "document",
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
  const warnDescriptor = Object.getOwnPropertyDescriptor(console, "warn");
  context.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor == undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
    if (warnDescriptor == undefined) delete console.warn;
    else Object.defineProperty(console, "warn", warnDescriptor);
  });
  Object.defineProperty(console, "warn", {
    configurable: true,
    writable: true,
    value: () => {},
  });
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

  const {
    decodeSongUrlHash,
    encodeSongUrl,
    ExportPrompt,
    SongRecovery,
    Song,
    versionToKey,
    cleanup,
  } = await loadSongRecovery();
  context.after(cleanup);
  const songData = new Song().toBinary();
  const storedSongData = encodeSongUrl(songData);

  await context.test(
    "malformed and prototype-named recovery keys are safe",
    () => {
      const storage = new MemoryStorage();
      const validVersion = { uid: "valid", time: 20, work: 1000 };
      const prototypeVersion = { uid: "__proto__", time: 10, work: 500 };
      assert.match(versionToKey(validVersion), /^songBinaryVersion: /);
      storage.seed(versionToKey(validVersion), storedSongData);
      storage.seed(versionToKey(prototypeVersion), storedSongData);
      storage.seed("songBinaryVersion: definitely not json", storedSongData);
      storage.seed(
        'songBinaryVersion: {"uid":"missing-numbers"}',
        storedSongData,
      );
      storage.seed(
        'songBinaryVersion: {"uid":"bad-time","time":null,"work":2}',
        storedSongData,
      );
      storage.seed(
        'songVersion: {"uid":"legacy","time":30,"work":1000}',
        storedSongData,
      );
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: storage,
      });

      const songs = SongRecovery.getAllRecoveredSongs();
      assert.deepEqual(
        songs.map((song) => song.versions.map((version) => version.uid)),
        [["valid"], ["__proto__"]],
      );
    },
  );

  await context.test(
    "quota retries discard the oldest versions and preserve the newest",
    () => {
      const storage = new RetryQuotaStorage(2);
      const oldest = { uid: "oldest", time: 10, work: 1000 };
      const middle = { uid: "middle", time: 20, work: 1000 };
      const newest = { uid: "newest", time: 30, work: 1000 };
      storage.seed(versionToKey(newest), storedSongData);
      storage.seed(versionToKey(oldest), storedSongData);
      storage.seed(versionToKey(middle), storedSongData);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: storage,
      });
      let historyLossNotifications = 0;

      withImmediateTimers(() => {
        new SongRecovery(() => historyLossNotifications++).saveVersion(
          "current",
          songData,
        );
      });

      assert.deepEqual(storage.removedKeys, [
        versionToKey(oldest),
        versionToKey(middle),
      ]);
      assert.equal(storage.getItem(versionToKey(newest)), storedSongData);
      assert.equal(
        historyLossNotifications,
        1,
        "quota trimming must report that recovery history was lost",
      );
      const recoveredSongs = SongRecovery.getAllRecoveredSongs();
      const recoveredUids = recoveredSongs.map((song) => song.versions[0].uid);
      assert.ok(recoveredUids.includes("newest"));
      assert.ok(recoveredUids.includes("current"));
      assert.ok(!recoveredUids.includes("oldest"));
      assert.ok(!recoveredUids.includes("middle"));
      const currentVersion = recoveredSongs.find(
        (song) => song.versions[0].uid == "current",
      ).versions[0];
      const currentPayload = storage.getItem(versionToKey(currentVersion));
      assert.match(currentPayload, /^#[A-Za-z0-9_-]+$/);
      assert.deepEqual(decodeSongUrlHash(currentPayload), songData);
    },
  );

  await context.test(
    "an entry that cannot fit invokes the loss callback instead of throwing",
    () => {
      const storage = new FullStorage();
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: storage,
      });
      let historyLossNotifications = 0;

      assert.doesNotThrow(() =>
        withImmediateTimers(() => {
          new SongRecovery(() => historyLossNotifications++).saveVersion(
            "current",
            songData,
          );
        }),
      );
      assert.equal(historyLossNotifications, 1);
      assert.equal(storage.length, 0);
    },
  );

  await context.test(
    "forced goop export works when export preference storage throws",
    async () => {
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
      let savedBlob = null;
      let savedName = null;
      let anchorClicked = false;
      let revokedUrl = null;
      let promptClosed = false;
      try {
        globalThis.Node = FakeNode;
        globalThis.Element = FakeElement;
        globalThis.HTMLElement = FakeElement;
        globalThis.HTMLDialogElement = FakeElement;
        globalThis.document = {
          createElement: (name) => {
            const element = new FakeElement(name);
            if (name == "a") {
              element.click = () => {
                anchorClicked = true;
                savedName = element.download;
              };
            }
            return element;
          },
          createElementNS: (_namespace, name) => new FakeElement(name),
          createTextNode: (text) =>
            Object.assign(new FakeNode(), { textContent: String(text) }),
        };
        Object.defineProperty(globalThis, "URL", {
          configurable: true,
          writable: true,
          value: {
            createObjectURL: (blob) => {
              savedBlob = blob;
              return "blob:goop-export";
            },
            revokeObjectURL: (url) => (revokedUrl = url),
          },
        });
        globalThis.window = {
          localStorage: {
            getItem() {
              throw new DOMException(
                "Storage is unavailable.",
                "SecurityError",
              );
            },
            setItem() {
              throw new DOMException(
                "The quota has been exceeded.",
                "QuotaExceededError",
              );
            },
          },
        };

        const song = new Song();
        song.tempo = 173;
        song.loopStart = 2;
        song.loopLength = 5;
        song.channels[0].bars[0] = 1;
        const expectedSongData = song.toBinary();
        withImmediateTimers(() => {
          const prompt = new ExportPrompt(
            { song, closePrompt: () => (promptClosed = true) },
            "goop",
          );
          assert.equal(prompt._formatSelect.value, "goop");
          assert.equal(prompt._formatSelect.disabled, true);
          assert.equal(prompt._enableIntro.disabled, true);
          assert.equal(prompt._loopDropDown.disabled, true);
          assert.equal(prompt._enableOutro.disabled, true);
          assert.doesNotThrow(() => prompt._export());
        });
        assert.equal(anchorClicked, true);
        assert.equal(savedName, "untitled.goop");
        assert.equal(savedBlob.type, "application/octet-stream");
        assert.equal(revokedUrl, "blob:goop-export");
        assert.equal(promptClosed, true);
        const exportedSongData = new Uint8Array(await savedBlob.arrayBuffer());
        assert.deepEqual(exportedSongData, expectedSongData);
        const exportedSong = new Song(exportedSongData);
        assert.equal(exportedSong.tempo, 173);
        assert.equal(exportedSong.loopStart, 2);
        assert.equal(exportedSong.loopLength, 5);
        assert.equal(exportedSong.channels[0].bars[0], 1);
      } finally {
        for (const [name, descriptor] of originalGlobals) {
          if (descriptor == undefined) delete globalThis[name];
          else Object.defineProperty(globalThis, name, descriptor);
        }
      }
    },
  );
});
