// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";

import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";
import { TabbedSearchablePrompt } from "./tabbed-searchable-prompt.js";

const { a, div, h2, p } = HTML,
  goopboxFeatures: readonly string[] = [
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
    "Automations",
  ];

export class AboutPrompt implements Prompt {
  readonly #doc: SongDocument;
  readonly #prompt: TabbedSearchablePrompt;
  public readonly container: HTMLDialogElement;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const goopbox: HTMLElement = div(
        { class: "promptGrid" },
        ...goopboxFeatures.map((feature) => div({ class: "promptCard" }, feature)),
      ),
      license: HTMLElement = document.createElement("div");
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
        ". The copyright notice and license are reproduced in LICENSE/MIT.",
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
            href: "https://github.com/101arrowz/fflate",
            target: "_blank",
            rel: "noopener",
          },
          "fflate",
        ),
      ),
      p(
        "Song compression and decompression use fflate by Arjun Barrett under the ",
        a(
          {
            href: "https://github.com/101arrowz/fflate/blob/master/LICENSE",
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
            href: "https://github.com/audiojs/stretch/tree/main/packages/stretch-transient",
            target: "_blank",
            rel: "noopener",
          },
          "@audio/stretch-transient",
        ),
      ),
      p(
        "Sample time stretching uses @audio/stretch-transient by Dmitry Iv under the ",
        a(
          {
            href: "https://github.com/audiojs/stretch/blob/main/packages/stretch-transient/LICENSE",
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
        a({ href: "https://unlicense.org/", target: "_blank", rel: "noopener" }, "Unlicense"),
        ". This dedication does not apply to BeepBox-derived code or third-party software.",
      ),
      p(
        "GoopBox will NEVER be paid software or ask for contributions. Any indication otherwise is an impersonator or a hack.",
      ),
      p(
        "The GoopBox logo is courtesy of ",
        a(
          {
            href: "https://scratch.mit.edu/users/10HCoder/",
            target: "_blank",
            rel: "noopener",
          },
          "10HCoder.",
        ),
      ),
      h2("Creations"),
      p("GoopBox claims no rights to the songs you create with it."),
      p("No external servers ever receive your songs."),
    );

    const disclosure: HTMLElement = document.createElement("div");
    disclosure.append(
      p("GoopBox code is mostly (99%) developed with AI."),
      p("It is not, and will never be, an AI soundtrack generator."),
    );

    this.#prompt = new TabbedSearchablePrompt(
      "About",
      [
        { name: "GoopBox", content: goopbox },
        { name: "License", content: license },
        { name: "AI Disclosure", content: disclosure },
      ],
      () => this.#doc.closePrompt(),
    );
    this.container = this.#prompt.container;
  }

  public cleanUp = (): void => {
    this.#prompt.cleanUp();
  };
}
