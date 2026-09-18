// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeBeatsPerBar } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";

const { button, dialog, div, span, h2, input, br, select, option } = HTML;

export class BeatsPerBarPrompt implements Prompt {
  #doc: SongDocument;
  readonly #beatsStepper: HTMLInputElement = input({
    style: "width: 4.5em; margin-left: 1em;",
    type: "number",
    step: "1",
  });
  readonly #conversionStrategySelect: HTMLSelectElement = select(
    { style: "width: 100%;" },
    option({ value: "splice" }, "Splice beats at end of bars."),
    option({ value: "stretch" }, "Stretch notes to fit in bars."),
    option({ value: "overflow" }, "Overflow notes across bars."),
  );
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
  });
  readonly #okayButton: HTMLButtonElement = button(
    { class: "okayButton", style: "width:45%;" },
    "Okay",
  );

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt noSelection", style: "width: 250px;" },
    h2("Beats Per Bar"),
    div(
      {
        style:
          "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;",
      },
      div(
        { style: "text-align: right;" },
        "Beats per bar:",
        br(),
        span(
          { style: `font-size: smaller; color: ${ColorConfig.secondaryText};` },
          "(Multiples of 3 or 4 are recommended)",
        ),
      ),
      this.#beatsStepper,
    ),
    div(
      {
        style:
          "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;",
      },
      this.#conversionStrategySelect,
    ),
    div(
      {
        style: "display: flex; flex-direction: row-reverse; justify-content: space-between;",
      },
      this.#okayButton,
    ),
    this.#cancelButton,
  );

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.#beatsStepper.value = `${this.#doc.song.beatsPerBar}`;
    this.#beatsStepper.min = `${Config.beatsPerBarMin}`;
    this.#beatsStepper.max = `${Config.beatsPerBarMax}`;

    const lastStrategy: string | null = window.localStorage.getItem("beatCountStrategy");
    if (lastStrategy != null) {
      this.#conversionStrategySelect.value = lastStrategy;
    }

    this.#beatsStepper.select();
    setTimeout(() => this.#beatsStepper.focus(), 0);

    this.#okayButton.addEventListener("click", this.#saveChanges);
    this.#cancelButton.addEventListener("click", this.#close);
    this.#beatsStepper.addEventListener("blur", BeatsPerBarPrompt.#validateNumber);
    this.container.addEventListener("keydown", this.#whenKeyPressed);
  }

  #close = (): void => {
    this.#doc.closePrompt();
  };

  public cleanUp = (): void => {
    this.#okayButton.removeEventListener("click", this.#saveChanges);
    this.#cancelButton.removeEventListener("click", this.#close);
    this.#beatsStepper.removeEventListener("blur", BeatsPerBarPrompt.#validateNumber);
    this.container.removeEventListener("keydown", this.#whenKeyPressed);
  };

  #whenKeyPressed = (event: KeyboardEvent): void => {
    if ((event.target as Element).tagName !== "BUTTON" && event.keyCode === 13) {
      this.#saveChanges();
    }
  };

  static #validateNumber(event: Event): void {
    const numberInput: HTMLInputElement = event.target as HTMLInputElement;
    numberInput.value = String(BeatsPerBarPrompt.#validate(numberInput));
  }

  static #validate(numberInput: HTMLInputElement): number {
    return Math.floor(
      Math.max(
        Number(numberInput.min),
        Math.min(Number(numberInput.max), Number(numberInput.value)),
      ),
    );
  }

  #saveChanges = (): void => {
    window.localStorage.setItem("beatCountStrategy", this.#conversionStrategySelect.value);
    this.#doc.closePrompt();
    this.#doc.record(
      new ChangeBeatsPerBar(
        this.#doc,
        BeatsPerBarPrompt.#validate(this.#beatsStepper),
        this.#conversionStrategySelect.value,
      ),
    );
  };
}
