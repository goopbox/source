import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const historyStorageKey = "goopboxUndoHistoryV3";

class FakeNode {
  constructor() {
    this.dataset = {};
    this.style = {};
    this.textContent = "";
  }
  setAttribute() {}
  appendChild(child) {
    return child;
  }
}

class MemoryStorage {
  _items = new Map();
  maxHistoryEntries = Infinity;
  failReads = false;
  failWrites = false;
  failRemoves = false;

  get length() {
    return this._items.size;
  }
  getItem(key) {
    if (this.failReads)
      throw new DOMException("Storage is unavailable.", "SecurityError");
    return this._items.get(key) ?? null;
  }
  setItem(key, value) {
    value = String(value);
    if (this.failWrites)
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError",
      );
    if (key == historyStorageKey) {
      const manifest = JSON.parse(value);
      if (manifest.entries.length > this.maxHistoryEntries) {
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError",
        );
      }
    }
    this._items.set(key, value);
  }
  removeItem(key) {
    if (this.failRemoves)
      throw new DOMException("Storage is unavailable.", "SecurityError");
    this._items.delete(key);
  }
  key(index) {
    return [...this._items.keys()][index] ?? null;
  }
}

class FakeLocation {
  constructor(href) {
    this._url = new URL(href);
  }
  get href() {
    return this._url.href;
  }
  set href(value) {
    this._url = new URL(value, this._url);
  }
  get hash() {
    return this._url.hash;
  }
}

class NativeHistory {
  constructor(browser, href) {
    this._browser = browser;
    this._entry = { state: null, href };
    this.backCalls = 0;
    this.forwardCalls = 0;
    this.failNextReplace = false;
  }
  get state() {
    return this._entry.state;
  }
  get length() {
    return 1;
  }
  replaceState(state, _unused, url) {
    if (this.failNextReplace) {
      this.failNextReplace = false;
      throw new DOMException(
        "The history entry could not be updated.",
        "QuotaExceededError",
      );
    }
    const href =
      url == undefined
        ? this._browser.location.href
        : new URL(String(url), this._browser.location.href).href;
    this._entry = { state: structuredClone(state), href };
    this._browser.location.href = href;
  }
  back() {
    this.backCalls++;
  }
  forward() {
    this.forwardCalls++;
  }
}

class FakeBrowser {
  constructor(href = "http://localhost:8080/") {
    this.location = new FakeLocation(href);
    this.localStorage = new MemoryStorage();
    this.sessionStorage = new MemoryStorage();
    this.history = new NativeHistory(this, href);
    this.alerts = [];
    this.confirmations = [];
    this.confirmResponse = false;
    this.reload();
  }
  reload() {
    this._listeners = new Map();
    this._animationFrames = [];
    this.window = {
      location: this.location,
      history: this.history,
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      addEventListener: (name, listener) => {
        const listeners = this._listeners.get(name) ?? [];
        listeners.push(listener);
        this._listeners.set(name, listeners);
      },
      requestAnimationFrame: (callback) => {
        this._animationFrames.push(callback);
        return this._animationFrames.length;
      },
      alert: (message) => this.alerts.push(String(message)),
      confirm: (message) => {
        this.confirmations.push(String(message));
        return this.confirmResponse;
      },
    };
    globalThis.window = this.window;
    globalThis.location = this.location;
    globalThis.localStorage = this.localStorage;
    globalThis.sessionStorage = this.sessionStorage;
    globalThis.requestAnimationFrame = this.window.requestAnimationFrame;
  }
  dispatch(name) {
    for (const listener of this._listeners.get(name) ?? [])
      listener({ type: name });
  }
  flushAnimationFrame() {
    const callbacks = this._animationFrames.splice(0);
    for (const callback of callbacks) callback(0);
  }
}

async function loadSongHistory() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-song-history-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {SongDocument} from "./src/SongDocument.ts";',
        'export {encodeSongUrl, decodeSongUrl, decodeSongUrlHash} from "./src/SongUrl.ts";',
        'export {encodeSongBinary, decodeSongBinary, extractCompressedSongBody} from "./synth/SongBinary.ts";',
        'export {Note, Pattern, Song} from "./synth/synth.ts";',
        'export {Config} from "./synth/SynthConfig.ts";',
        'export {ChangeAddChannelInstrument, ChangeBarCount, ChangeChannelBar, ChangeChorus, ChangeEnsurePatternExists, ChangeKey, ChangeLoop, ChangeNoteAdded, ChangeOctave, ChangePan, ChangeSong, ChangeTempo, ChangeToggleEffects, ChangeTrackSelection, ChangeVolume} from "./src/changes.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "song-history-entry.ts",
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

