// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  ChangeRemoveEnvelope,
  ChangeSetEnvelopeParameter,
  ChangeSetEnvelopeTarget,
  ChangeSetEnvelopeType,
} from "./changes.js";
import { Config, type InstrumentType } from "../synth/synth-config.js";
import type { EnvelopeSettings, Instrument } from "../synth/synth.js";
import type { Change } from "./change.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { SongDocument } from "./song-document.js";

type EnvelopeParameters = Pick<EnvelopeSettings, "speed" | "a" | "b">;
type EnvelopeParameter = keyof EnvelopeParameters;

export class EnvelopeParameterEditor {
  #doc: SongDocument;
  #getValue: (parameter: EnvelopeParameter) => number;
  #getChange: (parameter: EnvelopeParameter, oldValue: number, newValue: number) => Change;
  public readonly container: HTMLDivElement = HTML.div({
    class: "envelope-parameters",
  });
  readonly #controls: Record<EnvelopeParameter, HTMLDivElement> = {} as Record<
    EnvelopeParameter,
    HTMLDivElement
  >;
  readonly #sliders: Record<EnvelopeParameter, HTMLInputElement> = {} as Record<
    EnvelopeParameter,
    HTMLInputElement
  >;
  readonly #inputs: Record<EnvelopeParameter, HTMLInputElement> = {} as Record<
    EnvelopeParameter,
    HTMLInputElement
  >;
  readonly #changes: Partial<Record<EnvelopeParameter, Change>> = {};
  readonly #oldValues: Partial<Record<EnvelopeParameter, number>> = {};

  public constructor(
    _doc: SongDocument,
    _getValue: (parameter: EnvelopeParameter) => number,
    _getChange: (parameter: EnvelopeParameter, oldValue: number, newValue: number) => Change,
  ) {
    this.#doc = _doc;
    this.#getValue = _getValue;
    this.#getChange = _getChange;
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
        }),
        textInput: HTMLInputElement = HTML.input({
          type: "text",
          inputmode: "decimal",
          class: "envelope-value-input",
        });
      slider.addEventListener("input", () => {
        if (!this.#doc.lastChangeWas(this.#changes[parameter] ?? null)) {
          this.#oldValues[parameter] = this.#getValue(parameter);
        }
        const change: Change = this.#getChange(
          parameter,
          this.#oldValues[parameter]!,
          Number.parseFloat(slider.value),
        );
        this.#changes[parameter] = change;
        textInput.value = slider.value;
        this.#doc.setProspectiveChange(change);
      });
      slider.addEventListener("change", () => {
        const change: Change | undefined = this.#changes[parameter];
        if (change !== undefined) {
          this.#doc.record(change);
        }
        delete this.#changes[parameter];
      });
      textInput.addEventListener("change", () => {
        const value = Number(textInput.value);
        if (!Number.isFinite(value)) {
          return this.#doc.notifier.changed();
        }
        this.#doc.record(this.#getChange(parameter, this.#getValue(parameter), value));
      });
      this.#sliders[parameter] = slider;
      this.#inputs[parameter] = textInput;
      this.#controls[parameter] = HTML.div(
        { class: "envelope-parameter" },
        HTML.label(label),
        slider,
        textInput,
      );
      this.container.append(this.#controls[parameter]);
    }
  }

  public render(envelope: number, settings: EnvelopeParameters): void {
    this.#controls.speed.style.display =
      envelope === Config.envelopes.dictionary["velocity"]!.index ? "none" : "";
    for (const parameter of ["speed", "a", "b"] as const) {
      for (const control of [this.#sliders[parameter], this.#inputs[parameter]]) {
        if (document.activeElement !== control) {
          control.value = String(settings[parameter]);
        }
      }
    }
  }
}

export class EnvelopeEditor {
  #doc: SongDocument;
  public readonly container: HTMLElement = HTML.div({
    class: "envelopeEditor",
  });

