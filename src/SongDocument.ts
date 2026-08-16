// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config } from "../synth/SynthConfig.js";
import { ColorConfig } from "./ColorConfig.js";
import { Layout } from "./Layout.js";
import { Pattern, Song } from "../synth/synth.js";
import { SynthController } from "../synth/SynthController.js";
import { SongRecovery, generateUid, errorAlert } from "./SongRecovery.js";
import { SongPerformance } from "./SongPerformance.js";
import { MidiInputHandler } from "./MidiInput.js";
import { Selection } from "./Selection.js";
import { Preferences } from "./Preferences.js";
import { Change } from "./Change.js";
import { ChangeNotifier } from "./ChangeNotifier.js";
import { setDefaultInstruments } from "./changes.js";
import { decodeSongUrl, decodeSongUrlHash, encodeSongUrl } from "./SongUrl.js";

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
  public readonly notifier: ChangeNotifier = new ChangeNotifier(() =>
    this._validateDocState(),
  );
  public readonly selection: Selection = new Selection(this);
  public readonly prefs: Preferences = new Preferences();
  public channel: number = 0;
  public bar: number = 0;
  public readonly viewedInstrument: number[] = [];

  public trackVisibleBars: number = 16;
  public trackVisibleChannels: number = 4;
  public barScrollPos: number = 0;
  public channelScrollPos: number = 0;
  public prompt: string | null = null;

  public addedEffect: boolean = false;
  public addedEnvelope: boolean = false;
  public currentPatternIsDirty: boolean = false;

  private static readonly _maximumUndoHistory: number = 100;
  private static readonly _storedHistoryKey: string = "goopboxUndoHistoryV3";
  private _recovery: SongRecovery;
  private _recoveryUid!: string;
  private _recentChange: Change | null = null;
  private _historyId: string = generateUid();
  private _historyEntries: HistoryEntry[] = [];
  private _historyIndex: number = 0;
  private _currentUrlHash: string = "";
  private _historyLossWasReported: boolean = false;
  private _stateShouldBePushed: boolean = false;
  private _recordedNewSong: boolean = false;
  private _waitingToUpdateState: boolean = false;

  constructor() {
    ColorConfig.setTheme(this.prefs.colorTheme);
    Layout.setLayout(this.prefs.layout);

    let historyWasCorrupt: boolean = false;
    let restoredEntry: HistoryEntry | null = null;
    this.song = new Song();
    let loadedSong: boolean = false;
    let loadedFromUrl: boolean = false;
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
      this.song.scale = this.prefs.rememberScaleChoice
        ? this.prefs.defaultScale
        : 0;
    }

    const storedResult: { history: StoredHistory | null; corrupt: boolean } =
      this._readStoredHistory();
    historyWasCorrupt = historyWasCorrupt || storedResult.corrupt;
    if (storedResult.history != null) {
      const stored: StoredHistory = storedResult.history;
      try {
        const candidateEntry: HistoryEntry =
          stored.entries[stored.currentIndex];
        const candidateSong: Song = this._parseHistoryEntrySong(candidateEntry);
        const nativeHistoryId: string | null = this._getNativeHistoryId();
        const candidateUrlHash: string = encodeSongUrl(
          candidateSong.toBinary(),
        );
        if (
          nativeHistoryId == stored.id ||
          (nativeHistoryId == null &&
            window.location.hash != "" &&
            candidateUrlHash == window.location.hash)
        ) {
          this.song = candidateSong;
          this._historyId = stored.id;
          this._historyEntries = stored.entries;
          this._historyIndex = stored.currentIndex;
          restoredEntry = candidateEntry;
        } else {
          // Parsing the candidate configures global asset-backed chip waves.
          // If it belongs to another tab or URL, restore the open song's assets.
          Config.configureAssets(this.song.assets);
        }
      } catch (error) {
        Config.configureAssets(this.song.assets);
        console.warn(error);
        if (this._getNativeHistoryId() == stored.id) historyWasCorrupt = true;
      }
    }

    this.synth = new SynthController(this.song);
    this.synth.masterVolume = Preferences.masterVolumeToGain(
      this.prefs.masterVolume,
    );
    this.notifier.watch((): void => this.synth.syncSong());
    this._recovery = new SongRecovery(this._handleHistoryLoss);

    if (restoredEntry == null) {
      this.bar = 0;
      this.channel = 0;
      this._recoveryUid = generateUid();
      for (let i: number = 0; i < this.song.getChannelCount(); i++)
        this.viewedInstrument[i] = 0;
      this.selection.resetBoxSelection();
      this._historyEntries = [this._captureHistoryEntry()];
      this._historyIndex = 0;
    } else {
      this._applyHistoryEntryState(restoredEntry);
    }
    //this.barScrollPos = Math.max(0, this.bar - (this.trackVisibleBars - 6));
    this.selection.scrollToSelectedPattern();
    this._persistHistory();
    this._replaceNativeStateAndUrl(loadedFromUrl && restoredEntry == null);
    window.addEventListener("popstate", this._whenHistoryStateChanged);
    window.addEventListener("hashchange", this._whenHistoryStateChanged);

    // For all input events, intercept them in the capture phase, before other event handlers
    // make changes to the model, and enqueue a task to render the view after the changes are
    // done but before the browser renders. Listening in the capture phase allows this code to
    // be respond to events even if stopImmediatePropagation is called. mouseenter and
    // mouseleave are ignored because they are immediately followed by mousemove. Animation
    // frames and midi events also sometimes update the model, but are not automatically
    // detected here so they have to manually call "renderNow" instead.
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
      window.addEventListener(
        eventName,
        this.notifier.enqueueTaskToNotifyWatchers,
        { capture: true },
      );
    }

    this._validateDocState();
    this.performance = new SongPerformance(this);
    this.midiInputHandler = new MidiInputHandler(this);
    if (historyWasCorrupt) this._handleHistoryLoss();
  }

  public setMasterVolume(value: number): void {
    this.prefs.masterVolume = Math.max(
      0,
      Math.min(Preferences.maxMasterVolume, Math.round(value)),
    );
    this.prefs.save();
    this.synth.masterVolume = Preferences.masterVolumeToGain(
      this.prefs.masterVolume,
    );
  }

  private _getNativeHistoryId(): string | null {
    const state: any = window.history.state;
    return state != null &&
      typeof state == "object" &&
      state.goopboxUndoVersion == 3 &&
      typeof state.id == "string"
      ? state.id
      : null;
  }

  private _readStoredHistory(): {
    history: StoredHistory | null;
    corrupt: boolean;
  } {
    let serialized: string | null;
    try {
      serialized = window.sessionStorage.getItem(
        SongDocument._storedHistoryKey,
      );
    } catch (error) {
      console.warn(error);
      return { history: null, corrupt: true };
    }
    if (serialized == null) return { history: null, corrupt: false };
    try {
      const candidate: any = JSON.parse(serialized);
      if (
        candidate == null ||
        typeof candidate != "object" ||
        Array.isArray(candidate) ||
        candidate.goopboxUndoVersion != 3 ||
        typeof candidate.id != "string" ||
        candidate.id.length == 0 ||
        !Number.isInteger(candidate.currentIndex) ||
        !Array.isArray(candidate.entries) ||
        candidate.entries.length == 0 ||
        candidate.entries.length > SongDocument._maximumUndoHistory ||
        candidate.currentIndex < 0 ||
        candidate.currentIndex >= candidate.entries.length
      ) {
        throw new Error("Invalid undo history manifest.");
      }
      for (const entry of candidate.entries) {
        if (!this._isValidHistoryEntry(entry))
          throw new Error("Invalid undo history entry.");
      }
      return { history: candidate as StoredHistory, corrupt: false };
    } catch (error) {
      console.warn(error);
      return { history: null, corrupt: true };
    }
  }

  private _isValidHistoryEntry(entry: any): entry is HistoryEntry {
    const finiteInteger = (value: unknown): boolean =>
      typeof value == "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value);
    if (
      entry == null ||
      typeof entry != "object" ||
      Array.isArray(entry) ||
      typeof entry.snapshot != "string" ||
      !finiteInteger(entry.bar) ||
      !finiteInteger(entry.channel) ||
      typeof entry.recoveryUid != "string" ||
      entry.recoveryUid.length == 0 ||
      !Array.isArray(entry.viewedInstruments) ||
      entry.viewedInstruments.length > 64 ||
      !entry.viewedInstruments.every(finiteInteger) ||
      !Array.isArray(entry.mutedChannels) ||
      entry.mutedChannels.length > 64 ||
      !entry.mutedChannels.every(
        (muted: unknown): boolean => typeof muted == "boolean",
      )
    ) {
      return false;
    }
    const selection: any = entry.selection;
    return (
      selection != null &&
      typeof selection == "object" &&
      !Array.isArray(selection) &&
      finiteInteger(selection.x0) &&
      finiteInteger(selection.x1) &&
      finiteInteger(selection.y0) &&
      finiteInteger(selection.y1) &&
      finiteInteger(selection.start) &&
      finiteInteger(selection.end)
    );
  }

  private _captureHistoryEntry(): HistoryEntry {
    return {
      snapshot: encodeSongUrl(this.song.toBinary()),
      bar: this.bar,
      channel: this.channel,
      viewedInstruments: this.viewedInstrument.concat(),
      mutedChannels: this.song.channels.map(
        (channel): boolean => channel.muted,
      ),
      recoveryUid: this._recoveryUid,
      selection: this.selection.toJSON(),
    };
  }

  private _parseHistoryEntrySong(entry: HistoryEntry): Song {
    const previousChipWaves = Config.chipWaves;
    try {
      const songData: Uint8Array | null = decodeSongUrlHash(entry.snapshot);
      if (songData == null)
        throw new Error("Invalid undo history song snapshot.");
      return new Song(songData);
    } catch (error) {
      Config.chipWaves = previousChipWaves;
      throw error;
    }
  }

  private _applyHistoryEntryState(
    entry: HistoryEntry,
    restoreMutes: boolean = true,
  ): void {
    const clampInteger = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, value | 0));
    const channelCount: number = this.song.getChannelCount();
    this.channel = clampInteger(entry.channel, 0, channelCount - 1);
    this.bar = clampInteger(entry.bar, 0, this.song.barCount - 1);
    this.viewedInstrument.length = channelCount;
    for (let i: number = 0; i < channelCount; i++) {
      this.viewedInstrument[i] = clampInteger(
        entry.viewedInstruments[i] ?? 0,
        0,
        this.song.channels[i].instruments.length - 1,
      );
      if (restoreMutes)
        this.song.channels[i].muted = entry.mutedChannels[i] ?? false;
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
    this._recoveryUid = entry.recoveryUid;
    this._validateDocState();
  }

  private _replaceNativeStateAndUrl(preserveUrl: boolean = false): void {
    const nativeState: Object = { goopboxUndoVersion: 3, id: this._historyId };
    try {
      const canonicalHash: string = encodeSongUrl(this.song.toBinary());
      if (preserveUrl) {
        window.history.replaceState(nativeState, "");
      } else {
        window.history.replaceState(nativeState, "", canonicalHash);
      }
      this._currentUrlHash = preserveUrl ? window.location.hash : canonicalHash;
    } catch (error) {
      console.warn(error);
      try {
        // A large or otherwise rejected URL may still allow the small native
        // marker that authenticates the current persisted history entry.
        window.history.replaceState(nativeState, "");
      } catch (fallbackError) {
        console.warn(fallbackError);
      }
      this._currentUrlHash = window.location.hash;
      this._handleHistoryLoss();
    }
  }

  private _persistHistory(): void {
    let discardedHistory: boolean = false;
    while (this._historyEntries.length > SongDocument._maximumUndoHistory) {
      this._historyEntries.shift();
      this._historyIndex--;
      discardedHistory = true;
    }
    // Quota retries may temporarily trim the stack. If even the current entry
    // cannot be written, retain the full in-memory history for this open tab.
    const untrimmedEntries: HistoryEntry[] = this._historyEntries.concat();
    const untrimmedIndex: number = this._historyIndex;
    let trimmedRedoForPersistence: boolean = false;
    while (true) {
      const stored: StoredHistory = {
        goopboxUndoVersion: 3,
        id: this._historyId,
        currentIndex: this._historyIndex,
        entries: this._historyEntries,
      };
      try {
        window.sessionStorage.setItem(
          SongDocument._storedHistoryKey,
          JSON.stringify(stored),
        );
        if (trimmedRedoForPersistence) {
          this._historyEntries = untrimmedEntries;
          this._historyIndex = untrimmedIndex;
        }
        if (discardedHistory) this._handleHistoryLoss(stored.entries.length);
        return;
      } catch (error) {
        const quotaExceeded: boolean =
          error != null &&
          typeof error == "object" &&
          "name" in error &&
          error.name == "QuotaExceededError";
        if (
          quotaExceeded &&
          this._historyIndex > 0 &&
          this._historyEntries.length > 1
        ) {
          this._historyEntries.shift();
          this._historyIndex--;
          discardedHistory = true;
          continue;
        }
        if (
          quotaExceeded &&
          this._historyIndex == 0 &&
          this._historyEntries.length > 1
        ) {
          // The current song cannot be discarded. Trim the farthest redo state
          // one at a time so the largest reachable redo prefix is persisted.
          this._historyEntries.pop();
          trimmedRedoForPersistence = true;
          discardedHistory = true;
          continue;
        }
        console.warn(error);
        this._historyEntries = untrimmedEntries;
        this._historyIndex = untrimmedIndex;
        // A stale manifest may remain when storage removal is also blocked.
        // Rotate the native marker so a reload will prefer the current URL.
        this._historyId = generateUid();
        try {
          window.sessionStorage.removeItem(SongDocument._storedHistoryKey);
        } catch (removeError) {
          console.warn(removeError);
        }
        this._handleHistoryLoss(0);
        return;
      }
    }
  }

  private _handleHistoryLoss = (
    maximumStoredEntries: number = Number.POSITIVE_INFINITY,
  ): void => {
    if (maximumStoredEntries > 3 || this._historyLossWasReported) return;
    this._historyLossWasReported = true;
    const message: string =
      "Some undo or recovery history had to be discarded because browser storage is full or unavailable. Your current song is still open. Export a .goop backup now?";
    let exportNow: boolean = false;
    try {
      exportNow =
        typeof window.confirm == "function" ? window.confirm(message) : false;
      if (typeof window.confirm != "function") window.alert(message);
    } catch (error) {
      console.warn(error);
    }
    if (exportNow) this.openPrompt("exportGoop");
  };

  public hasRedoHistory(): boolean {
    return this._historyIndex + 1 < this._historyEntries.length;
  }

  private _whenHistoryStateChanged = (): void => {
    const requestedHash: string = window.location.hash;
    if (requestedHash == this._currentUrlHash) return;
    if (this.synth.recording) this.performance.abortRecording();
    this._flushPendingHistoryState();
    if (requestedHash == "") {
      this._replaceNativeStateAndUrl();
      return;
    }
    try {
      const songData: Uint8Array | null = decodeSongUrlHash(requestedHash);
      if (songData == null) {
        this._replaceNativeStateAndUrl();
        return;
      }
      const song: Song = new Song(songData);
      this.song = song;
      this.synth.setSong(song);
      this._resetSongRecoveryUid();
      this._validateDocState();
      this._historyEntries.splice(this._historyIndex + 1);
      this._historyEntries.push(this._captureHistoryEntry());
      this._historyIndex = this._historyEntries.length - 1;
      this._persistHistory();
      this._replaceNativeStateAndUrl();
      this.notifier.changed();
      this.forgetLastChange();
      this.renderNow();
    } catch (error) {
      Config.configureAssets(this.song.assets);
      errorAlert(error);
      this._replaceNativeStateAndUrl();
    }
  };

  public renderNow(): void {
    this.notifier.notifyWatchers();
  }

  // Make sure the doc state is self-consistent.
  private _validateDocState(): void {
    const channelCount: number = this.song.getChannelCount();
    this.channel = Math.max(0, Math.min(channelCount - 1, this.channel | 0));
    this.bar = Math.max(0, Math.min(this.song.barCount - 1, this.bar | 0));
    for (let i: number = this.viewedInstrument.length; i < channelCount; i++) {
      this.viewedInstrument[i] = 0;
    }
    this.viewedInstrument.length = channelCount;
    for (let i: number = 0; i < channelCount; i++) {
      this.viewedInstrument[i] = Math.max(
        0,
        Math.min(
          this.viewedInstrument[i] | 0,
          this.song.channels[i].instruments.length - 1,
        ),
      );
    }

    // Normalize selection.
    // I'm allowing the doc.bar to drift outside the box selection while playing
    // because it may auto-follow the playhead outside the selection but it would
    // be annoying to lose your selection just because the song is playing.
    if (
      (!this.synth.playing &&
        (this.bar < this.selection.boxSelectionBar ||
          this.selection.boxSelectionBar + this.selection.boxSelectionWidth <=
            this.bar)) ||
      this.channel < this.selection.boxSelectionChannel ||
      this.selection.boxSelectionChannel + this.selection.boxSelectionHeight <=
        this.channel ||
      this.song.barCount <
        this.selection.boxSelectionBar + this.selection.boxSelectionWidth ||
      channelCount <
        this.selection.boxSelectionChannel +
          this.selection.boxSelectionHeight ||
      (this.selection.boxSelectionWidth == 1 &&
        this.selection.boxSelectionHeight == 1)
    ) {
      this.selection.resetBoxSelection();
    }

    this.barScrollPos = Math.max(
      0,
      Math.min(this.song.barCount - this.trackVisibleBars, this.barScrollPos),
    );
    this.channelScrollPos = Math.max(
      0,
      Math.min(
        this.song.getChannelCount() - this.trackVisibleChannels,
        this.channelScrollPos,
      ),
    );
  }

  private _updateHistoryState = (): void => {
    if (!this._waitingToUpdateState) return;
    this._waitingToUpdateState = false;
    try {
      // Ensure that the song is valid before it becomes an undo boundary.
      const songData: Uint8Array = this.song.toBinary();
      if (this._recordedNewSong) {
        this._resetSongRecoveryUid();
      } else {
        this._recovery.saveVersion(this._recoveryUid, songData);
      }
      const entry: HistoryEntry = this._captureHistoryEntry();
      if (this._stateShouldBePushed) {
        this._historyEntries.splice(this._historyIndex + 1);
        this._historyEntries.push(entry);
        this._historyIndex = this._historyEntries.length - 1;
      } else {
        this._historyEntries[this._historyIndex] = entry;
      }
      this._persistHistory();
      this._replaceNativeStateAndUrl();
    } catch (error) {
      console.warn(error);
      this._handleHistoryLoss();
    }
    this._stateShouldBePushed = false;
    this._recordedNewSong = false;
  };

  public updateCurrentHistoryEntry(): void {
    this._flushPendingHistoryState();
    try {
      this._historyEntries[this._historyIndex] = this._captureHistoryEntry();
      this._persistHistory();
    } catch (error) {
      console.warn(error);
      this._handleHistoryLoss();
    }
  }

  private _flushPendingHistoryState(): void {
    if (this._waitingToUpdateState) this._updateHistoryState();
  }

  private _moveThroughHistory(targetIndex: number): void {
    if (
      targetIndex < 0 ||
      targetIndex >= this._historyEntries.length ||
      targetIndex == this._historyIndex
    )
      return;
    const mutedChannels: boolean[] = this.song.channels.map(
      (channel): boolean => channel.muted,
    );
    let restoredSong: Song;
    try {
      restoredSong = this._parseHistoryEntrySong(
        this._historyEntries[targetIndex],
      );
    } catch (error) {
      console.warn(error);
      this._historyEntries.splice(targetIndex, 1);
      if (targetIndex < this._historyIndex) this._historyIndex--;
      this._persistHistory();
      this._handleHistoryLoss();
      return;
    }
    for (
      let i: number = 0;
      i < Math.min(mutedChannels.length, restoredSong.channels.length);
      i++
    ) {
      restoredSong.channels[i].muted = mutedChannels[i];
    }
    this.song = restoredSong;
    this.synth.setSong(restoredSong);
    this._historyIndex = targetIndex;
    this._applyHistoryEntryState(
      this._historyEntries[this._historyIndex],
      false,
    );
    // Mutes are deliberately outside undo history. Refresh the visited snapshot
    // so they also survive a reload at this point in the stack.
    this._historyEntries[this._historyIndex] = this._captureHistoryEntry();
    this._persistHistory();
    this._replaceNativeStateAndUrl();
    this.notifier.changed();
    this.forgetLastChange();
    this.renderNow();
  }

  public record(
    change: Change,
    replace: boolean = false,
    newSong: boolean = false,
  ): void {
    if (change.isNoop()) {
      this._recentChange = null;
      if (replace) {
        this._flushPendingHistoryState();
        this._moveThroughHistory(this._historyIndex - 1);
      }
    } else {
      change.commit();
      this._recentChange = change;
      this._stateShouldBePushed = this._stateShouldBePushed || !replace;
      this._recordedNewSong = this._recordedNewSong || newSong;
      if (!this._waitingToUpdateState) {
        // Defer updating history until all sequenced changes have
        // committed and the interface has rendered the latest changes to
        // improve perceived responsiveness.
        this._waitingToUpdateState = true;
        window.requestAnimationFrame(this._updateHistoryState);
      }
    }
  }

  private _resetSongRecoveryUid(): void {
    this._recoveryUid = generateUid();
  }

  public openPrompt(prompt: string): void {
    this.prompt = prompt;
    this.notifier.changed();
    this.renderNow();
  }

  public closePrompt(): void {
    if (this.prompt == null) return;
    this.prompt = null;
    this.notifier.changed();
    this.renderNow();
  }

  public undo(): void {
    if (this.prompt != null) return;
    this._flushPendingHistoryState();
    if (this.synth.recording) this.performance.abortRecording();
    this._moveThroughHistory(this._historyIndex - 1);
  }

  public redo(): void {
    if (this.prompt != null) return;
    this._flushPendingHistoryState();
    if (this.synth.recording) this.performance.abortRecording();
    if (this.hasRedoHistory()) this._moveThroughHistory(this._historyIndex + 1);
  }

  public setProspectiveChange(change: Change | null): void {
    this._recentChange = change;
  }

  public forgetLastChange(): void {
    this._recentChange = null;
  }

  public lastChangeWas(change: Change | null): boolean {
    return change != null && change == this._recentChange;
  }

  public goBackToStart(): void {
    this.bar = 0;
    this.channel = 0;
    this.barScrollPos = 0;
    this.channelScrollPos = 0;
    this.synth.snapToStart();
    this.notifier.changed();
  }

  public getCurrentPattern(barOffset: number = 0): Pattern | null {
    return this.song.getPattern(this.channel, this.bar + barOffset);
  }

  public getCurrentInstrument(): number {
    return this.viewedInstrument[this.channel];
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
        Math.ceil(
          this.song.channels[channel].octave - visibleOctaveCount * 0.5,
        ),
      ),
    );
  }
}
