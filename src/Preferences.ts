// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type Scale, Config } from "../synth/SynthConfig.js";

export class Preferences {
  public static readonly defaultVisibleOctaves: number = 3;
  public static readonly defaultMasterVolume: number = 100;
  public static readonly maxMasterVolume: number = 100;
  public static readonly masterVolumeMinGain: number = 0.05;
  public static readonly defaultColorTheme: string = "GoopBox Dark";

  public autoFollow!: boolean;
  public notesOutsideScale!: boolean;
  public rememberScaleChoice!: boolean;
  public defaultScale!: number;
  public layout!: string;
  public colorTheme!: string;
  public masterVolume: number = Preferences.defaultMasterVolume;
  public visibleOctaves: number = Preferences.defaultVisibleOctaves;
  public pressControlForShortcuts!: boolean;
  public keyboardLayout!: string;
  public ignorePerformedNotesNotInScale!: boolean;
  public metronomeCountIn!: boolean;
  public metronomeWhileRecording!: boolean;
  public assetCacheEnabled!: boolean;

  constructor() {
    this.reload();
  }

  public static masterVolumeToGain(value: number): number {
    if (value <= 0) return 0.0;
    const clampedValue: number = Math.min(Preferences.maxMasterVolume, value);
    const ratio: number =
      (clampedValue - 1) / (Preferences.maxMasterVolume - 1);
    return (
      Preferences.masterVolumeMinGain *
      Math.pow(1.0 / Preferences.masterVolumeMinGain, ratio)
    );
  }

  public reload(): void {
    this.autoFollow = this._loadBoolean("autoFollow", true);
    this.notesOutsideScale = this._loadBoolean("notesOutsideScale", false);
    this.rememberScaleChoice = this._loadBoolean("rememberScaleChoice", true);
    this.pressControlForShortcuts = this._loadBoolean(
      "pressControlForShortcuts",
      false,
    );
    this.ignorePerformedNotesNotInScale = this._loadBoolean(
      "ignorePerformedNotesNotInScale",
      false,
    );
    this.metronomeCountIn = this._loadBoolean("metronomeCountIn", true);
    this.metronomeWhileRecording = this._loadBoolean(
      "metronomeWhileRecording",
      true,
    );
    this.assetCacheEnabled = this._loadBoolean("assetCacheEnabled", true);
    this.keyboardLayout =
      this._getStorageItem("keyboardLayout") || "wickiHayden";
    this.layout = this._getStorageItem("layout") || "long";
    this.colorTheme =
      this._getStorageItem("colorTheme") || Preferences.defaultColorTheme;
    const storedMasterVolume: string | null = this._getStorageItem("volume");
    if (storedMasterVolume != null) {
      const parsedMasterVolume: number = Number(storedMasterVolume);
      this.masterVolume = Number.isFinite(parsedMasterVolume)
        ? Math.max(
            0,
            Math.min(
              Preferences.maxMasterVolume,
              Math.round(parsedMasterVolume),
            ),
          )
        : Preferences.defaultMasterVolume;
    } else {
      this.masterVolume = Preferences.defaultMasterVolume;
    }
    this.visibleOctaves =
      (<any>this._getStorageItem("visibleOctaves")) >>> 0 ||
      Preferences.defaultVisibleOctaves;

    const defaultScale: Scale | undefined =
      Config.scales.dictionary[this._getStorageItem("defaultScale")!];
    this.defaultScale = defaultScale != undefined ? defaultScale.index : 0;

    if (this._getStorageItem("fullScreen") != null) {
      if (this._loadBoolean("fullScreen", false)) this.layout = "long";
      this._removeStorageItem("fullScreen");
    }
  }

  public save(): void {
    this._setStorageItem("autoFollow", this.autoFollow ? "true" : "false");
    this._setStorageItem(
      "notesOutsideScale",
      this.notesOutsideScale ? "true" : "false",
    );
    this._setStorageItem(
      "rememberScaleChoice",
      this.rememberScaleChoice ? "true" : "false",
    );
    this._setStorageItem("defaultScale", Config.scales[this.defaultScale].name);
    this._setStorageItem(
      "pressControlForShortcuts",
      this.pressControlForShortcuts ? "true" : "false",
    );
    this._setStorageItem(
      "ignorePerformedNotesNotInScale",
      this.ignorePerformedNotesNotInScale ? "true" : "false",
    );
    this._setStorageItem(
      "metronomeCountIn",
      this.metronomeCountIn ? "true" : "false",
    );
    this._setStorageItem(
      "metronomeWhileRecording",
      this.metronomeWhileRecording ? "true" : "false",
    );
    this._setStorageItem(
      "assetCacheEnabled",
      this.assetCacheEnabled ? "true" : "false",
    );
    this._setStorageItem("keyboardLayout", this.keyboardLayout);
    this._setStorageItem("volume", String(this.masterVolume));
    this._setStorageItem("layout", this.layout);
    this._setStorageItem("colorTheme", this.colorTheme);
    this._setStorageItem("visibleOctaves", String(this.visibleOctaves));
  }

  private _loadBoolean(name: string, defaultToTrue: boolean) {
    return defaultToTrue
      ? this._getStorageItem(name) != "false"
      : this._getStorageItem(name) == "true";
  }

  private _getStorageItem(name: string): string | null {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  }

  private _setStorageItem(name: string, value: string): void {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Preferences are optional. Keep the in-memory setting when storage is
      // unavailable or full.
    }
  }

  private _removeStorageItem(name: string): void {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Ignore unavailable storage just as for reads and writes.
    }
  }
}
