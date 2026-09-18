// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config, type SustainType } from "../synth/synth-config.js";
import { ChangeGroup } from "./change.js";
import { ChangeStringSustainType } from "./changes.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Instrument } from "../synth/synth.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";

const { button, dialog, div, h2, p, select, option } = HTML;

export class SustainPrompt implements Prompt {
  #doc: SongDocument;
  readonly #typeSelect: HTMLSelectElement = select(
    { style: "width: 100%;" },
    option({ value: "acoustic" }, "(A) Acoustic"),
    option({ value: "bright" }, "(B) Bright"),
  );
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
  });
  readonly #okayButton: HTMLButtonElement = button(
    { class: "okayButton", style: "width:45%;" },
    "Okay",
  );

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt", style: "width: 300px;" },
    div(
      h2("String Sustain"),
      p("This setting controls how quickly the picked string vibration decays."),
      p(
        'Unlike most instrument synthesizer features, a picked string cannot change frequency suddenly while maintaining its decay. If a tone\'s pitch changes suddenly (e.g. if the chord type is set to "arpeggio" or the transition type is set to "continues") then the string will be re-picked and start decaying from the beginning again, even if the envelopes don\'t otherwise restart.',
      ),
    ),
    div(
      { style: { display: Config.enableAcousticSustain ? undefined : "none" } },
      p(
        'The editor comes with two slightly different sustain designs. You can select one here and press "Okay" to confirm it.',
      ),
      this.#typeSelect,
    ),
    div(
      {
        style: {
          display: Config.enableAcousticSustain ? "flex" : "none",
          "flex-direction": "row-reverse",
          "justify-content": "space-between",
        },
      },
      this.#okayButton,
    ),
    this.#cancelButton,
  );

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const instrument: Instrument =
      this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!;
    this.#typeSelect.value = Config.sustainTypeNames[instrument.stringSustainType]!;

    setTimeout(() => this.#cancelButton.focus(), 0);

    this.#okayButton.addEventListener("click", this.#saveChanges);
    this.#cancelButton.addEventListener("click", this.#close);
    this.container.addEventListener("keydown", this.#whenKeyPressed);
  }

  #close = (): void => {
    this.#doc.closePrompt();
  };

  public cleanUp = (): void => {
    this.#okayButton.removeEventListener("click", this.#saveChanges);
    this.#cancelButton.removeEventListener("click", this.#close);
    this.container.removeEventListener("keydown", this.#whenKeyPressed);
  };

  #whenKeyPressed = (event: KeyboardEvent): void => {
    if ((event.target as Element).tagName !== "BUTTON" && event.keyCode === 13) {
      // Enter key
      this.#saveChanges();
    }
  };

  #saveChanges = (): void => {
    if (Config.enableAcousticSustain) {
      const group: ChangeGroup = new ChangeGroup();
      group.append(
        new ChangeStringSustainType(
          this.#doc,
          Config.sustainTypeNames.indexOf(this.#typeSelect.value) as SustainType,
        ),
      );
      this.#doc.closePrompt();
      this.#doc.record(group);
    } else {
      this.#close();
    }
  };
}
