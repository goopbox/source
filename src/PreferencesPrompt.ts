// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { Layout } from "./Layout.js";
import type { Prompt } from "./Prompt.js";
import { SongDocument } from "./SongDocument.js";
import { TabbedSearchablePrompt } from "./TabbedSearchablePrompt.js";
import { Config } from "../synth/SynthConfig.js";
import { ColorConfig } from "./ColorConfig.js";
import { ctrlSymbol } from "./EditorConfig.js";
import { KeyboardLayout } from "./KeyboardLayout.js";
import { Piano } from "./Piano.js";
import {
  disableAndDeleteAssetCache,
  enableAssetCache,
} from "../synth/AssetCache.js";
import { Preferences } from "./Preferences.js";

const { button, div, input, option, select } = HTML;

export class PreferencesPrompt implements Prompt {
  private readonly _prompt: TabbedSearchablePrompt;
  private readonly _toggleListeners: Array<{
    button: HTMLButtonElement;
    listener: () => void;
  }> = [];
  private readonly _layoutSelect: HTMLSelectElement = select(
    option({ value: "long" }, "Long"),
    option({ value: "tall" }, "Tall"),
  );
  private readonly _themeSelect: HTMLSelectElement = select(
    ...Object.keys(ColorConfig.themes).map((name) =>
      option({ value: name }, name),
    ),
  );
  private readonly _keyboardMode = select(
    option({ value: "notes" }, "Play notes, " + ctrlSymbol + "shortcuts"),
    option({ value: "shortcuts" }, "Simple shortcuts"),
  );
  private readonly _keyboardLayout = select(
    option({ value: "wickiHayden" }, "Wicki-Hayden"),
    option({ value: "songScale" }, "Song scale"),
    option({ value: "pianoAtC" }, "Piano (C)"),
    option({ value: "pianoAtA" }, "Piano (A)"),
    option({ value: "pianoTransposingC" }, "Transposing piano (C)"),
    option({ value: "pianoTransposingA" }, "Transposing piano (A)"),
  );
  private readonly _keyboardPreview = div({
    style:
      "display: grid; justify-items: center; row-gap: 4px; margin: 4px auto; font-size: 10px;",
  });
  private readonly _ignoreScale = input({ type: "checkbox" });
  private readonly _metronome = input({ type: "checkbox" });
  private readonly _countIn = input({ type: "checkbox" });
  private readonly _masterVolume = input({
    type: "range",
    min: "0",
    max: String(Preferences.maxMasterVolume),
    step: "1",
    title: "Master volume",
    "aria-label": "Master volume",
  });
  private readonly _cacheButton: HTMLButtonElement = button({ type: "button" });
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  constructor(private readonly _doc: SongDocument) {
    const pianoRollItems: HTMLElement[] = [
      this._makeToggle(
        "Follow playhead",
        () => this._doc.prefs.autoFollow,
        (value) => {
          this._doc.prefs.autoFollow = value;
        },
      ),
      this._makeToggle(
        "Place notes out of scale",
        () => this._doc.prefs.notesOutsideScale,
        (value) => {
          this._doc.prefs.notesOutsideScale = value;
        },
      ),
      this._makeToggle(
        "Remember scale choice",
        () => this._doc.prefs.rememberScaleChoice,
        (value) => {
          this._doc.prefs.rememberScaleChoice = value;
          if (value) this._doc.prefs.defaultScale = this._doc.song.scale;
        },
      ),
    ];
    const editorItems: HTMLElement[] = [
      this._makeRow("Master volume", this._masterVolume),
      this._makeRow("Layout", this._layoutSelect),
      this._makeRow("Theme", this._themeSelect),
      this._makeRow("Cache", this._cacheButton),
    ];
    const recordingItems: HTMLElement[] = [
      this._makeRow("Keyboard", this._keyboardLayout),
      this._keyboardPreview,
      this._makeRow("Keyboard behavior", this._keyboardMode),
      this._makeRow("Scale only", this._ignoreScale),
      this._makeRow("Metronome", this._metronome),
      this._makeRow("Count in", this._countIn),
    ];

    this._prompt = new TabbedSearchablePrompt(
      "Preferences",
      [
        { name: "Piano Roll", content: div(...pianoRollItems) },
        { name: "Editor", content: div(...editorItems) },
        { name: "Note Recording", content: div(...recordingItems) },
      ],
      () => this._doc.closePrompt(),
    );
    this.container = this._prompt.container;

    this._masterVolume.value = String(this._doc.prefs.masterVolume);
    this._layoutSelect.value = this._doc.prefs.layout;
    this._themeSelect.value = this._doc.prefs.colorTheme;
    this._layoutSelect.disabled =
      window.screen.availWidth < 710 || window.screen.availHeight < 710;
    this._layoutSelect.addEventListener("change", this._whenLayoutChanged);
    this._themeSelect.addEventListener("change", this._whenThemeChanged);
    this._keyboardMode.value = this._doc.prefs.pressControlForShortcuts
      ? "notes"
      : "shortcuts";
    this._keyboardLayout.value = this._doc.prefs.keyboardLayout;
    this._ignoreScale.checked = this._doc.prefs.ignorePerformedNotesNotInScale;
    this._metronome.checked = this._doc.prefs.metronomeWhileRecording;
    this._countIn.checked = this._doc.prefs.metronomeCountIn;
    this._keyboardLayout.addEventListener(
      "change",
      this._renderKeyboardPreview,
    );
    this._masterVolume.addEventListener("input", this._whenMasterVolumeChanged);
    this._cacheButton.addEventListener("click", this._toggleAssetCache);
    this._renderCacheButton();
    this._renderKeyboardPreview();
  }

