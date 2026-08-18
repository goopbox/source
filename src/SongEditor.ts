// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  InstrumentType,
  Config,
  getPulseWidthRatio,
  effectsIncludeTransition,
  effectsIncludeChord,
  effectsIncludePitchShift,
  effectsIncludeDetune,
  effectsIncludeVibrato,
  effectsIncludeNoteFilter,
  effectsIncludeDistortion,
  effectsIncludeBitcrusher,
  effectsIncludeChorus,
  effectsIncludeEcho,
  effectsIncludeReverb,
  effectsIncludeUnison,
  effectsIncludeEqFilter,
} from "../synth/SynthConfig.js";
import {
  type Preset,
  type PresetCategory,
  EditorConfig,
  ctrlSymbol,
  prettyNumber,
} from "./EditorConfig.js";
import { ColorConfig, type ChannelColors } from "./ColorConfig.js";
import "./Layout.js"; // Imported here for the sake of ensuring this code is transpiled early.
import {
  Instrument,
  EnvelopeSettings,
  Channel,
  Synth,
} from "../synth/synth.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import {
  EasyPointers,
  activeModifierKeys,
  getElementDimensions,
} from "./EasyPointers.js";
import { Preferences } from "./Preferences.js";
import { SongDocument } from "./SongDocument.js";
import { encodeSongUrl } from "./SongUrl.js";
import { mountPrompt, unmountPrompt, type Prompt } from "./Prompt.js";
import { PatternEditor } from "./PatternEditor.js";
import { EnvelopeEditor, EnvelopeParameterEditor } from "./EnvelopeEditor.js";
import { FadeInOutEditor } from "./FadeInOutEditor.js";
import { FilterEditor } from "./FilterEditor.js";
import { MuteEditor } from "./MuteEditor.js";
import { TrackEditor } from "./TrackEditor.js";
import { ChannelRow } from "./ChannelRow.js";
import { LoopEditor } from "./LoopEditor.js";
import { SpectrumEditor } from "./SpectrumEditor.js";
import { HarmonicsEditor } from "./HarmonicsEditor.js";
import { BarScrollBar } from "./BarScrollBar.js";
import { OctaveScrollBar } from "./OctaveScrollBar.js";
import { KeyboardLayout } from "./KeyboardLayout.js";
import { Piano } from "./Piano.js";
import { MoveNotesSidewaysPrompt } from "./MoveNotesSidewaysPrompt.js";
import { BeatsPerBarPrompt } from "./BeatsPerBarPrompt.js";
import { SustainPrompt } from "./SustainPrompt.js";
import { ExportPrompt } from "./ExportPrompt.js";
import { ImportFile } from "./Import.js";
import type { FlpSongImport } from "./FlpImport.js";
import { FlpInstrumentPrompt } from "./FlpInstrumentPrompt.js";
import { SongRecoveryPrompt } from "./SongRecoveryPrompt.js";
import { PreferencesPrompt } from "./PreferencesPrompt.js";
import { AboutPrompt } from "./AboutPrompt.js";
import { InstrumentSettings } from "./InstrumentSettings.js";
import {
  copyInstrumentSettingsCategory,
  isInstrumentSettingsCategoryCopy,
  pasteInstrumentSettingsCategory,
  type InstrumentSettingsCategory,
} from "./InstrumentSettingsCategory.js";
import {
  InstrumentPresetPrompt,
  type SamplePresetInfo,
  type SoundFontPresetGroup,
} from "./InstrumentPresetPrompt.js";
import { InstrumentTypePrompt } from "./InstrumentTypePrompt.js";
import { AssetsPrompt } from "./AssetsPrompt.js";
import { panPercentToSetting, panSettingToPercent } from "./PanConversion.js";
import { Change } from "./Change.js";
import {
  ChangeTempo,
  ChangeChorus,
  ChangeEchoDelay,
  ChangeEchoSustain,
  ChangeReverb,
  ChangeVolume,
  ChangePan,
  ChangePatternSelection,
  ChangeSupersawDynamism,
  ChangeSupersawSpread,
  ChangeSupersawShape,
  ChangePulseWidth,
  ChangeFeedbackAmplitude,
  ChangeOperatorAmplitude,
  ChangeOperatorFrequency,
  ChangeOperatorWave,
  ChangeDrumsetEnvelope,
  ChangeDrumsetEnvelopeParameter,
  ChangePasteInstrument,
  ChangePreset,
  ChangeRandomGeneratedInstrument,
  ChangeScale,
  ChangeDetectComposingKey,
  ChangeKey,
  ChangeComposingKey,
  ChangeRhythm,
  ChangeFeedbackType,
  ChangeAlgorithm,
  ChangeChipWave,
  ChangeSoundFont,
  ChangeSoundFontPreset,
  ChangeSoundFontPresetSelection,
  ChangeSamplePresetSelection,
  getRandomPresetValues,
  ChangeNoiseWave,
  ChangeTransition,
  ChangeToggleEffects,
  ChangeVibrato,
  ChangeUnison,
  ChangeChord,
  ChangeSong,
  ChangePitchShift,
  ChangeDetune,
  ChangeDistortion,
  ChangeStringSustain,
  ChangeBitcrusherFreq,
  ChangeBitcrusherQuantization,
  ChangeAddEnvelope,
  ChangeAddChannelInstrument,
  ChangeRemoveChannelInstrument,
  ChangeBarCount,
  ChangeBeatsPerBar,
  ChangeChannelCount,
  ChangePatternsPerChannel,
  ChangeRectifyPatterns,
} from "./changes.js";

const { button, div, input, label, select, span, optgroup, option } = HTML;

function buildOptions(
  menu: HTMLSelectElement,
  items: ReadonlyArray<string | number>,
): HTMLSelectElement {
  for (let index: number = 0; index < items.length; index++) {
    menu.appendChild(option({ value: index }, items[index]));
  }
  return menu;
}

function buildPresetOptions(isNoise: boolean): HTMLSelectElement {
  const menu: HTMLSelectElement = select();

  menu.appendChild(
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
    label: EditorConfig.presetCategories[0].name,
  });
  if (isNoise) {
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.noise },
        EditorConfig.valueToPreset(InstrumentType.noise)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.spectrum },
        EditorConfig.valueToPreset(InstrumentType.spectrum)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.drumset },
        EditorConfig.valueToPreset(InstrumentType.drumset)!.name,
      ),
    );
  } else {
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.chip },
        EditorConfig.valueToPreset(InstrumentType.chip)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.pwm },
        EditorConfig.valueToPreset(InstrumentType.pwm)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.supersaw },
        EditorConfig.valueToPreset(InstrumentType.supersaw)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.harmonics },
        EditorConfig.valueToPreset(InstrumentType.harmonics)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.pickedString },
        EditorConfig.valueToPreset(InstrumentType.pickedString)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.spectrum },
        EditorConfig.valueToPreset(InstrumentType.spectrum)!.name,
      ),
    );
    customTypeGroup.appendChild(
      option(
        { value: InstrumentType.fm },
        EditorConfig.valueToPreset(InstrumentType.fm)!.name,
      ),
    );
  }
  menu.appendChild(customTypeGroup);

  for (
    let categoryIndex: number = 1;
    categoryIndex < EditorConfig.presetCategories.length;
    categoryIndex++
  ) {
    const category: PresetCategory =
      EditorConfig.presetCategories[categoryIndex];
    const group: HTMLElement = optgroup({ label: category.name });
    let foundAny: boolean = false;
    for (
      let presetIndex: number = 0;
      presetIndex < category.presets.length;
      presetIndex++
    ) {
      const preset: Preset = category.presets[presetIndex];
      if ((preset.isNoise == true) == isNoise) {
        group.appendChild(
          option({ value: (categoryIndex << 6) + presetIndex }, preset.name),
        );
        foundAny = true;
      }
    }
    if (foundAny) menu.appendChild(group);
  }
  return menu;
}

function setSelectedValue(menu: HTMLSelectElement, value: number): void {
  const stringValue = value.toString();
  if (menu.value != stringValue) menu.value = stringValue;
}

class Slider {
  public container: HTMLSpanElement;
  private _change: Change | null = null;
  private _value: number = 0;
  private _oldValue: number = 0;

  constructor(
    public readonly input: HTMLInputElement,
    private readonly _doc: SongDocument,
    private readonly _getChange: (
      oldValue: number,
      newValue: number,
    ) => Change | null,
  ) {
    input.addEventListener("input", this._onInput);
    input.addEventListener("change", this._onChange);

    // Touch screens update the slider value as soon as you touch the slider,
    // but also allow scrolling by vertically dragging from the slider, which
    // can result in both the slider changing and the screen scrolling from
    // the same gesture, which feels bad. Unfortunately, calling
    // preventDefault() in the pointerdown listener does not prevent changing
    // the slider value on touchscreens, so we need to completely bypass
    // touching the slider. This code prevents the initial slider change and
    // reimplements it if the pointer will not scroll.
    input.style.pointerEvents = "none";
    this.container = span(input, {
      style: "touch-action: pan-y; display: flex; cursor: pointer;",
    });
    this.container.title = input.title;
    new EasyPointers(this.container);
    this.container.addEventListener("pointerdown", this._onPointerDown);
    this.container.addEventListener("pointermove", this._onPointerMove);
    this.container.addEventListener("pointerup", this._onPointerUp);
  }

  private _setFromPointer(event: PointerEvent): void {
    const x = event.pointer!.getPointIn(this.input, "contentBox").x;
    const dimensions = getElementDimensions(this.input, "contentBox");
    const thumbWidth: number = 6; // Slider thumbs are styled with a width of 6 pixels.
    const ratio = (x - thumbWidth / 2) / (dimensions.width - thumbWidth);
    const step = parseFloat(this.input.step);
    let min = parseFloat(this.input.min);
    let max = parseFloat(this.input.max);
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 100;
    const unquantizedValue: number = (max - min) * ratio + min;
    const value = Math.max(
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

  private _onPointerDown = (event: PointerEvent): void => {
    this._setFromPointer(event);
    this.input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
      }),
    );
  };

  private _onPointerMove = (event: PointerEvent): void => {
    if (event.pointer!.isDown) {
      this._setFromPointer(event);
      this.input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
        }),
      );
    }
  };

  private _onPointerUp = (event: PointerEvent): void => {
    this._setFromPointer(event);
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
    this._value = value;
    this.input.value = String(value);
  }

  private _onInput = (): void => {
    const continuingProspectiveChange: boolean = this._doc.lastChangeWas(
      this._change,
    );
    if (!continuingProspectiveChange) this._oldValue = this._value;
    this._change = this._getChange(
      this._oldValue,
      parseFloat(this.input.value),
    );
    if (this._change) this._doc.setProspectiveChange(this._change);
  };

  private _onChange = (): void => {
    if (this._change) this._doc.record(this._change);
    this._change = null;
  };
}

class NumberInput {
  private _change: Change | null = null;
  private _value: number = 0;
  private _oldValue: number = 0;

  constructor(
    public readonly input: HTMLInputElement,
    private readonly _doc: SongDocument,
    private readonly _getChange: (
      oldValue: number,
      newValue: number,
    ) => Change | null,
  ) {
    input.addEventListener("input", this._onInput);
    input.addEventListener("change", this._onChange);
  }

  public updateValue(value: number): void {
    this._value = value;
    if (document.activeElement != this.input) {
      this.input.value = String(value);
    }
  }

  private _onInput = (): void => {
    let value: number = this.input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    if (this.input.min != "") value = Math.max(Number(this.input.min), value);
    if (this.input.max != "") value = Math.min(Number(this.input.max), value);
    if (value != this.input.valueAsNumber) this.input.value = String(value);

    const continuingProspectiveChange: boolean = this._doc.lastChangeWas(
      this._change,
    );
    if (!continuingProspectiveChange) this._oldValue = this._value;
    this._change = this._getChange(this._oldValue, value);
    if (this._change) this._doc.setProspectiveChange(this._change);
  };

  private _onChange = (): void => {
    if (!Number.isFinite(this.input.valueAsNumber)) {
      this.input.value = String(this._value);
    }
    if (this._change) {
      this._doc.record(this._change);
    }
    this._change = null;
  };
}

class EffectSlider {
  public readonly container: HTMLSpanElement;
  private readonly _slider: Slider;
  private readonly _textInput: NumberInput;

  constructor(
    doc: SongDocument,
    private readonly _min: number,
    private readonly _max: number,
    getChange: (oldValue: number, newValue: number) => Change | null,
    private readonly _displayMin: number = 0,
    private readonly _displayMax: number = 100,
    private readonly _toDisplayValue: ((value: number) => number) | null = null,
    private readonly _fromDisplayValue:
      ((value: number) => number) | null = null,
    sliderStep: number | "any" = "any",
    textInputMin: number | null = null,
    textInputMax: number | null = null,
  ) {
    const textInputAttributes: { [name: string]: string } = {
      class: "instrument-value-input",
      type: "number",
      step: "any",
      value: "0",
    };
    if (textInputMin != null) textInputAttributes["min"] = String(textInputMin);
    if (textInputMax != null) textInputAttributes["max"] = String(textInputMax);
    this._textInput = new NumberInput(
      input(textInputAttributes),
      doc,
      (oldDisplayValue: number, newDisplayValue: number) =>
        getChange(
          this._fromDisplay(oldDisplayValue),
          this._fromDisplay(newDisplayValue),
        ),
    );
    this._slider = new Slider(
      input({
        style: "margin: 0;",
        type: "range",
        min: String(this._displayMin),
        max: String(this._displayMax),
        value: "0",
        step: String(sliderStep),
      }),
      doc,
      (oldDisplayValue: number, newDisplayValue: number) => {
        this._textInput.updateValue(newDisplayValue);
        return getChange(
          this._fromDisplay(oldDisplayValue),
          this._fromDisplay(newDisplayValue),
        );
      },
    );
    this.container = span(
      { class: "slider-with-input" },
      this._slider.container,
      this._textInput.input,
    );
  }

