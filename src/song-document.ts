// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type Pattern, Song } from "../synth/synth.js";
import { SongRecovery, errorAlert, generateUid } from "./song-recovery.js";
import { decodeSongUrl, decodeSongUrlHash, encodeSongUrl } from "./song-url.js";
import type { Change } from "./change.js";
import { ChangeNotifier } from "./change-notifier.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { Layout } from "./layout.js";
import { MidiInputHandler } from "./midi-input.js";
import { Preferences } from "./preferences.js";
import { Selection } from "./selection.js";
import { SongPerformance } from "./song-performance.js";
import { SynthController } from "../synth/synth-controller.js";
import { setDefaultInstruments } from "./changes.js";

interface HistorySelection {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  start: number;
  end: number;
}

interface HistoryEntry {
  snapshot: string;
  bar: number;
  channel: number;
  viewedInstruments: number[];
  mutedChannels: boolean[];
  recoveryUid: string;
  selection: HistorySelection;
}

interface StoredHistory {
  goopboxUndoVersion: 3;
  id: string;
  currentIndex: number;
  entries: HistoryEntry[];
}

export class SongDocument {
  public song!: Song;
  public synth: SynthController;
  public performance: SongPerformance;
  public midiInputHandler: MidiInputHandler;
  public readonly notifier: ChangeNotifier = new ChangeNotifier(() => this.#validateDocState());
  public readonly selection: Selection = new Selection(this);
  public readonly prefs: Preferences = new Preferences();
  public channel = 0;
  public bar = 0;
  public readonly viewedInstrument: number[] = [];

  public trackVisibleBars = 16;
  public trackVisibleChannels = 4;
  public barScrollPos = 0;
  public channelScrollPos = 0;
  public prompt: string | null = null;

  public addedEffect = false;
  public addedEnvelope = false;
  public currentPatternIsDirty = false;

  static readonly #maximumUndoHistory: number = 100;
  static readonly #storedHistoryKey: string = "goopboxUndoHistoryV3";
  #recovery: SongRecovery;
  #recoveryUid!: string;
  #recentChange: Change | null = null;
  #historyId: string = generateUid();
  #historyEntries: HistoryEntry[] = [];
  #historyIndex = 0;
  #currentUrlHash = "";
  #historyLossWasReported = false;
  #stateShouldBePushed = false;
  #recordedNewSong = false;
  #waitingToUpdateState = false;

  public constructor() {
    ColorConfig.setTheme(this.prefs.colorTheme);
    Layout.setLayout(this.prefs.layout);

    let historyWasCorrupt = false,
      restoredEntry: HistoryEntry | null = null;
    this.song = new Song();
    let loadedSong = false,
      loadedFromUrl = false;
    try {
      const sharedSong: Uint8Array | null = decodeSongUrl();
      if (sharedSong != null) {
        this.song.fromBinary(sharedSong);
        loadedSong = true;
        loadedFromUrl = true;
      }
    } catch (error) {
      errorAlert(error);
      this.song.initToDefault(true);
      loadedSong = false;
    }
    if (!loadedSong) {
      setDefaultInstruments(this.song);
      this.song.scale = this.prefs.rememberScaleChoice ? this.prefs.defaultScale : 0;
    }

    const storedResult: { history: StoredHistory | null; corrupt: boolean } =
      this.#readStoredHistory();
    historyWasCorrupt ||= storedResult.corrupt;
    if (storedResult.history != null) {
      const stored: StoredHistory = storedResult.history;
      try {
        const candidateEntry: HistoryEntry = stored.entries[stored.currentIndex]!,
          candidateSong: Song = this.#parseHistoryEntrySong(candidateEntry),
          nativeHistoryId: string | null = this.#getNativeHistoryId(),
          candidateUrlHash: string = encodeSongUrl(candidateSong.toBinary());
        if (
          nativeHistoryId === stored.id ||
          (nativeHistoryId == null &&
            window.location.hash !== "" &&
            candidateUrlHash === window.location.hash)
        ) {
          this.song = candidateSong;
          this.#historyId = stored.id;
          this.#historyEntries = stored.entries;
          this.#historyIndex = stored.currentIndex;
          restoredEntry = candidateEntry;
        } else {
          // Parsing the candidate configures global asset-backed chip waves.
          // If it belongs to another tab or URL, restore the open song's assets.
          Config.configureAssets(this.song.assets);
        }
      } catch (error) {
        Config.configureAssets(this.song.assets);
        console.warn(error);
        if (this.#getNativeHistoryId() === stored.id) {
          historyWasCorrupt = true;
        }
      }
    }

    this.synth = new SynthController(this.song);
    this.synth.masterVolume = Preferences.masterVolumeToGain(this.prefs.masterVolume);
    this.notifier.watch((): void => this.synth.syncSong());
    this.#recovery = new SongRecovery(this.#handleHistoryLoss);

    if (restoredEntry == null) {
      this.bar = 0;
      this.channel = 0;
      this.#recoveryUid = generateUid();
      for (let i = 0; i < this.song.getChannelCount(); i++) {
        this.viewedInstrument[i] = 0;
      }
      this.selection.resetBoxSelection();
      this.#historyEntries = [this.#captureHistoryEntry()];
      this.#historyIndex = 0;
    } else {
      this.#applyHistoryEntryState(restoredEntry);
    }
    //This.barScrollPos = Math.max(0, this.bar - (this.trackVisibleBars - 6));
    this.selection.scrollToSelectedPattern();
    this.#persistHistory();
    this.#replaceNativeStateAndUrl(loadedFromUrl && restoredEntry == null);
    window.addEventListener("popstate", this.#whenHistoryStateChanged);
    window.addEventListener("hashchange", this.#whenHistoryStateChanged);

    // For all input events, intercept them in the capture phase, before other event handlers
    // Make changes to the model, and enqueue a task to render the view after the changes are
    // Done but before the browser renders. Listening in the capture phase allows this code to
    // Be respond to events even if stopImmediatePropagation is called. mouseenter and
    // Mouseleave are ignored because they are immediately followed by mousemove. Animation
    // Frames and midi events also sometimes update the model, but are not automatically
    // Detected here so they have to manually call "renderNow" instead.
    for (const eventName of [
      "input",
      "change",
      "click",
      "keyup",
      "keydown",
      "mousedown",
      "mousemove",
      "mouseup",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]) {
      window.addEventListener(eventName, this.notifier.enqueueTaskToNotifyWatchers, {
        capture: true,
      });
    }

    this.#validateDocState();
    this.performance = new SongPerformance(this);
    this.midiInputHandler = new MidiInputHandler(this);
    if (historyWasCorrupt) {
      this.#handleHistoryLoss();
    }
  }

  public setMasterVolume(value: number): void {
    this.prefs.masterVolume = Math.max(0, Math.min(Preferences.maxMasterVolume, Math.round(value)));
    this.prefs.save();
    this.synth.masterVolume = Preferences.masterVolumeToGain(this.prefs.masterVolume);
  }

  #getNativeHistoryId(): string | null {
    const state: unknown = window.history.state,
      stateObject = state as Record<string, unknown>;
    return state != null &&
      typeof state === "object" &&
      stateObject["goopboxUndoVersion"] === 3 &&
      typeof stateObject["id"] === "string"
      ? stateObject["id"]
      : null;
  }

  #readStoredHistory(): {
    history: StoredHistory | null;
    corrupt: boolean;
  } {
    let serialized: string | null;
    try {
      serialized = window.sessionStorage.getItem(SongDocument.#storedHistoryKey);
    } catch (error) {
      console.warn(error);
      return { history: null, corrupt: true };
    }
    if (serialized == null) {
      return { history: null, corrupt: false };
    }
    try {
      const candidate: unknown = JSON.parse(serialized),
        candidateObject = candidate as Record<string, unknown>,
        currentIndex: unknown = candidateObject["currentIndex"],
        entries: unknown = candidateObject["entries"];
      if (
        candidate == null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        candidateObject["goopboxUndoVersion"] !== 3 ||
        typeof candidateObject["id"] !== "string" ||
        candidateObject["id"].length === 0 ||
        !Number.isInteger(currentIndex) ||
        !Array.isArray(entries) ||
        entries.length === 0 ||
        entries.length > SongDocument.#maximumUndoHistory ||
        (currentIndex as number) < 0 ||
        (currentIndex as number) >= entries.length
      ) {
        throw new Error("Invalid undo history manifest.");
      }
      for (const entry of entries) {
        if (!this.#isValidHistoryEntry(entry)) {
          throw new Error("Invalid undo history entry.");
        }
      }
      return { history: candidate as StoredHistory, corrupt: false };
    } catch (error) {
      console.warn(error);
      return { history: null, corrupt: true };
    }
  }

  #isValidHistoryEntry(entry: unknown): entry is HistoryEntry {
    const entryObject = entry as Record<string, unknown>,
      finiteInteger = (value: unknown): boolean =>
        typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
    if (
      entry == null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entryObject["snapshot"] !== "string" ||
      !finiteInteger(entryObject["bar"]) ||
      !finiteInteger(entryObject["channel"]) ||
      typeof entryObject["recoveryUid"] !== "string" ||
      entryObject["recoveryUid"].length === 0 ||
      !Array.isArray(entryObject["viewedInstruments"]) ||
      entryObject["viewedInstruments"].length > Config.channelCountMax ||
      !entryObject["viewedInstruments"].every(finiteInteger) ||
      !Array.isArray(entryObject["mutedChannels"]) ||
      entryObject["mutedChannels"].length > Config.channelCountMax ||
      !entryObject["mutedChannels"].every((muted: unknown): boolean => typeof muted === "boolean")
    ) {
      return false;
    }
    const selection: unknown = entryObject["selection"],
      selectionObject = selection as Record<string, unknown>;
    return (
      selection != null &&
      typeof selection === "object" &&
      !Array.isArray(selection) &&
      finiteInteger(selectionObject["x0"]) &&
      finiteInteger(selectionObject["x1"]) &&
      finiteInteger(selectionObject["y0"]) &&
      finiteInteger(selectionObject["y1"]) &&
      finiteInteger(selectionObject["start"]) &&
      finiteInteger(selectionObject["end"])
    );
  }

  #captureHistoryEntry(): HistoryEntry {
    return {
      snapshot: encodeSongUrl(this.song.toBinary()),
      bar: this.bar,
      channel: this.channel,
      viewedInstruments: this.viewedInstrument.concat(),
      mutedChannels: this.song.channels.map((channel): boolean => channel.muted),
      recoveryUid: this.#recoveryUid,
      selection: this.selection.toJSON(),
    };
  }