  readonly #rows: HTMLDivElement[] = [];
  readonly #targetSelects: HTMLSelectElement[] = [];
  readonly #envelopeSelects: HTMLSelectElement[] = [];
  readonly #deleteButtons: HTMLButtonElement[] = [];
  readonly #revealButtons: HTMLButtonElement[] = [];
  readonly #parameterContainers: HTMLDivElement[] = [];
  readonly #parameterEditors: EnvelopeParameterEditor[] = [];
  readonly #revealed: boolean[] = [];
  #renderedEnvelopeCount = 0;
  #renderedEqFilterCount = -1;
  #renderedNoteFilterCount = -1;
  #renderedInstrumentType!: InstrumentType;
  #renderedEffects = 0;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.container.addEventListener("change", this.#onChange);
    this.container.addEventListener("click", this.#onClick);
  }

  #onChange = (event: Event): void => {
    const targetSelectIndex: number = this.#targetSelects.indexOf(
        event.target as HTMLSelectElement,
      ),
      envelopeSelectIndex: number = this.#envelopeSelects.indexOf(
        event.target as HTMLSelectElement,
      );
    if (targetSelectIndex !== -1) {
      const combinedValue: number = Number.parseInt(
          this.#targetSelects[targetSelectIndex]!.value,
          10,
        ),
        target: number = combinedValue % Config.modulationTargets.length,
        index: number = (combinedValue / Config.modulationTargets.length) >>> 0;
      this.#doc.record(new ChangeSetEnvelopeTarget(this.#doc, targetSelectIndex, target, index));
    } else if (envelopeSelectIndex !== -1) {
      this.#doc.record(
        new ChangeSetEnvelopeType(
          this.#doc,
          envelopeSelectIndex,
          this.#envelopeSelects[envelopeSelectIndex]!.selectedIndex,
        ),
      );
    }
  };

  #onClick = (event: MouseEvent): void => {
    const index: number = this.#deleteButtons.indexOf(event.target as HTMLButtonElement);
    if (index !== -1) {
      this.#doc.record(new ChangeRemoveEnvelope(this.#doc, index));
    }
  };

  #makeOption(target: number, index: number): HTMLOptionElement {
    let { displayName } = Config.modulationTargets[target]!;
    if (Config.modulationTargets[target]!.maxCount > 1) {
      if (displayName.indexOf("#") === -1) {
        displayName += ` ${index + 1}`;
      } else {
        displayName = displayName.replace("#", String(index + 1));
      }
    }
    return HTML.option({ value: target + index * Config.modulationTargets.length }, displayName);
  }

  #updateTargetOptionVisibility(menu: HTMLSelectElement, instrument: Instrument): void {
    for (let optionIndex = 0; optionIndex < menu.childElementCount; optionIndex++) {
      const option: HTMLOptionElement = menu.children[optionIndex]! as HTMLOptionElement,
        combinedValue: number = Number.parseInt(option.value, 10),
        target: number = combinedValue % Config.modulationTargets.length,
        index: number = (combinedValue / Config.modulationTargets.length) >>> 0;
      option.hidden = !instrument.supportsEnvelopeTarget(target, index);
    }
  }

  public render(): void {
    const instrument: Instrument =
      this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!;
    for (
      let envelopeIndex: number = this.#rows.length;
      envelopeIndex < instrument.envelopeCount;
      envelopeIndex++
    ) {
      this.#revealed[envelopeIndex] = false;
      const targetSelect: HTMLSelectElement = HTML.select({
        style: "width: 0; flex: 1;",
      });
      for (let target = 0; target < Config.modulationTargets.length; target++) {
        const interleaved: boolean = Config.modulationTargets[target]!.interleave;
        for (let index = 0; index < Config.modulationTargets[target]!.maxCount; index++) {
          targetSelect.append(this.#makeOption(target, index));
          if (interleaved) {
            targetSelect.append(this.#makeOption(target + 1, index));
          }
        }
        if (interleaved) {
          target++;
        }
      }

      const envelopeSelect: HTMLSelectElement = HTML.select({
        style: "width: 0; flex: 0.7;",
      });
      for (let envelope = 0; envelope < Config.envelopes.length; envelope++) {
        envelopeSelect.append(HTML.option({ value: envelope }, Config.envelopes[envelope]!.name));
      }

      const deleteButton: HTMLButtonElement = HTML.button({
          type: "button",
          class: "delete-envelope",
        }),
        revealButton: HTMLButtonElement = HTML.button(
          {
            type: "button",
            class: "reveal-arrow",
            title: "Show envelope controls",
            "aria-expanded": "false",
          },
          "▶",
        ),
        parameters = new EnvelopeParameterEditor(
          this.#doc,
          (parameter) =>
            this.#doc.song.channels[this.#doc.channel]!.instruments[
              this.#doc.getCurrentInstrument()
            ]!.envelopes[envelopeIndex]![parameter],
          (parameter, oldValue, newValue) =>
            new ChangeSetEnvelopeParameter(this.#doc, envelopeIndex, parameter, oldValue, newValue),
        );
      revealButton.addEventListener("click", () => {
        this.#revealed[envelopeIndex] = !this.#revealed[envelopeIndex]!;
        parameters.container.hidden = !this.#revealed[envelopeIndex]!;
        revealButton.textContent = this.#revealed[envelopeIndex]! ? "▼" : "▶";
        revealButton.setAttribute("aria-expanded", String(this.#revealed[envelopeIndex]!));
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

      this.container.append(row);
      this.#rows[envelopeIndex] = row;
      this.#targetSelects[envelopeIndex] = targetSelect;
      this.#envelopeSelects[envelopeIndex] = envelopeSelect;
      this.#deleteButtons[envelopeIndex] = deleteButton;
      this.#revealButtons[envelopeIndex] = revealButton;
      this.#parameterContainers[envelopeIndex] = parameters.container;
      this.#parameterEditors[envelopeIndex] = parameters;
    }

    for (
      let envelopeIndex: number = this.#renderedEnvelopeCount;
      envelopeIndex < instrument.envelopeCount;
      envelopeIndex++
    ) {
      this.#rows[envelopeIndex]!.style.display = "";
      // For newly visible rows, update target option visibiliy.
      this.#updateTargetOptionVisibility(this.#targetSelects[envelopeIndex]!, instrument);
    }

    for (
      let envelopeIndex: number = instrument.envelopeCount;
      envelopeIndex < this.#renderedEnvelopeCount;
      envelopeIndex++
    ) {
      this.#rows[envelopeIndex]!.style.display = "none";
    }

    if (
      this.#renderedEqFilterCount !== instrument.eqFilter.controlPointCount ||
      this.#renderedNoteFilterCount !== instrument.noteFilter.controlPointCount ||
      this.#renderedInstrumentType !== instrument.type ||
      this.#renderedEffects !== instrument.effects
    ) {
      // Update target option visibility for previously visible rows.
      for (let envelopeIndex = 0; envelopeIndex < this.#renderedEnvelopeCount; envelopeIndex++) {
        this.#updateTargetOptionVisibility(this.#targetSelects[envelopeIndex]!, instrument);
      }
    }

    for (let envelopeIndex = 0; envelopeIndex < instrument.envelopeCount; envelopeIndex++) {
      this.#targetSelects[envelopeIndex]!.value = String(
        instrument.envelopes[envelopeIndex]!.target +
          instrument.envelopes[envelopeIndex]!.index * Config.modulationTargets.length,
      );
      this.#envelopeSelects[envelopeIndex]!.selectedIndex =
        instrument.envelopes[envelopeIndex]!.envelope;
      const settings = instrument.envelopes[envelopeIndex]!;
      this.#parameterEditors[envelopeIndex]!.render(settings.envelope, settings);
    }

    this.#renderedEnvelopeCount = instrument.envelopeCount;
    this.#renderedEqFilterCount = instrument.eqFilter.controlPointCount;
    this.#renderedNoteFilterCount = instrument.noteFilter.controlPointCount;
    this.#renderedInstrumentType = instrument.type;
    this.#renderedEffects = instrument.effects;
  }
}