  private _renderCacheButton(): void {
    this._cacheButton.textContent = this._doc.prefs.assetCacheEnabled
      ? "Disable and delete cache"
      : "Cache assets automatically";
  }

  private _toggleAssetCache = async (): Promise<void> => {
    this._cacheButton.disabled = true;
    try {
      if (this._doc.prefs.assetCacheEnabled) {
        this._doc.prefs.assetCacheEnabled = false;
        this._doc.prefs.save();
        await disableAndDeleteAssetCache();
      } else {
        this._doc.prefs.assetCacheEnabled = true;
        this._doc.prefs.save();
        this._cacheButton.textContent = "Caching...";
        this._cacheButton.classList.add("assetCaching");
        await enableAssetCache();
      }
      this._doc.notifier.changed();
    } finally {
      this._cacheButton.classList.remove("assetCaching");
      this._cacheButton.disabled = false;
      this._renderCacheButton();
    }
  };

  private _makeRow(name: string, control: HTMLElement): HTMLDivElement {
    return div({ class: "preferenceRow" }, div(name), control);
  }

  private _makeToggle(
    name: string,
    getValue: () => boolean,
    setValue: (value: boolean) => void,
  ): HTMLDivElement {
    const toggle: HTMLButtonElement = button({
      class: "preferenceToggle",
      type: "button",
    });
    const render = (): void => {
      const value: boolean = getValue();
      toggle.textContent = value ? "✔" : "✘";
      toggle.classList.toggle("enabled", value);
      toggle.setAttribute("aria-pressed", String(value));
      toggle.setAttribute("aria-label", `${name}: ${value ? "on" : "off"}`);
    };
    const listener = (): void => {
      setValue(!getValue());
      this._doc.prefs.save();
      this._doc.notifier.changed();
      render();
    };
    toggle.addEventListener("click", listener);
    this._toggleListeners.push({ button: toggle, listener });
    render();
    return this._makeRow(name, toggle);
  }

  private _whenLayoutChanged = (): void => {
    this._doc.prefs.layout = this._layoutSelect.value;
    this._doc.prefs.save();
    Layout.setLayout(this._doc.prefs.layout);
    this._doc.notifier.changed();
  };

  private _whenThemeChanged = (): void => {
    this._doc.prefs.colorTheme = this._themeSelect.value;
    this._doc.prefs.save();
    ColorConfig.setTheme(this._doc.prefs.colorTheme);
    this._doc.notifier.changed();
  };

  private _whenMasterVolumeChanged = (): void => {
    this._doc.setMasterVolume(Number(this._masterVolume.value));
  };

  private _renderKeyboardPreview = (): void => {
    this._keyboardPreview.replaceChildren();
    const scale = Config.scales[this._doc.song.scale].flags;
    const compositionOffset: number = this._doc.song.getChannelIsNoise(
      this._doc.channel,
    )
      ? 0
      : this._doc.song.composingKey - this._doc.song.key;
    const keyBasePitch: number = Config.keys[this._doc.song.key].basePitch;
    for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
      const row = div({ style: "display: flex;" });
      this._keyboardPreview.appendChild(row);
      row.appendChild(
        div({ style: `width: ${rowIndex * 12}px; height: 20px;` }),
      );
      for (
        let colIndex = 0;
        colIndex < [12, 12, 11, 10][rowIndex];
        colIndex++
      ) {
        const key = div({
          style:
            "width: 20px; height: 20px; margin: 0 2px; text-align: center;",
        });
        const pitch = KeyboardLayout.keyPosToPitch(
          this._doc,
          colIndex,
          3 - rowIndex,
          this._keyboardLayout.value,
        );
        if (pitch != null) {
          const scaleIndex: number =
            (((pitch - compositionOffset) % Config.pitchesPerOctave) +
              Config.pitchesPerOctave) %
            Config.pitchesPerOctave;
          const pitchNameIndex: number =
            (pitch + keyBasePitch) % Config.pitchesPerOctave;
          key.textContent = Piano.getPitchName(pitchNameIndex, scaleIndex);
          if (scale[scaleIndex])
            key.style.background = ColorConfig.uiWidgetBackground;
        }
        row.appendChild(key);
      }
    }
  };

  public cleanUp = (): void => {
    this._prompt.cleanUp();
    for (const toggle of this._toggleListeners)
      toggle.button.removeEventListener("click", toggle.listener);
    this._layoutSelect.removeEventListener("change", this._whenLayoutChanged);
    this._themeSelect.removeEventListener("change", this._whenThemeChanged);
    this._keyboardLayout.removeEventListener(
      "change",
      this._renderKeyboardPreview,
    );
    this._masterVolume.removeEventListener(
      "input",
      this._whenMasterVolumeChanged,
    );
    this._cacheButton.removeEventListener("click", this._toggleAssetCache);
    this._doc.prefs.pressControlForShortcuts =
      this._keyboardMode.value == "notes";
    this._doc.prefs.keyboardLayout = this._keyboardLayout.value;
    this._doc.prefs.ignorePerformedNotesNotInScale = this._ignoreScale.checked;
    this._doc.prefs.metronomeWhileRecording = this._metronome.checked;
    this._doc.prefs.metronomeCountIn = this._countIn.checked;
    this._doc.prefs.save();
  };
}
