// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config, type Scale } from "../synth/synth-config.js";

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

  public constructor() {
    this.reload();
  }

  public static masterVolumeToGain(value: number): number {
    if (value <= 0) {
      return 0.0;
    }
    const clampedValue: number = Math.min(Preferences.maxMasterVolume, value),
      ratio: number = (clampedValue - 1) / (Preferences.maxMasterVolume - 1);
    return Preferences.masterVolumeMinGain * (1.0 / Preferences.masterVolumeMinGain) ** ratio;
  }

  public reload(): void {
    this.autoFollow = this.#loadBoolean("autoFollow", true);
    this.notesOutsideScale = this.#loadBoolean("notesOutsideScale", false);
    this.rememberScaleChoice = this.#loadBoolean("rememberScaleChoice", true);
    this.pressControlForShortcuts = this.#loadBoolean("pressControlForShortcuts", false);
    this.ignorePerformedNotesNotInScale = this.#loadBoolean(
      "ignorePerformedNotesNotInScale",
      false,
    );
    this.metronomeCountIn = this.#loadBoolean("metronomeCountIn", true);
    this.metronomeWhileRecording = this.#loadBoolean("metronomeWhileRecording", true);
    this.keyboardLayout = this.#getStorageItem("keyboardLayout") || "wickiHayden";
    this.layout = this.#getStorageItem("layout") || "long";
    this.colorTheme = this.#getStorageItem("colorTheme") || Preferences.defaultColorTheme;
    const storedMasterVolume: string | null = this.#getStorageItem("volume");
    if (storedMasterVolume == null) {
      this.masterVolume = Preferences.defaultMasterVolume;
    } else {
      const parsedMasterVolume = Number(storedMasterVolume);
      this.masterVolume = Number.isFinite(parsedMasterVolume)
        ? Math.max(0, Math.min(Preferences.maxMasterVolume, Math.round(parsedMasterVolume)))
        : Preferences.defaultMasterVolume;
    }
    this.visibleOctaves =
      Number(this.#getStorageItem("visibleOctaves")) >>> 0 || Preferences.defaultVisibleOctaves;

    const defaultScale: Scale | undefined =
      Config.scales.dictionary[this.#getStorageItem("defaultScale")!]!;
    this.defaultScale = defaultScale === undefined ? 0 : defaultScale.index;

    if (this.#getStorageItem("fullScreen") != null) {
      if (this.#loadBoolean("fullScreen", false)) {
        this.layout = "long";
      }
      this.#removeStorageItem("fullScreen");
    }
  }

  public save(): void {
    this.#setStorageItem("autoFollow", this.autoFollow ? "true" : "false");
    this.#setStorageItem("notesOutsideScale", this.notesOutsideScale ? "true" : "false");
    this.#setStorageItem("rememberScaleChoice", this.rememberScaleChoice ? "true" : "false");
    this.#setStorageItem("defaultScale", Config.scales[this.defaultScale]!.name);
    this.#setStorageItem(
      "pressControlForShortcuts",
      this.pressControlForShortcuts ? "true" : "false",
    );
    this.#setStorageItem(
      "ignorePerformedNotesNotInScale",
      this.ignorePerformedNotesNotInScale ? "true" : "false",
    );
    this.#setStorageItem("metronomeCountIn", this.metronomeCountIn ? "true" : "false");
    this.#setStorageItem(
      "metronomeWhileRecording",
      this.metronomeWhileRecording ? "true" : "false",
    );
    this.#setStorageItem("keyboardLayout", this.keyboardLayout);
    this.#setStorageItem("volume", String(this.masterVolume));
    this.#setStorageItem("layout", this.layout);
    this.#setStorageItem("colorTheme", this.colorTheme);
    this.#setStorageItem("visibleOctaves", String(this.visibleOctaves));
  }

  #loadBoolean(name: string, defaultToTrue: boolean) {
    return defaultToTrue
      ? this.#getStorageItem(name) !== "false"
      : this.#getStorageItem(name) === "true";
  }

  #getStorageItem(name: string): string | null {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  }

  #setStorageItem(name: string, value: string): void {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Preferences are optional. Keep the in-memory setting when storage is
      // Unavailable or full.
    }
  }

  #removeStorageItem(name: string): void {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Ignore unavailable storage just as for reads and writes.
    }
  }
}
