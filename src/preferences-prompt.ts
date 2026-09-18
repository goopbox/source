// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { KeyboardLayout } from "./keyboard-layout.js";
import { Layout } from "./layout.js";
import { Piano } from "./piano.js";
import { Preferences } from "./preferences.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";
import { TabbedSearchablePrompt } from "./tabbed-searchable-prompt.js";
import { ctrlSymbol } from "./editor-config.js";
import { resetAssetCache } from "../synth/asset-cache.js";

const { button, div, input, option, select } = HTML;

export class PreferencesPrompt implements Prompt {
  readonly #doc: SongDocument;
  readonly #prompt: TabbedSearchablePrompt;
  readonly #checkboxListeners: {
    checkbox: HTMLInputElement;
    listener: () => void;
  }[] = [];
  readonly #layoutSelect: HTMLSelectElement = select(
    option({ value: "long" }, "Long"),
    option({ value: "tall" }, "Tall"),
  );
  readonly #themeSelect: HTMLSelectElement = select(
    ...Object.keys(ColorConfig.themes).map((name) => option({ value: name }, name)),
  );
  readonly #keyboardMode = select(
    option({ value: "notes" }, `Play notes, ${ctrlSymbol}shortcuts`),
    option({ value: "shortcuts" }, "Simple shortcuts"),
  );
  readonly #keyboardLayout = select(
    option({ value: "wickiHayden" }, "Wicki-Hayden"),
    option({ value: "songScale" }, "Song scale"),
    option({ value: "pianoAtC" }, "Piano (C)"),
    option({ value: "pianoAtA" }, "Piano (A)"),
    option({ value: "pianoTransposingC" }, "Transposing piano (C)"),
    option({ value: "pianoTransposingA" }, "Transposing piano (A)"),
  );
  readonly #keyboardPreview = div({
    style: "display: grid; justify-items: center; row-gap: 4px; margin: 4px auto; font-size: 10px;",
  });
  readonly #ignoreScale = input({ type: "checkbox" });
  readonly #metronome = input({ type: "checkbox" });
  readonly #countIn = input({ type: "checkbox" });
  readonly #masterVolume = input({
    type: "range",
    min: "0",
    max: String(Preferences.maxMasterVolume),
    step: "1",
    title: "Master volume",
    "aria-label": "Master volume",
  });
  readonly #cacheButton: HTMLButtonElement = button({ type: "button" });
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const pianoRollItems: HTMLElement[] = [
        this.#makeToggle(
          "Follow playhead",
          () => this.#doc.prefs.autoFollow,
          (value) => {
            this.#doc.prefs.autoFollow = value;
          },
        ),
        this.#makeToggle(
          "Place notes out of scale",
          () => this.#doc.prefs.notesOutsideScale,
          (value) => {
            this.#doc.prefs.notesOutsideScale = value;
          },
        ),
        this.#makeToggle(
          "Remember scale choice",
          () => this.#doc.prefs.rememberScaleChoice,
          (value) => {
            this.#doc.prefs.rememberScaleChoice = value;
            if (value) {
              this.#doc.prefs.defaultScale = this.#doc.song.scale;
            }
          },
        ),
      ],
      editorItems: HTMLElement[] = [
        this.#makeRow("Master volume", this.#masterVolume),
        this.#makeRow("Layout", this.#layoutSelect),
        this.#makeRow("Theme", this.#themeSelect),
        this.#makeRow("Cache", this.#cacheButton),
      ],
      recordingItems: HTMLElement[] = [
        this.#makeRow("Keyboard", this.#keyboardLayout),
        this.#keyboardPreview,
        this.#makeRow("Keyboard behavior", this.#keyboardMode),
        this.#makeRow("Scale only", this.#ignoreScale),
        this.#makeRow("Metronome", this.#metronome),
        this.#makeRow("Count in", this.#countIn),
      ];

    this.#prompt = new TabbedSearchablePrompt(
      "Preferences",
      [
        { name: "Piano Roll", content: div(...pianoRollItems) },
        { name: "Editor", content: div(...editorItems) },
        { name: "Note Recording", content: div(...recordingItems) },
      ],
      () => this.#doc.closePrompt(),
    );
    this.container = this.#prompt.container;

    this.#masterVolume.value = String(this.#doc.prefs.masterVolume);
    this.#layoutSelect.value = this.#doc.prefs.layout;
    this.#themeSelect.value = this.#doc.prefs.colorTheme;
    this.#layoutSelect.disabled = window.screen.availWidth < 710 || window.screen.availHeight < 710;
    this.#layoutSelect.addEventListener("change", this.#whenLayoutChanged);
    this.#themeSelect.addEventListener("change", this.#whenThemeChanged);
    this.#keyboardMode.value = this.#doc.prefs.pressControlForShortcuts ? "notes" : "shortcuts";
    this.#keyboardLayout.value = this.#doc.prefs.keyboardLayout;
    this.#ignoreScale.checked = this.#doc.prefs.ignorePerformedNotesNotInScale;
    this.#metronome.checked = this.#doc.prefs.metronomeWhileRecording;
    this.#countIn.checked = this.#doc.prefs.metronomeCountIn;
    this.#keyboardLayout.addEventListener("change", this.#renderKeyboardPreview);
    this.#masterVolume.addEventListener("input", this.#whenMasterVolumeChanged);
    this.#cacheButton.addEventListener("click", this.#toggleAssetCache);
    this.#renderCacheButton();
    this.#renderKeyboardPreview();
  }

  #renderCacheButton(): void {
    this.#cacheButton.textContent = "Reset cache";
  }

  #toggleAssetCache = async (): Promise<void> => {
    this.#cacheButton.disabled = true;
    try {
      this.#cacheButton.textContent = "Resetting...";
      this.#cacheButton.classList.add("assetCaching");
      await resetAssetCache();
      this.#doc.notifier.changed();
    } finally {
      this.#cacheButton.classList.remove("assetCaching");
      this.#cacheButton.disabled = false;
      this.#renderCacheButton();
    }
  };

  #makeRow(name: string, control: HTMLElement): HTMLDivElement {
    return div({ class: "preferenceRow" }, div(name), control);
  }

  #makeToggle(
    name: string,
    getValue: () => boolean,
    setValue: (value: boolean) => void,
  ): HTMLDivElement {
    const checkbox: HTMLInputElement = input({
      type: "checkbox",
      "aria-label": name,
    });
    checkbox.checked = getValue();
    const listener = (): void => {
      setValue(checkbox.checked);
      this.#doc.prefs.save();
      this.#doc.notifier.changed();
    };
    checkbox.addEventListener("change", listener);
    this.#checkboxListeners.push({ checkbox, listener });
    return this.#makeRow(name, checkbox);
  }

  #whenLayoutChanged = (): void => {
    this.#doc.prefs.layout = this.#layoutSelect.value;
    this.#doc.prefs.save();
    Layout.setLayout(this.#doc.prefs.layout);
    this.#doc.notifier.changed();
  };

  #whenThemeChanged = (): void => {
    this.#doc.prefs.colorTheme = this.#themeSelect.value;
    this.#doc.prefs.save();
    ColorConfig.setTheme(this.#doc.prefs.colorTheme);
    this.#doc.notifier.changed();
  };

  #whenMasterVolumeChanged = (): void => {
    this.#doc.setMasterVolume(Number(this.#masterVolume.value));
  };

  #renderKeyboardPreview = (): void => {
    this.#keyboardPreview.replaceChildren();
    const scale = Config.scales[this.#doc.song.scale]!.flags,
      compositionOffset: number = this.#doc.song.getChannelIsNoise(this.#doc.channel)
        ? 0
        : this.#doc.song.composingKey - this.#doc.song.key,
      keyBasePitch: number = Config.keys[this.#doc.song.key]!.basePitch;
    for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
      const row = div({ style: "display: flex;" });
      this.#keyboardPreview.append(row);
      row.append(div({ style: `width: ${rowIndex * 12}px; height: 20px;` }));
      for (let colIndex = 0; colIndex < [12, 12, 11, 10][rowIndex]!; colIndex++) {
        const key = div({
            style: "width: 20px; height: 20px; margin: 0 2px; text-align: center;",
          }),
          pitch = KeyboardLayout.keyPosToPitch(
            this.#doc,
            colIndex,
            3 - rowIndex,
            this.#keyboardLayout.value,
          );
        if (pitch != null) {
          const scaleIndex: number =
              (((pitch - compositionOffset) % Config.pitchesPerOctave) + Config.pitchesPerOctave) %
              Config.pitchesPerOctave,
            pitchNameIndex: number = (pitch + keyBasePitch) % Config.pitchesPerOctave;
          key.textContent = Piano.getPitchName(pitchNameIndex, scaleIndex);
          if (scale[scaleIndex]!) {
            key.style.background = ColorConfig.uiWidgetBackground;
          }
        }
        row.append(key);
      }
    }
  };

  public cleanUp = (): void => {
    this.#prompt.cleanUp();
    for (const toggle of this.#checkboxListeners) {
      toggle.checkbox.removeEventListener("change", toggle.listener);
    }
    this.#layoutSelect.removeEventListener("change", this.#whenLayoutChanged);
    this.#themeSelect.removeEventListener("change", this.#whenThemeChanged);
    this.#keyboardLayout.removeEventListener("change", this.#renderKeyboardPreview);
    this.#masterVolume.removeEventListener("input", this.#whenMasterVolumeChanged);
    this.#cacheButton.removeEventListener("click", this.#toggleAssetCache);
    this.#doc.prefs.pressControlForShortcuts = this.#keyboardMode.value === "notes";
    this.#doc.prefs.keyboardLayout = this.#keyboardLayout.value;
    this.#doc.prefs.ignorePerformedNotesNotInScale = this.#ignoreScale.checked;
    this.#doc.prefs.metronomeWhileRecording = this.#metronome.checked;
    this.#doc.prefs.metronomeCountIn = this.#countIn.checked;
    this.#doc.prefs.save();
  };
}
