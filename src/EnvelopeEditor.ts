// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { InstrumentType, Config } from "../synth/SynthConfig.js";
import { Instrument, EnvelopeSettings } from "../synth/synth.js";
import { SongDocument } from "./SongDocument.js";
import {
  ChangeSetEnvelopeTarget,
  ChangeSetEnvelopeType,
  ChangeSetEnvelopeParameter,
  ChangeRemoveEnvelope,
} from "./changes.js";
import { Change } from "./Change.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";

type EnvelopeParameters = Pick<EnvelopeSettings, "speed" | "a" | "b">;
type EnvelopeParameter = keyof EnvelopeParameters;

export class EnvelopeParameterEditor {
  public readonly container: HTMLDivElement = HTML.div({
    class: "envelope-parameters",
  });
  private readonly _controls: Record<EnvelopeParameter, HTMLDivElement> =
    {} as Record<EnvelopeParameter, HTMLDivElement>;
  private readonly _sliders: Record<EnvelopeParameter, HTMLInputElement> =
    {} as Record<EnvelopeParameter, HTMLInputElement>;
  private readonly _inputs: Record<EnvelopeParameter, HTMLInputElement> =
    {} as Record<EnvelopeParameter, HTMLInputElement>;
  private readonly _changes: Partial<Record<EnvelopeParameter, Change>> = {};
  private readonly _oldValues: Partial<Record<EnvelopeParameter, number>> = {};

  constructor(
    private _doc: SongDocument,
    private _getValue: (parameter: EnvelopeParameter) => number,
    private _getChange: (
      parameter: EnvelopeParameter,
      oldValue: number,
      newValue: number,
    ) => Change,
  ) {
    for (const [parameter, label, max] of [
      ["speed", "Speed", 5],
      ["a", "A", 2],
      ["b", "B", 2],
    ] as const) {
      const slider: HTMLInputElement = HTML.input({
        type: "range",
        min: "0",
        max: String(max),
        step: "0.01",
      });
      const textInput: HTMLInputElement = HTML.input({
        type: "text",
        inputmode: "decimal",
        class: "envelope-value-input",
      });
      slider.addEventListener("input", () => {
        if (!this._doc.lastChangeWas(this._changes[parameter] ?? null))
          this._oldValues[parameter] = this._getValue(parameter);
        const change: Change = this._getChange(
          parameter,
          this._oldValues[parameter]!,
          parseFloat(slider.value),
        );
        this._changes[parameter] = change;
        textInput.value = slider.value;
        this._doc.setProspectiveChange(change);
      });
      slider.addEventListener("change", () => {
        const change: Change | undefined = this._changes[parameter];
        if (change != undefined) this._doc.record(change);
        delete this._changes[parameter];
      });
      textInput.addEventListener("change", () => {
        const value: number = Number(textInput.value);
        if (!Number.isFinite(value)) return this._doc.notifier.changed();
        this._doc.record(
          this._getChange(parameter, this._getValue(parameter), value),
        );
      });
      this._sliders[parameter] = slider;
      this._inputs[parameter] = textInput;
      this._controls[parameter] = HTML.div(
        { class: "envelope-parameter" },
        HTML.label(label),
        slider,
        textInput,
      );
      this.container.appendChild(this._controls[parameter]);
    }
  }

  public render(envelope: number, settings: EnvelopeParameters): void {
    this._controls.speed.style.display =
      envelope == Config.envelopes.dictionary["velocity"].index ? "none" : "";
    for (const parameter of ["speed", "a", "b"] as const) {
      for (const control of [
        this._sliders[parameter],
        this._inputs[parameter],
      ]) {
        if (document.activeElement != control)
          control.value = String(settings[parameter]);
      }
    }
  }
}

export class EnvelopeEditor {
  public readonly container: HTMLElement = HTML.div({
    class: "envelopeEditor",
  });