function makeLargeSong(Song, Pattern, Note, Config) {
  const song = new Song();
  const patternCount = 48;
  const noteCount = 96;
  song.patternsPerChannel = patternCount;
  song.barCount = patternCount;
  song.loopStart = 0;
  song.loopLength = patternCount;
  for (
    let channelIndex = 0;
    channelIndex < song.channels.length;
    channelIndex++
  ) {
    const channel = song.channels[channelIndex];
    channel.patterns.length = 0;
    channel.bars.length = patternCount;
    for (let patternIndex = 0; patternIndex < patternCount; patternIndex++) {
      const pattern = new Pattern();
      for (let noteIndex = 0; noteIndex < noteCount; noteIndex++) {
        const noise = channelIndex >= song.pitchChannelCount;
        const pitch = noise
          ? (patternIndex * 7 + noteIndex * 5) % 12
          : (patternIndex * 17 + noteIndex * 11 + channelIndex * 13) % 72;
        const size =
          1 + ((patternIndex * 19 + noteIndex * 23 + channelIndex * 29) % 10);
        const note = new Note(pitch, noteIndex, noteIndex + 1, size);
        const maximumPitch = noise ? Config.drumCount - 1 : Config.maxPitch;
        note.pins[1].interval = Math.max(
          -pitch,
          Math.min(
            maximumPitch - pitch,
            ((patternIndex + noteIndex * 3) % 5) - 2,
          ),
        );
        note.pins[1].size = 1 + ((patternIndex * 31 + noteIndex * 37) % 10);
        pattern.notes.push(note);
      }
      channel.patterns.push(pattern);
      channel.bars[patternIndex] = patternIndex + 1;
    }
  }
  return song;
}

function storedHistory(browser) {
  const serialized = browser.sessionStorage.getItem(historyStorageKey);
  assert.notEqual(serialized, null, "undo history should be persisted");
  return JSON.parse(serialized);
}

function recordChange(browser, doc, change) {
  assert.equal(
    change.isNoop(),
    false,
    "history integration changes must produce an undo boundary",
  );
  doc.record(change, false, true);
  browser.flushAnimationFrame();
}

function recordTempo(browser, doc, ChangeTempo, tempo, flush = true) {
  const change = new ChangeTempo(doc, doc.song.tempo, tempo);
  doc.record(change, false, true);
  if (flush) browser.flushAnimationFrame();
}

function snapshotDocument(doc) {
  return {
    song: doc.song.toBinary(),
    bar: doc.bar,
    channel: doc.channel,
    viewedInstrument: [...doc.viewedInstrument],
    selection: doc.selection.toJSON(),
  };
}

function historyTempos(history, Song, decodeSongUrlHash) {
  return history.entries.map((entry) => {
    const songData = decodeSongUrlHash(entry.snapshot);
    assert.notEqual(songData, null);
    return new Song(songData).tempo;
  });
}

