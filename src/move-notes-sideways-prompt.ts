// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeMoveNotesSideways } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";

const { button, dialog, div, span, h2, input, br, select, option } = HTML;

export class MoveNotesSidewaysPrompt implements Prompt {
  #doc: SongDocument;
  readonly #beatsStepper: HTMLInputElement = input({
    style: "width: 4.5em; margin-left: 1em;",
    type: "number",
    step: "0.01",
    value: "0",
  });
  readonly #conversionStrategySelect: HTMLSelectElement = select(
    { style: "width: 100%;" },
    option({ value: "overflow" }, "Overflow notes across bars."),
    option({ value: "wrapAround" }, "Wrap notes around within bars."),
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
    h2("Move Notes Sideways"),
    div(
      {
        style:
          "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;",
      },
      div(
        { style: "text-align: right;" },
        "Beats to move",
        br(),
        span(
          { style: `font-size: smaller; color: ${ColorConfig.secondaryText};` },
          "(Negative is left, positive is right)",
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
    this.#beatsStepper.min = `${-this.#doc.song.beatsPerBar}`;
    this.#beatsStepper.max = `${this.#doc.song.beatsPerBar}`;

    const lastStrategy: string | null = window.localStorage.getItem("moveNotesSidewaysStrategy");
    if (lastStrategy != null) {
      this.#conversionStrategySelect.value = lastStrategy;
    }

    this.#beatsStepper.select();
    setTimeout(() => this.#beatsStepper.focus(), 0);

    this.#okayButton.addEventListener("click", this.#saveChanges);
    this.#cancelButton.addEventListener("click", this.#close);
    this.#beatsStepper.addEventListener("blur", MoveNotesSidewaysPrompt.#validateNumber);
    this.container.addEventListener("keydown", this.#whenKeyPressed);
  }

  #close = (): void => {
    this.#doc.closePrompt();
  };

  public cleanUp = (): void => {
    this.#okayButton.removeEventListener("click", this.#saveChanges);
    this.#cancelButton.removeEventListener("click", this.#close);
    this.#beatsStepper.removeEventListener("blur", MoveNotesSidewaysPrompt.#validateNumber);
    this.container.removeEventListener("keydown", this.#whenKeyPressed);
  };

  #whenKeyPressed = (event: KeyboardEvent): void => {
    if ((event.target as Element).tagName !== "BUTTON" && event.keyCode === 13) {
      // Enter key
      this.#saveChanges();
    }
  };

  static #validateNumber(event: Event): void {
    const numberInput: HTMLInputElement = event.target as HTMLInputElement;
    let value = Number(numberInput.value);
    value = Math.round(value * Config.partsPerBeat) / Config.partsPerBeat;
    value = Math.round(value * 100) / 100;
    numberInput.value = `${Math.max(Number(numberInput.min), Math.min(Number(numberInput.max), value))}`;
  }

  #saveChanges = (): void => {
    window.localStorage.setItem("moveNotesSidewaysStrategy", this.#conversionStrategySelect.value);
    this.#doc.closePrompt();
    this.#doc.record(
      new ChangeMoveNotesSideways(
        this.#doc,
        Number(this.#beatsStepper.value),
        this.#conversionStrategySelect.value,
      ),
    );
  };
}