  private readonly _rows: HTMLDivElement[] = [];
  private readonly _targetSelects: HTMLSelectElement[] = [];
  private readonly _envelopeSelects: HTMLSelectElement[] = [];
  private readonly _deleteButtons: HTMLButtonElement[] = [];
  private readonly _revealButtons: HTMLButtonElement[] = [];
  private readonly _parameterContainers: HTMLDivElement[] = [];
  private readonly _parameterEditors: EnvelopeParameterEditor[] = [];
  private readonly _revealed: boolean[] = [];
  private _renderedEnvelopeCount: number = 0;
  private _renderedEqFilterCount: number = -1;
  private _renderedNoteFilterCount: number = -1;
  private _renderedInstrumentType!: InstrumentType;
  private _renderedEffects: number = 0;

  constructor(private _doc: SongDocument) {
    this.container.addEventListener("change", this._onChange);
    this.container.addEventListener("click", this._onClick);
  }

  private _onChange = (event: Event): void => {
    const targetSelectIndex: number = this._targetSelects.indexOf(
      <any>event.target,
    );
    const envelopeSelectIndex: number = this._envelopeSelects.indexOf(
      <any>event.target,
    );
    if (targetSelectIndex != -1) {
      const combinedValue: number = parseInt(
        this._targetSelects[targetSelectIndex].value,
      );
      const target: number =
        combinedValue % Config.instrumentAutomationTargets.length;
      const index: number =
        (combinedValue / Config.instrumentAutomationTargets.length) >>> 0;
      this._doc.record(
        new ChangeSetEnvelopeTarget(
          this._doc,
          targetSelectIndex,
          target,
          index,
        ),
      );
    } else if (envelopeSelectIndex != -1) {
      this._doc.record(
        new ChangeSetEnvelopeType(
          this._doc,
          envelopeSelectIndex,
          this._envelopeSelects[envelopeSelectIndex].selectedIndex,
        ),
      );
    }
  };

  private _onClick = (event: MouseEvent): void => {
    const index: number = this._deleteButtons.indexOf(<any>event.target);
    if (index != -1) {
      this._doc.record(new ChangeRemoveEnvelope(this._doc, index));
    }
  };

  private _makeOption(target: number, index: number): HTMLOptionElement {
    let displayName = Config.instrumentAutomationTargets[target].displayName;
    if (Config.instrumentAutomationTargets[target].maxCount > 1) {
      if (displayName.indexOf("#") != -1) {
        displayName = displayName.replace("#", String(index + 1));
      } else {
        displayName += " " + (index + 1);
      }
    }
    return HTML.option(
      { value: target + index * Config.instrumentAutomationTargets.length },
      displayName,
    );
  }

  private _updateTargetOptionVisibility(
    menu: HTMLSelectElement,
    instrument: Instrument,
  ): void {
    for (
      let optionIndex: number = 0;
      optionIndex < menu.childElementCount;
      optionIndex++
    ) {
      const option: HTMLOptionElement = <HTMLOptionElement>(
        menu.children[optionIndex]
      );
      const combinedValue: number = parseInt(option.value);
      const target: number =
        combinedValue % Config.instrumentAutomationTargets.length;
      const index: number =
        (combinedValue / Config.instrumentAutomationTargets.length) >>> 0;
      option.hidden = !instrument.supportsEnvelopeTarget(target, index);
    }
  }