  #parseHistoryEntrySong(entry: HistoryEntry): Song {
    const previousChipWaves = Config.chipWaves;
    try {
      const songData: Uint8Array | null = decodeSongUrlHash(entry.snapshot);
      if (songData == null) {
        throw new Error("Invalid undo history song snapshot.");
      }
      return new Song(songData);
    } catch (error) {
      Config.chipWaves = previousChipWaves;
      throw error;
    }
  }

  #applyHistoryEntryState(entry: HistoryEntry, restoreMutes = true): void {
    const clampInteger = (value: number, min: number, max: number): number =>
        Math.max(min, Math.min(max, value | 0)),
      channelCount: number = this.song.getChannelCount();
    this.channel = clampInteger(entry.channel, 0, channelCount - 1);
    this.bar = clampInteger(entry.bar, 0, this.song.barCount - 1);
    this.viewedInstrument.length = channelCount;
    for (let i = 0; i < channelCount; i++) {
      this.viewedInstrument[i] = clampInteger(
        entry.viewedInstruments[i] ?? 0,
        0,
        this.song.channels[i]!.instruments.length - 1,
      );
      if (restoreMutes) {
        this.song.channels[i]!.muted = entry.mutedChannels[i] ?? false;
      }
    }
    const maximumPart: number = this.song.beatsPerBar * Config.partsPerBeat;
    this.selection.fromJSON({
      x0: clampInteger(entry.selection.x0, 0, this.song.barCount - 1),
      x1: clampInteger(entry.selection.x1, 0, this.song.barCount - 1),
      y0: clampInteger(entry.selection.y0, 0, channelCount - 1),
      y1: clampInteger(entry.selection.y1, 0, channelCount - 1),
      start: clampInteger(entry.selection.start, 0, maximumPart),
      end: clampInteger(entry.selection.end, 0, maximumPart),
    });
    this.#recoveryUid = entry.recoveryUid;
    this.#validateDocState();
  }

  #replaceNativeStateAndUrl(preserveUrl = false): void {
    const nativeState: object = { goopboxUndoVersion: 3, id: this.#historyId };
    try {
      const canonicalHash: string = encodeSongUrl(this.song.toBinary());
      if (preserveUrl) {
        window.history.replaceState(nativeState, "");
      } else {
        window.history.replaceState(nativeState, "", canonicalHash);
      }
      this.#currentUrlHash = preserveUrl ? window.location.hash : canonicalHash;
    } catch (error) {
      console.warn(error);
      try {
        // A large or otherwise rejected URL may still allow the small native
        // Marker that authenticates the current persisted history entry.
        window.history.replaceState(nativeState, "");
      } catch (fallbackError) {
        console.warn(fallbackError);
      }
      this.#currentUrlHash = window.location.hash;
      this.#handleHistoryLoss();
    }
  }

  #persistHistory(): void {
    let discardedHistory = false;
    while (this.#historyEntries.length > SongDocument.#maximumUndoHistory) {
      this.#historyEntries.shift();
      this.#historyIndex--;
      discardedHistory = true;
    }
    // Quota retries may temporarily trim the stack. If even the current entry
    // Cannot be written, retain the full in-memory history for this open tab.
    const untrimmedEntries: HistoryEntry[] = this.#historyEntries.concat(),
      untrimmedIndex: number = this.#historyIndex;
    let trimmedRedoForPersistence = false;
    while (true) {
      const stored: StoredHistory = {
        goopboxUndoVersion: 3,
        id: this.#historyId,
        currentIndex: this.#historyIndex,
        entries: this.#historyEntries,
      };
      try {
        window.sessionStorage.setItem(SongDocument.#storedHistoryKey, JSON.stringify(stored));
        if (trimmedRedoForPersistence) {
          this.#historyEntries = untrimmedEntries;
          this.#historyIndex = untrimmedIndex;
        }
        if (discardedHistory) {
          this.#handleHistoryLoss(stored.entries.length);
        }
        return;
      } catch (error) {
        const quotaExceeded: boolean =
          error != null &&
          typeof error === "object" &&
          "name" in error &&
          error.name === "QuotaExceededError";
        if (quotaExceeded && this.#historyIndex > 0 && this.#historyEntries.length > 1) {
          this.#historyEntries.shift();
          this.#historyIndex--;
          discardedHistory = true;
          continue;
        }
        if (quotaExceeded && this.#historyIndex === 0 && this.#historyEntries.length > 1) {
          // The current song cannot be discarded. Trim the farthest redo state
          // One at a time so the largest reachable redo prefix is persisted.
          this.#historyEntries.pop();
          trimmedRedoForPersistence = true;
          discardedHistory = true;
          continue;
        }
        console.warn(error);
        this.#historyEntries = untrimmedEntries;
        this.#historyIndex = untrimmedIndex;
        // A stale manifest may remain when storage removal is also blocked.
        // Rotate the native marker so a reload will prefer the current URL.
        this.#historyId = generateUid();
        try {
          window.sessionStorage.removeItem(SongDocument.#storedHistoryKey);
        } catch (removeError) {
          console.warn(removeError);
        }
        this.#handleHistoryLoss(0);
        return;
      }
    }
  }

  #handleHistoryLoss = (maximumStoredEntries: number = Number.POSITIVE_INFINITY): void => {
    if (maximumStoredEntries > 3 || this.#historyLossWasReported) {
      return;
    }
    this.#historyLossWasReported = true;
    const message =
      "Some undo or recovery history had to be discarded because browser storage is full or unavailable. Your current song is still open. Export a .goop backup now?";
    let exportNow = false;
    try {
      exportNow = typeof window.confirm === "function" ? window.confirm(message) : false;
      if (typeof window.confirm !== "function") {
        window.alert(message);
      }
    } catch (error) {
      console.warn(error);
    }
    if (exportNow) {
      this.openPrompt("exportGoop");
    }
  };

  public hasRedoHistory(): boolean {
    return this.#historyIndex + 1 < this.#historyEntries.length;
  }

  #whenHistoryStateChanged = (): void => {
    const requestedHash: string = window.location.hash;
    if (requestedHash === this.#currentUrlHash) {
      return;
    }
    if (this.synth.recording) {
      this.performance.abortRecording();
    }
    this.#flushPendingHistoryState();
    if (requestedHash === "") {
      this.#replaceNativeStateAndUrl();
      return;
    }
    try {
      const songData: Uint8Array | null = decodeSongUrlHash(requestedHash);
      if (songData == null) {
        this.#replaceNativeStateAndUrl();
        return;
      }
      const song: Song = new Song(songData);
      this.song = song;
      this.synth.setSong(song);
      this.#resetSongRecoveryUid();
      this.#validateDocState();
      this.#historyEntries.splice(this.#historyIndex + 1);
      this.#historyEntries.push(this.#captureHistoryEntry());
      this.#historyIndex = this.#historyEntries.length - 1;
      this.#persistHistory();
      this.#replaceNativeStateAndUrl();
      this.notifier.changed();
      this.forgetLastChange();
      this.renderNow();
    } catch (error) {
      Config.configureAssets(this.song.assets);
      errorAlert(error);
      this.#replaceNativeStateAndUrl();
    }
  };

  public renderNow(): void {
    this.notifier.notifyWatchers();
  }

  // Make sure the doc state is self-consistent.
  #validateDocState(): void {
    const channelCount: number = this.song.getChannelCount();
    this.channel = Math.max(0, Math.min(channelCount - 1, this.channel | 0));
    this.bar = Math.max(0, Math.min(this.song.barCount - 1, this.bar | 0));
    for (let i: number = this.viewedInstrument.length; i < channelCount; i++) {
      this.viewedInstrument[i] = 0;
    }
    this.viewedInstrument.length = channelCount;
    for (let i = 0; i < channelCount; i++) {
      this.viewedInstrument[i] = Math.max(
        0,
        Math.min(this.viewedInstrument[i]! | 0, this.song.channels[i]!.instruments.length - 1),
      );
    }

    // Normalize selection.
    // I'm allowing the doc.bar to drift outside the box selection while playing
    // Because it may auto-follow the playhead outside the selection but it would
    // Be annoying to lose your selection just because the song is playing.
    if (
      (!this.synth.playing &&
        (this.bar < this.selection.boxSelectionBar ||
          this.selection.boxSelectionBar + this.selection.boxSelectionWidth <= this.bar)) ||
      this.channel < this.selection.boxSelectionChannel ||
      this.selection.boxSelectionChannel + this.selection.boxSelectionHeight <= this.channel ||
      this.song.barCount < this.selection.boxSelectionBar + this.selection.boxSelectionWidth ||
      channelCount < this.selection.boxSelectionChannel + this.selection.boxSelectionHeight ||
      (this.selection.boxSelectionWidth === 1 && this.selection.boxSelectionHeight === 1)
    ) {
      this.selection.resetBoxSelection();
    }

    this.barScrollPos = Math.max(
      0,
      Math.min(this.song.barCount - this.trackVisibleBars, this.barScrollPos),
    );
    this.channelScrollPos = Math.max(
      0,
      Math.min(this.song.getChannelCount() - this.trackVisibleChannels, this.channelScrollPos),
    );
  }

  #updateHistoryState = (): void => {
    if (!this.#waitingToUpdateState) {
      return;
    }
    this.#waitingToUpdateState = false;
    try {
      // Ensure that the song is valid before it becomes an undo boundary.
      const songData: Uint8Array = this.song.toBinary();
      if (this.#recordedNewSong) {
        this.#resetSongRecoveryUid();
      } else {
        this.#recovery.saveVersion(this.#recoveryUid, songData);
      }
      const entry: HistoryEntry = this.#captureHistoryEntry();
      if (this.#stateShouldBePushed) {
        this.#historyEntries.splice(this.#historyIndex + 1);
        this.#historyEntries.push(entry);
        this.#historyIndex = this.#historyEntries.length - 1;
      } else {
        this.#historyEntries[this.#historyIndex] = entry;
      }
      this.#persistHistory();
      this.#replaceNativeStateAndUrl();
    } catch (error) {
      console.warn(error);
      this.#handleHistoryLoss();
    }
    this.#stateShouldBePushed = false;
    this.#recordedNewSong = false;
  };

  public updateCurrentHistoryEntry(): void {
    this.#flushPendingHistoryState();
    try {
      this.#historyEntries[this.#historyIndex] = this.#captureHistoryEntry();
      this.#persistHistory();
    } catch (error) {
      console.warn(error);
      this.#handleHistoryLoss();
    }
  }

  #flushPendingHistoryState(): void {
    if (this.#waitingToUpdateState) {
      this.#updateHistoryState();
    }
  }

  #moveThroughHistory(targetIndex: number): void {
    if (
      targetIndex < 0 ||
      targetIndex >= this.#historyEntries.length ||
      targetIndex === this.#historyIndex
    ) {
      return;
    }
    const mutedChannels: boolean[] = this.song.channels.map((channel): boolean => channel.muted);
    let restoredSong: Song;
    try {
      restoredSong = this.#parseHistoryEntrySong(this.#historyEntries[targetIndex]!);
    } catch (error) {
      console.warn(error);
      this.#historyEntries.splice(targetIndex, 1);
      if (targetIndex < this.#historyIndex) {
        this.#historyIndex--;
      }
      this.#persistHistory();
      this.#handleHistoryLoss();
      return;
    }
    for (let i = 0; i < Math.min(mutedChannels.length, restoredSong.channels.length); i++) {
      restoredSong.channels[i]!.muted = mutedChannels[i]!;
    }
    this.song = restoredSong;
    this.synth.setSong(restoredSong);
    this.#historyIndex = targetIndex;
    this.#applyHistoryEntryState(this.#historyEntries[this.#historyIndex]!, false);
    // Mutes are deliberately outside undo history. Refresh the visited snapshot
    // So they also survive a reload at this point in the stack.
    this.#historyEntries[this.#historyIndex] = this.#captureHistoryEntry();
    this.#persistHistory();
    this.#replaceNativeStateAndUrl();
    this.notifier.changed();
    this.forgetLastChange();
    this.renderNow();
  }

  public record(change: Change, replace = false, newSong = false): void {
    if (change.isNoop()) {
      this.#recentChange = null;
      if (replace) {
        this.#flushPendingHistoryState();
        this.#moveThroughHistory(this.#historyIndex - 1);
      }
    } else {
      change.commit();
      this.#recentChange = change;
      this.#stateShouldBePushed ||= !replace;
      this.#recordedNewSong ||= newSong;
      if (!this.#waitingToUpdateState) {
        // Defer updating history until all sequenced changes have
        // Committed and the interface has rendered the latest changes to
        // Improve perceived responsiveness.
        this.#waitingToUpdateState = true;
        window.requestAnimationFrame(this.#updateHistoryState);
      }
    }
  }

  #resetSongRecoveryUid(): void {
    this.#recoveryUid = generateUid();
  }

  public openPrompt(prompt: string): void {
    this.prompt = prompt;
    this.notifier.changed();
    this.renderNow();
  }

  public closePrompt(): void {
    if (this.prompt == null) {
      return;
    }
    this.prompt = null;
    this.notifier.changed();
    this.renderNow();
  }

  public undo(): void {
    if (this.prompt != null) {
      return;
    }
    this.#flushPendingHistoryState();
    if (this.synth.recording) {
      this.performance.abortRecording();
    }
    this.#moveThroughHistory(this.#historyIndex - 1);
  }

  public redo(): void {
    if (this.prompt != null) {
      return;
    }
    this.#flushPendingHistoryState();
    if (this.synth.recording) {
      this.performance.abortRecording();
    }
    if (this.hasRedoHistory()) {
      this.#moveThroughHistory(this.#historyIndex + 1);
    }
  }

  public setProspectiveChange(change: Change | null): void {
    this.#recentChange = change;
  }

  public forgetLastChange(): void {
    this.#recentChange = null;
  }

  public lastChangeWas(change: Change | null): boolean {
    return change != null && change === this.#recentChange;
  }

  public goBackToStart(): void {
    this.bar = 0;
    this.channel = 0;
    this.barScrollPos = 0;
    this.channelScrollPos = 0;
    this.synth.snapToStart();
    this.notifier.changed();
  }

  public getCurrentPattern(barOffset = 0): Pattern | null {
    return this.song.getPattern(this.channel, this.bar + barOffset);
  }

  public getCurrentInstrument(): number {
    return this.viewedInstrument[this.channel]!;
  }

  public getBarWidth(): number {
    return 32;
  }

  public getVisibleOctaveCount(): number {
    return this.prefs.visibleOctaves;
  }

  public getVisiblePitchCount(): number {
    return this.getVisibleOctaveCount() * Config.pitchesPerOctave + 1;
  }

  public getBaseVisibleOctave(channel: number): number {
    const visibleOctaveCount: number = this.getVisibleOctaveCount();
    return Math.max(
      0,
      Math.min(
        Config.pitchOctaves - visibleOctaveCount,
        Math.ceil(this.song.channels[channel]!.octave - visibleOctaveCount * 0.5),
      ),
    );
  }
}