  public updateValue(value: number): void {
    const displayValue: number = this._toDisplay(value);
    this._slider.updateValue(displayValue);
    this._textInput.updateValue(Number(EffectSlider._format(displayValue)));
  }

  private _toDisplay(value: number): number {
    if (this._toDisplayValue != null) return this._toDisplayValue(value);
    return (
      this._displayMin +
      ((value - this._min) * (this._displayMax - this._displayMin)) /
        (this._max - this._min)
    );
  }

  private _fromDisplay(value: number): number {
    if (this._fromDisplayValue != null) return this._fromDisplayValue(value);
    return (
      this._min +
      ((value - this._displayMin) * (this._max - this._min)) /
        (this._displayMax - this._displayMin)
    );
  }

  private static _format(value: number): string {
    return String(parseFloat(value.toFixed(6)));
  }
}

export class SongEditor {
  public readonly doc: SongDocument = new SongDocument();
  public prompt: Prompt | null = null;
  private _pendingFlpImport: {
    imported: FlpSongImport;
    apply: () => void;
  } | null = null;
  private readonly _importFile = new ImportFile(
    this.doc,
    (imported: FlpSongImport, apply: () => void): void => {
      this._pendingFlpImport = { imported, apply };
      this._openPrompt("flpInstruments");
    },
  );

