// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// Imported here for the sake of ensuring this code is transpiled early.
import "./layout.js";
import { AutomationEditor, AutomationSettings } from "./automation-editor.js";
import {
  ChangeAddChannelInstrument,
  ChangeAddEnvelope,
  ChangeAlgorithm,
  ChangeBarCount,
  ChangeBeatsPerBar,
  ChangeBitcrusherFreq,
  ChangeBitcrusherQuantization,
  ChangeChannelCount,
  ChangeChipWave,
  ChangeChipWavePitch,
  ChangeChipWaveTempo,
  ChangeChord,
  ChangeChorus,
  ChangeComposingKey,
  ChangeDetectComposingKey,
  ChangeDetune,
  ChangeDistortion,
  ChangeDrumsetEnvelope,
  ChangeDrumsetEnvelopeParameter,
  ChangeEchoDelay,
  ChangeEchoSustain,
  ChangeFeedbackAmplitude,
  ChangeFeedbackType,
  ChangeKey,
  ChangeNoiseWave,
  ChangeOperatorAmplitude,
  ChangeOperatorFrequency,
  ChangeOperatorWave,
  ChangePan,
  ChangePasteInstrument,
  ChangePatternSelection,
  ChangePatternsPerChannel,
  ChangePitchShift,
  ChangePreset,
  ChangePulseWidth,
  ChangeRandomGeneratedInstrument,
  ChangeRectifyPatterns,
  ChangeRemoveChannelInstrument,
  ChangeReverb,
  ChangeRhythm,
  ChangeSamplePresetSelection,
  ChangeScale,
  ChangeSong,
  ChangeSoundFont,
  ChangeSoundFontPreset,
  ChangeSoundFontPresetSelection,
  ChangeStringSustain,
  ChangeSupersawDynamism,
  ChangeSupersawShape,
  ChangeSupersawSpread,
  ChangeTempo,
  ChangeToggleEffects,
  ChangeTransition,
  ChangeUnison,
  ChangeVibrato,
  ChangeVolume,
  getRandomPresetValues,
} from "./changes.js";
import { type Channel, EnvelopeSettings, Instrument, Synth } from "../synth/synth.js";
import { type ChannelColors, ColorConfig } from "./color-config.js";
import {
  Config,
  InstrumentType,
  effectsIncludeBitcrusher,
  effectsIncludeChord,
  effectsIncludeChorus,
  effectsIncludeDetune,
  effectsIncludeDistortion,
  effectsIncludeEcho,
  effectsIncludeEqFilter,
  effectsIncludeNoteFilter,
  effectsIncludePitchShift,
  effectsIncludeReverb,
  effectsIncludeTransition,
  effectsIncludeUnison,
  effectsIncludeVibrato,
  getPulseWidthRatio,
} from "../synth/synth-config.js";
import { EasyPointers, activeModifierKeys, getElementDimensions } from "./easy-pointers.js";
import {
  EditorConfig,
  type Preset,
  type PresetCategory,
  ctrlSymbol,
  prettyNumber,
} from "./editor-config.js";
import { EnvelopeEditor, EnvelopeParameterEditor } from "./envelope-editor.js";
import {
  InstrumentPresetPrompt,
  type SamplePresetInfo,
  type SoundFontPresetGroup,
} from "./instrument-preset-prompt.js";
import {
  type InstrumentSettingsCategory,
  copyInstrumentSettingsCategory,
  isInstrumentSettingsCategoryCopy,
  pasteInstrumentSettingsCategory,
} from "./instrument-settings-category.js";
import { type Prompt, mountPrompt, unmountPrompt } from "./prompt.js";
import { panPercentToSetting, panSettingToPercent } from "./pan-conversion.js";
import { AboutPrompt } from "./about-prompt.js";
import { AssetsPrompt } from "./assets-prompt.js";
import { BarScrollBar } from "./bar-scroll-bar.js";
import { BeatsPerBarPrompt } from "./beats-per-bar-prompt.js";
import type { Change } from "./change.js";
import { ChannelRow } from "./channel-row.js";
import { ChipWaveLoopPrompt } from "./chip-wave-loop-prompt.js";
import { ExportPrompt } from "./export-prompt.js";
import { FadeInOutEditor } from "./fade-in-out-editor.js";
import { FilterEditor } from "./filter-editor.js";
import { FlpInstrumentPrompt } from "./flp-instrument-prompt.js";
import type { FlpSongImport } from "./flp-import.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { HarmonicsEditor } from "./harmonics-editor.js";
import { ImportFile } from "./import.js";
import { InstrumentSettings } from "./instrument-settings.js";
import { InstrumentTypePrompt } from "./instrument-type-prompt.js";
import { KeyboardLayout } from "./keyboard-layout.js";
import { LoopEditor } from "./loop-editor.js";
import { MoveNotesSidewaysPrompt } from "./move-notes-sideways-prompt.js";
import { MuteEditor } from "./mute-editor.js";
import { OctaveScrollBar } from "./octave-scroll-bar.js";
import { PatternEditor } from "./pattern-editor.js";
import { Piano } from "./piano.js";
import type { Preferences } from "./preferences.js";
import { PreferencesPrompt } from "./preferences-prompt.js";
import { SongDocument } from "./song-document.js";
import { SongRecoveryPrompt } from "./song-recovery-prompt.js";
import { SpectrumEditor } from "./spectrum-editor.js";
import { SustainPrompt } from "./sustain-prompt.js";
import { TrackEditor } from "./track-editor.js";
import { encodeSongUrl } from "./song-url.js";

const { button, div, input, label, select, span, optgroup, option } = HTML;

function buildOptions(
  menu: HTMLSelectElement,
  items: readonly (string | number)[],
): HTMLSelectElement {
  for (let index = 0; index < items.length; index++) {
    menu.append(option({ value: index }, items[index]!));
  }
  return menu;
}

function buildPresetOptions(isNoise: boolean): HTMLSelectElement {
  const menu: HTMLSelectElement = select();

  menu.append(
    optgroup(
      { label: "Random" },
      option({ value: "copyInstrument" }, "Copy Instrument (⇧C)"),
      option({ value: "pasteInstrument" }, "Paste Instrument (⇧V)"),
      option({ value: "randomPreset" }, "Preset (R)"),
      option({ value: "randomGenerated" }, "Generated (⇧R)"),
    ),
  );

  // Show the "spectrum" custom type in both pitched and noise channels.
  const customTypeGroup: HTMLElement = optgroup({
    label: EditorConfig.presetCategories[0]!.name,
  });
  if (isNoise) {
    customTypeGroup.append(
      option(
        { value: InstrumentType.noise },
        EditorConfig.valueToPreset(InstrumentType.noise)!.name,
      ),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.spectrum },
        EditorConfig.valueToPreset(InstrumentType.spectrum)!.name,
      ),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.drumset },
        EditorConfig.valueToPreset(InstrumentType.drumset)!.name,
      ),
    );
  } else {
    customTypeGroup.append(
      option({ value: InstrumentType.chip }, EditorConfig.valueToPreset(InstrumentType.chip)!.name),
    );
    customTypeGroup.append(
      option({ value: InstrumentType.pwm }, EditorConfig.valueToPreset(InstrumentType.pwm)!.name),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.supersaw },
        EditorConfig.valueToPreset(InstrumentType.supersaw)!.name,
      ),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.harmonics },
        EditorConfig.valueToPreset(InstrumentType.harmonics)!.name,
      ),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.pickedString },
        EditorConfig.valueToPreset(InstrumentType.pickedString)!.name,
      ),
    );
    customTypeGroup.append(
      option(
        { value: InstrumentType.spectrum },
        EditorConfig.valueToPreset(InstrumentType.spectrum)!.name,
      ),
    );
    customTypeGroup.append(
      option({ value: InstrumentType.fm }, EditorConfig.valueToPreset(InstrumentType.fm)!.name),
    );
  }
  menu.append(customTypeGroup);

  for (
    let categoryIndex = 1;
    categoryIndex < EditorConfig.presetCategories.length;
    categoryIndex++
  ) {
    const category: PresetCategory = EditorConfig.presetCategories[categoryIndex]!,
      group: HTMLElement = optgroup({ label: category.name });
    let foundAny = false;
    for (let presetIndex = 0; presetIndex < category.presets.length; presetIndex++) {
      const preset: Preset = category.presets[presetIndex]!;
      if ((preset.isNoise === true) === isNoise) {
        group.append(option({ value: (categoryIndex << 6) + presetIndex }, preset.name));
        foundAny = true;
      }
    }
    if (foundAny) {
      menu.append(group);
    }
  }
  return menu;
}

function setSelectedValue(menu: HTMLSelectElement, value: number): void {
  const stringValue = value.toString();
  if (menu.value !== stringValue) {
    menu.value = stringValue;
  }
}

class Slider {
  readonly #doc: SongDocument;
  readonly #getChange: (oldValue: number, newValue: number) => Change | null;
  public container: HTMLSpanElement;
  #change: Change | null = null;
  #value = 0;
  #oldValue = 0;

  public readonly input: HTMLInputElement;

  public constructor(
    element: HTMLInputElement,
    _doc: SongDocument,
    _getChange: (oldValue: number, newValue: number) => Change | null,
  ) {
    this.#doc = _doc;
    this.#getChange = _getChange;
    this.input = element;
    element.addEventListener("input", this.#onInput);
    element.addEventListener("change", this.#onChange);

    // Touch screens update the slider value as soon as you touch the slider,
    // But also allow scrolling by vertically dragging from the slider, which
    // Can result in both the slider changing and the screen scrolling from
    // The same gesture, which feels bad. Unfortunately, calling
    // PreventDefault() in the pointerdown listener does not prevent changing
    // The slider value on touchscreens, so we need to completely bypass
    // Touching the slider. This code prevents the initial slider change and
    // Reimplements it if the pointer will not scroll.
    element.style.pointerEvents = "none";
    this.container = span(element, {
      style: "touch-action: pan-y; display: flex; cursor: pointer;",
    });
    this.container.title = element.title;
    new EasyPointers(this.container);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
  }

  #setFromPointer(event: PointerEvent): void {
    const { x } = event.pointer!.getPointIn(this.input, "contentBox"),
      dimensions = getElementDimensions(this.input, "contentBox"),
      thumbWidth = 6, // Slider thumbs are styled with a width of 6 pixels.
      ratio = (x - thumbWidth / 2) / (dimensions.width - thumbWidth),
      step = Number.parseFloat(this.input.step);
    let min = Number.parseFloat(this.input.min),
      max = Number.parseFloat(this.input.max);
    if (!isFinite(min)) {
      min = 0;
    }
    if (!isFinite(max)) {
      max = 100;
    }
    const unquantizedValue: number = (max - min) * ratio + min,
      value = Math.max(
        min,
        Math.min(
          max,
          Number.isFinite(step)
            ? Math.round((unquantizedValue - min) / step) * step + min
            : unquantizedValue,
        ),
      );
    this.input.value = String(value);
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#setFromPointer(event);
    this.input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
      }),
    );
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (event.pointer!.isDown) {
      this.#setFromPointer(event);
      this.input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
        }),
      );
    }
  };

  #onPointerUp = (event: PointerEvent): void => {
    this.#setFromPointer(event);
    this.input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
      }),
    );
    this.input.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: false, composed: true }),
    );
  };

  public updateValue(value: number): void {
    this.#value = value;
    this.input.value = String(value);
  }

  #onInput = (): void => {
    const continuingProspectiveChange: boolean = this.#doc.lastChangeWas(this.#change);
    if (!continuingProspectiveChange) {
      this.#oldValue = this.#value;
    }
    this.#change = this.#getChange(this.#oldValue, Number.parseFloat(this.input.value));
    if (this.#change) {
      this.#doc.setProspectiveChange(this.#change);
    }
  };

  #onChange = (): void => {
    if (this.#change) {
      this.#doc.record(this.#change);
    }
    this.#change = null;
  };
}

class NumberInput {
  readonly #doc: SongDocument;
  readonly #getChange: (oldValue: number, newValue: number) => Change | null;
  #change: Change | null = null;
  #value = 0;
  #oldValue = 0;

  public readonly input: HTMLInputElement;

  public constructor(
    element: HTMLInputElement,
    _doc: SongDocument,
    _getChange: (oldValue: number, newValue: number) => Change | null,
  ) {
    this.#doc = _doc;
    this.#getChange = _getChange;
    this.input = element;
    element.addEventListener("input", this.#onInput);
    element.addEventListener("change", this.#onChange);
  }

  public updateValue(value: number): void {
    this.#value = value;
    if (document.activeElement !== this.input) {
      this.input.value = String(value);
    }
  }

  #onInput = (): void => {
    let value: number = this.input.valueAsNumber;
    if (!Number.isFinite(value)) {
      return;
    }
    if (this.input.min !== "") {
      value = Math.max(Number(this.input.min), value);
    }
    if (this.input.max !== "") {
      value = Math.min(Number(this.input.max), value);
    }
    if (value !== this.input.valueAsNumber) {
      this.input.value = String(value);
    }

    const continuingProspectiveChange: boolean = this.#doc.lastChangeWas(this.#change);
    if (!continuingProspectiveChange) {
      this.#oldValue = this.#value;
    }
    this.#change = this.#getChange(this.#oldValue, value);
    if (this.#change) {
      this.#doc.setProspectiveChange(this.#change);
    }
  };

  #onChange = (): void => {
    if (!Number.isFinite(this.input.valueAsNumber)) {
      this.input.value = String(this.#value);
    }
    if (this.#change) {
      this.#doc.record(this.#change);
    }
    this.#change = null;
  };
}

class EffectSlider {
  readonly #min: number;
  readonly #max: number;
  readonly #displayMin: number;
  readonly #displayMax: number;
  readonly #toDisplayValue: ((value: number) => number) | null;
  readonly #fromDisplayValue: ((value: number) => number) | null;
  public readonly container: HTMLSpanElement;
  readonly #slider: Slider;
  readonly #textInput: NumberInput;