test("undo history is durable, contiguous, exact, and crash resistant", async (context) => {
  const globalNames = [
    "window",
    "location",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "navigator",
    "fetch",
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
  globalThis.Element = FakeNode;
  globalThis.HTMLElement = FakeNode;
  globalThis.SVGElement = FakeNode;
  globalThis.document = {
    createElement: () => new FakeNode(),
    createElementNS: () => new FakeNode(),
    documentElement: new FakeNode(),
    head: new FakeNode(),
    querySelector: () => null,
  };
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "fetch", {
    value: () => new Promise(() => {}),
    configurable: true,
    writable: true,
  });

  const api = await loadSongHistory();
  context.after(api.cleanup);
  const {
    ChangeAddChannelInstrument,
    ChangeBarCount,
    ChangeChannelBar,
    ChangeChorus,
    ChangeEnsurePatternExists,
    ChangeKey,
    ChangeLoop,
    ChangeNoteAdded,
    ChangeOctave,
    ChangePan,
    ChangeSong,
    ChangeTempo,
    ChangeToggleEffects,
    ChangeTrackSelection,
    ChangeVolume,
    Config,
    Note,
    Pattern,
    Song,
    SongDocument,
    decodeSongBinary,
    decodeSongUrl,
    decodeSongUrlHash,
    encodeSongBinary,
    encodeSongUrl,
    extractCompressedSongBody,
  } = api;

  await context.test(
    "large histories survive undo, redo, reload, and branching",
    () => {
      const largeSong = makeLargeSong(Song, Pattern, Note, Config);
      const serializedSong = largeSong.toBinary();
      const sharedHash = encodeSongUrl(serializedSong);
      assert.ok(
        serializedSong.length > 8_000,
        "fixture must exercise a large compressed song",
      );
      assert.ok(
        sharedHash.length > 10_000,
        "fixture must exercise an unusually large shared URL",
      );
      assert.match(
        sharedHash,
        /^#[A-Za-z0-9_-]+$/,
        "song URLs must be the unpadded URL-safe Base64 compressed body only",
      );
      const payload = sharedHash.match(/^#([A-Za-z0-9_-]+)$/)?.[1];
      assert.notEqual(payload, undefined);
      assert.deepEqual(
        new Uint8Array(Buffer.from(payload, "base64url")),
        extractCompressedSongBody(serializedSong),
        "song URLs must reuse the file's already-compressed body",
      );
      assert.deepEqual(decodeSongUrlHash(sharedHash), serializedSong);

      const browser = new FakeBrowser(`http://localhost:8080/${sharedHash}`);
      const doc = new SongDocument();
      assert.equal(
        browser.location.hash,
        sharedHash,
        "opening a shared song must preserve its original URL",
      );
      assert.equal(
        browser.history.length,
        1,
        "undo entries should not consume native browser history",
      );
      assert.equal(browser.history.state.goopboxUndoVersion, 3);

      recordTempo(browser, doc, ChangeTempo, 151);
      recordTempo(browser, doc, ChangeTempo, 152);
      assert.deepEqual(
        historyTempos(storedHistory(browser), Song, decodeSongUrlHash),
        [150, 151, 152],
      );
      assert.equal(browser.history.length, 1);

      doc.undo();
      assert.equal(doc.song.tempo, 151);
      doc.undo();
      assert.equal(doc.song.tempo, 150);
      doc.redo();
      assert.equal(doc.song.tempo, 151);
      doc.redo();
      assert.equal(doc.song.tempo, 152);
      assert.equal(browser.history.backCalls, 0);
      assert.equal(browser.history.forwardCalls, 0);

      doc.undo();
      browser.reload();
      const reloadedDoc = new SongDocument();
      assert.equal(
        reloadedDoc.song.tempo,
        151,
        "reload should restore the current undo entry",
      );
      assert.equal(
        reloadedDoc.hasRedoHistory(),
        true,
        "redo position should survive reload",
      );
      reloadedDoc.redo();
      assert.equal(reloadedDoc.song.tempo, 152);

      reloadedDoc.undo();
      recordTempo(browser, reloadedDoc, ChangeTempo, 153);
      assert.equal(reloadedDoc.hasRedoHistory(), false);
      reloadedDoc.redo();
      assert.equal(
        reloadedDoc.song.tempo,
        153,
        "redo must not resurrect the discarded branch",
      );
      assert.deepEqual(
        historyTempos(storedHistory(browser), Song, decodeSongUrlHash),
        [150, 151, 153],
      );
      assert.deepEqual(browser.confirmations, []);

      const standardBase64Hash = sharedHash
        .replaceAll("-", "+")
        .replaceAll("_", "/");
      assert.notEqual(standardBase64Hash, sharedHash);
      browser.location.href = `http://localhost:8080/${standardBase64Hash}`;
      assert.equal(
        decodeSongUrl(),
        null,
        "standard Base64 song URLs must not be accepted",
      );
    },
  );

  await context.test(
    "legacy JSON URLs and undo manifests are not migrated",
    () => {
      const legacySong = new Song();
      legacySong.tempo = 199;
      const legacyBrowser = new FakeBrowser("http://localhost:8080/#j1.e30");
      legacyBrowser.sessionStorage.setItem(
        "goopboxUndoHistoryV2",
        JSON.stringify({
          goopboxUndoVersion: 2,
          id: "legacy-tab",
          currentIndex: 0,
          entries: [{ snapshot: encodeSongUrl(legacySong.toBinary()) }],
        }),
      );
      legacyBrowser.history._entry.state = {
        goopboxUndoVersion: 1,
        canUndo: false,
        sequenceNumber: 0,
        newestSequenceNumber: 0,
        song: legacySong.toBinary(),
      };
      assert.equal(decodeSongUrlHash("#j1.e30"), null);
      const doc = new SongDocument();
      assert.equal(
        doc.song.tempo,
        150,
        "legacy URL and native-history song data must be ignored",
      );
      assert.match(legacyBrowser.location.hash, /^#[A-Za-z0-9_-]+$/);
      assert.equal(legacyBrowser.history.state.goopboxUndoVersion, 3);
      assert.equal(storedHistory(legacyBrowser).goopboxUndoVersion, 3);
      assert.deepEqual(legacyBrowser.confirmations, []);
    },
  );

  await context.test(
    "real changes from every editor category round-trip without corruption",
    () => {
      const browser = new FakeBrowser();
      const doc = new SongDocument();
      const states = [snapshotDocument(doc)];
      const apply = (change) => {
        recordChange(browser, doc, change);
        states.push(snapshotDocument(doc));
      };

      apply(new ChangeTempo(doc, doc.song.tempo, 173));
      apply(new ChangeKey(doc, (doc.song.key + 5) % 12));
      apply(new ChangeBarCount(doc, doc.song.barCount + 2, false));
      apply(new ChangeLoop(doc, doc.song.loopStart, doc.song.loopLength, 1, 4));
      apply(
        new ChangeOctave(
          doc,
          doc.song.channels[0].octave,
          doc.song.channels[0].octave + 1,
        ),
      );
      const instrument = doc.song.channels[0].instruments[0];
      apply(new ChangeVolume(doc, instrument.volume, instrument.volume + 1));
      apply(new ChangePan(doc, instrument.pan, instrument.pan + 1));
      apply(new ChangeToggleEffects(doc, 1));
      apply(
        new ChangeChorus(doc, instrument.chorus, (instrument.chorus + 1) % 4),
      );

      const emptyBar = doc.song.barCount - 1;
      apply(new ChangeEnsurePatternExists(doc, 0, emptyBar));
      const pattern = doc.song.getPattern(0, emptyBar);
      assert.notEqual(pattern, null);
      apply(new ChangeNoteAdded(doc, pattern, new Note(24, 0, 12, 5), 0));
      apply(new ChangeAddChannelInstrument(doc));
      apply(new ChangeTrackSelection(doc, 0, 2, 0, 1));
      apply(new ChangeChannelBar(doc, 1, 1));
      const importedSong = new Song(doc.song.toBinary());
      importedSong.tempo = 199;
      apply(new ChangeSong(doc, importedSong.toBinary()));
      assert.equal(storedHistory(browser).entries.length, states.length);
      assert.equal(storedHistory(browser).currentIndex, states.length - 1);

      for (let index = states.length - 2; index >= 0; index--) {
        doc.undo();
        assert.deepEqual(
          snapshotDocument(doc),
          states[index],
          `undo should exactly restore state ${index}`,
        );
      }
      doc.undo();
      assert.deepEqual(
        snapshotDocument(doc),
        states[0],
        "undo at the oldest boundary should be a no-op",
      );
      for (let index = 1; index < states.length; index++) {
        doc.redo();
        assert.deepEqual(
          snapshotDocument(doc),
          states[index],
          `redo should exactly restore state ${index}`,
        );
      }
      doc.redo();
      assert.deepEqual(
        snapshotDocument(doc),
        states.at(-1),
        "redo at the newest boundary should be a no-op",
      );
    },
  );

  await context.test(
    "undo preserves mute state and disabled effect settings",
    () => {
      const browser = new FakeBrowser();
      const doc = new SongDocument();
      const channel = doc.song.channels[0];
      const instrument = channel.instruments[0];
      channel.muted = true;
      instrument.chorus = 1;
      instrument.reverb = 6;
      instrument.noteFilter.addPoint(0, 12, 8);
      recordTempo(browser, doc, ChangeTempo, 151);
      const exactSettings = instrument.toBinaryState();
      recordTempo(browser, doc, ChangeTempo, 152);

      doc.undo();
      assert.equal(doc.song.tempo, 151);
      assert.equal(doc.song.channels[0].muted, true);
      assert.deepEqual(
        doc.song.channels[0].instruments[0].toBinaryState(),
        exactSettings,
      );
      doc.redo();
      assert.equal(doc.song.channels[0].muted, true);
      assert.deepEqual(
        doc.song.channels[0].instruments[0].toBinaryState(),
        exactSettings,
      );
    },
  );

  await context.test(
    "quota trimming keeps a contiguous suffix of the newest progress",
    () => {
      const fourEntryBrowser = new FakeBrowser();
      const fourEntryDoc = new SongDocument();
      recordTempo(fourEntryBrowser, fourEntryDoc, ChangeTempo, 151);
      recordTempo(fourEntryBrowser, fourEntryDoc, ChangeTempo, 152);
      recordTempo(fourEntryBrowser, fourEntryDoc, ChangeTempo, 153);
      fourEntryBrowser.sessionStorage.maxHistoryEntries = 4;
      recordTempo(fourEntryBrowser, fourEntryDoc, ChangeTempo, 154);
      assert.equal(
        fourEntryBrowser.confirmations.length,
        0,
        "retaining four history entries should not prompt",
      );

      const browser = new FakeBrowser();
      const doc = new SongDocument();
      recordTempo(browser, doc, ChangeTempo, 151);
      recordTempo(browser, doc, ChangeTempo, 152);
      browser.sessionStorage.maxHistoryEntries = 3;
      recordTempo(browser, doc, ChangeTempo, 153);

      const history = storedHistory(browser);
      assert.deepEqual(
        historyTempos(history, Song, decodeSongUrlHash),
        [151, 152, 153],
        "oldest history should be trimmed before any recent transition",
      );
      assert.equal(history.currentIndex, 2);
      assert.equal(browser.confirmations.length, 1);
      assert.match(browser.confirmations[0], /discarded/i);
      assert.match(browser.confirmations[0], /\.goop/i);

      doc.undo();
      assert.equal(doc.song.tempo, 152);
      doc.undo();
      assert.equal(doc.song.tempo, 151);
      doc.undo();
      assert.equal(
        doc.song.tempo,
        151,
        "history before the retained suffix should be unavailable",
      );
      doc.redo();
      assert.equal(doc.song.tempo, 152);

      const middleBrowser = new FakeBrowser();
      const middleDoc = new SongDocument();
      recordTempo(middleBrowser, middleDoc, ChangeTempo, 151);
      recordTempo(middleBrowser, middleDoc, ChangeTempo, 152);
      middleDoc.undo();
      middleDoc.undo();
      middleBrowser.sessionStorage.maxHistoryEntries = 2;
      middleBrowser.reload();
      const middleReloadedDoc = new SongDocument();
      assert.equal(middleReloadedDoc.song.tempo, 150);
      assert.deepEqual(
        historyTempos(storedHistory(middleBrowser), Song, decodeSongUrlHash),
        [150, 151],
        "quota trimming should persist the largest redo prefix reachable from the current entry",
      );
      assert.equal(
        middleReloadedDoc.hasRedoHistory(),
        true,
        "quota fallback should retain redo history in the live tab",
      );
      middleReloadedDoc.redo();
      assert.equal(middleReloadedDoc.song.tempo, 151);
      middleReloadedDoc.redo();
      assert.equal(
        middleReloadedDoc.song.tempo,
        152,
        "redo trimmed only for persistence should remain available in the live tab",
      );
    },
  );

  await context.test(
    "unavoidable loss offers a forced .goop export without losing the live song",
    () => {
      const browser = new FakeBrowser();
      const doc = new SongDocument();
      recordTempo(browser, doc, ChangeTempo, 151);
      browser.sessionStorage.failWrites = true;
      browser.confirmResponse = true;
      assert.doesNotThrow(() => recordTempo(browser, doc, ChangeTempo, 152));

      assert.equal(doc.song.tempo, 152);
      assert.equal(doc.prompt, "exportGoop");
      doc.closePrompt();
      doc.undo();
      assert.equal(
        doc.song.tempo,
        151,
        "failed durable storage must not discard live-tab undo entries",
      );
      doc.undo();
      assert.equal(doc.song.tempo, 150);
      doc.redo();
      doc.redo();
      assert.equal(browser.confirmations.length, 1);
      assert.match(
        browser.confirmations[0],
        /storage is full|storage is.*unavailable/i,
      );
      assert.match(browser.confirmations[0], /export a \.goop backup/i);
      assert.equal(browser.sessionStorage.getItem(historyStorageKey), null);
      const currentData = decodeSongUrlHash(browser.location.hash);
      assert.notEqual(currentData, null);
      const currentSong = new Song(currentData);
      assert.equal(
        currentSong.tempo,
        152,
        "the public URL should retain the latest progress",
      );
    },
  );

  await context.test(
    "pending history, corrupt snapshots, invalid metadata, and browser failures do not crash",
    () => {
      const pendingBrowser = new FakeBrowser();
      const pendingDoc = new SongDocument();
      recordTempo(pendingBrowser, pendingDoc, ChangeTempo, 151, false);
      pendingDoc.undo();
      assert.equal(
        pendingDoc.song.tempo,
        150,
        "undo should flush the pending boundary first",
      );
      pendingBrowser.flushAnimationFrame();
      pendingDoc.redo();
      assert.equal(
        pendingDoc.song.tempo,
        151,
        "the stale animation frame must not create a phantom entry",
      );

      const metadataBrowser = new FakeBrowser();
      const metadataDoc = new SongDocument();
      recordTempo(metadataBrowser, metadataDoc, ChangeTempo, 152);
      const metadataHistory = storedHistory(metadataBrowser);
      metadataHistory.entries[metadataHistory.currentIndex].bar = 999999;
      metadataHistory.entries[metadataHistory.currentIndex].channel = 999999;
      metadataHistory.entries[metadataHistory.currentIndex].viewedInstruments =
        [999999];
      metadataBrowser.sessionStorage.setItem(
        historyStorageKey,
        JSON.stringify(metadataHistory),
      );
      metadataBrowser.reload();
      const clampedDoc = new SongDocument();
      assert.equal(clampedDoc.song.tempo, 152);
      assert.equal(clampedDoc.bar, clampedDoc.song.barCount - 1);
      assert.equal(clampedDoc.channel, clampedDoc.song.getChannelCount() - 1);
      assert.ok(
        clampedDoc.viewedInstrument.every(
          (value, channel) =>
            value >= 0 &&
            value < clampedDoc.song.channels[channel].instruments.length,
        ),
      );

      const beforeCorruption = snapshotDocument(clampedDoc);
      const invalidHash = encodeSongUrl(encodeSongBinary({ channels: [] }));
      metadataBrowser.location.href = `http://localhost:8080/${invalidHash}`;
      assert.doesNotThrow(() => metadataBrowser.dispatch("hashchange"));
      assert.deepEqual(
        snapshotDocument(clampedDoc),
        beforeCorruption,
        "a failed external load must be atomic",
      );
      assert.equal(metadataBrowser.alerts.length, 1);

      const corruptHistory = storedHistory(metadataBrowser);
      corruptHistory.entries[corruptHistory.currentIndex].snapshot =
        "not-a-song-hash";
      metadataBrowser.sessionStorage.setItem(
        historyStorageKey,
        JSON.stringify(corruptHistory),
      );
      metadataBrowser.reload();
      assert.doesNotThrow(() => new SongDocument());
      assert.equal(
        metadataBrowser.confirmations.length,
        0,
        "corrupt persisted history should not imply a low storage capacity",
      );

      const nativeFailureBrowser = new FakeBrowser();
      const nativeFailureDoc = new SongDocument();
      nativeFailureBrowser.history._entry.state = null;
      nativeFailureBrowser.location.href = "http://localhost:8080/#not-a-song";
      nativeFailureBrowser.history.failNextReplace = true;
      assert.doesNotThrow(() =>
        recordTempo(nativeFailureBrowser, nativeFailureDoc, ChangeTempo, 151),
      );
      assert.equal(nativeFailureDoc.song.tempo, 151);
      assert.equal(
        nativeFailureBrowser.confirmations.length,
        0,
        "native history failure should not imply a low storage capacity",
      );
      nativeFailureBrowser.reload();
      assert.equal(
        new SongDocument().song.tempo,
        151,
        "a state-only history fallback must prevent reload rollback when a URL replacement fails",
      );

      const detachedHashBrowser = new FakeBrowser();
      const detachedHashDoc = new SongDocument();
      recordTempo(detachedHashBrowser, detachedHashDoc, ChangeTempo, 151);
      const liveSongHash = detachedHashBrowser.location.hash;
      detachedHashBrowser.location.href = "http://localhost:8080/#not-a-song";
      detachedHashBrowser.dispatch("hashchange");
      assert.equal(
        detachedHashBrowser.location.hash,
        liveSongHash,
        "an unrecognized hash must not detach the URL from the live song",
      );
      detachedHashBrowser.location.href = "http://localhost:8080/";
      detachedHashBrowser.dispatch("popstate");
      assert.equal(
        detachedHashBrowser.location.hash,
        liveSongHash,
        "a blank traversal must restore the live song URL",
      );
      detachedHashBrowser.reload();
      assert.equal(
        new SongDocument().song.tempo,
        151,
        "a malformed or blank hash must not roll progress back on reload",
      );

      const constructorFailureBrowser = new FakeBrowser();
      const constructorFailureDoc = new SongDocument();
      recordTempo(
        constructorFailureBrowser,
        constructorFailureDoc,
        ChangeTempo,
        151,
      );
      const staleConstructorHistoryId = storedHistory(
        constructorFailureBrowser,
      ).id;
      constructorFailureBrowser.sessionStorage.failWrites = true;
      constructorFailureBrowser.sessionStorage.failRemoves = true;
      constructorFailureBrowser.reload();
      assert.equal(new SongDocument().song.tempo, 151);
      assert.notEqual(
        constructorFailureBrowser.history.state.id,
        staleConstructorHistoryId,
        "first-load persistence failure must rotate the native marker after stale storage",
      );
      constructorFailureBrowser.sessionStorage.failWrites = false;
      constructorFailureBrowser.sessionStorage.failRemoves = false;
      constructorFailureBrowser.reload();
      assert.equal(
        new SongDocument().song.tempo,
        151,
        "constructor persistence failure must leave the current URL authoritative on reload",
      );

      const staleBrowser = new FakeBrowser();
      const staleDoc = new SongDocument();
      recordTempo(staleBrowser, staleDoc, ChangeTempo, 151);
      staleBrowser.sessionStorage.failWrites = true;
      staleBrowser.sessionStorage.failRemoves = true;
      recordTempo(staleBrowser, staleDoc, ChangeTempo, 152);
      staleBrowser.sessionStorage.failWrites = false;
      staleBrowser.reload();
      const staleReloadedDoc = new SongDocument();
      assert.equal(
        staleReloadedDoc.song.tempo,
        152,
        "a stale manifest that could not be removed must not roll back the current URL",
      );

      const foreignBrowser = new FakeBrowser();
      const foreignDoc = new SongDocument();
      foreignDoc.song.channels[0].muted = true;
      recordTempo(foreignBrowser, foreignDoc, ChangeTempo, 151);
      const publicSongData = decodeSongUrlHash(foreignBrowser.location.hash);
      assert.notEqual(publicSongData, null);
      const publicSong = new Song(publicSongData);
      assert.equal(
        publicSong.channels[0].muted,
        false,
        "fixture must keep per-tab mute state outside the public URL",
      );
      assert.equal(
        storedHistory(foreignBrowser).entries.at(-1).mutedChannels[0],
        true,
      );
      foreignBrowser.history._entry.state = {
        goopboxUndoVersion: 3,
        id: "another-tab",
      };
      foreignBrowser.reload();
      const foreignReloadedDoc = new SongDocument();
      assert.equal(
        foreignReloadedDoc.song.channels[0].muted,
        false,
        "a foreign history id must not inject per-tab state into a matching public URL",
      );

      const assetSong = new Song();
      const assetSongObject = assetSong.toBinaryObject();
      assetSongObject.assets = ["https://example.com/current.wav"];
      assetSong.fromBinary(encodeSongBinary(assetSongObject));
      const assetBrowser = new FakeBrowser(
        `http://localhost:8080/${encodeSongUrl(assetSong.toBinary())}`,
      );
      const assetDoc = new SongDocument();
      const assetWaveCount = Config.chipWaves.length;
      assert.ok(assetWaveCount > Config.assetChipWaveStart);
      assetBrowser.location.href = `http://localhost:8080/${encodeSongUrl(encodeSongBinary({ channels: [] }))}`;
      assetBrowser.dispatch("hashchange");
      assert.equal(
        Config.chipWaves.length,
        assetWaveCount,
        "a failed external load must restore the open song's asset waves",
      );
      assert.equal(assetDoc.song.assets.length, 1);

      const inaccessibleBrowser = new FakeBrowser();
      inaccessibleBrowser.sessionStorage.failReads = true;
      assert.doesNotThrow(() => new SongDocument());
      assert.equal(
        inaccessibleBrowser.confirmations.length,
        0,
        "a read failure followed by a successful write should not prompt",
      );
    },
  );
});
