// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { InstrumentType } from "../synth/SynthConfig.js";
import type { InstrumentSettingsCategory } from "./InstrumentSettingsCategory.js";

const { button, div, span } = HTML;

const instrumentTypeDisplayNames: ReadonlyArray<string> = [
  "Chip Wave",
  "FM",
  "Noise",
  "Spectrum",
  "Drumset",
  "Harmonics",
  "Pulse Width",
  "Picked String",
  "Supersaw",
  "SoundFont",
];

export interface InstrumentSettingsControls {
  preset: HTMLElement;
  instruments: HTMLElement;
  copyPaste: HTMLElement;
  volume: HTMLElement;
  pan: HTMLElement;
  fade: HTMLElement;
  specific: ReadonlyArray<HTMLElement>;
  effects: ReadonlyArray<HTMLElement>;
  effectsMenu: HTMLElement;
  envelopes: HTMLElement;
  addEnvelope: HTMLButtonElement;
  openInstrumentType: () => void;
  copyCategory: (category: InstrumentSettingsCategory) => void;
  pasteCategory: (category: InstrumentSettingsCategory) => void;
  randomizeCategory: (category: InstrumentSettingsCategory) => void;
}

/** Renders the instrument controls in their visual groups. */
export class InstrumentSettings {
  public readonly container: HTMLDivElement;
  private readonly _specificTitle: HTMLSpanElement = span(
    "Specific Instrument",
  );

  constructor(controls: InstrumentSettingsControls) {
    const instrumentTypeAdd: HTMLButtonElement = button(
      {
        class: "instrumentSettingsAdd",
        type: "button",
        title: "Choose basic instrument type",
      },
      "+",
    );
    instrumentTypeAdd.addEventListener("click", controls.openInstrumentType);
    const effectsTitle: HTMLDivElement = this._groupTitle(
      "Effects",
      controls.effectsMenu,
      "effects",
      controls,
    );
    const envelopesTitle: HTMLDivElement = this._groupTitle(
      "Envelopes",
      controls.addEnvelope,
      "envelopes",
      controls,
    );
    this.container = div(
      { class: "editor-controls groupedSettings" },
      controls.instruments,
      controls.preset,
      controls.copyPaste,
      div(
        { class: "settingsGroup" },
        controls.volume,
        controls.pan,
        controls.fade,
      ),
      this._group(
        this._specificTitle,
        controls.specific,
        instrumentTypeAdd,
        "specific",
        controls,
      ),
      div({ class: "settingsGroup" }, effectsTitle, ...controls.effects),
      div({ class: "settingsGroup" }, envelopesTitle, controls.envelopes),
    );
  }

  public setSpecificInstrumentTitle(name: string): void {
    this._specificTitle.textContent = name;
  }

  public setSpecificInstrumentType(type: InstrumentType): void {
    this.setSpecificInstrumentTitle(
      instrumentTypeDisplayNames[type] ?? "Specific Instrument",
    );
  }

  private _group(
    name: string | HTMLSpanElement,
    items: ReadonlyArray<HTMLElement>,
    action?: HTMLElement,
    category?: InstrumentSettingsCategory,
    controls?: InstrumentSettingsControls,
  ): HTMLDivElement {
    return div(
      { class: "settingsGroup" },
      this._groupTitle(name, action, category, controls),
      ...items,
    );
  }

  private _groupTitle(
    name: string | HTMLSpanElement,
    action?: HTMLElement,
    category?: InstrumentSettingsCategory,
    controls?: InstrumentSettingsControls,
  ): HTMLDivElement {
    const title: HTMLSpanElement = typeof name == "string" ? span(name) : name;
    if (category != undefined && controls != undefined && action != undefined) {
      const actions = div({ class: "settingsGroupActions" });
      const addButton = (
        text: string,
        description: string,
        perform: (category: InstrumentSettingsCategory) => void,
      ): void => {
        const actionButton = button(
          {
            type: "button",
            title: `${description} ${title.textContent} settings`,
          },
          text,
        );
        actionButton.addEventListener("click", () => perform(category));
        actions.appendChild(actionButton);
      };
      addButton("C", "Copy", controls.copyCategory);
      addButton("V", "Paste", controls.pasteCategory);
      addButton("R", "Generate random", controls.randomizeCategory);
      actions.appendChild(action);
      return div({ class: "settingsGroupTitle hasAction" }, title, actions);
    }
    return action == undefined
      ? div({ class: "settingsGroupTitle" }, title)
      : div({ class: "settingsGroupTitle hasAction" }, title, action);
  }
}