  public render(): void {
    const instrument: Instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
    for (
      let envelopeIndex: number = this._rows.length;
      envelopeIndex < instrument.envelopeCount;
      envelopeIndex++
    ) {
      this._revealed[envelopeIndex] = false;
      const targetSelect: HTMLSelectElement = HTML.select({
        style: "width: 0; flex: 1;",
      });
      for (
        let target: number = 0;
        target < Config.instrumentAutomationTargets.length;
        target++
      ) {
        const interleaved: boolean =
          Config.instrumentAutomationTargets[target].interleave;
        for (
          let index: number = 0;
          index < Config.instrumentAutomationTargets[target].maxCount;
          index++
        ) {
          targetSelect.appendChild(this._makeOption(target, index));
          if (interleaved) {
            targetSelect.appendChild(this._makeOption(target + 1, index));
          }
        }
        if (interleaved) target++;
      }

      const envelopeSelect: HTMLSelectElement = HTML.select({
        style: "width: 0; flex: 0.7;",
      });
      for (
        let envelope: number = 0;
        envelope < Config.envelopes.length;
        envelope++
      ) {
        envelopeSelect.appendChild(
          HTML.option({ value: envelope }, Config.envelopes[envelope].name),
        );
      }

      const deleteButton: HTMLButtonElement = HTML.button({
        type: "button",
        class: "delete-envelope",
      });
      const revealButton: HTMLButtonElement = HTML.button(
        {
          type: "button",
          class: "reveal-arrow",
          title: "Show envelope controls",
          "aria-expanded": "false",
        },
        "▶",
      );
      const parameters = new EnvelopeParameterEditor(
        this._doc,
        (parameter) =>
          this._doc.song.channels[this._doc.channel].instruments[
            this._doc.getCurrentInstrument()
          ].envelopes[envelopeIndex][parameter],
        (parameter, oldValue, newValue) =>
          new ChangeSetEnvelopeParameter(
            this._doc,
            envelopeIndex,
            parameter,
            oldValue,
            newValue,
          ),
      );
      revealButton.addEventListener("click", () => {
        this._revealed[envelopeIndex] = !this._revealed[envelopeIndex];
        parameters.container.hidden = !this._revealed[envelopeIndex];
        revealButton.textContent = this._revealed[envelopeIndex] ? "▼" : "▶";
        revealButton.setAttribute(
          "aria-expanded",
          String(this._revealed[envelopeIndex]),
        );
      });
      parameters.container.hidden = true;

      const row: HTMLDivElement = HTML.div(
        { class: "envelope-editor-item" },
        HTML.div(
          { class: "envelope-row" },
          revealButton,
          targetSelect,
          envelopeSelect,
          deleteButton,
        ),
        parameters.container,
      );

      this.container.appendChild(row);
      this._rows[envelopeIndex] = row;
      this._targetSelects[envelopeIndex] = targetSelect;
      this._envelopeSelects[envelopeIndex] = envelopeSelect;
      this._deleteButtons[envelopeIndex] = deleteButton;
      this._revealButtons[envelopeIndex] = revealButton;
      this._parameterContainers[envelopeIndex] = parameters.container;
      this._parameterEditors[envelopeIndex] = parameters;
    }

    for (
      let envelopeIndex: number = this._renderedEnvelopeCount;
      envelopeIndex < instrument.envelopeCount;
      envelopeIndex++
    ) {
      this._rows[envelopeIndex].style.display = "";
      // For newly visible rows, update target option visibiliy.
      this._updateTargetOptionVisibility(
        this._targetSelects[envelopeIndex],
        instrument,
      );
    }

    for (
      let envelopeIndex: number = instrument.envelopeCount;
      envelopeIndex < this._renderedEnvelopeCount;
      envelopeIndex++
    ) {
      this._rows[envelopeIndex].style.display = "none";
    }

    if (
      this._renderedEqFilterCount != instrument.eqFilter.controlPointCount ||
      this._renderedNoteFilterCount !=
        instrument.noteFilter.controlPointCount ||
      this._renderedInstrumentType != instrument.type ||
      this._renderedEffects != instrument.effects
    ) {
      // Update target option visibility for previously visible rows.
      for (
        let envelopeIndex: number = 0;
        envelopeIndex < this._renderedEnvelopeCount;
        envelopeIndex++
      ) {
        this._updateTargetOptionVisibility(
          this._targetSelects[envelopeIndex],
          instrument,
        );
      }
    }

    for (
      let envelopeIndex: number = 0;
      envelopeIndex < instrument.envelopeCount;
      envelopeIndex++
    ) {
      this._targetSelects[envelopeIndex].value = String(
        instrument.envelopes[envelopeIndex].target +
          instrument.envelopes[envelopeIndex].index *
            Config.instrumentAutomationTargets.length,
      );
      this._envelopeSelects[envelopeIndex].selectedIndex =
        instrument.envelopes[envelopeIndex].envelope;
      const settings = instrument.envelopes[envelopeIndex];
      this._parameterEditors[envelopeIndex].render(settings.envelope, settings);
    }

    this._renderedEnvelopeCount = instrument.envelopeCount;
    this._renderedEqFilterCount = instrument.eqFilter.controlPointCount;
    this._renderedNoteFilterCount = instrument.noteFilter.controlPointCount;
    this._renderedInstrumentType = instrument.type;
    this._renderedEffects = instrument.effects;
  }
}