  private readonly _keyboardLayout: KeyboardLayout = new KeyboardLayout(
    this.doc,
  );
  private readonly _patternEditorPrev: PatternEditor = new PatternEditor(
    this.doc,
    false,
    -1,
  );
  private readonly _patternEditor: PatternEditor = new PatternEditor(
    this.doc,
    true,
    0,
  );
  private readonly _patternEditorNext: PatternEditor = new PatternEditor(
    this.doc,
    false,
    1,
  );
  private readonly _muteEditor: MuteEditor = new MuteEditor(this.doc);
  private readonly _trackEditor: TrackEditor = new TrackEditor(this.doc);
  private readonly _loopEditor: LoopEditor = new LoopEditor(this.doc);
  private readonly _octaveScrollBar: OctaveScrollBar = new OctaveScrollBar(
    this.doc,
  );
  private readonly _piano: Piano = new Piano(this.doc);
  private readonly _playButton: HTMLButtonElement = button(
    { class: "playButton", type: "button", title: "Play (Space)" },
    span("Play"),
  );
  private readonly _pauseButton: HTMLButtonElement = button(
    {
      class: "pauseButton",
      style: "display: none;",
      type: "button",
      title: "Pause (Space)",
    },
    "Pause",
  );
  private readonly _recordButton: HTMLButtonElement = button(
    {
      class: "recordButton",
      style: "display: none;",
      type: "button",
      title: "Record (Ctrl+Space)",
    },
    span("Record"),
  );
  private readonly _stopButton: HTMLButtonElement = button(
    {
      class: "stopButton",
      style: "display: none;",
      type: "button",
      title: "Stop Recording (Space)",
    },
    "Stop Recording",
  );
  private readonly _prevBarButton: HTMLButtonElement = button({
    class: "prevBarButton",
    type: "button",
    title: "Previous Bar (left bracket)",
  });
  private readonly _nextBarButton: HTMLButtonElement = button({
    class: "nextBarButton",
    type: "button",
    title: "Next Bar (right bracket)",
  });
  private readonly _fileMenu: HTMLSelectElement = select(
    { class: "menu", style: "width: 100%;" },
    option({ selected: true, disabled: true, hidden: true }, "File"),
    option({ value: "new" }, "+ New"),
    option({ value: "import" }, "↑ Import (" + ctrlSymbol + "O)"),
    option({ value: "export" }, "↓ Export (" + ctrlSymbol + "S)"),
    option({ value: "shareUrl" }, "⎘ Share URL"),
    option({ value: "songRecovery" }, "⚠ Recover"),
  );
  private readonly _editMenu: HTMLSelectElement = select(
    { class: "menu", style: "width: 100%;" },
    option({ selected: true, disabled: true, hidden: true }, "Edit"),
    option({ value: "undo" }, "Undo (Z)"),
    option({ value: "redo" }, "Redo (Y)"),
    option({ value: "copy" }, "Copy Pattern (C)"),
    option({ value: "cut" }, "Cut Pattern (X)"),
    option({ value: "pasteNotes" }, "Paste Pattern Notes (V)"),
    option(
      { value: "pasteNumbers" },
      "Paste Pattern Numbers (" + ctrlSymbol + "⇧V)",
    ),
    option({ value: "insertBars" }, "Insert Bar (⏎)"),
    option({ value: "deleteBars" }, "Delete Selected Bars (⌫)"),
    option({ value: "insertChannel" }, "Insert Channel (" + ctrlSymbol + "⏎)"),
    option(
      { value: "deleteChannel" },
      "Delete Selected Channels (" + ctrlSymbol + "⌫)",
    ),
    option({ value: "selectAll" }, "Select All (A)"),
    option({ value: "selectChannel" }, "Select Channel (⇧A)"),
    option({ value: "duplicatePatterns" }, "Duplicate Reused Patterns (D)"),
    option(
      { value: "rectifyPatterns" },
      "Rectify Patterns (" + ctrlSymbol + "⇧D)",
    ),
    option({ value: "transposeUp" }, "Move Notes Up (+ or ⇧+)"),
    option({ value: "transposeDown" }, "Move Notes Down (- or ⇧-)"),
    option({ value: "moveNotesSideways" }, "Move All Notes Sideways"),
    option({ value: "beatsPerBar" }, "Change Beats Per Bar..."),
    option({ value: "assets" }, "Add Assets (⇧Q)"),
  );
  private readonly _preferencesButton: HTMLButtonElement = button(
    { class: "menu preferences", type: "button" },
    "Preferences",
  );
  private readonly _aboutButton: HTMLButtonElement = button(
    { class: "menu about", type: "button" },
    "About",
  );
  private readonly _scaleSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.scales.map((scale) => scale.name),
  );
  private readonly _keySelect: HTMLSelectElement = buildOptions(
    select(),
    Config.keys.map((key) => key.name).reverse(),
  );
  private readonly _legacyKeySelect: HTMLSelectElement = buildOptions(
    select(),
    Config.keys.map((key) => key.name).reverse(),
  );
  private readonly _legacyKeyButton: HTMLButtonElement = button(
    {
      class: "reveal-arrow",
      type: "button",
      title: "Show legacy transposition key",
      "aria-label": "Show legacy transposition key",
    },
    "▾",
  );
  private readonly _legacyKeyRow: HTMLDivElement = div(
    { class: "selectRow", style: "display: none;" },
    label("Legacy"),
    this._legacyKeySelect,
  );
  private _showLegacyKey: boolean = false;
  private readonly _tempoSlider: Slider = new Slider(
    input({
      style: "margin: 0; width: 4em; flex-grow: 1; vertical-align: middle;",
      type: "range",
      min: "0",
      max: "14",
      value: "7",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeTempo(
        this.doc,
        oldValue,
        Math.round(120.0 * Math.pow(2.0, (-4.0 + newValue) / 9.0)),
      ),
  );
  private readonly _tempoStepper: HTMLInputElement = input({
    style: "width: 4.5em; margin-left: 0.4em; vertical-align: middle;",
    type: "number",
    step: "1",
  });
  private readonly _chorusSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.chorusRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeChorus(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    100,
  );
  private readonly _chorusRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Chorus"),
    this._chorusSlider.container,
  );
  private readonly _reverbSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.reverbRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeReverb(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    (100 * Config.reverbRange) / (Config.reverbRange - 1),
  );
  private readonly _reverbRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Reverb"),
    this._reverbSlider.container,
  );
  private readonly _echoSustainSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    (Config.echoSustainRange - 1) * 2,
    (oldValue: number, newValue: number) =>
      new ChangeEchoSustain(this.doc, oldValue, newValue),
    0,
    200,
    null,
    null,
    "any",
    0,
    200,
  );
  private readonly _echoSustainRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Echo"),
    this._echoSustainSlider.container,
  );
  private readonly _echoDelaySlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.echoDelayRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeEchoDelay(this.doc, oldValue, newValue),
    0.25,
    2,
    (value: number) => this._echoDelayToBeats(value),
    (value: number) => this._echoDelayFromBeats(value),
    0.25,
  );
  private readonly _echoDelayRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Echo Delay"),
    this._echoDelaySlider.container,
  );
  private readonly _rhythmSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.rhythms.map((rhythm) => rhythm.name),
  );
  private readonly _beatsPerBarStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.beatsPerBarMin,
    max: Config.beatsPerBarMax,
    step: "1",
  });
  private readonly _songLengthStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.barCountMin,
    max: Config.barCountMax,
    step: "1",
  });
  private readonly _pitchChannelsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.pitchChannelCountMin,
    max: Config.pitchChannelCountMax,
    step: "1",
  });
  private readonly _drumChannelsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: Config.noiseChannelCountMin,
    max: Config.noiseChannelCountMax,
    step: "1",
  });
  private readonly _maxPatternsStepper: HTMLInputElement = input({
    style: "width: 4.5em;",
    type: "number",
    min: "1",
    max: Config.barCountMax,
    step: "1",
  });
  private readonly _pitchedPresetSelect: HTMLSelectElement =
    buildPresetOptions(false);
  private readonly _drumPresetSelect: HTMLSelectElement =
    buildPresetOptions(true);
  private readonly _algorithmSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.algorithms.map((algorithm) => algorithm.name),
  );
  private readonly _algorithmSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._algorithmSelect,
  );
  private readonly _instrumentButtons: HTMLButtonElement[] = [];
  private readonly _instrumentAddButton: HTMLButtonElement = button({
    type: "button",
    class: "add-instrument last-button",
  });
  private readonly _instrumentRemoveButton: HTMLButtonElement = button({
    type: "button",
    class: "remove-instrument",
  });
  private readonly _instrumentButtonsScroller: HTMLDivElement = div({
    class: "instrument-buttons-scroller",
  });
  private readonly _instrumentActions: HTMLDivElement = div(
    { class: "instrument-actions" },
    this._instrumentRemoveButton,
    this._instrumentAddButton,
  );
  private readonly _instrumentsButtonBar: HTMLDivElement = div(
    { class: "instrument-bar", style: "width: 100%;" },
    this._instrumentButtonsScroller,
    this._instrumentActions,
  );
  private readonly _instrumentsButtonRow: HTMLDivElement = div(
    { class: "selectRow", style: "display: none;" },
    this._instrumentsButtonBar,
  );
  private readonly _instrumentCopyButton: HTMLButtonElement = button(
    { type: "button", class: "copy-instrument", title: "Copy Instrument (⇧C)" },
    "Copy",
  );
  private readonly _instrumentPasteButton: HTMLButtonElement = button(
    {
      type: "button",
      class: "paste-instrument",
      title: "Paste Instrument (⇧V)",
    },
    "Paste",
  );
  private readonly _instrumentCopyPasteRow: HTMLDivElement = div(
    { class: "instrumentActionRow" },
    this._instrumentCopyButton,
    this._instrumentPasteButton,
  );
  private readonly _instrumentVolumeSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      title: "Volume",
      min: "0",
      max: "100",
      value: String(Config.volumeDefault),
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeVolume(this.doc, oldValue, newValue),
  );
  private readonly _instrumentVolumeInput: NumberInput = new NumberInput(
    input({
      class: "instrument-value-input",
      style: "width: 4.5em; margin-left: 0.4em; vertical-align: middle;",
      type: "number",
      min: "0",
      max: "100",
      step: "1",
      value: String(Config.volumeDefault),
      title: "Volume",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeVolume(
        this.doc,
        oldValue,
        Math.max(0, Math.min(100, newValue)),
      ),
  );
  private readonly _instrumentVolumeSliderRow: HTMLDivElement = div(
    { class: "selectRow instrument-symbol-control" },
    div({ class: "instrument-volume-icon", title: "Volume" }),
    this._instrumentVolumeSlider.container,
    this._instrumentVolumeInput.input,
  );
  private readonly _panSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      title: "Panning",
      min: "-100",
      max: "100",
      value: "0",
      step: "2",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangePan(
        this.doc,
        panPercentToSetting(oldValue),
        panPercentToSetting(newValue),
      ),
  );
  private readonly _panInput: NumberInput = new NumberInput(
    input({
      class: "instrument-value-input",
      style: "width: 4.5em; margin-left: 0.4em; vertical-align: middle;",
      type: "number",
      min: "-100",
      max: "100",
      step: "2",
      value: "0",
      title: "Panning",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangePan(
        this.doc,
        panPercentToSetting(oldValue),
        panPercentToSetting(newValue),
      ),
  );
  private readonly _panSliderRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    div(
      { class: "instrument-pan-slider" },
      span({ class: "pan-label" }, "L"),
      this._panSlider.container,
      span({ class: "pan-label" }, "R"),
    ),
    this._panInput.input,
  );
  private readonly _chipWaveSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.chipWaves.map((wave) => wave.name),
  );
  private readonly _chipNoiseSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.chipNoises.map((wave) => wave.name),
  );
  private readonly _chipWaveSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control asset-select-control" },
    this._chipWaveSelect,
  );
  private readonly _chipNoiseSelectRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Noise"),
    this._chipNoiseSelect,
  );
  private readonly _soundFontSelect: HTMLSelectElement = select({
    title: "SoundFont",
  });
  private readonly _soundFontPresetSelect: HTMLSelectElement = select({
    title: "SoundFont Instrument",
  });
  private readonly _soundFontSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._soundFontSelect,
  );
  private readonly _soundFontPresetSelectRow: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._soundFontPresetSelect,
  );
  private readonly _fadeInOutEditor: FadeInOutEditor = new FadeInOutEditor(
    this.doc,
  );
  private readonly _fadeInOutRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._fadeInOutEditor.container,
  );
  private readonly _transitionSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.transitions.map((transition) => transition.name),
  );
  private readonly _transitionRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Transition"),
    this._transitionSelect,
  );
  private readonly _effectsSelect: HTMLSelectElement = select(
    option({
      selected: true,
      disabled: true,
      hidden: true,
    }),
  );
  private readonly _addEffectButton: HTMLButtonElement = button(
    {
      class: "instrumentSettingsAdd",
      type: "button",
      title: "Add or remove effect",
    },
    "+",
  );
  private readonly _eqFilterEditor: FilterEditor = new FilterEditor(this.doc);
  private readonly _eqFilterRow: HTMLElement = div(
    { class: "selectRow" },
    label("EQ Filter"),
    this._eqFilterEditor.container,
  );
  private readonly _noteFilterEditor: FilterEditor = new FilterEditor(
    this.doc,
    true,
  );
  private readonly _noteFilterRow: HTMLElement = div(
    { class: "selectRow" },
    label("Note Filter"),
    this._noteFilterEditor.container,
  );
  private readonly _supersawDynamismSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
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
  private readonly _supersawDynamismRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Dynamism"),
    this._supersawDynamismSlider.container,
  );
  private readonly _supersawSpreadSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      min: "0",
      max: Config.supersawSpreadMax,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeSupersawSpread(this.doc, oldValue, newValue),
  );
  private readonly _supersawSpreadRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Spread"),
    this._supersawSpreadSlider.container,
  );
  private readonly _supersawShapeSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      min: "0",
      max: Config.supersawShapeMax,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeSupersawShape(this.doc, oldValue, newValue),
  );
  private readonly _supersawShapeRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Saw↔Pulse"),
    this._supersawShapeSlider.container,
  );
  private readonly _pulseWidthSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      min: "0",
      max: Config.pulseWidthRange - 1,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangePulseWidth(this.doc, oldValue, newValue),
  );
  private readonly _pulseWidthRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Pulse Width"),
    this._pulseWidthSlider.container,
  );
  private readonly _pitchShiftSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.pitchShiftRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangePitchShift(this.doc, oldValue, newValue),
    -12,
    12,
    null,
    null,
    1,
  );
  private readonly _pitchShiftTonicMarkers: HTMLDivElement[] = [
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
  private readonly _pitchShiftFifthMarkers: HTMLDivElement[] = [
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.fifthNote, left: (100 * 7) / 24 + "%" },
    }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.fifthNote, left: (100 * 19) / 24 + "%" },
    }),
  ];
  private readonly _pitchShiftThirdMarkers: HTMLDivElement[] = [
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.thirdNote, left: (100 * 4) / 24 + "%" },
    }),
    div({
      class: "pitchShiftMarker",
      style: { color: ColorConfig.thirdNote, left: (100 * 16) / 24 + "%" },
    }),
  ];
  private readonly _pitchShiftMarkerContainer: HTMLDivElement = div(
    { style: "display: flex; position: relative;" },
    this._pitchShiftSlider.container,
    div(
      { class: "pitchShiftMarkerContainer" },
      this._pitchShiftTonicMarkers,
      this._pitchShiftThirdMarkers,
      this._pitchShiftFifthMarkers,
    ),
  );
  private readonly _pitchShiftRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Pitch Shift"),
    this._pitchShiftMarkerContainer,
  );
  private readonly _detuneSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.detuneMax,
    (oldValue: number, newValue: number) =>
      new ChangeDetune(this.doc, oldValue, newValue),
    -200,
    200,
    (value: number) => Synth.detuneToCents(value - Config.detuneCenter),
    (value: number) => Config.detuneCenter + Synth.centsToDetune(value),
  );
  private readonly _detuneRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Detune"),
    this._detuneSlider.container,
  );
  private readonly _distortionSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.distortionRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeDistortion(this.doc, oldValue, newValue),
    0,
    100,
    null,
    null,
    "any",
    0,
    100,
  );
  private readonly _distortionRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Distortion"),
    this._distortionSlider.container,
  );
  private readonly _bitcrusherQuantizationSlider: EffectSlider =
    new EffectSlider(
      this.doc,
      0,
      Config.bitcrusherQuantizationRange - 1,
      (oldValue: number, newValue: number) =>
        new ChangeBitcrusherQuantization(this.doc, oldValue, newValue),
    );
  private readonly _bitcrusherQuantizationRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Bit Crush"),
    this._bitcrusherQuantizationSlider.container,
  );
  private readonly _bitcrusherFreqSlider: EffectSlider = new EffectSlider(
    this.doc,
    0,
    Config.bitcrusherFreqRange - 1,
    (oldValue: number, newValue: number) =>
      new ChangeBitcrusherFreq(this.doc, oldValue, newValue),
  );
  private readonly _bitcrusherFreqRow: HTMLDivElement = div(
    { class: "selectRow" },
    label("Freq Crush"),
    this._bitcrusherFreqSlider.container,
  );
  private readonly _stringSustainSlider: Slider = new Slider(
    input({
      style: "margin: 0;",
      type: "range",
      min: "0",
      max: Config.stringSustainRange - 1,
      value: "0",
      step: "1",
    }),
    this.doc,
    (oldValue: number, newValue: number) =>
      new ChangeStringSustain(this.doc, oldValue, newValue),
  );
  private readonly _stringSustainLabel: HTMLLabelElement = label("Sustain");
  private readonly _stringSustainRow: HTMLDivElement = div(
    { class: "selectRow" },
    this._stringSustainLabel,
    this._stringSustainSlider.container,
  );
  private readonly _unisonSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.unisons.map((unison) => unison.name),
  );
  private readonly _unisonSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Unison"),
    this._unisonSelect,
  );
  private readonly _chordSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.chords.map((chord) => chord.name),
  );
  private readonly _chordSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Chords"),
    this._chordSelect,
  );
  private readonly _vibratoSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.vibratos.map((vibrato) => vibrato.name),
  );
  private readonly _vibratoSelectRow: HTMLElement = div(
    { class: "selectRow" },
    label("Vibrato"),
    this._vibratoSelect,
  );
  private readonly _phaseModGroup: HTMLElement = div({
    class: "editor-controls",
  });
  private readonly _feedbackTypeSelect: HTMLSelectElement = buildOptions(
    select(),
    Config.feedbacks.map((feedback) => feedback.name),
  );
  private readonly _feedbackRow1: HTMLDivElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._feedbackTypeSelect,
  );
  private readonly _spectrumEditor: SpectrumEditor = new SpectrumEditor(
    this.doc,
    null,
  );
  private readonly _spectrumRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._spectrumEditor.container,
  );
  private readonly _harmonicsEditor: HarmonicsEditor = new HarmonicsEditor(
    this.doc,
  );
  private readonly _harmonicsRow: HTMLElement = div(
    { class: "selectRow instrument-unlabeled-control" },
    this._harmonicsEditor.container,
  );
  private readonly _envelopeEditor: EnvelopeEditor = new EnvelopeEditor(
    this.doc,
  );
  private readonly _drumsetGroup: HTMLElement = div({
    class: "editor-controls",
  });

  private readonly _feedbackAmplitudeSlider: Slider = new Slider(
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
  private readonly _feedbackRow2: HTMLDivElement = div(
    { class: "selectRow" },
    label("Feedback"),
    this._feedbackAmplitudeSlider.container,
  );
  private readonly _presetButton: HTMLButtonElement = button(
    { type: "button", class: "presetButton variableNameButton" },
    "Preset",
  );
  private readonly _addEnvelopeButton: HTMLButtonElement = button(
    { class: "instrumentSettingsAdd", type: "button", title: "Add envelope" },
    "+",
  );
  private readonly _instrumentSettings: InstrumentSettings =
    new InstrumentSettings({
      preset: this._presetButton,
      instruments: this._instrumentsButtonRow,
      copyPaste: this._instrumentCopyPasteRow,
      volume: this._instrumentVolumeSliderRow,
      pan: this._panSliderRow,
      fade: this._fadeInOutRow,
      specific: [
        this._chipWaveSelectRow,
        this._chipNoiseSelectRow,
        this._soundFontSelectRow,
        this._soundFontPresetSelectRow,
        this._algorithmSelectRow,
        this._phaseModGroup,
        this._feedbackRow1,
        this._feedbackRow2,
        this._spectrumRow,
        this._harmonicsRow,
        this._drumsetGroup,
        this._supersawDynamismRow,
        this._supersawSpreadRow,
        this._supersawShapeRow,
        this._pulseWidthRow,
        this._stringSustainRow,
      ],
      effects: [
        this._eqFilterRow,
        this._noteFilterRow,
        this._pitchShiftRow,
        this._detuneRow,
        this._chordSelectRow,
        this._transitionRow,
        this._distortionRow,
        this._bitcrusherQuantizationRow,
        this._bitcrusherFreqRow,
        this._vibratoSelectRow,
        this._unisonSelectRow,
        this._chorusRow,
        this._echoSustainRow,
        this._echoDelayRow,
        this._reverbRow,
      ],
      effectsMenu: div(
        { class: "effects-menu" },
        this._addEffectButton,
        this._effectsSelect,
      ),
      envelopes: this._envelopeEditor.container,
      addEnvelope: this._addEnvelopeButton,
      openInstrumentType: () => this._openPrompt("instrumentType"),
      copyCategory: (category) =>
        this._copyInstrumentSettingsCategory(category),
      pasteCategory: (category) =>
        this._pasteInstrumentSettingsCategory(category),
      randomizeCategory: (category) =>
        this._randomizeInstrumentSettingsCategory(category),
    });
  private readonly _instrumentSettingsControls: HTMLDivElement =
    this._instrumentSettings.container;
  private readonly _promptContainer: HTMLDivElement = div({
    class: "promptContainer",
  });
  private readonly _zoomInButton: HTMLButtonElement = button({
    class: "zoomInButton overlay-button",
    type: "button",
    title: "Zoom In",
  });
  private readonly _zoomOutButton: HTMLButtonElement = button({
    class: "zoomOutButton overlay-button",
    type: "button",
    title: "Zoom Out",
  });
  private readonly _patternEditorRow: HTMLDivElement = div(
    {
      style:
        "flex: 1; height: 100%; display: flex; overflow: hidden; justify-content: center;",
    },
    this._patternEditorPrev.container,
    this._patternEditor.container,
    this._patternEditorNext.container,
  );
  private readonly _patternArea: HTMLDivElement = div(
    { class: "pattern-area" },
    this._piano.container,
    this._patternEditorRow,
    this._octaveScrollBar.container,
    this._zoomInButton,
    this._zoomOutButton,
  );
  private readonly _trackContainer: HTMLDivElement = div(
    { class: "trackContainer noSelection" },
    this._trackEditor.container,
    this._loopEditor.container,
  );
  private readonly _trackVisibleArea: HTMLDivElement = div({
    style:
      "position: absolute; width: 100%; height: 100%; pointer-events: none;",
  });
  private readonly _trackAndMuteContainer: HTMLDivElement = div(
    { class: "trackAndMuteContainer" },
    this._muteEditor.container,
    this._trackContainer,
    this._trackVisibleArea,
  );
  private readonly _barScrollBar: BarScrollBar = new BarScrollBar(this.doc);
  private readonly _trackArea: HTMLDivElement = div(
    { class: "track-area" },
    this._trackAndMuteContainer,
    this._barScrollBar.container,
  );

  private readonly _menuArea: HTMLDivElement = div(
    { class: "menu-area" },
    div({ class: "menu-icon file" }, this._fileMenu),
    div({ class: "menu-icon edit" }, this._editMenu),
    this._preferencesButton,
    this._aboutButton,
  );
  private readonly _songSettingsArea: HTMLDivElement = div(
    { class: "song-settings-area" },
    div(
      { class: "editor-controls groupedSettings" },
      div(
        { class: "settingsGroup" },
        div({ class: "selectRow" }, label("Scale"), this._scaleSelect),
        div(
          { class: "selectRow" },
          label("Key"),
          div(
            { class: "reveal-control" },
            this._legacyKeyButton,
            this._keySelect,
          ),
        ),
        this._legacyKeyRow,
      ),
      div(
        { class: "settingsGroup" },
        div(
          { class: "selectRow" },
          label("Tempo"),
          span(
            { style: "display: flex;" },
            this._tempoSlider.container,
            this._tempoStepper,
          ),
        ),
        div({ class: "selectRow" }, label("Rhythm"), this._rhythmSelect),
      ),
      div(
        { class: "settingsGroup" },
        div(
          { class: "selectRow" },
          label("Beats per bar"),
          this._beatsPerBarStepper,
        ),
        div(
          { class: "selectRow" },
          label("Song length"),
          this._songLengthStepper,
        ),
      ),
      div(
        { class: "settingsGroup" },
        div(
          { class: "selectRow" },
          label("Pitch channels"),
          this._pitchChannelsStepper,
        ),
        div(
          { class: "selectRow" },
          label("Drum channels"),
          this._drumChannelsStepper,
        ),
        div(
          { class: "selectRow" },
          label("Max patterns"),
          this._maxPatternsStepper,
        ),
      ),
    ),
  );
  private readonly _instrumentSettingsArea: HTMLDivElement = div(
    { class: "instrument-settings-area" },
    this._instrumentSettingsControls,
  );
  private readonly _settingsArea: HTMLDivElement = div(
    { class: "settings-area noSelection" },
    div(
      { class: "play-pause-area" },
      div(
        { class: "playback-bar-controls" },
        this._playButton,
        this._pauseButton,
        this._recordButton,
        this._stopButton,
        this._prevBarButton,
        this._nextBarButton,
      ),
    ),
    this._menuArea,
    this._songSettingsArea,
    this._instrumentSettingsArea,
  );

  public readonly mainLayer: HTMLDivElement = div(
    { class: "app", tabIndex: "0" },
    this._patternArea,
    this._trackArea,
    this._settingsArea,
    this._promptContainer,
  );

  private _wasPlaying: boolean = false;
  private _currentPromptName: string | null = null;
  private _highlightedInstrumentIndex: number = -1;
  private _renderedInstrumentCount: number = 0;
  private _renderedIsPlaying: boolean = false;
  private _renderedIsRecording: boolean = false;
  private _renderedShowRecordButton: boolean = false;
  private _renderedCtrlHeld: boolean = false;
  private readonly _operatorRows: HTMLDivElement[] = [];
  private readonly _operatorAmplitudeSliders: Slider[] = [];
  private readonly _operatorFrequencyInputs: NumberInput[] = [];
  private readonly _operatorWaveSelects: HTMLSelectElement[] = [];
  private readonly _operatorWaveRows: HTMLDivElement[] = [];
  private readonly _operatorWaveButtons: HTMLButtonElement[] = [];
  private readonly _drumsetSpectrumEditors: SpectrumEditor[] = [];
  private readonly _drumsetEnvelopeSelects: HTMLSelectElement[] = [];
  private readonly _drumsetEnvelopeParameterEditors: EnvelopeParameterEditor[] =
    [];

  constructor(app: HTMLElement) {
    this.doc.notifier.watch(this.whenUpdated);
    this.doc.synth.assetLoadEvents.addEventListener(
      "change",
      this._whenAssetLoadStateChanged,
    );

    window.addEventListener("resize", this._whenResized);
    window.requestAnimationFrame(this.updatePlayButton);

    this._keySelect.appendChild(
      optgroup({ label: "Edit" }, option({ value: "detectKey" }, "Detect Key")),
    );
    this._rhythmSelect.appendChild(
      optgroup(
        { label: "Edit" },
        option({ value: "forceRhythm" }, "Snap Notes To Rhythm"),
      ),
    );
    this._tempoSlider.container.style.flex = "1";

    for (let i: number = 0; i < Config.operatorCount; i++) {
      const operatorIndex: number = i;
      const waveButton: HTMLButtonElement = button(
        {
          class: "reveal-arrow",
          type: "button",
          title: "Show waveform",
          "aria-label": "Show waveform",
        },
        "▾",
      );
      const frequencyInput: NumberInput = new NumberInput(
        input({
          class: "instrument-value-input",
          style: "margin-right: .3em;",
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
      );
      const waveSelect: HTMLSelectElement = buildOptions(
        select({ title: "Waveform" }),
        ["sine", ...Config.chipWaves.map((wave) => wave.name)],
      );
      const amplitudeSlider: Slider = new Slider(
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
          new ChangeOperatorAmplitude(
            this.doc,
            operatorIndex,
            oldValue,
            newValue,
          ),
      );
      const row: HTMLDivElement = div(
        { class: "selectRow fm-operator-row" },
        waveButton,
        frequencyInput.input,
        amplitudeSlider.container,
      );
      const waveRow: HTMLDivElement = div(
        {
          class: "selectRow instrument-unlabeled-control",
          style: "display: none;",
        },
        waveSelect,
      );
      this._phaseModGroup.append(row, waveRow);
      this._operatorRows[i] = row;
      this._operatorAmplitudeSliders[i] = amplitudeSlider;
      this._operatorFrequencyInputs[i] = frequencyInput;
      this._operatorWaveSelects[i] = waveSelect;
      this._operatorWaveRows[i] = waveRow;
      this._operatorWaveButtons[i] = waveButton;

      waveSelect.addEventListener("change", () => {
        this.doc.record(
          new ChangeOperatorWave(
            this.doc,
            operatorIndex,
            waveSelect.selectedIndex,
          ),
        );
      });
      waveButton.addEventListener("click", () => {
        const showWave: boolean = waveRow.style.display == "none";
        waveRow.style.display = showWave ? "" : "none";
        waveButton.textContent = showWave ? "▴" : "▾";
        waveButton.title = showWave ? "Hide waveform" : "Show waveform";
        waveButton.setAttribute("aria-label", waveButton.title);
      });
    }

    for (let i: number = Config.drumCount - 1; i >= 0; i--) {
      const drumIndex: number = i;
      const spectrumEditor: SpectrumEditor = new SpectrumEditor(
        this.doc,
        drumIndex,
      );
      spectrumEditor.container.addEventListener(
        "pointerdown",
        this._refocusStage,
      );
      this._drumsetSpectrumEditors[i] = spectrumEditor;

      const envelopeSelect: HTMLSelectElement = buildOptions(
        select({
          title: "Filter Envelope",
        }),
        Config.envelopes.map((envelope) => envelope.name),
      );
      this._drumsetEnvelopeSelects[i] = envelopeSelect;
      const envelopeRevealButton: HTMLButtonElement = button(
        {
          class: "reveal-arrow",
          type: "button",
          title: "Show envelope controls",
          "aria-label": "Show envelope controls",
          "aria-expanded": "false",
        },
        "▾",
      );
      const envelopeParameters = new EnvelopeParameterEditor(
        this.doc,
        (parameter) => {
          const instrument =
            this.doc.song.channels[this.doc.channel].instruments[
              this.doc.getCurrentInstrument()
            ];
          return parameter == "speed"
            ? instrument.drumsetEnvelopeSpeeds[drumIndex]
            : parameter == "a"
              ? instrument.drumsetEnvelopeAs[drumIndex]
              : instrument.drumsetEnvelopeBs[drumIndex];
        },
        (parameter, oldValue, newValue) =>
          new ChangeDrumsetEnvelopeParameter(
            this.doc,
            drumIndex,
            parameter,
            oldValue,
            newValue,
          ),
      );
      envelopeParameters.container.style.display = "none";
      this._drumsetEnvelopeParameterEditors[i] = envelopeParameters;
      envelopeSelect.addEventListener("change", () => {
        this.doc.record(
          new ChangeDrumsetEnvelope(
            this.doc,
            drumIndex,
            envelopeSelect.selectedIndex,
          ),
        );
      });
      envelopeRevealButton.addEventListener("click", () => {
        const showEnvelope: boolean =
          envelopeParameters.container.style.display == "none";
        envelopeParameters.container.style.display = showEnvelope ? "" : "none";
        envelopeRevealButton.textContent = showEnvelope ? "▴" : "▾";
        envelopeRevealButton.title = showEnvelope
          ? "Hide envelope controls"
          : "Show envelope controls";
        envelopeRevealButton.setAttribute(
          "aria-label",
          envelopeRevealButton.title,
        );
        envelopeRevealButton.setAttribute(
          "aria-expanded",
          String(showEnvelope),
        );
      });

      const row: HTMLDivElement = div(
        { class: "selectRow drumset-row" },
        envelopeRevealButton,
        envelopeSelect,
        this._drumsetSpectrumEditors[i].container,
      );
      this._drumsetGroup.appendChild(row);
      this._drumsetGroup.appendChild(envelopeParameters.container);
    }

    this._fileMenu.addEventListener("change", this._fileMenuHandler);
    this._editMenu.addEventListener("change", this._editMenuHandler);
    this._preferencesButton.addEventListener("click", this._openPreferences);
    this._aboutButton.addEventListener("click", this._openAbout);
    this._tempoStepper.addEventListener("change", this._whenSetTempo);
    this._scaleSelect.addEventListener("change", this._whenSetScale);
    this._keySelect.addEventListener("change", this._whenSetKey);
    this._legacyKeySelect.addEventListener("change", this._whenSetLegacyKey);
    this._legacyKeyButton.addEventListener("click", this._toggleLegacyKey);
    this._rhythmSelect.addEventListener("change", this._whenSetRhythm);
    this._beatsPerBarStepper.addEventListener(
      "change",
      this._whenSetBeatsPerBar,
    );
    this._songLengthStepper.addEventListener("change", this._whenSetSongLength);
    this._pitchChannelsStepper.addEventListener(
      "change",
      this._whenSetPitchChannels,
    );
    this._drumChannelsStepper.addEventListener(
      "change",
      this._whenSetDrumChannels,
    );
    this._maxPatternsStepper.addEventListener(
      "change",
      this._whenSetMaxPatterns,
    );
    this._presetButton.addEventListener("click", this._openInstrumentPreset);
    this._algorithmSelect.addEventListener("change", this._whenSetAlgorithm);
    this._instrumentsButtonBar.addEventListener(
      "click",
      this._whenSelectInstrument,
    );
    this._instrumentCopyButton.addEventListener("click", this._copyInstrument);
    this._instrumentPasteButton.addEventListener(
      "click",
      this._pasteInstrument,
    );
    this._feedbackTypeSelect.addEventListener(
      "change",
      this._whenSetFeedbackType,
    );
    this._chipWaveSelect.addEventListener("change", this._whenSetChipWave);
    this._soundFontSelect.addEventListener("change", this._whenSetSoundFont);
    this._soundFontPresetSelect.addEventListener(
      "change",
      this._whenSetSoundFontPreset,
    );
    this._chipNoiseSelect.addEventListener("change", this._whenSetNoiseWave);
    this._transitionSelect.addEventListener("change", this._whenSetTransition);
    this._effectsSelect.addEventListener("change", this._whenSetEffects);
    this._addEffectButton.addEventListener("click", this._openEffectsMenu);
    this._unisonSelect.addEventListener("change", this._whenSetUnison);
    this._chordSelect.addEventListener("change", this._whenSetChord);
    this._vibratoSelect.addEventListener("change", this._whenSetVibrato);
    this._playButton.addEventListener("click", this._togglePlay);
    this._pauseButton.addEventListener("click", this._togglePlay);
    this._recordButton.addEventListener("click", this._toggleRecord);
    this._stopButton.addEventListener("click", this._toggleRecord);
    // Start recording instead of opening context menu when control-clicking the record button on a Mac.
    this._recordButton.addEventListener("contextmenu", (event: MouseEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this._toggleRecord();
      }
    });
    this._stopButton.addEventListener("contextmenu", (event: MouseEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this._toggleRecord();
      }
    });
    this._prevBarButton.addEventListener("click", this._whenPrevBarPressed);
    this._nextBarButton.addEventListener("click", this._whenNextBarPressed);
    this._zoomInButton.addEventListener("click", this._zoomIn);
    this._zoomOutButton.addEventListener("click", this._zoomOut);

    this._patternArea.addEventListener("pointerdown", this._refocusStage);
    this._trackArea.addEventListener("pointerdown", this._refocusStage);
    this._fadeInOutEditor.container.addEventListener(
      "pointerdown",
      this._refocusStage,
    );
    this._spectrumEditor.container.addEventListener(
      "pointerdown",
      this._refocusStage,
    );
    this._eqFilterEditor.container.addEventListener(
      "pointerdown",
      this._refocusStage,
    );
    this._noteFilterEditor.container.addEventListener(
      "pointerdown",
      this._refocusStage,
    );
    this._harmonicsEditor.container.addEventListener(
      "pointerdown",
      this._refocusStage,
    );
    this._addEnvelopeButton.addEventListener("click", this._addNewEnvelope);
    this._patternArea.addEventListener(
      "contextmenu",
      this._disableCtrlContextMenu,
    );
    this._trackArea.addEventListener(
      "contextmenu",
      this._disableCtrlContextMenu,
    );
    this.mainLayer.addEventListener("keydown", this._whenKeyPressed);
    this.mainLayer.addEventListener("keyup", this._whenKeyReleased);
    this.mainLayer.addEventListener("focusin", this._onFocusIn);

    // Sorry, bypassing typescript type safety on this function because I want to use the new "passive" option.
    //this._trackAndMuteContainer.addEventListener("scroll", this._onTrackAreaScroll, {capture: false, passive: true});
    (<Function>this._trackAndMuteContainer.addEventListener)(
      "scroll",
      this._onTrackAreaScroll,
      { capture: false, passive: true },
    );

    app.appendChild(this.mainLayer);
    this.whenUpdated();
    this.mainLayer.focus();

    this.updatePlayButton();

    // The editor uses browser history state as its own undo history. Browsers typically
    // remember scroll position for each history state, but editor users would prefer not
    // auto scrolling when undoing. Sadly this tweak doesn't work on Edge or IE.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service_worker.js", { updateViaCache: "all", scope: "/" })
        .catch(() => {});
    }
  }

  private _whenResized = (): void => {
    this.whenUpdated();
  };

  private _whenAssetLoadStateChanged = (): void => {
    this._syncSoundFontOptions();
    const instrument =
      this.doc.song.channels[this.doc.channel]?.instruments[
        this.doc.getCurrentInstrument()
      ];
    if (instrument?.type == InstrumentType.soundFont) {
      this._presetButton.textContent = this._getSoundFontPresetName(
        instrument.soundFontId,
        instrument.soundFontPreset,
      );
    }
    this._updateAssetLoadingIndicator();
  };

  private _syncChipWaveOptions(): void {
    let needsUpdate: boolean =
      this._chipWaveSelect.options.length != Config.chipWaves.length;
    if (!needsUpdate) {
      for (let i: number = 0; i < Config.chipWaves.length; i++) {
        if (
          this._chipWaveSelect.options[i].textContent !=
          Config.chipWaves[i].name
        ) {
          needsUpdate = true;
          break;
        }
      }
    }
    if (!needsUpdate) return;
    this._chipWaveSelect.replaceChildren();
    buildOptions(
      this._chipWaveSelect,
      Config.chipWaves.map((wave) => wave.name),
    );
    for (const select of this._operatorWaveSelects) {
      select.replaceChildren();
      buildOptions(select, [
        "sine",
        ...Config.chipWaves.map((wave) => wave.name),
      ]);
    }
  }

  private _syncSoundFontOptions(): void {
    const instrument =
      this.doc.song.channels[this.doc.channel]?.instruments[
        this.doc.getCurrentInstrument()
      ];
    const soundFonts = this.doc.song.assets.filter(
      (asset) => asset.type == "soundFont",
    );
    this._soundFontSelect.replaceChildren(option({ value: "" }, "none"));
    for (const soundFont of soundFonts)
      this._soundFontSelect.appendChild(
        option({ value: soundFont.id }, soundFont.name),
      );

    const selectedId: string | null =
      instrument?.type == InstrumentType.soundFont
        ? instrument.soundFontId
        : null;
    this._soundFontSelect.value = selectedId ?? "";
    if (this._soundFontSelect.value != (selectedId ?? ""))
      this._soundFontSelect.value = "";

    this._soundFontPresetSelect.replaceChildren();
    if (selectedId == null || this._soundFontSelect.value == "") {
      this._soundFontPresetSelectRow.style.display = "none";
      return;
    }

    this._soundFontPresetSelectRow.style.display = "";
    const presets = this.doc.synth.getSoundFontPresets(selectedId);
    if (presets == null) {
      const status = this.doc.synth.getAssetLoadStatus(selectedId);
      this._soundFontPresetSelect.appendChild(
        option(
          { disabled: true },
          status == "error" ? "Failed to load" : "Loading…",
        ),
      );
      return;
    }
    for (const preset of presets)
      this._soundFontPresetSelect.appendChild(
        option({ value: preset.index }, preset.name),
      );
    this._soundFontPresetSelect.value = String(
      instrument?.soundFontPreset ?? 0,
    );
    if (this._soundFontPresetSelect.selectedIndex == -1 && presets.length > 0)
      this._soundFontPresetSelect.selectedIndex = 0;
  }

  private _updateAssetLoadingIndicator(): void {
    const instrument =
      this.doc.song.channels[this.doc.channel]?.instruments[
        this.doc.getCurrentInstrument()
      ];
    const chipWave =
      instrument?.type == InstrumentType.chip
        ? Config.chipWaves[instrument.chipWave]
        : undefined;
    const loading: boolean =
      chipWave?.sampleId != undefined &&
      this.doc.synth.getAssetLoadStatus(chipWave.sampleId) == "loading";
    this._chipWaveSelectRow.classList.toggle("asset-loading", loading);
  }

  private _echoDelayToBeats(value: number): number {
    return (
      ((value + 1) * Config.echoDelayStepTicks) /
      (Config.ticksPerPart * Config.partsPerBeat)
    );
  }

  private _echoDelayFromBeats(value: number): number {
    return (
      (value * Config.ticksPerPart * Config.partsPerBeat) /
        Config.echoDelayStepTicks -
      1
    );
  }

  private _openPrompt(promptName: string): void {
    this.doc.openPrompt(promptName);
  }

  private _openPreferences = (): void => {
    this._openPrompt("preferences");
  };

  private _openAbout = (): void => {
    this._openPrompt("about");
  };

  private _setPrompt(promptName: string | null): void {
    if (this._currentPromptName == promptName) return;
    this._currentPromptName = promptName;

    if (this.prompt) {
      if (
        this._wasPlaying &&
        this.prompt.pausePlayback !== false &&
        !(this.prompt instanceof SustainPrompt)
      ) {
        this.doc.performance.play();
      }
      this._wasPlaying = false;
      unmountPrompt(this.prompt, this._promptContainer);
      this.prompt = null;
      this._refocusStage();
    }

    if (promptName) {
      switch (promptName) {
        case "export":
          this.prompt = new ExportPrompt(this.doc);
          break;
        case "exportGoop":
          this.prompt = new ExportPrompt(this.doc, "goop");
          break;
        case "songRecovery":
          this.prompt = new SongRecoveryPrompt(this.doc);
          break;
        case "moveNotesSideways":
          this.prompt = new MoveNotesSidewaysPrompt(this.doc);
          break;
        case "beatsPerBar":
          this.prompt = new BeatsPerBarPrompt(this.doc);
          break;
        case "preferences":
          this.prompt = new PreferencesPrompt(this.doc);
          break;
        case "about":
          this.prompt = new AboutPrompt(this.doc);
          break;
        case "stringSustain":
          this.prompt = new SustainPrompt(this.doc);
          break;
        case "instrumentPreset":
          this.prompt = new InstrumentPresetPrompt(
            this.doc.song.getChannelIsNoise(this.doc.channel),
            (preset) => this._setPreset(preset),
            this._closePrompt,
            this._getSamplePresets(),
            this._getSoundFontPresetGroups(),
          );
          break;
        case "instrumentType":
          this.prompt = new InstrumentTypePrompt(
            (preset) => this._setPreset(preset),
            this._closePrompt,
          );
          break;
        case "assets":
          this.prompt = new AssetsPrompt(this.doc);
          break;
        case "flpInstruments":
          {
            const pending = this._pendingFlpImport;
            if (pending != null) {
              this.prompt = new FlpInstrumentPrompt(
                this.doc,
                pending.imported,
                (): void => {
                  pending.apply();
                  this._pendingFlpImport = null;
                  this._closePrompt();
                },
                this._closePrompt,
              );
            }
          }
          break;
        default:
          this.prompt = null;
          break;
      }

      if (this.prompt) {
        if (
          this.prompt.pausePlayback !== false &&
          !(this.prompt instanceof SustainPrompt)
        ) {
          this._wasPlaying = this.doc.synth.playing;
          this.doc.performance.pause();
        }
        mountPrompt(this.prompt, this._promptContainer, this._closePrompt);
      }
    }
  }

  private _closePrompt = (): void => {
    if (this._currentPromptName == "flpInstruments")
      this._pendingFlpImport = null;
    this.doc.closePrompt();
  };

  private _refocusStage = (): void => {
    this.mainLayer.focus({ preventScroll: true });
  };

  private _onFocusIn = (event: Event): void => {
    if (
      this.doc.synth.recording &&
      event.target != this.mainLayer &&
      event.target != this._stopButton
    ) {
      // Don't allow using tab to focus on the song settings while recording,
      // since interacting with them while recording would mess up the recording.
      this._refocusStage();
    }
  };

  public whenUpdated = (): void => {
    const prefs: Preferences = this.doc.prefs;
    this._muteEditor.container.style.display = "";
    this.doc.trackVisibleBars = Math.floor(
      (this._trackVisibleArea.clientWidth -
        32 -
        TrackEditor.channelNumberWidth) /
        this.doc.getBarWidth(),
    );
    this.doc.trackVisibleChannels = Math.floor(
      (this._trackVisibleArea.clientHeight - 30 - TrackEditor.barNumberHeight) /
        ChannelRow.patternHeight,
    );
    this._barScrollBar.render();
    this._muteEditor.render();
    this._trackEditor.render();

    this._trackAndMuteContainer.scrollLeft =
      this.doc.barScrollPos * this.doc.getBarWidth();
    this._trackAndMuteContainer.scrollTop =
      this.doc.channelScrollPos * ChannelRow.patternHeight;

    this._piano.container.style.display = "";
    this._octaveScrollBar.container.style.display = "";
    this._barScrollBar.container.style.display =
      this.doc.song.barCount > this.doc.trackVisibleBars ? "" : "none";

    const semitoneHeight: number =
      this._patternEditorRow.clientHeight / this.doc.getVisiblePitchCount();
    const targetBeatWidth: number = semitoneHeight * 5;
    const minBeatWidth: number =
      this._patternEditorRow.clientWidth / (this.doc.song.beatsPerBar * 3);
    const maxBeatWidth: number =
      this._patternEditorRow.clientWidth / (this.doc.song.beatsPerBar + 2);
    const beatWidth: number = Math.max(
      minBeatWidth,
      Math.min(maxBeatWidth, targetBeatWidth),
    );
    const patternEditorWidth: number = beatWidth * this.doc.song.beatsPerBar;

    this._patternEditorPrev.container.style.width = patternEditorWidth + "px";
    this._patternEditor.container.style.width = patternEditorWidth + "px";
    this._patternEditorNext.container.style.width = patternEditorWidth + "px";
    this._patternEditorPrev.container.style.flexShrink = "0";
    this._patternEditor.container.style.flexShrink = "0";
    this._patternEditorNext.container.style.flexShrink = "0";
    this._patternEditorPrev.container.style.display = "";
    this._patternEditorNext.container.style.display = "";
    this._patternEditorPrev.render();
    this._patternEditorNext.render();
    const isDrumChannel: boolean = this.doc.song.getChannelIsNoise(
      this.doc.channel,
    );
    this._zoomInButton.style.display = isDrumChannel ? "none" : "";
    this._zoomOutButton.style.display = isDrumChannel ? "none" : "";
    this._zoomInButton.style.right = "24px";
    this._zoomOutButton.style.right = "24px";
    this._patternEditor.render();

    const channel: Channel = this.doc.song.channels[this.doc.channel];
    const instrumentIndex: number = this.doc.getCurrentInstrument();
    const instrument: Instrument = channel.instruments[instrumentIndex];
    const wasActive: boolean = this.mainLayer.contains(document.activeElement);
    const activeElement: Element | null = document.activeElement;
    const colors: ChannelColors = ColorConfig.getChannelColor(
      this.doc.song,
      this.doc.channel,
    );

    if (this._effectsSelect.childElementCount == 1) {
      for (const group of Config.effectGroups) {
        const optgroup: HTMLOptGroupElement =
          document.createElement("optgroup");
        optgroup.label = group.name;
        for (const effect of group.effects) {
          optgroup.appendChild(option({ value: effect }));
        }
        this._effectsSelect.appendChild(optgroup);
      }
    }
    this._effectsSelect.selectedIndex = 0;
    for (let i: number = 0; i < Config.effectOrder.length; i++) {
      let effectFlag: number = Config.effectOrder[i];
      const selected: boolean = (instrument.effects & (1 << effectFlag)) != 0;
      const label: string =
        (selected ? "✓ " : "　") + Config.effectNames[effectFlag];
      const effectOption: HTMLOptionElement = <HTMLOptionElement>(
        this._effectsSelect.querySelector(`option[value="${effectFlag}"]`)
      );
      if (effectOption.textContent != label) effectOption.textContent = label;
    }

    setSelectedValue(this._scaleSelect, this.doc.song.scale);
    this._scaleSelect.title = Config.scales[this.doc.song.scale].realName;
    setSelectedValue(
      this._keySelect,
      Config.keys.length - 1 - this.doc.song.composingKey,
    );
    setSelectedValue(
      this._legacyKeySelect,
      Config.keys.length - 1 - this.doc.song.key,
    );
    this._tempoSlider.updateValue(
      Math.max(
        0,
        Math.min(
          28,
          Math.round(4.0 + 9.0 * Math.log2(this.doc.song.tempo / 120.0)),
        ),
      ),
    );
    this._tempoStepper.value = this.doc.song.tempo.toString();
    setSelectedValue(this._rhythmSelect, this.doc.song.rhythm);
    this._beatsPerBarStepper.value = this.doc.song.beatsPerBar.toString();
    this._songLengthStepper.value = this.doc.song.barCount.toString();
    this._pitchChannelsStepper.value =
      this.doc.song.pitchChannelCount.toString();
    this._drumChannelsStepper.value =
      this.doc.song.noiseChannelCount.toString();
    this._maxPatternsStepper.value =
      this.doc.song.patternsPerChannel.toString();
    const chipWave =
      instrument.type == InstrumentType.chip
        ? Config.chipWaves[instrument.chipWave]
        : undefined;
    this._presetButton.textContent =
      instrument.type == InstrumentType.soundFont
        ? this._getSoundFontPresetName(
            instrument.soundFontId,
            instrument.soundFontPreset,
          )
        : chipWave?.sampleId != undefined
          ? chipWave.name
          : (EditorConfig.valueToPreset(instrument.preset)?.name ?? "Preset");
    this._instrumentSettings.setSpecificInstrumentType(instrument.type);

    if (this.doc.song.getChannelIsNoise(this.doc.channel)) {
      this._pitchedPresetSelect.style.display = "none";
      this._drumPresetSelect.style.display = "";
      setSelectedValue(this._drumPresetSelect, instrument.preset);
    } else {
      this._pitchedPresetSelect.style.display = "";
      this._drumPresetSelect.style.display = "none";
      setSelectedValue(this._pitchedPresetSelect, instrument.preset);
    }

    if (instrument.type == InstrumentType.noise) {
      this._chipNoiseSelectRow.style.display = "";
      setSelectedValue(this._chipNoiseSelect, instrument.chipNoise);
    } else {
      this._chipNoiseSelectRow.style.display = "none";
    }
    if (instrument.type == InstrumentType.spectrum) {
      this._spectrumRow.style.display = "";
      this._spectrumEditor.render();
    } else {
      this._spectrumRow.style.display = "none";
    }
    if (
      instrument.type == InstrumentType.harmonics ||
      instrument.type == InstrumentType.pickedString
    ) {
      this._harmonicsRow.style.display = "";
      this._harmonicsEditor.render();
    } else {
      this._harmonicsRow.style.display = "none";
    }
    if (instrument.type == InstrumentType.pickedString) {
      this._stringSustainRow.style.display = "";
      this._stringSustainSlider.updateValue(instrument.stringSustain);
      this._stringSustainLabel.textContent = Config.enableAcousticSustain
        ? "Sustain (" +
          Config.sustainTypeNames[instrument.stringSustainType]
            .substring(0, 1)
            .toUpperCase() +
          ")"
        : "Sustain";
    } else {
      this._stringSustainRow.style.display = "none";
    }
    this._fadeInOutRow.style.display = "";
    this._fadeInOutEditor.render();
    if (instrument.type == InstrumentType.drumset) {
      this._drumsetGroup.style.display = "";
      for (let i: number = 0; i < Config.drumCount; i++) {
        setSelectedValue(
          this._drumsetEnvelopeSelects[i],
          instrument.drumsetEnvelopes[i],
        );
        this._drumsetEnvelopeParameterEditors[i].render(
          instrument.drumsetEnvelopes[i],
          {
            speed: instrument.drumsetEnvelopeSpeeds[i],
            a: instrument.drumsetEnvelopeAs[i],
            b: instrument.drumsetEnvelopeBs[i],
          },
        );
        this._drumsetSpectrumEditors[i].render();
      }
    } else {
      this._drumsetGroup.style.display = "none";
    }

    this._syncChipWaveOptions();
    this._syncSoundFontOptions();
    if (instrument.type == InstrumentType.chip) {
      this._chipWaveSelectRow.style.display = "";
      setSelectedValue(this._chipWaveSelect, instrument.chipWave);
      this._updateAssetLoadingIndicator();
    } else {
      this._chipWaveSelectRow.style.display = "none";
      this._chipWaveSelectRow.classList.remove("asset-loading");
    }
    if (instrument.type == InstrumentType.soundFont) {
      this._soundFontSelectRow.style.display = "";
      this._syncSoundFontOptions();
    } else {
      this._soundFontSelectRow.style.display = "none";
      this._soundFontPresetSelectRow.style.display = "none";
    }
    if (instrument.type == InstrumentType.fm) {
      this._algorithmSelectRow.style.display = "";
      this._phaseModGroup.style.display = "";
      this._feedbackRow1.style.display = "";
      this._feedbackRow2.style.display = "";
      setSelectedValue(this._algorithmSelect, instrument.algorithm);
      setSelectedValue(this._feedbackTypeSelect, instrument.feedbackType);
      this._feedbackAmplitudeSlider.updateValue(instrument.feedbackAmplitude);
      for (let i: number = 0; i < Config.operatorCount; i++) {
        const isCarrier: boolean =
          i < Config.algorithms[instrument.algorithm].carrierCount;
        this._operatorRows[i].style.color = colors.primaryNote;
        this._operatorFrequencyInputs[i].updateValue(
          instrument.operators[i].frequency,
        );
        setSelectedValue(
          this._operatorWaveSelects[i],
          instrument.operators[i].wave,
        );
        this._operatorAmplitudeSliders[i].updateValue(
          instrument.operators[i].amplitude,
        );
        const operatorName: string =
          (isCarrier ? "Voice " : "Modulator ") + (i + 1);
        this._operatorFrequencyInputs[i].input.title =
          operatorName + " Frequency";
        this._operatorWaveSelects[i].title = operatorName + " Waveform";
        this._operatorWaveButtons[i].title =
          (this._operatorWaveRows[i].style.display == "none"
            ? "Show "
            : "Hide ") +
          operatorName.toLowerCase() +
          " waveform";
        this._operatorWaveButtons[i].setAttribute(
          "aria-label",
          this._operatorWaveButtons[i].title,
        );
        this._operatorAmplitudeSliders[i].input.title =
          operatorName + (isCarrier ? " Volume" : " Amplitude");
      }
    } else {
      this._algorithmSelectRow.style.display = "none";
      this._phaseModGroup.style.display = "none";
      this._feedbackRow1.style.display = "none";
      this._feedbackRow2.style.display = "none";
    }
    if (instrument.type == InstrumentType.supersaw) {
      this._supersawDynamismRow.style.display = "";
      this._supersawSpreadRow.style.display = "";
      this._supersawShapeRow.style.display = "";
      this._supersawDynamismSlider.updateValue(instrument.supersawDynamism);
      this._supersawSpreadSlider.updateValue(instrument.supersawSpread);
      this._supersawShapeSlider.updateValue(instrument.supersawShape);
    } else {
      this._supersawDynamismRow.style.display = "none";
      this._supersawSpreadRow.style.display = "none";
      this._supersawShapeRow.style.display = "none";
    }
    if (
      instrument.type == InstrumentType.pwm ||
      instrument.type == InstrumentType.supersaw
    ) {
      this._pulseWidthRow.style.display = "";
      this._pulseWidthSlider.container.title =
        prettyNumber(getPulseWidthRatio(instrument.pulseWidth) * 100) + "%";
      this._pulseWidthSlider.updateValue(instrument.pulseWidth);
    } else {
      this._pulseWidthRow.style.display = "none";
    }

    if (effectsIncludeTransition(instrument.effects)) {
      this._transitionRow.style.display = "";
      setSelectedValue(this._transitionSelect, instrument.transition);
    } else {
      this._transitionRow.style.display = "none";
    }

    if (effectsIncludeChord(instrument.effects)) {
      this._chordSelectRow.style.display = "";
      setSelectedValue(this._chordSelect, instrument.chord);
    } else {
      this._chordSelectRow.style.display = "none";
    }

    if (effectsIncludePitchShift(instrument.effects)) {
      this._pitchShiftRow.style.display = "";
      this._pitchShiftSlider.updateValue(instrument.pitchShift);
      this._pitchShiftSlider.container.title =
        instrument.pitchShift - Config.pitchShiftCenter + " semitone(s)";
      for (const marker of this._pitchShiftFifthMarkers) {
        marker.style.display = "";
      }
    } else {
      this._pitchShiftRow.style.display = "none";
    }

    if (effectsIncludeDetune(instrument.effects)) {
      this._detuneRow.style.display = "";
      this._detuneSlider.updateValue(instrument.detune);
      this._detuneSlider.container.title =
        Synth.detuneToCents(instrument.detune - Config.detuneCenter) +
        " cent(s)";
    } else {
      this._detuneRow.style.display = "none";
    }

    if (effectsIncludeVibrato(instrument.effects)) {
      this._vibratoSelectRow.style.display = "";
      setSelectedValue(this._vibratoSelect, instrument.vibrato);
    } else {
      this._vibratoSelectRow.style.display = "none";
    }

    if (effectsIncludeNoteFilter(instrument.effects)) {
      this._noteFilterRow.style.display = "";
      this._noteFilterEditor.render();
    } else {
      this._noteFilterRow.style.display = "none";
    }

    if (effectsIncludeDistortion(instrument.effects)) {
      this._distortionRow.style.display = "";
      this._distortionSlider.updateValue(instrument.distortion);
    } else {
      this._distortionRow.style.display = "none";
    }

    if (effectsIncludeBitcrusher(instrument.effects)) {
      this._bitcrusherQuantizationRow.style.display = "";
      this._bitcrusherFreqRow.style.display = "";
      this._bitcrusherQuantizationSlider.updateValue(
        instrument.bitcrusherQuantization,
      );
      this._bitcrusherFreqSlider.updateValue(instrument.bitcrusherFreq);
    } else {
      this._bitcrusherQuantizationRow.style.display = "none";
      this._bitcrusherFreqRow.style.display = "none";
    }

    const panPercent: number = panSettingToPercent(instrument.pan);
    this._panSlider.updateValue(panPercent);
    this._panInput.updateValue(panPercent);

    if (effectsIncludeChorus(instrument.effects)) {
      this._chorusRow.style.display = "";
      this._chorusSlider.updateValue(instrument.chorus);
    } else {
      this._chorusRow.style.display = "none";
    }

    if (effectsIncludeEcho(instrument.effects)) {
      this._echoSustainRow.style.display = "";
      this._echoSustainSlider.updateValue(instrument.echoSustain);
      this._echoDelayRow.style.display = "";
      this._echoDelaySlider.updateValue(instrument.echoDelay);
      this._echoDelaySlider.container.title =
        Math.round(this._echoDelayToBeats(instrument.echoDelay) * 1000) / 1000 +
        " beat(s)";
    } else {
      this._echoSustainRow.style.display = "none";
      this._echoDelayRow.style.display = "none";
    }

    if (effectsIncludeReverb(instrument.effects)) {
      this._reverbRow.style.display = "";
      this._reverbSlider.updateValue(instrument.reverb);
    } else {
      this._reverbRow.style.display = "none";
    }

    if (effectsIncludeUnison(instrument.effects)) {
      this._unisonSelectRow.style.display = "";
      setSelectedValue(this._unisonSelect, instrument.unison);
    } else {
      this._unisonSelectRow.style.display = "none";
    }

    this._envelopeEditor.render();

    for (
      let chordIndex: number = 0;
      chordIndex < Config.chords.length;
      chordIndex++
    ) {
      let hidden: boolean =
        !Config.instrumentTypeHasSpecialInterval[instrument.type] &&
        Config.chords[chordIndex].customInterval;
      const option: Element = this._chordSelect.children[chordIndex];
      if (hidden) {
        if (!option.hasAttribute("hidden")) {
          option.setAttribute("hidden", "");
        }
      } else {
        option.removeAttribute("hidden");
      }
    }

    this._instrumentsButtonRow.style.display = "";

    this._instrumentsButtonBar.style.setProperty(
      "--text-color-lit",
      colors.primaryNote,
    );
    this._instrumentsButtonBar.style.setProperty(
      "--background-color-lit",
      colors.primaryChannel,
    );

    const maxInstrumentsPerChannel =
      this.doc.song.getMaxInstrumentsPerChannel();
    while (this._instrumentButtons.length < channel.instruments.length) {
      const instrumentButton: HTMLButtonElement = button(
        String(this._instrumentButtons.length + 1),
      );
      this._instrumentButtons.push(instrumentButton);
      this._instrumentButtonsScroller.appendChild(instrumentButton);
    }
    for (
      let i: number = this._renderedInstrumentCount;
      i < channel.instruments.length;
      i++
    ) {
      this._instrumentButtons[i].style.display = "";
    }
    for (
      let i: number = channel.instruments.length;
      i < this._renderedInstrumentCount;
      i++
    ) {
      this._instrumentButtons[i].style.display = "none";
    }
    this._renderedInstrumentCount = channel.instruments.length;
    while (this._instrumentButtons.length > maxInstrumentsPerChannel) {
      this._instrumentButtonsScroller.removeChild(
        this._instrumentButtons.pop()!,
      );
    }

    this._instrumentRemoveButton.style.display =
      channel.instruments.length > Config.instrumentCountMin ? "" : "none";
    this._instrumentAddButton.style.display =
      channel.instruments.length < maxInstrumentsPerChannel ? "" : "none";
    if (channel.instruments.length < maxInstrumentsPerChannel) {
      this._instrumentRemoveButton.classList.remove("last-button");
    } else {
      this._instrumentRemoveButton.classList.add("last-button");
    }
    if (channel.instruments.length > 1) {
      if (this._highlightedInstrumentIndex != instrumentIndex) {
        const oldButton: HTMLButtonElement =
          this._instrumentButtons[this._highlightedInstrumentIndex];
        if (oldButton != null)
          oldButton.classList.remove("selected-instrument");
        const newButton: HTMLButtonElement =
          this._instrumentButtons[instrumentIndex];
        newButton.classList.add("selected-instrument");
        newButton.scrollIntoView({ block: "nearest", inline: "nearest" });
        this._highlightedInstrumentIndex = instrumentIndex;
      }
    } else {
      const oldButton: HTMLButtonElement =
        this._instrumentButtons[this._highlightedInstrumentIndex];
      if (oldButton != null) oldButton.classList.remove("selected-instrument");
      this._highlightedInstrumentIndex = -1;
    }

    this._instrumentSettingsControls.style.color = colors.primaryNote;

    if (effectsIncludeEqFilter(instrument.effects)) {
      this._eqFilterRow.style.display = "";
      this._eqFilterEditor.render();
    } else {
      this._eqFilterRow.style.display = "none";
    }
    this._instrumentVolumeSlider.updateValue(instrument.volume);
    this._instrumentVolumeInput.updateValue(instrument.volume);
    this._addEnvelopeButton.disabled =
      instrument.envelopeCount >= Config.maxEnvelopeCount;

    // If an interface element was selected, but becomes invisible (e.g. an instrument
    // select menu) just select the editor container so keyboard commands still work.
    if (wasActive && activeElement != null && activeElement.clientWidth == 0) {
      this._refocusStage();
    }

    this._setPrompt(this.doc.prompt);

    if (prefs.autoFollow && !this.doc.synth.playing) {
      this.doc.synth.goToBar(this.doc.bar);
    }

    // When adding effects or envelopes to an instrument in fullscreen modes,
    // auto-scroll the settings areas to ensure the new settings are visible.
    if (this.doc.addedEffect) {
      // TODO: This is pretty janky! I'd prefer to not have to rely on getBoundingClientRect().
      const envButtonRect: DOMRect =
        this._addEnvelopeButton.getBoundingClientRect();
      const instSettingsRect: DOMRect =
        this._instrumentSettingsArea.getBoundingClientRect();
      const settingsRect: DOMRect = this._settingsArea.getBoundingClientRect();
      this._instrumentSettingsArea.scrollTop += Math.max(
        0,
        envButtonRect.top - (instSettingsRect.top + instSettingsRect.height),
      );
      this._settingsArea.scrollTop += Math.max(
        0,
        envButtonRect.top - (settingsRect.top + settingsRect.height),
      );
      this.doc.addedEffect = false;
    }
    if (this.doc.addedEnvelope) {
      this._instrumentSettingsArea.scrollTop =
        this._instrumentSettingsArea.scrollHeight;
      this._settingsArea.scrollTop = this._settingsArea.scrollHeight;
      this.doc.addedEnvelope = false;
    }
  };

  public updatePlayButton = (): void => {
    if (
      this._renderedIsPlaying != this.doc.synth.playing ||
      this._renderedIsRecording != this.doc.synth.recording ||
      !this._renderedShowRecordButton ||
      this._renderedCtrlHeld != activeModifierKeys.ctrl
    ) {
      this._renderedIsPlaying = this.doc.synth.playing;
      this._renderedIsRecording = this.doc.synth.recording;
      this._renderedShowRecordButton = true;
      this._renderedCtrlHeld = activeModifierKeys.ctrl;

      if (
        document.activeElement == this._playButton ||
        document.activeElement == this._pauseButton ||
        document.activeElement == this._recordButton ||
        document.activeElement == this._stopButton
      ) {
        // When a focused element is hidden, focus is transferred to the document, so let's refocus the editor instead to make sure we can still capture keyboard input.
        this._refocusStage();
      }

      this._playButton.style.display = "none";
      this._pauseButton.style.display = "none";
      this._recordButton.style.display = "none";
      this._stopButton.style.display = "none";
      this._prevBarButton.style.display = "";
      this._nextBarButton.style.display = "";
      this._playButton.classList.remove("shrunk");
      this._recordButton.classList.remove("shrunk");
      this._patternEditorRow.style.pointerEvents = "";
      this._octaveScrollBar.container.style.pointerEvents = "";
      this._octaveScrollBar.container.style.opacity = "";
      this._trackContainer.style.pointerEvents = "";
      this._loopEditor.container.style.opacity = "";
      this._instrumentSettingsArea.style.pointerEvents = "";
      this._instrumentSettingsArea.style.opacity = "";
      this._menuArea.style.pointerEvents = "";
      this._menuArea.style.opacity = "";
      this._songSettingsArea.style.pointerEvents = "";
      this._songSettingsArea.style.opacity = "";

      if (this.doc.synth.recording) {
        this._stopButton.style.display = "";
        this._prevBarButton.style.display = "none";
        this._nextBarButton.style.display = "none";
        this._patternEditorRow.style.pointerEvents = "none";
        this._octaveScrollBar.container.style.pointerEvents = "none";
        this._octaveScrollBar.container.style.opacity = "0.5";
        this._trackContainer.style.pointerEvents = "none";
        this._loopEditor.container.style.opacity = "0.5";
        this._instrumentSettingsArea.style.pointerEvents = "none";
        this._instrumentSettingsArea.style.opacity = "0.5";
        this._menuArea.style.pointerEvents = "none";
        this._menuArea.style.opacity = "0.5";
        this._songSettingsArea.style.pointerEvents = "none";
        this._songSettingsArea.style.opacity = "0.5";
      } else if (this.doc.synth.playing) {
        this._pauseButton.style.display = "";
      } else {
        this._playButton.style.display = "";
        this._recordButton.style.display = "";
        this._playButton.classList.add("shrunk");
        this._recordButton.classList.add("shrunk");
      }
    }
    window.requestAnimationFrame(this.updatePlayButton);
  };

  private _onTrackAreaScroll = (_event: Event): void => {
    this._loopEditor.container.style.setProperty(
      "--track-scroll-left",
      `${this._trackAndMuteContainer.scrollLeft}px`,
    );
    this.doc.barScrollPos =
      this._trackAndMuteContainer.scrollLeft / this.doc.getBarWidth();
    this.doc.channelScrollPos =
      this._trackAndMuteContainer.scrollTop / ChannelRow.patternHeight;
    //this.doc.notifier.changed();
  };

  private _disableCtrlContextMenu = (event: MouseEvent): boolean => {
    // On a Mac, clicking while holding control opens the right-click context menu.
    // But in the pattern and track editors I'd rather prevent that and instead allow
    // custom behaviors such as setting the volume of a note.
    if (event.ctrlKey) {
      event.preventDefault();
      return false;
    }
    return true;
  };

  private _whenKeyPressed = (event: KeyboardEvent): void => {
    if (this.prompt) {
      if (event.keyCode == 27) {
        // ESC key
        // close prompt.
        this._closePrompt();
      }
      return;
    }

    if (
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLInputElement &&
        [
          "email",
          "number",
          "password",
          "search",
          "tel",
          "text",
          "url",
        ].includes(event.target.type))
    ) {
      return;
    }

    if (this.doc.synth.recording) {
      // The only valid keyboard interactions when recording are playing notes or pressing space OR P to stop.
      if (!event.ctrlKey && !event.metaKey) {
        this._keyboardLayout.handleKeyEvent(event, true);
      }
      if (event.keyCode == 32) {
        // space
        this._toggleRecord();
        event.preventDefault();
        this._refocusStage();
      } else if (event.keyCode == 80 && (event.ctrlKey || event.metaKey)) {
        // p
        this._toggleRecord();
        event.preventDefault();
        this._refocusStage();
      }
      return;
    }

    const needControlForShortcuts: boolean =
      this.doc.prefs.pressControlForShortcuts;
    const canPlayNotes: boolean =
      !event.ctrlKey && !event.metaKey && needControlForShortcuts;
    if (canPlayNotes) this._keyboardLayout.handleKeyEvent(event, true);

    switch (event.keyCode) {
      case 27: // ESC key
        if (!event.ctrlKey && !event.metaKey) {
          new ChangePatternSelection(this.doc, 0, 0);
          this.doc.selection.resetBoxSelection();
        }
        break;
      case 32: // space
        if (event.ctrlKey) {
          this._toggleRecord();
        } else if (event.shiftKey) {
          // Jump to mouse
          if (
            this._trackEditor.movePlayheadToMouse() ||
            this._patternEditor.movePlayheadToMouse()
          ) {
            if (!this.doc.synth.playing) this.doc.performance.play();
          }
        } else {
          this._togglePlay();
        }
        event.preventDefault();
        this._refocusStage();
        break;
      case 80: // p
        if (canPlayNotes) break;
        if (event.ctrlKey || event.metaKey) {
          this._toggleRecord();
          event.preventDefault();
          this._refocusStage();
        }
        break;
      case 90: // z
        if (canPlayNotes) break;
        if (event.shiftKey) {
          this.doc.redo();
        } else {
          this.doc.undo();
        }
        event.preventDefault();
        break;
      case 89: // y
        if (canPlayNotes) break;
        this.doc.redo();
        event.preventDefault();
        break;
      case 67: // c
        if (canPlayNotes) break;
        if (event.shiftKey) {
          this._copyInstrument();
        } else {
          this.doc.selection.copy();
        }
        event.preventDefault();
        break;
      case 88: // x
        if (canPlayNotes) break;
        this.doc.selection.cut();
        event.preventDefault();
        break;
      case 81: // q
        if (!event.shiftKey || event.ctrlKey || event.metaKey) break;
        this._openPrompt("assets");
        event.preventDefault();
        break;
      case 13: // enter/return
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.insertChannel();
        } else {
          this.doc.selection.insertBars();
        }
        event.preventDefault();
        break;
      case 8: // backspace/delete
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.deleteChannel();
        } else {
          this.doc.selection.deleteBars();
        }
        event.preventDefault();
        break;
      case 65: // a
        if (canPlayNotes) break;
        if (event.shiftKey) {
          this.doc.selection.selectChannel();
        } else {
          this.doc.selection.selectAll();
        }
        event.preventDefault();
        break;
      case 68: // d
        if (canPlayNotes) break;
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
          this.doc.record(new ChangeRectifyPatterns(this.doc));
          event.preventDefault();
        } else if (
          needControlForShortcuts == (event.ctrlKey || event.metaKey)
        ) {
          this.doc.selection.duplicatePatterns();
          event.preventDefault();
        }
        break;
      case 70: // f
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.synth.snapToStart();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(
              this.doc.channel,
              Math.floor(this.doc.synth.playhead),
            );
          }
          event.preventDefault();
        }
        break;
      case 72: // h
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToBar(this.doc.bar);
          this.doc.synth.snapToBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(
              this.doc.channel,
              Math.floor(this.doc.synth.playhead),
            );
          }
          event.preventDefault();
        }
        break;
      case 77: // m
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.muteChannels(event.shiftKey);
          event.preventDefault();
        }
        break;
      case 83: // s
        if (canPlayNotes) break;
        if (event.ctrlKey || event.metaKey) {
          this._openPrompt("export");
          event.preventDefault();
        } else {
          this.doc.selection.soloChannels(event.shiftKey);
          event.preventDefault();
        }
        break;
      case 79: // o
        if (canPlayNotes) break;
        if (event.ctrlKey || event.metaKey) {
          this._importFile.open();
          event.preventDefault();
        }
        break;
      case 86: // v
        if (canPlayNotes) break;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          !needControlForShortcuts
        ) {
          this.doc.selection.pasteNumbers();
        } else if (event.shiftKey) {
          this._pasteInstrument();
        } else {
          this.doc.selection.pasteNotes();
        }
        event.preventDefault();
        break;
      case 82: // r
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          if (event.shiftKey) {
            this._randomGenerated();
          } else {
            this._randomPreset();
          }
          event.preventDefault();
        }
        break;
      case 219: // left brace
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToPrevBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(
              this.doc.channel,
              Math.floor(this.doc.synth.playhead),
            );
          }
          event.preventDefault();
        }
        break;
      case 221: // right brace
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.synth.goToNextBar();
          if (this.doc.prefs.autoFollow) {
            this.doc.selection.setChannelBar(
              this.doc.channel,
              Math.floor(this.doc.synth.playhead),
            );
          }
          event.preventDefault();
        }
        break;
      case 189: // -
      case 173: // Firefox -
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.transpose(false, event.shiftKey);
          event.preventDefault();
        }
        break;
      case 187: // +
      case 61: // Firefox +
      case 171: // Some users have this as +? Hmm.
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.transpose(true, event.shiftKey);
          event.preventDefault();
        }
        break;
      case 38: // up
        if (event.ctrlKey || event.metaKey) {
          this.doc.selection.swapChannels(-1);
        } else if (event.shiftKey) {
          this.doc.selection.boxSelectionY1 = Math.max(
            0,
            this.doc.selection.boxSelectionY1 - 1,
          );
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
      case 40: // down
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
      case 37: // left
        if (event.shiftKey) {
          this.doc.selection.boxSelectionX1 = Math.max(
            0,
            this.doc.selection.boxSelectionX1 - 1,
          );
          this.doc.selection.scrollToEndOfSelection();
          this.doc.selection.selectionUpdated();
        } else {
          this.doc.selection.setChannelBar(
            this.doc.channel,
            (this.doc.bar + this.doc.song.barCount - 1) %
              this.doc.song.barCount,
          );
          this.doc.selection.resetBoxSelection();
        }
        event.preventDefault();
        break;
      case 39: // right
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
      case 48: // 0
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("0", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 49: // 1
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("1", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 50: // 2
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("2", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 51: // 3
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("3", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 52: // 4
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("4", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 53: // 5
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("5", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 54: // 6
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("6", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 55: // 7
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("7", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 56: // 8
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("8", event.shiftKey);
          event.preventDefault();
        }
        break;
      case 57: // 9
        if (canPlayNotes) break;
        if (needControlForShortcuts == (event.ctrlKey || event.metaKey)) {
          this.doc.selection.nextDigit("9", event.shiftKey);
          event.preventDefault();
        }
        break;
      default:
        this.doc.selection.digits = "";
        this.doc.selection.instrumentDigits = "";
        break;
    }

    if (canPlayNotes) {
      this.doc.selection.digits = "";
      this.doc.selection.instrumentDigits = "";
    }
  };

  private _whenKeyReleased = (event: KeyboardEvent): void => {
    // Release live pitches regardless of control so that any pitches played before will get released even if the modifier keys changed.
    this._keyboardLayout.handleKeyEvent(event, false);
  };

  private _copyTextToClipboard(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        window.prompt("Copy to clipboard:", text);
      });
      return;
    }
    const textField: HTMLTextAreaElement = document.createElement("textarea");
    textField.textContent = text;
    document.body.appendChild(textField);
    textField.select();
    const succeeded: boolean = document.execCommand("copy");
    textField.remove();
    this._refocusStage();
    if (!succeeded) window.prompt("Copy this:", text);
  }

  private _whenPrevBarPressed = (): void => {
    this.doc.synth.goToPrevBar();
  };

  private _whenNextBarPressed = (): void => {
    this.doc.synth.goToNextBar();
  };

  private _togglePlay = (): void => {
    if (this.doc.synth.playing) {
      this.doc.performance.pause();
    } else {
      this.doc.synth.snapToBar();
      this.doc.performance.play();
    }
  };

  private _toggleRecord = (): void => {
    if (this.doc.synth.playing) {
      this.doc.performance.pause();
    } else {
      this.doc.performance.record();
    }
  };

  private _copyInstrument = (): void => {
    window.localStorage.setItem(
      "instrumentCopy",
      JSON.stringify(this._getInstrumentCopy()),
    );
    this._refocusStage();
  };

  private _pasteInstrument = (): void => {
    const instrumentCopy: any = JSON.parse(
      String(window.localStorage.getItem("instrumentCopy")),
    );
    this._pasteInstrumentCopy(instrumentCopy);
    this._refocusStage();
  };

  private _getInstrumentCopy(): any {
    const channel: Channel = this.doc.song.channels[this.doc.channel];
    const instrument: Instrument =
      channel.instruments[this.doc.getCurrentInstrument()];
    return instrument.toSettingsObject();
  }

  private _pasteInstrumentCopy(instrumentCopy: any): void {
    if (instrumentCopy != null) {
      const channel: Channel = this.doc.song.channels[this.doc.channel];
      const instrument: Instrument =
        channel.instruments[this.doc.getCurrentInstrument()];
      this.doc.record(
        new ChangePasteInstrument(this.doc, instrument, instrumentCopy),
      );
    }
  }

  private _copyInstrumentSettingsCategory = (
    category: InstrumentSettingsCategory,
  ): void => {
    window.localStorage.setItem(
      "instrumentSettingsCategoryCopy",
      JSON.stringify(
        copyInstrumentSettingsCategory(this._getInstrumentCopy(), category),
      ),
    );
    this._refocusStage();
  };

  private _pasteInstrumentSettingsCategory = (
    category: InstrumentSettingsCategory,
  ): void => {
    try {
      const copy: unknown = JSON.parse(
        String(window.localStorage.getItem("instrumentSettingsCategoryCopy")),
      );
      if (!isInstrumentSettingsCategoryCopy(copy, category)) {
        return;
      }
      this._recordInstrumentSettingsCategory(
        pasteInstrumentSettingsCategory(this._getInstrumentCopy(), copy),
      );
    } catch {
      // Ignore malformed clipboard data.
    } finally {
      this._refocusStage();
    }
  };

  private _randomizeInstrumentSettingsCategory = (
    category: InstrumentSettingsCategory,
  ): void => {
    const original = this._getInstrumentCopy();
    new ChangeRandomGeneratedInstrument(this.doc);
    const generated = copyInstrumentSettingsCategory(
      this._getInstrumentCopy(),
      category,
    );
    this._recordInstrumentSettingsCategory(
      pasteInstrumentSettingsCategory(original, generated),
    );
    this._refocusStage();
  };

  private _recordInstrumentSettingsCategory(instrumentCopy: any): void {
    const isNoiseChannel = this.doc.song.getChannelIsNoise(this.doc.channel);
    const normalized = new Instrument(isNoiseChannel);
    delete instrumentCopy["preset"];
    const envelopes: unknown[] = Array.isArray(instrumentCopy["envelopes"])
      ? instrumentCopy["envelopes"]
      : [];
    normalized.fromSettingsObject(
      { ...instrumentCopy, envelopes: [] },
      isNoiseChannel,
    );
    for (const envelopeObject of envelopes) {
      const envelope = new EnvelopeSettings();
      envelope.fromSettingsObject(envelopeObject);
      if (!normalized.supportsEnvelopeTarget(envelope.target, envelope.index)) {
        envelope.target =
          Config.instrumentAutomationTargets.dictionary["none"].index;
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
    const copy = normalized.toSettingsObject() as any;
    const instrument =
      this.doc.song.channels[this.doc.channel].instruments[
        this.doc.getCurrentInstrument()
      ];
    this.doc.record(new ChangePasteInstrument(this.doc, instrument, copy));
  }

  private _randomPreset(): void {
    const choices: string[] = getRandomPresetValues().map(String);
    for (const sample of this._getSamplePresets())
      choices.push(`sample:${encodeURIComponent(sample.id)}`);
    for (const soundFont of this._getSoundFontPresetGroups()) {
      for (const preset of soundFont.presets)
        choices.push(
          `soundFont:${encodeURIComponent(soundFont.id)}:${preset.index}`,
        );
    }
    if (choices.length > 0)
      this._setPreset(choices[(Math.random() * choices.length) | 0]!);
  }

  private _randomGenerated(): void {
    this.doc.record(new ChangeRandomGeneratedInstrument(this.doc));
  }

  private _whenSetTempo = (): void => {
    this.doc.record(
      new ChangeTempo(this.doc, -1, parseInt(this._tempoStepper.value) | 0),
    );
  };

  private _validateNumberInput(input: HTMLInputElement): number {
    const value: number = Math.floor(
      Math.max(
        Number(input.min),
        Math.min(Number(input.max), Number(input.value)),
      ),
    );
    input.value = value.toString();
    return value;
  }

  private _whenSetBeatsPerBar = (): void => {
    this.doc.record(
      new ChangeBeatsPerBar(
        this.doc,
        this._validateNumberInput(this._beatsPerBarStepper),
        "splice",
      ),
    );
  };

  private _whenSetSongLength = (): void => {
    this.doc.record(
      new ChangeBarCount(
        this.doc,
        this._validateNumberInput(this._songLengthStepper),
        false,
      ),
    );
  };

  private _whenSetPitchChannels = (): void => {
    this.doc.record(
      new ChangeChannelCount(
        this.doc,
        this._validateNumberInput(this._pitchChannelsStepper),
        this.doc.song.noiseChannelCount,
      ),
    );
  };

  private _whenSetDrumChannels = (): void => {
    this.doc.record(
      new ChangeChannelCount(
        this.doc,
        this.doc.song.pitchChannelCount,
        this._validateNumberInput(this._drumChannelsStepper),
      ),
    );
  };

  private _whenSetMaxPatterns = (): void => {
    this.doc.record(
      new ChangePatternsPerChannel(
        this.doc,
        this._validateNumberInput(this._maxPatternsStepper),
      ),
    );
  };

  private _whenSetScale = (): void => {
    this.doc.record(new ChangeScale(this.doc, this._scaleSelect.selectedIndex));
    if (this.doc.prefs.rememberScaleChoice) {
      this.doc.prefs.defaultScale = this.doc.song.scale;
      this.doc.prefs.save();
    }
  };

  private _whenSetKey = (): void => {
    if (this._keySelect.value == "detectKey") {
      this.doc.record(new ChangeDetectComposingKey(this.doc));
      this.doc.notifier.changed();
    } else {
      this.doc.record(
        new ChangeComposingKey(
          this.doc,
          Config.keys.length - 1 - this._keySelect.selectedIndex,
        ),
      );
    }
  };

  private _whenSetLegacyKey = (): void => {
    this.doc.record(
      new ChangeKey(
        this.doc,
        Config.keys.length - 1 - this._legacyKeySelect.selectedIndex,
      ),
    );
  };

  private _toggleLegacyKey = (): void => {
    this._showLegacyKey = !this._showLegacyKey;
    this._legacyKeyRow.style.display = this._showLegacyKey ? "" : "none";
    this._legacyKeyButton.textContent = this._showLegacyKey ? "▴" : "▾";
    this._legacyKeyButton.title = this._showLegacyKey
      ? "Hide legacy transposition key"
      : "Show legacy transposition key";
    this._legacyKeyButton.setAttribute(
      "aria-label",
      this._legacyKeyButton.title,
    );
  };

  private _whenSetRhythm = (): void => {
    if (isNaN(<number>(<unknown>this._rhythmSelect.value))) {
      switch (this._rhythmSelect.value) {
        case "forceRhythm":
          this.doc.selection.forceRhythm();
          break;
      }
      this.doc.notifier.changed();
    } else {
      this.doc.record(
        new ChangeRhythm(this.doc, this._rhythmSelect.selectedIndex),
      );
    }
  };

  private _openInstrumentPreset = (): void => {
    this._openPrompt("instrumentPreset");
  };

  private _getSoundFontPresetGroups(): SoundFontPresetGroup[] {
    const groups: SoundFontPresetGroup[] = [];
    const usedNames: Map<string, number> = new Map();
    for (const asset of this.doc.song.assets) {
      if (asset.type != "soundFont") continue;
      const presets = this.doc.synth.getSoundFontPresets(asset.id);
      if (presets == null) continue;
      const baseName: string = asset.name;
      const occurrence: number = (usedNames.get(baseName) ?? 0) + 1;
      usedNames.set(baseName, occurrence);
      const name: string =
        occurrence == 1 ? baseName : `${baseName} (${occurrence})`;
      groups.push({ id: asset.id, name, presets });
    }
    return groups;
  }

  private _getSamplePresets(): SamplePresetInfo[] {
    return this.doc.song.assets
      .filter((asset) => asset.type == "sample")
      .map((asset) => ({ id: asset.id, name: asset.name }));
  }

  private _getSoundFontPresetName(
    soundFontId: string | null,
    presetIndex: number,
  ): string {
    if (soundFontId == null) return "SoundFont: none";
    const asset = this.doc.song.assets.find(
      (candidate) => candidate.id == soundFontId,
    );
    const preset = this.doc.synth
      .getSoundFontPresets(soundFontId)
      ?.find((candidate) => candidate.index == presetIndex);
    if (preset == null)
      return asset == null ? "SoundFont Preset" : `${asset.name}: loading…`;
    return `${asset?.name ?? "SoundFont"}: ${preset.name}`;
  }

  private _setPreset(preset: string): void {
    const sampleMatch = /^sample:(.+)$/.exec(preset);
    if (sampleMatch != null) {
      this.doc.record(
        new ChangeSamplePresetSelection(
          this.doc,
          decodeURIComponent(sampleMatch[1]),
        ),
      );
      return;
    }
    const soundFontMatch = /^soundFont:([^:]+):(\d+)$/.exec(preset);
    if (soundFontMatch != null) {
      const soundFontId = decodeURIComponent(soundFontMatch[1]);
      const presetIndex = parseInt(soundFontMatch[2]);
      this.doc.record(
        new ChangeSoundFontPresetSelection(this.doc, soundFontId, presetIndex),
      );
      return;
    }
    if (isNaN(<number>(<unknown>preset))) {
      switch (preset) {
        case "copyInstrument":
          this._copyInstrument();
          break;
        case "pasteInstrument":
          this._pasteInstrument();
          break;
        case "randomPreset":
          this._randomPreset();
          break;
        case "randomGenerated":
          this._randomGenerated();
          break;
      }
      this.doc.notifier.changed();
    } else {
      this.doc.record(new ChangePreset(this.doc, parseInt(preset)));
    }
  }

  private _whenSetFeedbackType = (): void => {
    this.doc.record(
      new ChangeFeedbackType(this.doc, this._feedbackTypeSelect.selectedIndex),
    );
  };

  private _whenSetAlgorithm = (): void => {
    this.doc.record(
      new ChangeAlgorithm(this.doc, this._algorithmSelect.selectedIndex),
    );
  };

  private _whenSelectInstrument = (event: MouseEvent): void => {
    if (event.target == this._instrumentAddButton) {
      this.doc.record(new ChangeAddChannelInstrument(this.doc));
    } else if (event.target == this._instrumentRemoveButton) {
      this.doc.record(new ChangeRemoveChannelInstrument(this.doc));
    } else {
      const index: number = this._instrumentButtons.indexOf(<any>event.target);
      if (index != -1) {
        this.doc.selection.selectInstrument(index);
      }
    }
    this._refocusStage();
  };

  private _whenSetChipWave = (): void => {
    this.doc.record(
      new ChangeChipWave(this.doc, this._chipWaveSelect.selectedIndex),
    );
  };

  private _whenSetSoundFont = (): void => {
    this.doc.record(
      new ChangeSoundFont(this.doc, this._soundFontSelect.value || null),
    );
    this._syncSoundFontOptions();
  };

  private _whenSetSoundFontPreset = (): void => {
    this.doc.record(
      new ChangeSoundFontPreset(
        this.doc,
        parseInt(this._soundFontPresetSelect.value) || 0,
      ),
    );
  };

  private _whenSetNoiseWave = (): void => {
    this.doc.record(
      new ChangeNoiseWave(this.doc, this._chipNoiseSelect.selectedIndex),
    );
  };
  private _whenSetTransition = (): void => {
    this.doc.record(
      new ChangeTransition(this.doc, this._transitionSelect.selectedIndex),
    );
  };

  private _whenSetEffects = (): void => {
    const instrument: Instrument =
      this.doc.song.channels[this.doc.channel].instruments[
        this.doc.getCurrentInstrument()
      ];
    const oldValue: number = instrument.effects;
    const toggleFlag: number = Number(
      (this._effectsSelect.selectedOptions[0] as HTMLOptionElement).value,
    );
    this.doc.record(new ChangeToggleEffects(this.doc, toggleFlag));
    this._effectsSelect.selectedIndex = 0;
    if (instrument.effects > oldValue) {
      this.doc.addedEffect = true;
    }
  };

  private _openEffectsMenu = (): void => {
    this._effectsSelect.focus();
    this._effectsSelect.click();
  };

  private _whenSetVibrato = (): void => {
    this.doc.record(
      new ChangeVibrato(this.doc, this._vibratoSelect.selectedIndex),
    );
  };

  private _whenSetUnison = (): void => {
    this.doc.record(
      new ChangeUnison(this.doc, this._unisonSelect.selectedIndex),
    );
  };

  private _whenSetChord = (): void => {
    this.doc.record(new ChangeChord(this.doc, this._chordSelect.selectedIndex));
  };

  private _addNewEnvelope = (): void => {
    this.doc.record(new ChangeAddEnvelope(this.doc));
    this._refocusStage();
    this.doc.addedEnvelope = true;
  };

  private _zoomIn = (): void => {
    this.doc.prefs.visibleOctaves = Math.max(
      1,
      this.doc.prefs.visibleOctaves - 1,
    );
    this.doc.prefs.save();
    this.doc.notifier.changed();
    this._refocusStage();
  };

  private _zoomOut = (): void => {
    this.doc.prefs.visibleOctaves = Math.min(
      Config.pitchOctaves,
      this.doc.prefs.visibleOctaves + 1,
    );
    this.doc.prefs.save();
    this.doc.notifier.changed();
    this._refocusStage();
  };

  private _fileMenuHandler = (_event: Event): void => {
    switch (this._fileMenu.value) {
      case "new":
        this.doc.goBackToStart();
        for (const channel of this.doc.song.channels) channel.muted = false;
        this.doc.record(new ChangeSong(this.doc, null), false, true);
        break;
      case "export":
        this._openPrompt("export");
        break;
      case "import":
        this._importFile.open();
        break;
      case "shareUrl":
        const url: URL = new URL(location.href);
        url.hash = encodeSongUrl(this.doc.song.toBinary());
        this._copyTextToClipboard(url.href);
        break;
      case "songRecovery":
        this._openPrompt("songRecovery");
        break;
    }
    this._fileMenu.selectedIndex = 0;
  };

  private _editMenuHandler = (_event: Event): void => {
    switch (this._editMenu.value) {
      case "undo":
        this.doc.undo();
        break;
      case "redo":
        this.doc.redo();
        break;
      case "copy":
        this.doc.selection.copy();
        break;
      case "cut":
        this.doc.selection.cut();
        break;
      case "insertBars":
        this.doc.selection.insertBars();
        break;
      case "deleteBars":
        this.doc.selection.deleteBars();
        break;
      case "insertChannel":
        this.doc.selection.insertChannel();
        break;
      case "deleteChannel":
        this.doc.selection.deleteChannel();
        break;
      case "pasteNotes":
        this.doc.selection.pasteNotes();
        break;
      case "pasteNumbers":
        this.doc.selection.pasteNumbers();
        break;
      case "transposeUp":
        this.doc.selection.transpose(true, false);
        break;
      case "transposeDown":
        this.doc.selection.transpose(false, false);
        break;
      case "selectAll":
        this.doc.selection.selectAll();
        break;
      case "selectChannel":
        this.doc.selection.selectChannel();
        break;
      case "duplicatePatterns":
        this.doc.selection.duplicatePatterns();
        break;
      case "rectifyPatterns":
        this.doc.record(new ChangeRectifyPatterns(this.doc));
        break;
      case "moveNotesSideways":
        this._openPrompt("moveNotesSideways");
        break;
      case "beatsPerBar":
        this._openPrompt("beatsPerBar");
        break;
      case "assets":
        this._openPrompt("assets");
        break;
    }
    this._editMenu.selectedIndex = 0;
  };
}