  public constructor(
    doc: SongDocument,
    _min: number,
    _max: number,
    getChange: (oldValue: number, newValue: number) => Change | null,
    _displayMin = 0,
    _displayMax = 100,
    _toDisplayValue: ((value: number) => number) | null = null,
    _fromDisplayValue: ((value: number) => number) | null = null,
    sliderStep: number | "any" = "any",
    textInputMin: number | null = null,
    textInputMax: number | null = null,
  ) {
    this.#min = _min;
    this.#max = _max;
    this.#displayMin = _displayMin;
    this.#displayMax = _displayMax;
    this.#toDisplayValue = _toDisplayValue;
    this.#fromDisplayValue = _fromDisplayValue;
    const textInputAttributes: Record<string, string> = {
      class: "instrument-value-input",
      type: "number",
      step: "any",
      value: "0",
    };
    if (textInputMin != null) {
      textInputAttributes["min"] = String(textInputMin);
    }
    if (textInputMax != null) {
      textInputAttributes["max"] = String(textInputMax);
    }
    this.#textInput = new NumberInput(
      input(textInputAttributes),
      doc,
      (oldDisplayValue: number, newDisplayValue: number) =>
        getChange(this.#fromDisplay(oldDisplayValue), this.#fromDisplay(newDisplayValue)),
    );
    this.#slider = new Slider(
      input({
        type: "range",
        min: String(this.#displayMin),
        max: String(this.#displayMax),
        value: "0",
        step: String(sliderStep),
      }),
      doc,
      (oldDisplayValue: number, newDisplayValue: number) => {
        this.#textInput.updateValue(newDisplayValue);
        return getChange(this.#fromDisplay(oldDisplayValue), this.#fromDisplay(newDisplayValue));
      },
    );
    this.container = span(
      { class: "slider-with-input" },
      this.#slider.container,
      this.#textInput.input,
    );
  }

  public updateValue(value: number): void {
    const displayValue: number = this.#toDisplay(value);
    this.#slider.updateValue(displayValue);
    this.#textInput.updateValue(Number(EffectSlider.#format(displayValue)));
  }

  #toDisplay(value: number): number {
    if (this.#toDisplayValue != null) {
      return this.#toDisplayValue(value);
    }
    return (
      this.#displayMin +
      ((value - this.#min) * (this.#displayMax - this.#displayMin)) / (this.#max - this.#min)
    );
  }

  #fromDisplay(value: number): number {
    if (this.#fromDisplayValue != null) {
      return this.#fromDisplayValue(value);
    }
    return (
      this.#min +
      ((value - this.#displayMin) * (this.#max - this.#min)) / (this.#displayMax - this.#displayMin)
    );
  }

  static #format(value: number): string {
    return String(Number.parseFloat(value.toFixed(6)));
  }
}

class ChipWaveEditor {
  readonly #doc: SongDocument;
  readonly #includeSine: boolean;
  readonly #operatorIndex: number | null;
  public readonly select: HTMLSelectElement = select({ title: "Waveform" });
  public readonly waveRow: HTMLDivElement;
  public readonly container: HTMLDivElement;
  readonly #loopButton: HTMLButtonElement = button(
    { type: "button", class: "chip-wave-loop-button" },
    "Loop controls",
  );
  readonly #pitchSlider: EffectSlider;
  readonly #tempoSlider: EffectSlider;

  public constructor(
    _doc: SongDocument,
    _includeSine: boolean,
    _operatorIndex: number | null,
    getWaveChange: (newValue: number) => Change,
    openLoopPrompt: () => void,
    assetSelect = false,
  ) {
    this.#doc = _doc;
    this.#includeSine = _includeSine;
    this.#operatorIndex = _operatorIndex;
    this.#pitchSlider = new EffectSlider(
      _doc,
      25,
      400,
      (oldValue: number, newValue: number) =>
        new ChangeChipWavePitch(_doc, this.#operatorIndex, oldValue, newValue),
      25,
      400,
    );
    this.#tempoSlider = new EffectSlider(
      _doc,
      25,
      400,
      (oldValue: number, newValue: number) =>
        new ChangeChipWaveTempo(_doc, this.#operatorIndex, oldValue, newValue),
      25,
      400,
    );
    this.waveRow = div(
      {
        class: `selectRow instrument-unlabeled-control${
          assetSelect ? " asset-select-control" : ""
        }`,
      },
      this.select,
    );
    this.container = div(
      { class: "editor-controls" },
      this.waveRow,
      div({ class: "selectRow instrument-unlabeled-control" }, this.#loopButton),
      div({ class: "selectRow" }, label("Pitch %"), this.#pitchSlider.container),
      div({ class: "selectRow" }, label("Tempo %"), this.#tempoSlider.container),
    );
    this.syncOptions();
    this.select.addEventListener("change", () => {
      this.#doc.record(getWaveChange(this.select.selectedIndex));
    });
    this.#loopButton.addEventListener("click", openLoopPrompt);
  }

  public syncOptions(): void {
    const names: string[] = Config.chipWaves.map((wave) => wave.name);
    if (this.#includeSine) {
      names.unshift("sine");
    }
    if (
      this.select.options.length === names.length &&
      names.every(
        (name: string, index: number): boolean => this.select.options[index]!.textContent === name,
      )
    ) {
      return;
    }
    this.select.replaceChildren();
    buildOptions(this.select, names);
  }

  public render(wave: number, pitch: number, tempo: number): void {
    setSelectedValue(this.select, wave);
    const chipWaveIndex: number = this.#includeSine ? wave - 1 : wave,
      sampleBacked: boolean = Config.chipWaves[chipWaveIndex]?.sampleId !== undefined;
    this.#loopButton.disabled = !sampleBacked;
    this.#loopButton.title = sampleBacked
      ? "Edit sample offset and loop"
      : "Loop controls are available for sample assets";
    this.#pitchSlider.updateValue(pitch);
    this.#tempoSlider.updateValue(tempo);
  }
}

export class SongEditor {
  public readonly doc: SongDocument = new SongDocument();
  public prompt: Prompt | null = null;
  #activeEditor: "pattern" | "track" = "pattern";
  #pendingFlpImport: {
    imported: FlpSongImport;
    apply: () => void;
  } | null = null;
  readonly #importFile = new ImportFile(
    this.doc,
    (imported: FlpSongImport, apply: () => void): void => {
      this.#pendingFlpImport = { imported, apply };
      this.#openPrompt("flpInstruments");
    },
  );

  readonly #keyboardLayout: KeyboardLayout = new KeyboardLayout(this.doc);
  readonly #patternEditorPrev: PatternEditor = new PatternEditor(this.doc, false, -1);
  readonly #patternEditor: PatternEditor = new PatternEditor(this.doc, true, 0);
  readonly #patternEditorNext: PatternEditor = new PatternEditor(this.doc, false, 1);
  readonly #automationEditorPrev: AutomationEditor = new AutomationEditor(this.doc, false, -1);
  readonly #automationEditor: AutomationEditor = new AutomationEditor(this.doc, true, 0);
  readonly #automationEditorNext: AutomationEditor = new AutomationEditor(this.doc, false, 1);
  readonly #automationSettings: AutomationSettings = new AutomationSettings(this.doc);
  readonly #muteEditor: MuteEditor = new MuteEditor(this.doc);
  readonly #trackEditor: TrackEditor = new TrackEditor(this.doc);
  readonly #loopEditor: LoopEditor = new LoopEditor(this.doc);
  readonly #octaveScrollBar: OctaveScrollBar = new OctaveScrollBar(this.doc);
  readonly #piano: Piano = new Piano(this.doc);
  readonly #playButton: HTMLButtonElement = button(
    { class: "playButton", type: "button", title: "Play (Space)" },
    span("Play"),
  );
  readonly #pauseButton: HTMLButtonElement = button(
    {
      class: "pauseButton",
      style: "display: none;",
      type: "button",
      title: "Pause (Space)",
    },
    "Pause",
  );
  readonly #recordButton: HTMLButtonElement = button(
    {
      class: "recordButton",
      style: "display: none;",
      type: "button",
      title: "Record (Ctrl+Space)",
    },
    span("Record"),
  );
  readonly #stopButton: HTMLButtonElement = button(
    {
      class: "stopButton",
      style: "display: none;",
      type: "button",
      title: "Stop Recording (Space)",
    },
    "Stop Recording",
  );
  readonly #prevBarButton: HTMLButtonElement = button({
    class: "prevBarButton",
    type: "button",
    title: "Previous Bar (left bracket)",
  });
  readonly #nextBarButton: HTMLButtonElement = button({
    class: "nextBarButton",
    type: "button",
    title: "Next Bar (right bracket)",
  });
  readonly #fileMenu: HTMLSelectElement = select(
    { class: "menu", style: "width: 100%;" },
    option({ selected: true, disabled: true, hidden: true }, "File"),
    option({ value: "new" }, "+ New"),
    option({ value: "import" }, `↑ Import (${ctrlSymbol}O)`),
    option({ value: "export" }, `↓ Export (${ctrlSymbol}S)`),
    option({ value: "shareUrl" }, "⎘ Share URL"),
    option({ value: "songRecovery" }, "⚠ Recover"),
  );
  readonly #editMenu: HTMLSelectElement = select(
    { class: "menu", style: "width: 100%;" },
    option({ selected: true, disabled: true, hidden: true }, "Edit"),
    option({ value: "undo" }, "Undo (Z)"),
    option({ value: "redo" }, "Redo (Y)"),
    option({ value: "copy" }, "Copy Pattern (C)"),
    option({ value: "cut" }, "Cut Pattern (X)"),
    option({ value: "pasteNotes" }, "Paste Pattern Notes (V)"),
    option({ value: "pasteNumbers" }, `Paste Pattern Numbers (${ctrlSymbol}⇧V)`),
    option({ value: "insertBars" }, "Insert Bar (⏎)"),
    option({ value: "deleteBars" }, "Delete Selected Bars (⌫)"),
    option({ value: "insertChannel" }, `Insert Channel (${ctrlSymbol}⏎)`),
    option({ value: "deleteChannel" }, `Delete Selected Channels (${ctrlSymbol}⌫)`),
    option({ value: "selectAll" }, "Select All (A)"),
    option({ value: "selectChannel" }, "Select Channel (⇧A)"),
    option({ value: "duplicatePatterns" }, "Duplicate Reused Patterns (D)"),
    option({ value: "rectifyPatterns" }, `Rectify Patterns (${ctrlSymbol}⇧D)`),
    option({ value: "transposeUp" }, "Move Notes Up (+ or ⇧+)"),
    option({ value: "transposeDown" }, "Move Notes Down (- or ⇧-)"),
    option({ value: "moveNotesSideways" }, "Move All Notes Sideways"),
    option({ value: "beatsPerBar" }, "Change Beats Per Bar..."),
    option({ value: "assets" }, "Add Assets (⇧Q)"),
  );
  readonly #preferencesButton: HTMLButtonElement = button(
    { class: "menu preferences", type: "button" },
    "Preferences",
  );
  readonly #aboutButton: HTMLButtonElement = button(
    { class: "menu about", type: "button" },
    "About",
  );
  readonly #scaleSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.scales.map((scale) => scale.name),
  );
  readonly #keySelect: HTMLSelectElement = buildOptions(
    select(),
    Config.keys.map((key) => key.name).reverse(),
  );
  readonly #legacyKeySelect: HTMLSelectElement = buildOptions(
    select(),
    Config.keys.map((key) => key.name).reverse(),
  );
  readonly #legacyKeyButton: HTMLButtonElement = button(
    {
      class: "reveal-arrow",
      type: "button",
      title: "Show legacy transposition key",
      "aria-label": "Show legacy transposition key",
    },
    "▾",
  );
  readonly #legacyKeyRow: HTMLDivElement = div(
    { class: "selectRow", style: "display: none;" },
    label("Legacy"),
    this.#legacyKeySelect,
  );
  #showLegacyKey = false;
  readonly #tempoSlider: Slider = new Slider(
    input({
      style: "width: 4em; flex-grow: 1; vertical-align: middle;",
      type: "range",
      min: "0",
      max: "14",
      value: "7",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeTempo(this.doc, oldValue, Math.round(120.0 * 2.0 ** ((-4.0 + newValue) / 9.0))),
  );
  readonly #tempoStepper: HTMLInputElement = input({
    style: "width: 4.5em; vertical-align: middle;",
    type: "number",
    step: "1",
  });
  readonly #chorusSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.chorusRange - 1,
    (oldValue: number, newValue: number) => new ChangeChorus(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    100,
  );
  readonly #chorusRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Chorus"),
    this.#chorusSlider.container,
  );
  readonly #reverbSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.reverbRange - 1,
    (oldValue: number, newValue: number) => new ChangeReverb(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    (100 * Config.reverbRange) / (Config.reverbRange - 1),
  );
  readonly #reverbRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Reverb"),
    this.#reverbSlider.container,
  );
  readonly #echoSustainSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    (Config.echoSustainRange - 1) * 2,
    (oldValue: number, newValue: number) => new ChangeEchoSustain(this.doc, oldValue, newValue),
    0,
    200,
    null,
    null,
    "any",
    0,
    200,
  );
  readonly #echoSustainRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Echo"),
    this.#echoSustainSlider.container,
  );
  readonly #echoDelaySlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.echoDelayRange - 1,
    (oldValue: number, newValue: number) => new ChangeEchoDelay(this.doc, oldValue, newValue),
    0.25,
    2,
    (value: number) => this.#echoDelayToBeats(value),
    (value: number) => this.#echoDelayFromBeats(value),
    0.25,
  );
  readonly #echoDelayRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Echo Delay"),
    this.#echoDelaySlider.container,
  );
  readonly #rhythmSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.rhythms.map((rhythm) => rhythm.name),
  );
  readonly #beatsPerBarStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.beatsPerBarMin,
    max: Config.beatsPerBarMax,
    step: "1",
  });
  readonly #songLengthStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.barCountMin,
    max: Config.barCountMax,
    step: "1",
  });
  readonly #pitchChannelsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.pitchChannelCountMin,
    max: Config.pitchChannelCountMax,
    step: "1",
  });
  readonly #drumChannelsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.noiseChannelCountMin,
    max: Config.noiseChannelCountMax,
    step: "1",
  });
  readonly #automationChannelsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.automationChannelCountMin,
    max: Config.automationChannelCountMax,
    step: "1",
  });
  readonly #maxPatternsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: "1",
    max: Config.barCountMax,
    step: "1",
  });
  readonly #pitchedPresetSelect: HTMLSelectElement = buildPresetOptions(false);
  readonly #drumPresetSelect: HTMLSelectElement = buildPresetOptions(true);
  readonly #algorithmSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.algorithms.map((algorithm) => algorithm.name),
  );
  readonly #algorithmSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#algorithmSelect,
  );
  readonly #instrumentButtons: HTMLButtonElement[] = [];
  readonly #instrumentAddButton: HTMLButtonElement = button({
    type: "button",
    class: "add-instrument last-button",
  });
  readonly #instrumentRemoveButton: HTMLButtonElement = button({
    type: "button",
    class: "remove-instrument",
  });
  readonly #instrumentButtonsScroller: HTMLDivElement = div({
    class: "instrument-buttons-scroller",
  });
  readonly #instrumentActions: HTMLDivElement = div(
    { class: "instrument-actions" },
    this.#instrumentRemoveButton,
    this.#instrumentAddButton,
  );
  readonly #instrumentsButtonBar: HTMLDivElement = div(
    { class: "instrument-bar", style: "width: 100%;" },
    this.#instrumentButtonsScroller,
    this.#instrumentActions,
  );
  readonly #instrumentsButtonRow: HTMLDivElement = div(
    { class: "selectRow", style: "display: none;" },
    this.#instrumentsButtonBar,
  );
  readonly #instrumentCopyButton: HTMLButtonElement = button(
    { type: "button", class: "copy-instrument", title: "Copy Instrument (⇧C)" },
    "Copy",
  );
  readonly #instrumentPasteButton: HTMLButtonElement = button(
    {
      type: "button",
      class: "paste-instrument",
      title: "Paste Instrument (⇧V)",
    },
    "Paste",
  );
  readonly #instrumentCopyPasteRow: HTMLDivElement = div(
    { class: "instrumentActionRow" },
    this.#instrumentCopyButton,
    this.#instrumentPasteButton,
  );
  readonly #instrumentVolumeSlider: Slider = new Slider(
    input({
      type: "range",
      title: "Volume",
      min: "0",
      max: "100",
      value: String(Config.volumeDefault),
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) => new ChangeVolume(this.doc, oldValue, newValue),
  );
  readonly #instrumentVolumeInput: NumberInput = new NumberInput(
    input({
      class: "instrument-value-input",
      style: "width: 4.5em; vertical-align: middle;",
      type: "number",
      min: "0",
      max: "100",
      step: "1",
      value: String(Config.volumeDefault),
      title: "Volume",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeVolume(this.doc, oldValue, Math.max(0, Math.min(100, newValue))),
  );
  readonly #instrumentVolumeSliderRow: HTMLDivElement = div(
    { class: "selectRow instrument-symbol-control" },
    div({ class: "instrument-volume-icon", title: "Volume" }),
    this.#instrumentVolumeSlider.container,
    this.#instrumentVolumeInput.input,
  );
  readonly #panSlider: Slider = new Slider(
    input({
      type: "range",
      title: "Panning",
      min: "-100",
      max: "100",
      value: "0",
      step: "2",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangePan(this.doc, panPercentToSetting(oldValue), panPercentToSetting(newValue)),
  );
  readonly #panInput: NumberInput = new NumberInput(
    input({
      class: "instrument-value-input",
      style: "width: 4.5em; vertical-align: middle;",
      type: "number",
      min: "-100",
      max: "100",
      step: "2",
      value: "0",
      title: "Panning",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangePan(this.doc, panPercentToSetting(oldValue), panPercentToSetting(newValue)),
  );
  readonly #panSliderRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    div(
      { class: "instrument-pan-slider" },
      span({ class: "pan-label" }, "L"),
      this.#panSlider.container,
      span({ class: "pan-label" }, "R"),
    ),
    this.#panInput.input,
  );
  readonly #chipWaveEditor: ChipWaveEditor = new ChipWaveEditor(
    this.doc,
    false,
    null,
    (newValue: number) => new ChangeChipWave(this.doc, newValue),
    () => this.#openChipWaveLoopPrompt(null),
    true,
  );
  readonly #chipWaveSelectRow: HTMLDivElement = this.#chipWaveEditor.waveRow;
  readonly #chipNoiseSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.chipNoises.map((wave) => wave.name),
  );
  readonly #chipNoiseSelectRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Noise"),
    this.#chipNoiseSelect,
  );
  readonly #soundFontSelect: HTMLSelectElement = select({
    title: "SoundFont",
  });
  readonly #soundFontPresetSelect: HTMLSelectElement = select({
    title: "SoundFont Instrument",
  });
  readonly #soundFontSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control asset-select-control" },
    this.#soundFontSelect,
  );
  readonly #soundFontPresetSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#soundFontPresetSelect,
  );
  readonly #fadeInOutEditor: FadeInOutEditor = new FadeInOutEditor(this.doc);
  readonly #fadeInOutRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#fadeInOutEditor.container,
  );
  readonly #transitionSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.transitions.map((transition) => transition.name),
  );
  readonly #transitionRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Transition"),
    this.#transitionSelect,
  );
  readonly #effectsSelect: HTMLSelectElement = select(
    option({
      selected: true,
      disabled: true,
      hidden: true,
    }),
  );
  readonly #addEffectButton: HTMLButtonElement = button(
    {
      class: "instrumentSettingsAdd",
      type: "button",
      title: "Add or remove effect",
    },
    "+",
  );
  readonly #eqFilterEditor: FilterEditor = new FilterEditor(this.doc);
  readonly #eqFilterRow: HTMLElement = div(
    { class: "selectRow" },
    label("EQ Filter"),
    this.#eqFilterEditor.container,
  );
  readonly #noteFilterEditor: FilterEditor = new FilterEditor(this.doc, true);
  readonly #noteFilterRow: HTMLElement = div(
    { class: "selectRow" },
    label("Note Filter"),
    this.#noteFilterEditor.container,
  );
  readonly #supersawDynamismSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.supersawDynamismMax,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeSupersawDynamism(this.doc, oldValue, newValue),
  );
  readonly #supersawDynamismRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Dynamism"),
    this.#supersawDynamismSlider.container,
  );
  readonly #supersawSpreadSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.supersawSpreadMax,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) => new ChangeSupersawSpread(this.doc, oldValue, newValue),
  );
  readonly #supersawSpreadRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Spread"),
    this.#supersawSpreadSlider.container,
  );
  readonly #supersawShapeSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.supersawShapeMax,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) => new ChangeSupersawShape(this.doc, oldValue, newValue),
  );
  readonly #supersawShapeRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Saw↔Pulse"),
    this.#supersawShapeSlider.container,
  );
  readonly #pulseWidthSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.pulseWidthRange - 1,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) => new ChangePulseWidth(this.doc, oldValue, newValue),
  );
  readonly #pulseWidthRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Pulse Width"),
    this.#pulseWidthSlider.container,
  );
  readonly #pitchShiftSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.pitchShiftRange - 1,
    (oldValue: number, newValue: number) => new ChangePitchShift(this.doc, oldValue, newValue),
    -12,
    12,
    null,
    null,
    1,
  );
  readonly #pitchShiftTonicMarkers: HTMLDivElement[] = [
    div({ class: "pitchShiftMarker", style: { color: ColorConfig.tonic } }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.tonic, left: "50%" },
    }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.tonic, left: "100%" },
    }),
  ];
  readonly #pitchShiftFifthMarkers: HTMLDivElement[] = [
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.fifthNote, left: `${(100 * 7) / 24}%` },
    }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.fifthNote, left: `${(100 * 19) / 24}%` },
    }),
  ];
  readonly #pitchShiftThirdMarkers: HTMLDivElement[] = [
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.thirdNote, left: `${(100 * 4) / 24}%` },
    }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.thirdNote, left: `${(100 * 16) / 24}%` },
    }),
  ];
  readonly #pitchShiftMarkerContainer: HTMLDivElement = div(
    { style: "display: flex; position: relative;" },
    this.#pitchShiftSlider.container,
    div(
      { class: "pitchShiftMarkerContainer" },
      this.#pitchShiftTonicMarkers,
      this.#pitchShiftThirdMarkers,
      this.#pitchShiftFifthMarkers,
    ),
  );
  readonly #pitchShiftRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Pitch Shift"),
    this.#pitchShiftMarkerContainer,
  );
  readonly #detuneSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.detuneMax,
    (oldValue: number, newValue: number) => new ChangeDetune(this.doc, oldValue, newValue),
    -200,
    200,
    (value: number) => Synth.detuneToCents(value - Config.detuneCenter),
    (value: number) => Config.detuneCenter + Synth.centsToDetune(value),
  );
  readonly #detuneRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Detune"),
    this.#detuneSlider.container,
  );
  readonly #distortionSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.distortionRange - 1,
    (oldValue: number, newValue: number) => new ChangeDistortion(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    100,
  );
  readonly #distortionRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Distortion"),
    this.#distortionSlider.container,
  );
  readonly #bitcrusherQuantizationSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.bitcrusherQuantizationRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeBitcrusherQuantization(this.doc, oldValue, newValue),
  );
  readonly #bitcrusherQuantizationRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Bit Crush"),
    this.#bitcrusherQuantizationSlider.container,
  );
  readonly #bitcrusherFreqSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.bitcrusherFreqRange - 1,
    (oldValue: number, newValue: number) => new ChangeBitcrusherFreq(this.doc, oldValue, newValue),
  );
  readonly #bitcrusherFreqRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Freq Crush"),
    this.#bitcrusherFreqSlider.container,
  );
  readonly #stringSustainSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.stringSustainRange - 1,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) => new ChangeStringSustain(this.doc, oldValue, newValue),
  );
  readonly #stringSustainLabel: HTMLLabelElement = label("Sustain");
  readonly #stringSustainRow: HTMLDivElement = div(
    { class: "selectRow" },
    this.#stringSustainLabel,
    this.#stringSustainSlider.container,
  );
  readonly #unisonSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.unisons.map((unison) => unison.name),
  );
  readonly #unisonSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Unison"),
    this.#unisonSelect,
  );
  readonly #chordSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.chords.map((chord) => chord.name),
  );
  readonly #chordSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Chords"),
    this.#chordSelect,
  );
  readonly #vibratoSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.vibratos.map((vibrato) => vibrato.name),
  );
  readonly #vibratoSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Vibrato"),
    this.#vibratoSelect,
  );
  readonly #phaseModGroup: HTMLElement = div({
    class: "editor-controls",
  });
  readonly #feedbackTypeSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.feedbacks.map((feedback) => feedback.name),
  );
  readonly #feedbackRow1: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#feedbackTypeSelect,
  );
  readonly #spectrumEditor: SpectrumEditor = new SpectrumEditor(this.doc, null);
  readonly #spectrumRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#spectrumEditor.container,
  );
  readonly #harmonicsEditor: HarmonicsEditor = new HarmonicsEditor(this.doc);
  readonly #harmonicsRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this.#harmonicsEditor.container,
  );
  readonly #envelopeEditor: EnvelopeEditor = new EnvelopeEditor(this.doc);
  readonly #drumsetGroup: HTMLElement = div({
    class: "editor-controls",
  });

  readonly #feedbackAmplitudeSlider: Slider = new Slider(
    input({
      type: "range",
      min: "0",
      max: Config.operatorAmplitudeMax,
      value: "0",
      step: "1",
      title: "Feedback Amplitude",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeFeedbackAmplitude(this.doc, oldValue, newValue),
  );
  readonly #feedbackRow2: HTMLDivElement = div(
    { class: "selectRow" },
    label("Feedback"),
    this.#feedbackAmplitudeSlider.container,
  );
  readonly #presetButton: HTMLButtonElement = button(
    { type: "button", class: "presetButton variableNameButton" },
    "Preset",
  );
  readonly #addEnvelopeButton: HTMLButtonElement = button(
    { class: "instrumentSettingsAdd", type: "button", title: "Add envelope" },
    "+",
  );
  readonly #instrumentSettings: InstrumentSettings = new InstrumentSettings({
    preset: this.#presetButton,
    instruments: this.#instrumentsButtonRow,
    copyPaste: this.#instrumentCopyPasteRow,
    volume: this.#instrumentVolumeSliderRow,
    pan: this.#panSliderRow,
    fade: this.#fadeInOutRow,
    specific: [
      this.#chipWaveEditor.container,
      this.#chipNoiseSelectRow,
      this.#soundFontSelectRow,
      this.#soundFontPresetSelectRow,
      this.#algorithmSelectRow,
      this.#phaseModGroup,
      this.#feedbackRow1,
      this.#feedbackRow2,
      this.#spectrumRow,
      this.#harmonicsRow,
      this.#drumsetGroup,
      this.#supersawDynamismRow,
      this.#supersawSpreadRow,
      this.#supersawShapeRow,
      this.#pulseWidthRow,
      this.#stringSustainRow,
    ],
    effects: [
      this.#eqFilterRow,
      this.#noteFilterRow,
      this.#pitchShiftRow,
      this.#detuneRow,
      this.#chordSelectRow,
      this.#transitionRow,
      this.#distortionRow,
      this.#bitcrusherQuantizationRow,
      this.#bitcrusherFreqRow,
      this.#vibratoSelectRow,
      this.#unisonSelectRow,
      this.#chorusRow,
      this.#echoSustainRow,
      this.#echoDelayRow,
      this.#reverbRow,
    ],
    effectsMenu: div({ class: "effects-menu" }, this.#addEffectButton, this.#effectsSelect),
    envelopes: this.#envelopeEditor.container,
    addEnvelope: this.#addEnvelopeButton,
    openInstrumentType: () => this.#openPrompt("instrumentType"),
    copyCategory: (category) => this.#copyInstrumentSettingsCategory(category),
    pasteCategory: (category) => this.#pasteInstrumentSettingsCategory(category),
    randomizeCategory: (category) => this.#randomizeInstrumentSettingsCategory(category),
  });
  readonly #instrumentSettingsControls: HTMLDivElement = this.#instrumentSettings.container;
  readonly #promptContainer: HTMLDivElement = div({
    class: "promptContainer",
  });
  readonly #zoomInButton: HTMLButtonElement = button({
    class: "zoomInButton overlay-button",
    type: "button",
    title: "Zoom In",
  });
  readonly #zoomOutButton: HTMLButtonElement = button({
    class: "zoomOutButton overlay-button",
    type: "button",
    title: "Zoom Out",
  });
  readonly #patternEditorRow: HTMLDivElement = div(
    {
      style: "flex: 1; height: 100%; display: flex; overflow: hidden; justify-content: center;",
    },
    this.#patternEditorPrev.container,
    this.#patternEditor.container,
    this.#patternEditorNext.container,
  );
  readonly #automationEditorRow: HTMLDivElement = div(
    { class: "automation-editor-row" },
    this.#automationEditorPrev.container,
    this.#automationEditor.container,
    this.#automationEditorNext.container,
  );
  readonly #patternArea: HTMLDivElement = div(
    { class: "pattern-area" },
    this.#piano.container,
    this.#patternEditorRow,
    this.#automationEditorRow,
    this.#octaveScrollBar.container,
    this.#zoomInButton,
    this.#zoomOutButton,
  );
  readonly #trackContainer: HTMLDivElement = div(
    { class: "trackContainer noSelection" },
    this.#trackEditor.container,
    this.#loopEditor.container,
  );
  readonly #trackVisibleArea: HTMLDivElement = div({
    style: "position: absolute; width: 100%; height: 100%; pointer-events: none;",
  });
  readonly #trackAndMuteContainer: HTMLDivElement = div(
    { class: "trackAndMuteContainer" },
    this.#muteEditor.container,
    this.#trackContainer,
    this.#trackVisibleArea,
  );
  readonly #trackViewport: HTMLDivElement = div(
    { class: "trackViewport" },
    this.#trackAndMuteContainer,
    div(
      { class: "trackViewportEdges" },
      div({ class: "trackViewportLeftEdge" }),
      div({ class: "trackViewportBottomEdge" }),
    ),
  );
  readonly #barScrollBar: BarScrollBar = new BarScrollBar(this.doc);
  readonly #trackArea: HTMLDivElement = div(
    { class: "track-area" },
    this.#trackViewport,
    this.#barScrollBar.container,
  );

  readonly #menuArea: HTMLDivElement = div(
    { class: "menu-area" },
    div({ class: "menu-icon file" }, this.#fileMenu),
    div({ class: "menu-icon edit" }, this.#editMenu),
    this.#preferencesButton,
    this.#aboutButton,
  );
  readonly #songSettingsArea: HTMLDivElement = div(
    { class: "song-settings-area" },
    div(
      { class: "editor-controls groupedSettings" },
      div(
        { class: "settingsGroup" },
        div({ class: "selectRow" }, label("Scale"), this.#scaleSelect),
        div(
          { class: "selectRow" },
          label("Key"),
          div({ class: "reveal-control" }, this.#legacyKeyButton, this.#keySelect),
        ),
        this.#legacyKeyRow,
      ),
      div(
        { class: "settingsGroup" },
        div(
          { class: "selectRow" },
          label("Tempo"),
          span(
            { style: "display: flex; gap: 4px;" },
            this.#tempoSlider.container,
            this.#tempoStepper,
          ),
        ),
        div({ class: "selectRow" }, label("Rhythm"), this.#rhythmSelect),
      ),
      div(
        { class: "settingsGroup" },
        div({ class: "selectRow" }, label("Beats per bar"), this.#beatsPerBarStepper),
        div({ class: "selectRow" }, label("Song length"), this.#songLengthStepper),
      ),
      div(
        { class: "settingsGroup" },
        div({ class: "selectRow" }, label("Pitch channels"), this.#pitchChannelsStepper),
        div({ class: "selectRow" }, label("Drum channels"), this.#drumChannelsStepper),
        div({ class: "selectRow" }, label("Auto channels"), this.#automationChannelsStepper),
        div({ class: "selectRow" }, label("Max patterns"), this.#maxPatternsStepper),
      ),
    ),
  );
  readonly #instrumentSettingsArea: HTMLDivElement = div(
    { class: "instrument-settings-area" },
    this.#instrumentSettingsControls,
    this.#automationSettings.container,
  );
  readonly #settingsArea: HTMLDivElement = div(
    { class: "settings-area noSelection" },
    div(
      { class: "play-pause-area" },
      div(
        { class: "playback-bar-controls" },
        this.#playButton,
        this.#pauseButton,
        this.#recordButton,
        this.#stopButton,
        this.#prevBarButton,
        this.#nextBarButton,
      ),
    ),
    this.#menuArea,
    this.#songSettingsArea,
    this.#instrumentSettingsArea,
  );

  public readonly mainLayer: HTMLDivElement = div(
    { class: "app", tabIndex: "0" },
    this.#patternArea,
    this.#trackArea,
    this.#settingsArea,
    this.#promptContainer,
  );

  #wasPlaying = false;
  #currentPromptName: string | null = null;
  #chipWaveLoopOperatorIndex: number | null = null;
  #highlightedInstrumentIndex = -1;
  #renderedInstrumentCount = 0;
  #renderedIsPlaying = false;
  #renderedIsRecording = false;
  #renderedShowRecordButton: boolean | null = null;
  #renderedCtrlHeld = false;
  readonly #operatorRows: HTMLDivElement[] = [];
  readonly #operatorAmplitudeSliders: Slider[] = [];
  readonly #operatorFrequencyInputs: NumberInput[] = [];
  readonly #operatorWaveEditors: ChipWaveEditor[] = [];
  readonly #operatorWaveSelects: HTMLSelectElement[] = [];
  readonly #operatorWaveRows: HTMLDivElement[] = [];
  readonly #operatorWaveButtons: HTMLButtonElement[] = [];
  readonly #drumsetSpectrumEditors: SpectrumEditor[] = [];
  readonly #drumsetEnvelopeSelects: HTMLSelectElement[] = [];
  readonly #drumsetEnvelopeParameterEditors: EnvelopeParameterEditor[] = [];

  public constructor(app: HTMLElement) {
    this.doc.notifier.watch(this.whenUpdated);
    this.doc.synth.assetLoadEvents.addEventListener("change", this.#whenAssetLoadStateChanged);

    window.addEventListener("resize", this.#whenResized);
    window.requestAnimationFrame(this.updatePlayButton);

    this.#keySelect.append(
      optgroup({ label: "Edit" }, option({ value: "detectKey" }, "Detect Key")),
    );
    this.#rhythmSelect.append(
      optgroup({ label: "Edit" }, option({ value: "forceRhythm" }, "Snap Notes To Rhythm")),
    );
    this.#tempoSlider.container.style.flex = "1";

    for (let i = 0; i < Config.operatorCount; i++) {
      const operatorIndex: number = i,
        waveButton: HTMLButtonElement = button(
          {
            class: "reveal-arrow",
            type: "button",
            title: "Show waveform",
            "aria-label": "Show waveform",
          },
          "▾",
        ),
        frequencyInput: NumberInput = new NumberInput(
          input({
            class: "instrument-value-input",
            type: "number",
            min: "0",
            max: String(Config.operatorFrequencyMax),
            step: "any",
            value: "1",
            title: "Frequency",
          }),
          this.doc,
          (_oldValue: number, newValue: number) =>
            new ChangeOperatorFrequency(this.doc, operatorIndex, newValue),
        ),
        waveEditor: ChipWaveEditor = new ChipWaveEditor(
          this.doc,
          true,
          operatorIndex,
          (newValue: number) => new ChangeOperatorWave(this.doc, operatorIndex, newValue),
          () => this.#openChipWaveLoopPrompt(operatorIndex),
        ),
        waveSelect: HTMLSelectElement = waveEditor.select,
        amplitudeSlider: Slider = new Slider(
          input({
            type: "range",
            min: "0",
            max: Config.operatorAmplitudeMax,
            value: "0",
            step: "1",
            title: "Volume",
          }),
          this.doc,
          (oldValue: number, newValue: number) =>
            new ChangeOperatorAmplitude(this.doc, operatorIndex, oldValue, newValue),
        ),
        row: HTMLDivElement = div(
          { class: "selectRow fm-operator-row" },
          waveButton,
          frequencyInput.input,
          amplitudeSlider.container,
        ),
        waveRow: HTMLDivElement = waveEditor.container;
      waveRow.style.display = "none";
      this.#phaseModGroup.append(row, waveRow);
      this.#operatorRows[i] = row;
      this.#operatorAmplitudeSliders[i] = amplitudeSlider;
      this.#operatorFrequencyInputs[i] = frequencyInput;
      this.#operatorWaveEditors[i] = waveEditor;
      this.#operatorWaveSelects[i] = waveSelect;
      this.#operatorWaveRows[i] = waveRow;
      this.#operatorWaveButtons[i] = waveButton;

      waveButton.addEventListener("click", () => {
        const showWave: boolean = waveRow.style.display === "none";
        waveRow.style.display = showWave ? "" : "none";
        waveButton.textContent = showWave ? "▴" : "▾";
        waveButton.title = showWave ? "Hide waveform" : "Show waveform";
        waveButton.setAttribute("aria-label", waveButton.title);
      });
    }

    for (let i: number = Config.drumCount - 1; i >= 0; i--) {
      const drumIndex: number = i,
        spectrumEditor: SpectrumEditor = new SpectrumEditor(this.doc, drumIndex);
      spectrumEditor.container.addEventListener("pointerdown", this.#refocusStage);
      this.#drumsetSpectrumEditors[i] = spectrumEditor;

      const envelopeSelect: HTMLSelectElement = buildOptions(
        select({
          title: "Filter Envelope",
        }),
        Config.envelopes.map((envelope) => envelope.name),
      );
      this.#drumsetEnvelopeSelects[i] = envelopeSelect;
      const envelopeRevealButton: HTMLButtonElement = button(
          {
            class: "reveal-arrow",
            type: "button",
            title: "Show envelope controls",
            "aria-label": "Show envelope controls",
            "aria-expanded": "false",
          },
          "▾",
        ),
        envelopeParameters = new EnvelopeParameterEditor(
          this.doc,
          (parameter) => {
            const instrument =
              this.doc.song.channels[this.doc.channel]!.instruments[
                this.doc.getCurrentInstrument()
              ]!;
            return parameter === "speed"
              ? instrument.drumsetEnvelopeSpeeds[drumIndex]!
              : parameter === "a"
                ? instrument.drumsetEnvelopeAs[drumIndex]!
                : instrument.drumsetEnvelopeBs[drumIndex]!;
          },
          (parameter, oldValue, newValue) =>
            new ChangeDrumsetEnvelopeParameter(this.doc, drumIndex, parameter, oldValue, newValue),
        );
      envelopeParameters.container.style.display = "none";
      this.#drumsetEnvelopeParameterEditors[i] = envelopeParameters;
      envelopeSelect.addEventListener("change", () => {
        this.doc.record(
          new ChangeDrumsetEnvelope(this.doc, drumIndex, envelopeSelect.selectedIndex),
        );
      });
      envelopeRevealButton.addEventListener("click", () => {
        const showEnvelope: boolean = envelopeParameters.container.style.display === "none";
        envelopeParameters.container.style.display = showEnvelope ? "" : "none";
        envelopeRevealButton.textContent = showEnvelope ? "▴" : "▾";
        envelopeRevealButton.title = showEnvelope
          ? "Hide envelope controls"
          : "Show envelope controls";
        envelopeRevealButton.setAttribute("aria-label", envelopeRevealButton.title);
        envelopeRevealButton.setAttribute("aria-expanded", String(showEnvelope));
      });

      const row: HTMLDivElement = div(
        { class: "selectRow drumset-row" },
        envelopeRevealButton,
        envelopeSelect,
        this.#drumsetSpectrumEditors[i]!.container,
      );
      this.#drumsetGroup.append(row);
      this.#drumsetGroup.append(envelopeParameters.container);
    }

    this.#fileMenu.addEventListener("change", this.#fileMenuHandler);
    this.#editMenu.addEventListener("change", this.#editMenuHandler);
    this.#preferencesButton.addEventListener("click", this.#openPreferences);
    this.#aboutButton.addEventListener("click", this.#openAbout);
    this.#tempoStepper.addEventListener("change", this.#whenSetTempo);
    this.#scaleSelect.addEventListener("change", this.#whenSetScale);
    this.#keySelect.addEventListener("change", this.#whenSetKey);
    this.#legacyKeySelect.addEventListener("change", this.#whenSetLegacyKey);
    this.#legacyKeyButton.addEventListener("click", this.#toggleLegacyKey);
    this.#rhythmSelect.addEventListener("change", this.#whenSetRhythm);
    this.#beatsPerBarStepper.addEventListener("change", this.#whenSetBeatsPerBar);
    this.#songLengthStepper.addEventListener("change", this.#whenSetSongLength);
    this.#pitchChannelsStepper.addEventListener("change", this.#whenSetPitchChannels);
    this.#drumChannelsStepper.addEventListener("change", this.#whenSetDrumChannels);
    this.#automationChannelsStepper.addEventListener("change", this.#whenSetAutomationChannels);
    this.#maxPatternsStepper.addEventListener("change", this.#whenSetMaxPatterns);
    this.#presetButton.addEventListener("click", this.#openInstrumentPreset);
    this.#algorithmSelect.addEventListener("change", this.#whenSetAlgorithm);
    this.#instrumentsButtonBar.addEventListener("click", this.#whenSelectInstrument);
    this.#instrumentCopyButton.addEventListener("click", this.#copyInstrument);
    this.#instrumentPasteButton.addEventListener("click", this.#pasteInstrument);
    this.#feedbackTypeSelect.addEventListener("change", this.#whenSetFeedbackType);
    this.#soundFontSelect.addEventListener("change", this.#whenSetSoundFont);
    this.#soundFontPresetSelect.addEventListener("change", this.#whenSetSoundFontPreset);
    this.#chipNoiseSelect.addEventListener("change", this.#whenSetNoiseWave);
    this.#transitionSelect.addEventListener("change", this.#whenSetTransition);
    this.#effectsSelect.addEventListener("change", this.#whenSetEffects);
    this.#addEffectButton.addEventListener("click", this.#openEffectsMenu);
    this.#unisonSelect.addEventListener("change", this.#whenSetUnison);
    this.#chordSelect.addEventListener("change", this.#whenSetChord);
    this.#vibratoSelect.addEventListener("change", this.#whenSetVibrato);
    this.#playButton.addEventListener("click", this.#togglePlay);
    this.#pauseButton.addEventListener("click", this.#togglePlay);
    this.#recordButton.addEventListener("click", this.#toggleRecord);
    this.#stopButton.addEventListener("click", this.#toggleRecord);
    // Start recording instead of opening context menu when control-clicking the record button on a Mac.
    this.#recordButton.addEventListener("contextmenu", (event: MouseEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this.#toggleRecord();
      }
    });
    this.#stopButton.addEventListener("contextmenu", (event: MouseEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this.#toggleRecord();
      }
    });
    this.#prevBarButton.addEventListener("click", this.#whenPrevBarPressed);
    this.#nextBarButton.addEventListener("click", this.#whenNextBarPressed);
    this.#zoomInButton.addEventListener("click", this.#zoomIn);
    this.#zoomOutButton.addEventListener("click", this.#zoomOut);

    this.#patternArea.addEventListener("pointerdown", this.#activatePatternEditor);
    this.#trackArea.addEventListener("pointerdown", this.#activateTrackEditor);
    this.#fadeInOutEditor.container.addEventListener("pointerdown", this.#refocusStage);
    this.#spectrumEditor.container.addEventListener("pointerdown", this.#refocusStage);
    this.#eqFilterEditor.container.addEventListener("pointerdown", this.#refocusStage);
    this.#noteFilterEditor.container.addEventListener("pointerdown", this.#refocusStage);
    this.#harmonicsEditor.container.addEventListener("pointerdown", this.#refocusStage);
    this.#addEnvelopeButton.addEventListener("click", this.#addNewEnvelope);
    this.#patternArea.addEventListener("contextmenu", this.#disableCtrlContextMenu);
    this.#trackArea.addEventListener("contextmenu", this.#disableCtrlContextMenu);
    this.mainLayer.addEventListener("keydown", this.#whenKeyPressed);
    this.mainLayer.addEventListener("keyup", this.#whenKeyReleased);
    this.mainLayer.addEventListener("focusin", this.#onFocusIn);

    // Sorry, bypassing typescript type safety on this function because I want to use the new "passive" option.
    //This._trackAndMuteContainer.addEventListener("scroll", this._onTrackAreaScroll, {capture: false, passive: true});
    (this.#trackAndMuteContainer.addEventListener as Function)("scroll", this.#onTrackAreaScroll, {
      capture: false,
      passive: true,
    });

    app.append(this.mainLayer);
    this.whenUpdated();
    this.mainLayer.focus();

    this.updatePlayButton();

    // The editor uses browser history state as its own undo history. Browsers typically
    // Remember scroll position for each history state, but editor users would prefer not
    // Auto scrolling when undoing. Sadly this tweak doesn't work on Edge or IE.
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js", { updateViaCache: "all", scope: "/" })
        .catch(() => {});
    }
  }

  #whenResized = (): void => {
    this.whenUpdated();
  };

  #whenAssetLoadStateChanged = (): void => {
    this.#syncSoundFontOptions();
    const instrument =
      this.doc.song.channels[this.doc.channel]?.instruments[this.doc.getCurrentInstrument()];
    if (instrument?.type === InstrumentType.soundFont) {
      this.#presetButton.textContent = this.#getSoundFontPresetName(
        instrument.soundFontId,
        instrument.soundFontPreset,
      );
    }
    this.#updateAssetLoadingIndicator();
  };

  #syncChipWaveOptions(): void {
    this.#chipWaveEditor.syncOptions();
    for (const editor of this.#operatorWaveEditors) {
      editor.syncOptions();
    }
  }

  #syncSoundFontOptions(): void {
    const instrument =
        this.doc.song.channels[this.doc.channel]?.instruments[this.doc.getCurrentInstrument()],
      soundFonts = this.doc.song.assets.filter((asset) => asset.type === "soundFont");
    this.#soundFontSelect.replaceChildren(option({ value: "" }, "none"));
    for (const soundFont of soundFonts) {
      this.#soundFontSelect.append(option({ value: soundFont.id }, soundFont.name));
    }

    const selectedId: string | null =
      instrument?.type === InstrumentType.soundFont ? instrument.soundFontId : null;
    this.#soundFontSelect.value = selectedId ?? "";
    if (this.#soundFontSelect.value !== (selectedId ?? "")) {
      this.#soundFontSelect.value = "";
    }

    this.#soundFontPresetSelect.replaceChildren();
    if (selectedId == null || this.#soundFontSelect.value === "") {
      this.#soundFontPresetSelectRow.style.display = "none";
      return;
    }

    const presets = this.doc.synth.getSoundFontPresets(selectedId);
    this.#soundFontPresetSelectRow.style.display = presets == null ? "none" : "";
    if (presets == null) {
      return;
    }
    for (const preset of presets) {
      this.#soundFontPresetSelect.append(option({ value: preset.index }, preset.name));
    }
    this.#soundFontPresetSelect.value = String(instrument?.soundFontPreset ?? 0);
    if (this.#soundFontPresetSelect.selectedIndex === -1 && presets.length > 0) {
      this.#soundFontPresetSelect.selectedIndex = 0;
    }
  }

  #updateAssetLoadingIndicator(): void {
    const instrument =
        this.doc.song.channels[this.doc.channel]?.instruments[this.doc.getCurrentInstrument()],
      chipWave =
        instrument?.type === InstrumentType.chip
          ? Config.chipWaves[instrument.chipWave]!
          : undefined,
      loading: boolean =
        chipWave?.sampleId !== undefined &&
        this.doc.synth.getAssetLoadStatus(chipWave.sampleId) === "loading";
    this.#chipWaveSelectRow.classList.toggle("asset-loading", loading);
    this.#soundFontSelectRow.classList.toggle(
      "asset-loading",
      instrument?.type === InstrumentType.soundFont &&
        instrument.soundFontId != null &&
        this.doc.synth.getAssetLoadStatus(instrument.soundFontId) === "loading",
    );
  }

  #echoDelayToBeats(value: number): number {
    return ((value + 1) * Config.echoDelayStepTicks) / (Config.ticksPerPart * Config.partsPerBeat);
  }

  #echoDelayFromBeats(value: number): number {
    return (value * Config.ticksPerPart * Config.partsPerBeat) / Config.echoDelayStepTicks - 1;
  }

  #openPrompt(promptName: string): void {
    this.doc.openPrompt(promptName);
  }

  #openPreferences = (): void => {
    this.#openPrompt("preferences");
  };

  #openAbout = (): void => {
    this.#openPrompt("about");
  };

  #openChipWaveLoopPrompt(operatorIndex: number | null): void {
    this.#chipWaveLoopOperatorIndex = operatorIndex;
    this.#openPrompt("chipWaveLoop");
  }

  #setPrompt(promptName: string | null): void {
    if (this.#currentPromptName === promptName) {
      return;
    }
    this.#currentPromptName = promptName;

    if (this.prompt) {
      if (
        this.#wasPlaying &&
        this.prompt.pausePlayback !== false &&
        !(this.prompt instanceof SustainPrompt)
      ) {
        this.doc.performance.play();
      }
      this.#wasPlaying = false;
      unmountPrompt(this.prompt, this.#promptContainer);
      this.prompt = null;
      this.#refocusStage();
    }

    if (promptName) {
      switch (promptName) {
        case "export": {
          this.prompt = new ExportPrompt(this.doc);
          break;
        }
        case "exportGoop": {
          this.prompt = new ExportPrompt(this.doc, "goop");
          break;
        }
        case "songRecovery": {
          this.prompt = new SongRecoveryPrompt(this.doc);
          break;
        }
        case "moveNotesSideways": {
          this.prompt = new MoveNotesSidewaysPrompt(this.doc);
          break;
        }
        case "beatsPerBar": {
          this.prompt = new BeatsPerBarPrompt(this.doc);
          break;
        }
        case "preferences": {
          this.prompt = new PreferencesPrompt(this.doc);
          break;
        }
        case "about": {
          this.prompt = new AboutPrompt(this.doc);
          break;
        }
        case "stringSustain": {
          this.prompt = new SustainPrompt(this.doc);
          break;
        }
        case "chipWaveLoop": {
          this.prompt = new ChipWaveLoopPrompt(this.doc, this.#chipWaveLoopOperatorIndex);
          break;
        }
        case "instrumentPreset": {
          this.prompt = new InstrumentPresetPrompt(
            this.doc.song.getChannelIsNoise(this.doc.channel),
            (preset) => this.#setPreset(preset),
            this.#closePrompt,
            this.#getSamplePresets(),
            this.#getSoundFontPresetGroups(),
          );
          break;
        }
        case "instrumentType": {
          this.prompt = new InstrumentTypePrompt(
            (preset) => this.#setPreset(preset),
            this.#closePrompt,
          );
          break;
        }
        case "assets": {
          this.prompt = new AssetsPrompt(this.doc);
          break;
        }
        case "flpInstruments": {
          {
            const pending = this.#pendingFlpImport;
            if (pending != null) {
              this.prompt = new FlpInstrumentPrompt(
                this.doc,
                pending.imported,
                (): void => {
                  pending.apply();
                  this.#pendingFlpImport = null;
                  this.#closePrompt();
                },
                this.#closePrompt,
              );
            }
          }
          break;
        }
        default: {
          this.prompt = null;
          break;
        }
      }

      if (this.prompt) {
        if (this.prompt.pausePlayback !== false && !(this.prompt instanceof SustainPrompt)) {
          this.#wasPlaying = this.doc.synth.playing;
          this.doc.performance.pause();
        }
        mountPrompt(this.prompt, this.#promptContainer, this.#closePrompt);
      }
    }
  }

  #closePrompt = (): void => {
    if (this.#currentPromptName === "flpInstruments") {
      this.#pendingFlpImport = null;
    }
    this.doc.closePrompt();
  };

  #refocusStage = (): void => {
    this.mainLayer.focus({ preventScroll: true });
  };

  #activatePatternEditor = (): void => {
    this.#activeEditor = "pattern";
    this.#refocusStage();
  };

  #activateTrackEditor = (): void => {
    this.#activeEditor = "track";
    this.#refocusStage();
  };

  #automationPatternEditorIsActive(): boolean {
    return (
      this.#activeEditor === "pattern" && this.doc.song.getChannelIsAutomation(this.doc.channel)
    );
  }

  #onFocusIn = (event: Event): void => {
    if (
      this.doc.synth.recording &&
      event.target !== this.mainLayer &&
      event.target !== this.#stopButton
    ) {
      // Don't allow using tab to focus on the song settings while recording,
      // Since interacting with them while recording would mess up the recording.
      this.#refocusStage();
    }
  };

  public whenUpdated = (): void => {
    const prefs: Preferences = this.doc.prefs;
    this.#muteEditor.container.style.display = "";
    this.doc.trackVisibleBars = Math.floor(
      (this.#trackVisibleArea.clientWidth - 32 - TrackEditor.channelNumberWidth) /
        this.doc.getBarWidth(),
    );
    this.doc.trackVisibleChannels = Math.floor(
      (this.#trackVisibleArea.clientHeight - 30 - TrackEditor.barNumberHeight) /
        ChannelRow.patternHeight,
    );
    this.#barScrollBar.render();
    this.#muteEditor.render();
    this.#trackEditor.render();

    this.#trackAndMuteContainer.scrollLeft = this.doc.barScrollPos * this.doc.getBarWidth();
    this.#trackAndMuteContainer.scrollTop = this.doc.channelScrollPos * ChannelRow.patternHeight;

    this.#barScrollBar.container.style.display =
      this.doc.song.barCount > this.doc.trackVisibleBars ? "" : "none";
    const isAutomationChannel: boolean = this.doc.song.getChannelIsAutomation(this.doc.channel),
      isDrumChannel: boolean = this.doc.song.getChannelIsNoise(this.doc.channel);
    this.#piano.container.style.visibility = isAutomationChannel ? "hidden" : "";
    this.#octaveScrollBar.container.style.visibility = isAutomationChannel ? "hidden" : "";
    this.#patternEditorRow.style.display = isAutomationChannel ? "none" : "flex";
    this.#automationEditorRow.style.display = isAutomationChannel ? "flex" : "none";
    this.#zoomInButton.style.display = isAutomationChannel || isDrumChannel ? "none" : "";
    this.#zoomOutButton.style.display = isAutomationChannel || isDrumChannel ? "none" : "";
    this.#zoomInButton.style.right = "24px";
    this.#zoomOutButton.style.right = "24px";

    if (isAutomationChannel) {
      const automationColors: ChannelColors = ColorConfig.getChannelColor(
        this.doc.song,
        this.doc.channel,
      );
      ColorConfig.applyChannelColors(this.#automationEditorRow, automationColors);
    }
    const editorRow: HTMLDivElement = isAutomationChannel
        ? this.#automationEditorRow
        : this.#patternEditorRow,
      eventHeight: number = editorRow.clientHeight / this.doc.getVisiblePitchCount(),
      targetBeatWidth: number = eventHeight * 5,
      minBeatWidth: number = editorRow.clientWidth / (this.doc.song.beatsPerBar * 3),
      maxBeatWidth: number = editorRow.clientWidth / (this.doc.song.beatsPerBar + 2),
      beatWidth: number = Math.max(minBeatWidth, Math.min(maxBeatWidth, targetBeatWidth)),
      editorWidth: number = beatWidth * this.doc.song.beatsPerBar,
      editors: readonly (PatternEditor | AutomationEditor)[] = isAutomationChannel
        ? [this.#automationEditorPrev, this.#automationEditor, this.#automationEditorNext]
        : [this.#patternEditorPrev, this.#patternEditor, this.#patternEditorNext];
    for (const editor of editors) {
      editor.container.style.width = `${editorWidth}px`;
      editor.container.style.flexShrink = "0";
    }
    for (const editor of editors) {
      editor.render();
    }

    this.#automationChannelsStepper.value = this.doc.song.automationChannelCount.toString();

    if (isAutomationChannel) {
      setSelectedValue(this.#scaleSelect, this.doc.song.scale);
      setSelectedValue(this.#keySelect, Config.keys.length - 1 - this.doc.song.composingKey);
      setSelectedValue(this.#legacyKeySelect, Config.keys.length - 1 - this.doc.song.key);
      this.#tempoStepper.value = this.doc.song.tempo.toString();
      setSelectedValue(this.#rhythmSelect, this.doc.song.rhythm);
      this.#beatsPerBarStepper.value = this.doc.song.beatsPerBar.toString();
      this.#songLengthStepper.value = this.doc.song.barCount.toString();
      this.#pitchChannelsStepper.value = this.doc.song.pitchChannelCount.toString();
      this.#drumChannelsStepper.value = this.doc.song.noiseChannelCount.toString();
      this.#maxPatternsStepper.value = this.doc.song.patternsPerChannel.toString();
      this.#instrumentSettingsControls.style.display = "none";
      this.#automationSettings.container.style.display = "";
      this.#automationSettings.render();
      ColorConfig.applyChannelColors(
        this.#automationSettings.container,
        ColorConfig.getChannelColor(this.doc.song, this.doc.channel),
      );
      this.#setPrompt(this.doc.prompt);
      if (prefs.autoFollow && !this.doc.synth.playing) {
        this.doc.synth.goToBar(this.doc.bar);
      }
      return;
    }

    this.#instrumentSettingsControls.style.display = "";
    this.#automationSettings.container.style.display = "none";

    const channel: Channel = this.doc.song.channels[this.doc.channel]!,
      instrumentIndex: number = this.doc.getCurrentInstrument(),
      instrument: Instrument = channel.instruments[instrumentIndex]!,
      wasActive: boolean = this.mainLayer.contains(document.activeElement),
      activeElement: Element | null = document.activeElement,
      colors: ChannelColors = ColorConfig.getChannelColor(this.doc.song, this.doc.channel);

    if (this.#effectsSelect.childElementCount === 1) {
      for (const group of Config.effectGroups) {
        const effectGroupElement: HTMLOptGroupElement = document.createElement("optgroup");
        effectGroupElement.label = group.name;
        for (const effect of group.effects) {
          effectGroupElement.append(option({ value: effect }));
        }
        this.#effectsSelect.append(effectGroupElement);
      }
    }
    this.#effectsSelect.selectedIndex = 0;
    for (let i = 0; i < Config.effectOrder.length; i++) {
      const effectFlag: number = Config.effectOrder[i]!,
        selected: boolean = (instrument.effects & (1 << effectFlag)) !== 0,
        effectLabel: string = (selected ? "✓ " : "　") + Config.effectNames[effectFlag]!,
        effectOption: HTMLOptionElement = this.#effectsSelect.querySelector(
          `option[value="${effectFlag}"]`,
        ) as HTMLOptionElement;
      if (effectOption.textContent !== effectLabel) {
        effectOption.textContent = effectLabel;
      }
    }

    setSelectedValue(this.#scaleSelect, this.doc.song.scale);
    this.#scaleSelect.title = Config.scales[this.doc.song.scale]!.realName;
    setSelectedValue(this.#keySelect, Config.keys.length - 1 - this.doc.song.composingKey);
    setSelectedValue(this.#legacyKeySelect, Config.keys.length - 1 - this.doc.song.key);
    this.#tempoSlider.updateValue(
      Math.max(0, Math.min(28, Math.round(4.0 + 9.0 * Math.log2(this.doc.song.tempo / 120.0)))),
    );
    this.#tempoStepper.value = this.doc.song.tempo.toString();
    setSelectedValue(this.#rhythmSelect, this.doc.song.rhythm);
    this.#beatsPerBarStepper.value = this.doc.song.beatsPerBar.toString();
    this.#songLengthStepper.value = this.doc.song.barCount.toString();
    this.#pitchChannelsStepper.value = this.doc.song.pitchChannelCount.toString();
    this.#drumChannelsStepper.value = this.doc.song.noiseChannelCount.toString();
    this.#maxPatternsStepper.value = this.doc.song.patternsPerChannel.toString();
    const chipWave =
      instrument.type === InstrumentType.chip ? Config.chipWaves[instrument.chipWave]! : undefined;
    this.#presetButton.textContent =
      instrument.type === InstrumentType.soundFont
        ? this.#getSoundFontPresetName(instrument.soundFontId, instrument.soundFontPreset)
        : chipWave?.sampleId !== undefined
          ? chipWave.name
          : (EditorConfig.valueToPreset(instrument.preset)?.name ?? "Preset");
    this.#instrumentSettings.setSpecificInstrumentType(instrument.type);

    if (this.doc.song.getChannelIsNoise(this.doc.channel)) {
      this.#pitchedPresetSelect.style.display = "none";
      this.#drumPresetSelect.style.display = "";
      setSelectedValue(this.#drumPresetSelect, instrument.preset);
    } else {
      this.#pitchedPresetSelect.style.display = "";
      this.#drumPresetSelect.style.display = "none";
      setSelectedValue(this.#pitchedPresetSelect, instrument.preset);
    }

    if (instrument.type === InstrumentType.noise) {
      this.#chipNoiseSelectRow.style.display = "";
      setSelectedValue(this.#chipNoiseSelect, instrument.chipNoise);
    } else {
      this.#chipNoiseSelectRow.style.display = "none";
    }
    if (instrument.type === InstrumentType.spectrum) {
      this.#spectrumRow.style.display = "";
      this.#spectrumEditor.render();
    } else {
      this.#spectrumRow.style.display = "none";
    }
    if (
      instrument.type === InstrumentType.harmonics ||
      instrument.type === InstrumentType.pickedString
    ) {
      this.#harmonicsRow.style.display = "";
      this.#harmonicsEditor.render();
    } else {
      this.#harmonicsRow.style.display = "none";
    }
    if (instrument.type === InstrumentType.pickedString) {
      this.#stringSustainRow.style.display = "";
      this.#stringSustainSlider.updateValue(instrument.stringSustain);
      this.#stringSustainLabel.textContent = Config.enableAcousticSustain
        ? `Sustain (${Config.sustainTypeNames[instrument.stringSustainType]!.substring(
            0,
            1,
          ).toUpperCase()})`
        : "Sustain";
    } else {
      this.#stringSustainRow.style.display = "none";
    }
    this.#fadeInOutRow.style.display = "";
    this.#fadeInOutEditor.render();
    if (instrument.type === InstrumentType.drumset) {
      this.#drumsetGroup.style.display = "";
      for (let i = 0; i < Config.drumCount; i++) {
        setSelectedValue(this.#drumsetEnvelopeSelects[i]!, instrument.drumsetEnvelopes[i]!);
        this.#drumsetEnvelopeParameterEditors[i]!.render(instrument.drumsetEnvelopes[i]!, {
          speed: instrument.drumsetEnvelopeSpeeds[i]!,
          a: instrument.drumsetEnvelopeAs[i]!,
          b: instrument.drumsetEnvelopeBs[i]!,
        });
        this.#drumsetSpectrumEditors[i]!.render();
      }
    } else {
      this.#drumsetGroup.style.display = "none";
    }

    this.#syncChipWaveOptions();
    this.#syncSoundFontOptions();
    this.#updateAssetLoadingIndicator();
    if (instrument.type === InstrumentType.chip) {
      this.#chipWaveEditor.container.style.display = "";
      this.#chipWaveEditor.render(
        instrument.chipWave,
        instrument.chipWaveSettings.pitch,
        instrument.chipWaveSettings.tempo,
      );
    } else {
      this.#chipWaveEditor.container.style.display = "none";
    }
    if (instrument.type === InstrumentType.soundFont) {
      this.#soundFontSelectRow.style.display = "";
      this.#syncSoundFontOptions();
    } else {
      this.#soundFontSelectRow.style.display = "none";
      this.#soundFontPresetSelectRow.style.display = "none";
    }
    if (instrument.type === InstrumentType.fm) {
      this.#algorithmSelectRow.style.display = "";
      this.#phaseModGroup.style.display = "";
      this.#feedbackRow1.style.display = "";
      this.#feedbackRow2.style.display = "";
      setSelectedValue(this.#algorithmSelect, instrument.algorithm);
      setSelectedValue(this.#feedbackTypeSelect, instrument.feedbackType);
      this.#feedbackAmplitudeSlider.updateValue(instrument.feedbackAmplitude);
      for (let i = 0; i < Config.operatorCount; i++) {
        const isCarrier: boolean = i < Config.algorithms[instrument.algorithm]!.carrierCount;
        this.#operatorRows[i]!.style.color = colors.primaryButton[0];
        this.#operatorFrequencyInputs[i]!.updateValue(instrument.operators[i]!.frequency);
        this.#operatorWaveEditors[i]!.render(
          instrument.operators[i]!.wave,
          instrument.operators[i]!.chipWaveSettings.pitch,
          instrument.operators[i]!.chipWaveSettings.tempo,
        );
        this.#operatorAmplitudeSliders[i]!.updateValue(instrument.operators[i]!.amplitude);
        const operatorName: string = (isCarrier ? "Voice " : "Modulator ") + (i + 1);
        this.#operatorFrequencyInputs[i]!.input.title = `${operatorName} Frequency`;
        this.#operatorWaveSelects[i]!.title = `${operatorName} Waveform`;
        this.#operatorWaveButtons[i]!.title = `${
          (this.#operatorWaveRows[i]!.style.display === "none" ? "Show " : "Hide ") +
          operatorName.toLowerCase()
        } waveform`;
        this.#operatorWaveButtons[i]!.setAttribute(
          "aria-label",
          this.#operatorWaveButtons[i]!.title,
        );
        this.#operatorAmplitudeSliders[i]!.input.title =
          operatorName + (isCarrier ? " Volume" : " Amplitude");
      }
    } else {
      this.#algorithmSelectRow.style.display = "none";
      this.#phaseModGroup.style.display = "none";
      this.#feedbackRow1.style.display = "none";
      this.#feedbackRow2.style.display = "none";
    }
    if (instrument.type === InstrumentType.supersaw) {
      this.#supersawDynamismRow.style.display = "";
      this.#supersawSpreadRow.style.display = "";
      this.#supersawShapeRow.style.display = "";
      this.#supersawDynamismSlider.updateValue(instrument.supersawDynamism);
      this.#supersawSpreadSlider.updateValue(instrument.supersawSpread);
      this.#supersawShapeSlider.updateValue(instrument.supersawShape);
    } else {
      this.#supersawDynamismRow.style.display = "none";
      this.#supersawSpreadRow.style.display = "none";
      this.#supersawShapeRow.style.display = "none";
    }
    if (instrument.type === InstrumentType.pwm || instrument.type === InstrumentType.supersaw) {
      this.#pulseWidthRow.style.display = "";
      this.#pulseWidthSlider.container.title = `${prettyNumber(getPulseWidthRatio(instrument.pulseWidth) * 100)}%`;
      this.#pulseWidthSlider.updateValue(instrument.pulseWidth);
    } else {
      this.#pulseWidthRow.style.display = "none";
    }

    if (effectsIncludeTransition(instrument.effects)) {
      this.#transitionRow.style.display = "";
      setSelectedValue(this.#transitionSelect, instrument.transition);
    } else {
      this.#transitionRow.style.display = "none";
    }

    if (effectsIncludeChord(instrument.effects)) {
      this.#chordSelectRow.style.display = "";
      setSelectedValue(this.#chordSelect, instrument.chord);
    } else {
      this.#chordSelectRow.style.display = "none";
    }

    if (effectsIncludePitchShift(instrument.effects)) {
      this.#pitchShiftRow.style.display = "";
      this.#pitchShiftSlider.updateValue(instrument.pitchShift);
      this.#pitchShiftSlider.container.title = `${instrument.pitchShift - Config.pitchShiftCenter} semitone(s)`;
      for (const marker of this.#pitchShiftFifthMarkers) {
        marker.style.display = "";
      }
    } else {
      this.#pitchShiftRow.style.display = "none";
    }

    if (effectsIncludeDetune(instrument.effects)) {
      this.#detuneRow.style.display = "";
      this.#detuneSlider.updateValue(instrument.detune);
      this.#detuneSlider.container.title = `${Synth.detuneToCents(
        instrument.detune - Config.detuneCenter,
      )} cent(s)`;
    } else {
      this.#detuneRow.style.display = "none";
    }

    if (effectsIncludeVibrato(instrument.effects)) {
      this.#vibratoSelectRow.style.display = "";
      setSelectedValue(this.#vibratoSelect, instrument.vibrato);
    } else {
      this.#vibratoSelectRow.style.display = "none";
    }

    if (effectsIncludeNoteFilter(instrument.effects)) {
      this.#noteFilterRow.style.display = "";
      this.#noteFilterEditor.render();
    } else {
      this.#noteFilterRow.style.display = "none";
    }

    if (effectsIncludeDistortion(instrument.effects)) {
      this.#distortionRow.style.display = "";
      this.#distortionSlider.updateValue(instrument.distortion);
    } else {
      this.#distortionRow.style.display = "none";
    }

    if (effectsIncludeBitcrusher(instrument.effects)) {
      this.#bitcrusherQuantizationRow.style.display = "";
      this.#bitcrusherFreqRow.style.display = "";
      this.#bitcrusherQuantizationSlider.updateValue(instrument.bitcrusherQuantization);
      this.#bitcrusherFreqSlider.updateValue(instrument.bitcrusherFreq);
    } else {
      this.#bitcrusherQuantizationRow.style.display = "none";
      this.#bitcrusherFreqRow.style.display = "none";
    }

    const panPercent: number = panSettingToPercent(instrument.pan);
    this.#panSlider.updateValue(panPercent);
    this.#panInput.updateValue(panPercent);

    if (effectsIncludeChorus(instrument.effects)) {
      this.#chorusRow.style.display = "";
      this.#chorusSlider.updateValue(instrument.chorus);
    } else {
      this.#chorusRow.style.display = "none";
    }

    if (effectsIncludeEcho(instrument.effects)) {
      this.#echoSustainRow.style.display = "";
      this.#echoSustainSlider.updateValue(instrument.echoSustain);
      this.#echoDelayRow.style.display = "";
      this.#echoDelaySlider.updateValue(instrument.echoDelay);
      this.#echoDelaySlider.container.title = `${
        Math.round(this.#echoDelayToBeats(instrument.echoDelay) * 1000) / 1000
      } beat(s)`;
    } else {
      this.#echoSustainRow.style.display = "none";
      this.#echoDelayRow.style.display = "none";
    }

    if (effectsIncludeReverb(instrument.effects)) {
      this.#reverbRow.style.display = "";
      this.#reverbSlider.updateValue(instrument.reverb);
    } else {
      this.#reverbRow.style.display = "none";
    }

    if (effectsIncludeUnison(instrument.effects)) {
      this.#unisonSelectRow.style.display = "";
      setSelectedValue(this.#unisonSelect, instrument.unison);
    } else {
      this.#unisonSelectRow.style.display = "none";
    }

    this.#envelopeEditor.render();

    for (let chordIndex = 0; chordIndex < Config.chords.length; chordIndex++) {
      const hidden: boolean =
          !Config.instrumentTypeHasSpecialInterval[instrument.type]! &&
          Config.chords[chordIndex]!.customInterval,
        chordOption: Element = this.#chordSelect.children[chordIndex]!;
      if (hidden) {
        if (!chordOption.hasAttribute("hidden")) {
          chordOption.setAttribute("hidden", "");
        }
      } else {
        chordOption.removeAttribute("hidden");
      }
    }

    this.#instrumentsButtonRow.style.display = "";

    this.#instrumentsButtonBar.style.setProperty("--text-color-lit", colors.primaryButton[0]);
    this.#instrumentsButtonBar.style.setProperty(
      "--background-color-lit",
      colors.primaryChannel[0],
    );

    const maxInstrumentsPerChannel = this.doc.song.getMaxInstrumentsPerChannel();
    while (this.#instrumentButtons.length < channel.instruments.length) {
      const instrumentButton: HTMLButtonElement = button(
        String(this.#instrumentButtons.length + 1),
      );
      this.#instrumentButtons.push(instrumentButton);
      this.#instrumentButtonsScroller.append(instrumentButton);
    }
    for (let i: number = this.#renderedInstrumentCount; i < channel.instruments.length; i++) {
      this.#instrumentButtons[i]!.style.display = "";
    }
    for (let i: number = channel.instruments.length; i < this.#renderedInstrumentCount; i++) {
      this.#instrumentButtons[i]!.style.display = "none";
    }
    this.#renderedInstrumentCount = channel.instruments.length;
    while (this.#instrumentButtons.length > maxInstrumentsPerChannel) {
      this.#instrumentButtonsScroller.removeChild(this.#instrumentButtons.pop()!);
    }

    this.#instrumentRemoveButton.style.display =
      channel.instruments.length > Config.instrumentCountMin ? "" : "none";
    this.#instrumentAddButton.style.display =
      channel.instruments.length < maxInstrumentsPerChannel ? "" : "none";
    this.#instrumentRemoveButton.classList.toggle(
      "last-button",
      !(channel.instruments.length < maxInstrumentsPerChannel),
    );
    if (channel.instruments.length > 1) {
      if (this.#highlightedInstrumentIndex !== instrumentIndex) {
        const oldButton: HTMLButtonElement =
          this.#instrumentButtons[this.#highlightedInstrumentIndex]!;
        if (oldButton != null) {
          oldButton.classList.remove("selected-instrument");
        }
        const newButton: HTMLButtonElement = this.#instrumentButtons[instrumentIndex]!;
        newButton.classList.add("selected-instrument");
        newButton.scrollIntoView({ block: "nearest", inline: "nearest" });
        this.#highlightedInstrumentIndex = instrumentIndex;
      }
    } else {
      const oldButton: HTMLButtonElement =
        this.#instrumentButtons[this.#highlightedInstrumentIndex]!;
      if (oldButton != null) {
        oldButton.classList.remove("selected-instrument");
      }
      this.#highlightedInstrumentIndex = -1;
    }

    if (effectsIncludeEqFilter(instrument.effects)) {
      this.#eqFilterRow.style.display = "";
      this.#eqFilterEditor.render();
    } else {
      this.#eqFilterRow.style.display = "none";
    }
    this.#instrumentVolumeSlider.updateValue(instrument.volume);
    this.#instrumentVolumeInput.updateValue(instrument.volume);
    this.#addEnvelopeButton.disabled = instrument.envelopeCount >= Config.maxEnvelopeCount;
    this.#instrumentSettingsControls.style.color = colors.primaryButton[0];

    // If an interface element was selected, but becomes invisible (e.g. an instrument
    // Select menu) just select the editor container so keyboard commands still work.
    if (wasActive && activeElement != null && activeElement.clientWidth === 0) {
      this.#refocusStage();
    }

    this.#setPrompt(this.doc.prompt);

    if (prefs.autoFollow && !this.doc.synth.playing) {
      this.doc.synth.goToBar(this.doc.bar);
    }

    // When adding effects or envelopes to an instrument in fullscreen modes,
    // Auto-scroll the settings areas to ensure the new settings are visible.
    if (this.doc.addedEffect) {
      // TODO: This is pretty janky! I'd prefer to not have to rely on getBoundingClientRect().
      const envButtonRect: DOMRect = this.#addEnvelopeButton.getBoundingClientRect(),
        instSettingsRect: DOMRect = this.#instrumentSettingsArea.getBoundingClientRect(),
        settingsRect: DOMRect = this.#settingsArea.getBoundingClientRect();
      this.#instrumentSettingsArea.scrollTop += Math.max(
        0,
        envButtonRect.top - (instSettingsRect.top + instSettingsRect.height),
      );
      this.#settingsArea.scrollTop += Math.max(
        0,
        envButtonRect.top - (settingsRect.top + settingsRect.height),
      );
      this.doc.addedEffect = false;
    }
    if (this.doc.addedEnvelope) {
      this.#instrumentSettingsArea.scrollTop = this.#instrumentSettingsArea.scrollHeight;
      this.#settingsArea.scrollTop = this.#settingsArea.scrollHeight;
      this.doc.addedEnvelope = false;
    }
  };

  public updatePlayButton = (): void => {
    const showRecordButton = !this.doc.song.getChannelIsAutomation(this.doc.channel);
    if (
      this.#renderedIsPlaying !== this.doc.synth.playing ||
      this.#renderedIsRecording !== this.doc.synth.recording ||
      this.#renderedShowRecordButton !== showRecordButton ||
      this.#renderedCtrlHeld !== activeModifierKeys.ctrl
    ) {
      this.#renderedIsPlaying = this.doc.synth.playing;
      this.#renderedIsRecording = this.doc.synth.recording;
      this.#renderedShowRecordButton = showRecordButton;
      this.#renderedCtrlHeld = activeModifierKeys.ctrl;

      if (
        document.activeElement === this.#playButton ||
        document.activeElement === this.#pauseButton ||
        document.activeElement === this.#recordButton ||
        document.activeElement === this.#stopButton
      ) {
        // When a focused element is hidden, focus is transferred to the document, so let's refocus the editor instead to make sure we can still capture keyboard input.
        this.#refocusStage();
      }

      this.#playButton.style.display = "none";
      this.#pauseButton.style.display = "none";
      this.#recordButton.style.display = "none";
      this.#stopButton.style.display = "none";
      this.#prevBarButton.style.display = "";
      this.#nextBarButton.style.display = "";
      this.#playButton.classList.remove("shrunk");
      this.#recordButton.classList.remove("shrunk");
      this.#patternEditorRow.style.pointerEvents = "";
      this.#octaveScrollBar.container.style.pointerEvents = "";
      this.#octaveScrollBar.container.style.opacity = "";
      this.#trackContainer.style.pointerEvents = "";
      this.#loopEditor.container.style.opacity = "";
      this.#instrumentSettingsArea.style.pointerEvents = "";
      this.#instrumentSettingsArea.style.opacity = "";
      this.#menuArea.style.pointerEvents = "";
      this.#menuArea.style.opacity = "";
      this.#songSettingsArea.style.pointerEvents = "";
      this.#songSettingsArea.style.opacity = "";

      if (this.doc.synth.recording) {
        this.#stopButton.style.display = "";
        this.#prevBarButton.style.display = "none";
        this.#nextBarButton.style.display = "none";
        this.#patternEditorRow.style.pointerEvents = "none";
        this.#octaveScrollBar.container.style.pointerEvents = "none";
        this.#octaveScrollBar.container.style.opacity = "0.5";
        this.#trackContainer.style.pointerEvents = "none";
        this.#loopEditor.container.style.opacity = "0.5";
        this.#instrumentSettingsArea.style.pointerEvents = "none";
        this.#instrumentSettingsArea.style.opacity = "0.5";
        this.#menuArea.style.pointerEvents = "none";
        this.#menuArea.style.opacity = "0.5";
        this.#songSettingsArea.style.pointerEvents = "none";
        this.#songSettingsArea.style.opacity = "0.5";
      } else if (this.doc.synth.playing) {
        this.#pauseButton.style.display = "";
      } else {
        this.#playButton.style.display = "";
        this.#recordButton.style.display = showRecordButton ? "" : "none";
        this.#playButton.classList.toggle("shrunk", showRecordButton);
        this.#recordButton.classList.toggle("shrunk", showRecordButton);
      }
    }
    window.requestAnimationFrame(this.updatePlayButton);
  };

  #onTrackAreaScroll = (_event: Event): void => {
    this.doc.barScrollPos = this.#trackAndMuteContainer.scrollLeft / this.doc.getBarWidth();
    this.doc.channelScrollPos = this.#trackAndMuteContainer.scrollTop / ChannelRow.patternHeight;
    //This.doc.notifier.changed();
  };

  #disableCtrlContextMenu = (event: MouseEvent): boolean => {
    // On a Mac, clicking while holding control opens the right-click context menu.
    // But in the pattern and track editors I'd rather prevent that and instead allow
    // Custom behaviors such as setting the volume of a note.
    if (event.ctrlKey) {
      event.preventDefault();
      return false;
    }
    return true;
  };

  #whenKeyPressed = (event: KeyboardEvent): void => {
    if (this.prompt) {
      if (event.keyCode === 27) {
        // ESC key
        // Close prompt.
        this.#closePrompt();
      }
      return;
    }

    if (
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLInputElement &&
        ["email", "number", "password", "search", "tel", "text", "url"].includes(event.target.type))
    ) {
      return;
    }

    if (this.doc.synth.recording) {
      // The only valid keyboard interactions when recording are playing notes or pressing space OR P to stop.
      if (!event.ctrlKey && !event.metaKey) {
        this.#keyboardLayout.handleKeyEvent(event, true);
      }
      if (event.keyCode === 32) {
        // Space
        this.#toggleRecord();
        event.preventDefault();
        this.#refocusStage();
      } else if (event.keyCode === 80 && (event.ctrlKey || event.metaKey)) {
        // P
        this.#toggleRecord();
        event.preventDefault();
        this.#refocusStage();
      }
      return;
    }

    const needControlForShortcuts: boolean = this.doc.prefs.pressControlForShortcuts,
      canPlayNotes: boolean = !event.ctrlKey && !event.metaKey && needControlForShortcuts;
    if (canPlayNotes) {
      this.#keyboardLayout.handleKeyEvent(event, true);
    }

    switch (event.keyCode) {
      case 27: {
        // ESC key
        if (!event.ctrlKey && !event.metaKey) {
          if (this.#automationPatternEditorIsActive()) {
            this.#automationEditor.clearSelection();
          } else {
            new ChangePatternSelection(this.doc, 0, 0);
          }
          this.doc.selection.resetBoxSelection();
        }
        break;
      }
      case 32: {
        // space
        if (event.ctrlKey) {
          this.#toggleRecord();
        } else if (event.shiftKey) {
          // Jump to mouse
          if (
            this.#trackEditor.movePlayheadToMouse() ||
            (this.doc.song.getChannelIsAutomation(this.doc.channel)
              ? this.#automationEditor.movePlayheadToMouse()
              : this.#patternEditor.movePlayheadToMouse())
          ) {
            if (!this.doc.synth.playing) {
              this.doc.performance.play();
            }
          }
        } else {
          this.#togglePlay();
        }
        event.preventDefault();
        this.#refocusStage();
        break;
      }
      case 80: {
        // p
        if (canPlayNotes) {
          break;
        }
        if (event.ctrlKey || event.metaKey) {
          this.#toggleRecord();
          event.preventDefault();
          this.#refocusStage();
        }
        break;
      }
      case 90: {
        // z
        if (canPlayNotes) {
          break;
        }
        if (event.shiftKey) {
          this.doc.redo();
        } else {
          this.doc.undo();
        }
        event.preventDefault();
        break;
      }
      case 89: {
        // y
        if (canPlayNotes) {
          break;
        }
        this.doc.redo();
        event.preventDefault();
        break;
      }
      case 67: {
        // c
        if (canPlayNotes) {
          break;
        }
        if (event.shiftKey) {
          this.#copyInstrument();
        } else if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.copy();
        } else {
          this.doc.selection.copy();
        }
        event.preventDefault();
        break;
      }
      case 88: {
        // x
        if (canPlayNotes) {
          break;
        }
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.cut();
        } else {
          this.doc.selection.cut();
        }
        event.preventDefault();
        break;
      }
      case 81: {
        // q
        if (!event.shiftKey || event.ctrlKey || event.metaKey) {
          break;
        }
        this.#openPrompt("assets");
        event.preventDefault();
        break;
      }
      case 13: {
        // enter/return
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.insertChannel();
        } else {
          this.doc.selection.insertBars();
        }
        event.preventDefault();
        break;
      }
      case 8: {
        // backspace/delete
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.deleteChannel();
        } else if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.deleteSelected();
        } else {
          this.doc.selection.deleteBars();
        }
        event.preventDefault();
        break;
      }
      case 65: {
        // a
        if (canPlayNotes) {
          break;
        }
        if (!event.shiftKey && this.#automationPatternEditorIsActive()) {
          this.#automationEditor.selectAll();
        } else if (event.shiftKey) {
          this.doc.selection.selectChannel();
        } else {
          this.doc.selection.selectAll();
        }
        event.preventDefault();
        break;
      }
      case 68: {
        // d
        if (canPlayNotes) {
          break;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
          this.doc.record(new ChangeRectifyPatterns(this.doc));
          event.preventDefault();
        } else if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.duplicatePatterns();
          event.preventDefault();
        }
        break;
      }
      case 70: {
        // f
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.synth.snapToStart();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(this.doc.channel, Math.floor(this.doc.synth.playhead));
          }
          event.preventDefault();
        }
        break;
      }
      case 72: {
        // h
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToBar(this.doc.bar);
          this.doc.synth.snapToBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(this.doc.channel, Math.floor(this.doc.synth.playhead));
          }
          event.preventDefault();
        }
        break;
      }
      case 77: {
        // m
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.muteChannels(event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 83: {
        // s
        if (canPlayNotes) {
          break;
        }
        if (event.ctrlKey || event.metaKey) {
          this.#openPrompt("export");
        } else {
          this.doc.selection.soloChannels(event.shiftKey);
        }
        event.preventDefault();
        break;
      }
      case 79: {
        // o
        if (canPlayNotes) {
          break;
        }
        if (event.ctrlKey || event.metaKey) {
          this.#importFile.open();
          event.preventDefault();
        }
        break;
      }
      case 86: {
        // v
        if (canPlayNotes) {
          break;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && !needControlForShortcuts) {
          this.doc.selection.pasteNumbers();
        } else if (event.shiftKey) {
          this.#pasteInstrument();
        } else if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.paste();
        } else {
          this.doc.selection.pasteNotes();
        }
        event.preventDefault();
        break;
      }
      case 82: {
        // r
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          if (event.shiftKey) {
            this.#randomGenerated();
          } else {
            this.#randomPreset();
          }
          event.preventDefault();
        }
        break;
      }
      case 219: {
        // left brace
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToPrevBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(this.doc.channel, Math.floor(this.doc.synth.playhead));
          }
          event.preventDefault();
        }
        break;
      }
      case 221: {
        // right brace
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToNextBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(this.doc.channel, Math.floor(this.doc.synth.playhead));
          }
          event.preventDefault();
        }
        break;
      }
      case 189: // -
      case 173: {
        // Firefox -
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.transpose(false, event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 187: // +
      case 61: // Firefox +
      case 171: {
        // Some users have this as +? Hmm.
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.transpose(true, event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 38: {
        // up
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.swapChannels(-1);
        } else if (event.shiftKey) {
          this.doc.selection.boxSelectionY1 = Math.max(0, this.doc.selection.boxSelectionY1 - 1);
          this.doc.selection.scrollToEndOfSelection();
          this.doc.selection.selectionUpdated();
        } else {
          this.doc.selection.setChannelBar(
            (this.doc.channel - 1 + this.doc.song.getChannelCount()) %
              this.doc.song.getChannelCount(),
            this.doc.bar,
          );
          this.doc.selection.resetBoxSelection();
        }
        event.preventDefault();
        break;
      }
      case 40: {
        // down
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.swapChannels(1);
        } else if (event.shiftKey) {
          this.doc.selection.boxSelectionY1 = Math.min(
            this.doc.song.getChannelCount() - 1,
            this.doc.selection.boxSelectionY1 + 1,
          );
          this.doc.selection.scrollToEndOfSelection();
          this.doc.selection.selectionUpdated();
        } else {
          this.doc.selection.setChannelBar(
            (this.doc.channel + 1) % this.doc.song.getChannelCount(),
            this.doc.bar,
          );
          this.doc.selection.resetBoxSelection();
        }
        event.preventDefault();
        break;
      }
      case 37: {
        // left
        if (event.shiftKey) {
          this.doc.selection.boxSelectionX1 = Math.max(0, this.doc.selection.boxSelectionX1 - 1);
          this.doc.selection.scrollToEndOfSelection();
          this.doc.selection.selectionUpdated();
        } else {
          this.doc.selection.setChannelBar(
            this.doc.channel,
            (this.doc.bar + this.doc.song.barCount - 1) % this.doc.song.barCount,
          );
          this.doc.selection.resetBoxSelection();
        }
        event.preventDefault();
        break;
      }
      case 39: {
        // right
        if (event.shiftKey) {
          this.doc.selection.boxSelectionX1 = Math.min(
            this.doc.song.barCount - 1,
            this.doc.selection.boxSelectionX1 + 1,
          );
          this.doc.selection.scrollToEndOfSelection();
          this.doc.selection.selectionUpdated();
        } else {
          this.doc.selection.setChannelBar(
            this.doc.channel,
            (this.doc.bar + 1) % this.doc.song.barCount,
          );
          this.doc.selection.resetBoxSelection();
        }
        event.preventDefault();
        break;
      }
      case 48: {
        // 0
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("0", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 49: {
        // 1
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("1", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 50: {
        // 2
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("2", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 51: {
        // 3
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("3", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 52: {
        // 4
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("4", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 53: {
        // 5
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("5", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 54: {
        // 6
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("6", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 55: {
        // 7
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("7", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 56: {
        // 8
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("8", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      case 57: {
        // 9
        if (canPlayNotes) {
          break;
        }
        if (needControlForShortcuts === (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("9", event.shiftKey);
          event.preventDefault();
        }
        break;
      }
      default: {
        this.doc.selection.digits = "";
        this.doc.selection.instrumentDigits = "";
        break;
      }
    }

    if (canPlayNotes) {
      this.doc.selection.digits = "";
      this.doc.selection.instrumentDigits = "";
    }
  };

  #whenKeyReleased = (event: KeyboardEvent): void => {
    // Release live pitches regardless of control so that any pitches played before will get released even if the modifier keys changed.
    this.#keyboardLayout.handleKeyEvent(event, false);
  };

  #copyTextToClipboard(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        window.prompt("Copy to clipboard:", text);
      });
      return;
    }
    const textField: HTMLTextAreaElement = document.createElement("textarea");
    textField.textContent = text;
    document.body.append(textField);
    textField.select();
    const succeeded: boolean = document.execCommand("copy");
    textField.remove();
    this.#refocusStage();
    if (!succeeded) {
      window.prompt("Copy this:", text);
    }
  }

  #whenPrevBarPressed = (): void => {
    this.doc.synth.goToPrevBar();
  };

  #whenNextBarPressed = (): void => {
    this.doc.synth.goToNextBar();
  };

  #togglePlay = (): void => {
    if (this.doc.synth.playing) {
      this.doc.performance.pause();
    } else {
      this.doc.synth.snapToBar();
      this.doc.performance.play();
    }
  };

  #toggleRecord = (): void => {
    if (this.doc.song.getChannelIsAutomation(this.doc.channel)) {
      return;
    }
    if (this.doc.synth.playing) {
      this.doc.performance.pause();
    } else {
      this.doc.performance.record();
    }
  };

  #copyInstrument = (): void => {
    if (this.doc.song.getChannelIsAutomation(this.doc.channel)) {
      return;
    }
    window.localStorage.setItem("instrumentCopy", JSON.stringify(this.#getInstrumentCopy()));
    this.#refocusStage();
  };

  #pasteInstrument = (): void => {
    if (this.doc.song.getChannelIsAutomation(this.doc.channel)) {
      return;
    }
    const instrumentCopy: unknown = JSON.parse(
      String(window.localStorage.getItem("instrumentCopy")),
    );
    this.#pasteInstrumentCopy(instrumentCopy);
    this.#refocusStage();
  };

  #getInstrumentCopy(): Record<string, unknown> {
    const channel: Channel = this.doc.song.channels[this.doc.channel]!,
      instrument: Instrument = channel.instruments[this.doc.getCurrentInstrument()]!;
    return instrument.toSettingsObject() as Record<string, unknown>;
  }

  #pasteInstrumentCopy(instrumentCopy: unknown): void {
    if (instrumentCopy != null) {
      const channel: Channel = this.doc.song.channels[this.doc.channel]!,
        instrument: Instrument = channel.instruments[this.doc.getCurrentInstrument()]!;
      this.doc.record(
        new ChangePasteInstrument(this.doc, instrument, instrumentCopy as Record<string, unknown>),
      );
    }
  }

  #copyInstrumentSettingsCategory = (category: InstrumentSettingsCategory): void => {
    window.localStorage.setItem(
      "instrumentSettingsCategoryCopy",
      JSON.stringify(copyInstrumentSettingsCategory(this.#getInstrumentCopy(), category)),
    );
    this.#refocusStage();
  };

  #pasteInstrumentSettingsCategory = (category: InstrumentSettingsCategory): void => {
    try {
      const copy: unknown = JSON.parse(
        String(window.localStorage.getItem("instrumentSettingsCategoryCopy")),
      );
      if (!isInstrumentSettingsCategoryCopy(copy, category)) {
        return;
      }
      this.#recordInstrumentSettingsCategory(
        pasteInstrumentSettingsCategory(this.#getInstrumentCopy(), copy),
      );
    } catch {
      // Ignore malformed clipboard data.
    } finally {
      this.#refocusStage();
    }
  };

  #randomizeInstrumentSettingsCategory = (category: InstrumentSettingsCategory): void => {
    const original = this.#getInstrumentCopy();
    new ChangeRandomGeneratedInstrument(this.doc);
    const generated = copyInstrumentSettingsCategory(this.#getInstrumentCopy(), category);
    this.#recordInstrumentSettingsCategory(pasteInstrumentSettingsCategory(original, generated));
    this.#refocusStage();
  };

  #recordInstrumentSettingsCategory(instrumentCopy: Record<string, unknown>): void {
    const isNoiseChannel = this.doc.song.getChannelIsNoise(this.doc.channel),
      normalized = new Instrument(isNoiseChannel);
    delete instrumentCopy["preset"];
    const envelopes: unknown[] = Array.isArray(instrumentCopy["envelopes"])
      ? instrumentCopy["envelopes"]
      : [];
    normalized.fromSettingsObject({ ...instrumentCopy, envelopes: [] }, isNoiseChannel);
    for (const envelopeObject of envelopes) {
      const envelope = new EnvelopeSettings();
      envelope.fromSettingsObject(envelopeObject);
      if (!normalized.supportsEnvelopeTarget(envelope.target, envelope.index)) {
        envelope.target = Config.modulationTargets.dictionary["none"]!.index;
        envelope.index = 0;
      }
      normalized.addEnvelope(
        envelope.target,
        envelope.index,
        envelope.envelope,
        envelope.speed,
        envelope.a,
        envelope.b,
      );
    }
    const copy = normalized.toSettingsObject() as Record<string, unknown>,
      instrument =
        this.doc.song.channels[this.doc.channel]!.instruments[this.doc.getCurrentInstrument()]!;
    this.doc.record(new ChangePasteInstrument(this.doc, instrument, copy));
  }

  #randomPreset(): void {
    if (this.doc.song.getChannelIsAutomation(this.doc.channel)) {
      return;
    }
    const choices: string[] = getRandomPresetValues().map(String);
    for (const sample of this.#getSamplePresets()) {
      choices.push(`sample:${encodeURIComponent(sample.id)}`);
    }
    for (const soundFont of this.#getSoundFontPresetGroups()) {
      for (const preset of soundFont.presets) {
        choices.push(`soundFont:${encodeURIComponent(soundFont.id)}:${preset.index}`);
      }
    }
    if (choices.length > 0) {
      this.#setPreset(choices[(Math.random() * choices.length) | 0]!);
    }
  }

  #randomGenerated(): void {
    if (this.doc.song.getChannelIsAutomation(this.doc.channel)) {
      return;
    }
    this.doc.record(new ChangeRandomGeneratedInstrument(this.doc));
  }

  #whenSetTempo = (): void => {
    this.doc.record(
      new ChangeTempo(this.doc, -1, Number.parseInt(this.#tempoStepper.value, 10) | 0),
    );
  };

  #validateNumberInput(element: HTMLInputElement): number {
    const value: number = Math.floor(
      Math.max(Number(element.min), Math.min(Number(element.max), Number(element.value))),
    );
    element.value = value.toString();
    return value;
  }

  #whenSetBeatsPerBar = (): void => {
    this.doc.record(
      new ChangeBeatsPerBar(
        this.doc,
        this.#validateNumberInput(this.#beatsPerBarStepper),
        "splice",
      ),
    );
  };

  #whenSetSongLength = (): void => {
    this.doc.record(
      new ChangeBarCount(this.doc, this.#validateNumberInput(this.#songLengthStepper), false),
    );
  };

  #whenSetPitchChannels = (): void => {
    this.doc.record(
      new ChangeChannelCount(
        this.doc,
        this.#validateNumberInput(this.#pitchChannelsStepper),
        this.doc.song.noiseChannelCount,
        this.doc.song.automationChannelCount,
      ),
    );
  };

  #whenSetDrumChannels = (): void => {
    this.doc.record(
      new ChangeChannelCount(
        this.doc,
        this.doc.song.pitchChannelCount,
        this.#validateNumberInput(this.#drumChannelsStepper),
        this.doc.song.automationChannelCount,
      ),
    );
  };

  #whenSetAutomationChannels = (): void => {
    this.doc.record(
      new ChangeChannelCount(
        this.doc,
        this.doc.song.pitchChannelCount,
        this.doc.song.noiseChannelCount,
        this.#validateNumberInput(this.#automationChannelsStepper),
      ),
    );
  };

  #whenSetMaxPatterns = (): void => {
    this.doc.record(
      new ChangePatternsPerChannel(this.doc, this.#validateNumberInput(this.#maxPatternsStepper)),
    );
  };

  #whenSetScale = (): void => {
    this.doc.record(new ChangeScale(this.doc, this.#scaleSelect.selectedIndex));
    if (this.doc.prefs.rememberScaleChoice) {
      this.doc.prefs.defaultScale = this.doc.song.scale;
      this.doc.prefs.save();
    }
  };

  #whenSetKey = (): void => {
    if (this.#keySelect.value === "detectKey") {
      this.doc.record(new ChangeDetectComposingKey(this.doc));
      this.doc.notifier.changed();
    } else {
      this.doc.record(
        new ChangeComposingKey(this.doc, Config.keys.length - 1 - this.#keySelect.selectedIndex),
      );
    }
  };

  #whenSetLegacyKey = (): void => {
    this.doc.record(
      new ChangeKey(this.doc, Config.keys.length - 1 - this.#legacyKeySelect.selectedIndex),
    );
  };

  #toggleLegacyKey = (): void => {
    this.#showLegacyKey = !this.#showLegacyKey;
    this.#legacyKeyRow.style.display = this.#showLegacyKey ? "" : "none";
    this.#legacyKeyButton.textContent = this.#showLegacyKey ? "▴" : "▾";
    this.#legacyKeyButton.title = this.#showLegacyKey
      ? "Hide legacy transposition key"
      : "Show legacy transposition key";
    this.#legacyKeyButton.setAttribute("aria-label", this.#legacyKeyButton.title);
  };

  #whenSetRhythm = (): void => {
    if (isNaN(this.#rhythmSelect.value as unknown as number)) {
      switch (this.#rhythmSelect.value) {
        case "forceRhythm": {
          this.doc.selection.forceRhythm();
          break;
        }
      }
      this.doc.notifier.changed();
    } else {
      this.doc.record(new ChangeRhythm(this.doc, this.#rhythmSelect.selectedIndex));
    }
  };

  #openInstrumentPreset = (): void => {
    this.#openPrompt("instrumentPreset");
  };

  #getSoundFontPresetGroups(): SoundFontPresetGroup[] {
    const groups: SoundFontPresetGroup[] = [],
      usedNames = new Map<string, number>();
    for (const asset of this.doc.song.assets) {
      if (asset.type !== "soundFont") {
        continue;
      }
      const presets = this.doc.synth.getSoundFontPresets(asset.id);
      if (presets == null) {
        continue;
      }
      const baseName: string = asset.name,
        occurrence: number = (usedNames.get(baseName) ?? 0) + 1;
      usedNames.set(baseName, occurrence);
      const name: string = occurrence === 1 ? baseName : `${baseName} (${occurrence})`;
      groups.push({ id: asset.id, name, presets });
    }
    return groups;
  }

  #getSamplePresets(): SamplePresetInfo[] {
    return this.doc.song.assets
      .filter((asset) => asset.type === "sample")
      .map((asset) => ({ id: asset.id, name: asset.name }));
  }

  #getSoundFontPresetName(soundFontId: string | null, presetIndex: number): string {
    if (soundFontId == null) {
      return "SoundFont: none";
    }
    const asset = this.doc.song.assets.find((candidate) => candidate.id === soundFontId),
      preset = this.doc.synth
        .getSoundFontPresets(soundFontId)
        ?.find((candidate) => candidate.index === presetIndex);
    if (preset == null) {
      return asset == null ? "SoundFont Preset" : `${asset.name}: loading…`;
    }
    return `${asset?.name ?? "SoundFont"}: ${preset.name}`;
  }

  #setPreset(preset: string): void {
    const sampleMatch = /^sample:(.+)$/.exec(preset);
    if (sampleMatch != null) {
      this.doc.record(
        new ChangeSamplePresetSelection(this.doc, decodeURIComponent(sampleMatch[1]!)),
      );
      return;
    }
    const soundFontMatch = /^soundFont:([^:]+):(\d+)$/.exec(preset);
    if (soundFontMatch != null) {
      const soundFontId = decodeURIComponent(soundFontMatch[1]!),
        presetIndex = Number.parseInt(soundFontMatch[2]!, 10);
      this.doc.record(new ChangeSoundFontPresetSelection(this.doc, soundFontId, presetIndex));
      return;
    }
    if (isNaN(preset as unknown as number)) {
      switch (preset) {
        case "copyInstrument": {
          this.#copyInstrument();
          break;
        }
        case "pasteInstrument": {
          this.#pasteInstrument();
          break;
        }
        case "randomPreset": {
          this.#randomPreset();
          break;
        }
        case "randomGenerated": {
          this.#randomGenerated();
          break;
        }
      }
      this.doc.notifier.changed();
    } else {
      this.doc.record(new ChangePreset(this.doc, Number.parseInt(preset, 10)));
    }
  }

  #whenSetFeedbackType = (): void => {
    this.doc.record(new ChangeFeedbackType(this.doc, this.#feedbackTypeSelect.selectedIndex));
  };

  #whenSetAlgorithm = (): void => {
    this.doc.record(new ChangeAlgorithm(this.doc, this.#algorithmSelect.selectedIndex));
  };

  #whenSelectInstrument = (event: MouseEvent): void => {
    if (event.target === this.#instrumentAddButton) {
      this.doc.record(new ChangeAddChannelInstrument(this.doc));
    } else if (event.target === this.#instrumentRemoveButton) {
      this.doc.record(new ChangeRemoveChannelInstrument(this.doc));
    } else {
      const index: number = this.#instrumentButtons.indexOf(event.target as HTMLButtonElement);
      if (index !== -1) {
        this.doc.selection.selectInstrument(index);
      }
    }
    this.#refocusStage();
  };

  #whenSetSoundFont = (): void => {
    this.doc.record(new ChangeSoundFont(this.doc, this.#soundFontSelect.value || null));
    this.#syncSoundFontOptions();
  };

  #whenSetSoundFontPreset = (): void => {
    this.doc.record(
      new ChangeSoundFontPreset(
        this.doc,
        Number.parseInt(this.#soundFontPresetSelect.value, 10) || 0,
      ),
    );
  };

  #whenSetNoiseWave = (): void => {
    this.doc.record(new ChangeNoiseWave(this.doc, this.#chipNoiseSelect.selectedIndex));
  };
  #whenSetTransition = (): void => {
    this.doc.record(new ChangeTransition(this.doc, this.#transitionSelect.selectedIndex));
  };

  #whenSetEffects = (): void => {
    const instrument: Instrument =
        this.doc.song.channels[this.doc.channel]!.instruments[this.doc.getCurrentInstrument()]!,
      oldValue: number = instrument.effects,
      toggleFlag = Number((this.#effectsSelect.selectedOptions[0]! as HTMLOptionElement).value);
    this.doc.record(new ChangeToggleEffects(this.doc, toggleFlag));
    this.#effectsSelect.selectedIndex = 0;
    if (instrument.effects > oldValue) {
      this.doc.addedEffect = true;
    }
  };

  #openEffectsMenu = (): void => {
    this.#effectsSelect.focus();
    this.#effectsSelect.click();
  };

  #whenSetVibrato = (): void => {
    this.doc.record(new ChangeVibrato(this.doc, this.#vibratoSelect.selectedIndex));
  };

  #whenSetUnison = (): void => {
    this.doc.record(new ChangeUnison(this.doc, this.#unisonSelect.selectedIndex));
  };

  #whenSetChord = (): void => {
    this.doc.record(new ChangeChord(this.doc, this.#chordSelect.selectedIndex));
  };

  #addNewEnvelope = (): void => {
    this.doc.record(new ChangeAddEnvelope(this.doc));
    this.#refocusStage();
    this.doc.addedEnvelope = true;
  };

  #zoomIn = (): void => {
    this.doc.prefs.visibleOctaves = Math.max(1, this.doc.prefs.visibleOctaves - 1);
    this.doc.prefs.save();
    this.doc.notifier.changed();
    this.#refocusStage();
  };

  #zoomOut = (): void => {
    this.doc.prefs.visibleOctaves = Math.min(
      Config.pitchOctaves,
      this.doc.prefs.visibleOctaves + 1,
    );
    this.doc.prefs.save();
    this.doc.notifier.changed();
    this.#refocusStage();
  };

  #fileMenuHandler = (_event: Event): void => {
    switch (this.#fileMenu.value) {
      case "new": {
        this.doc.goBackToStart();
        for (const channel of this.doc.song.channels) {
          channel.muted = false;
        }
        this.doc.record(new ChangeSong(this.doc, null), false, true);
        break;
      }
      case "export": {
        this.#openPrompt("export");
        break;
      }
      case "import": {
        this.#importFile.open();
        break;
      }
      case "shareUrl": {
        const url: URL = new URL(location.href);
        url.hash = encodeSongUrl(this.doc.song.toBinary());
        this.#copyTextToClipboard(url.href);
        break;
      }
      case "songRecovery": {
        this.#openPrompt("songRecovery");
        break;
      }
    }
    this.#fileMenu.selectedIndex = 0;
  };

  #editMenuHandler = (_event: Event): void => {
    switch (this.#editMenu.value) {
      case "undo": {
        this.doc.undo();
        break;
      }
      case "redo": {
        this.doc.redo();
        break;
      }
      case "copy": {
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.copy();
        } else {
          this.doc.selection.copy();
        }
        break;
      }
      case "cut": {
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.cut();
        } else {
          this.doc.selection.cut();
        }
        break;
      }
      case "insertBars": {
        this.doc.selection.insertBars();
        break;
      }
      case "deleteBars": {
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.deleteSelected();
        } else {
          this.doc.selection.deleteBars();
        }
        break;
      }
      case "insertChannel": {
        this.doc.selection.insertChannel();
        break;
      }
      case "deleteChannel": {
        this.doc.selection.deleteChannel();
        break;
      }
      case "pasteNotes": {
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.paste();
        } else {
          this.doc.selection.pasteNotes();
        }
        break;
      }
      case "pasteNumbers": {
        this.doc.selection.pasteNumbers();
        break;
      }
      case "transposeUp": {
        this.doc.selection.transpose(true, false);
        break;
      }
      case "transposeDown": {
        this.doc.selection.transpose(false, false);
        break;
      }
      case "selectAll": {
        if (this.#automationPatternEditorIsActive()) {
          this.#automationEditor.selectAll();
        } else {
          this.doc.selection.selectAll();
        }
        break;
      }
      case "selectChannel": {
        this.doc.selection.selectChannel();
        break;
      }
      case "duplicatePatterns": {
        this.doc.selection.duplicatePatterns();
        break;
      }
      case "rectifyPatterns": {
        this.doc.record(new ChangeRectifyPatterns(this.doc));
        break;
      }
      case "moveNotesSideways": {
        this.#openPrompt("moveNotesSideways");
        break;
      }
      case "beatsPerBar": {
        this.#openPrompt("beatsPerBar");
        break;
      }
      case "assets": {
        this.#openPrompt("assets");
        break;
      }
    }
    this.#editMenu.selectedIndex = 0;
  };
}
