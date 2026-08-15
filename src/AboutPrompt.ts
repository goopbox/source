// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./Prompt.js";
import { SongDocument } from "./SongDocument.js";
import { TabbedSearchablePrompt } from "./TabbedSearchablePrompt.js";

const { a, div, h2, p } = HTML;

const goopboxFeatures: ReadonlyArray<string> = [
  "Interface redesign",
  "Instrument settings rework",
  "Scale and key rework",
  "Expanded song limits",
  "Recording rework",
  "Volume and panning rework",
  "Effects rework",
  "FM rework",
  "Envelope rework",
  "Custom assets",
  "FLP import",
  "Instrument randomizer rework",
  "Loop toggle",
];

export class AboutPrompt implements Prompt {
  private readonly _prompt: TabbedSearchablePrompt;
  public readonly container: HTMLDialogElement;

  constructor(private readonly _doc: SongDocument) {
    const goopbox: HTMLElement = div(
      { class: "promptGrid" },
      ...goopboxFeatures.map((feature) =>
        div({ class: "promptCard" }, feature),
      ),
    );

    const license: HTMLElement = document.createElement("div");
    license.append(
      h2(
        a(
          {
            href: "https://github.com/johnnesky/beepbox",
            target: "_blank",
            rel: "noopener",
          },
          "BeepBox",
        ),
      ),
      p(
        "GoopBox is an independent fork of BeepBox by John Nesky. It is not affiliated with or endorsed by John Nesky.",
      ),
      p(
        "Portions derived from BeepBox are copyright John Nesky and contributing authors and remain available under the ",
        a(
          {
            href: "https://github.com/johnnesky/beepbox/blob/master/LICENSE.md",
            target: "_blank",
            rel: "noopener",
          },
          "MIT License",
        ),
        ". The copyright notice and license are reproduced in LICENSE-MIT.",
      ),
      h2(
        a(
          {
            href: "https://github.com/dawhubapp/flpdiff",
            target: "_blank",
            rel: "noopener",
          },
          "flpdiff",
        ),
      ),
      p(
        "The FLP parser is adapted from flpdiff by Roman Pronskiy and used under the ",
        a(
          {
            href: "https://github.com/dawhubapp/flpdiff/blob/main/LICENSE",
            target: "_blank",
            rel: "noopener",
          },
          "MIT License",
        ),
        ".",
      ),
      h2(
        a(
          {
            href: "https://github.com/goopbox/source",
            target: "_blank",
            rel: "noopener",
          },
          "GoopBox",
        ),
      ),
      p(
        "Original GoopBox contributions are dedicated to the public domain under the ",
        a(
          { href: "https://unlicense.org/", target: "_blank", rel: "noopener" },
          "Unlicense",
        ),
        ". This dedication does not apply to BeepBox-derived code or third-party software.",
      ),
      p("GoopBox will NEVER be paid software or ask for contributions."),
      p("Any indication otherwise is an impersonator or a hack."),
      h2("Creations"),
      p("GoopBox claims no rights to the songs you create with it."),
      p("No external servers ever receive your songs."),
    );

    const disclosure: HTMLElement = document.createElement("div");
    disclosure.append(p("GoopBox code is mostly (99%) developed with AI."));

    this._prompt = new TabbedSearchablePrompt(
      "About",
      [
        { name: "GoopBox", content: goopbox },
        { name: "License", content: license },
        { name: "AI Disclosure", content: disclosure },
      ],
      () => this._doc.closePrompt(),
    );
    this.container = this._prompt.container;
  }

  public cleanUp = (): void => {
    this._prompt.cleanUp();
  };
}
