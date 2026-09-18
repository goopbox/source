// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";

import { Layout } from "./layout.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";

const { button, dialog, label, div, form, h2, input } = HTML;

export class LayoutPrompt implements Prompt {
  #doc: SongDocument;
  readonly #okayButton: HTMLButtonElement = button(
    { class: "okayButton", style: "width:45%;" },
    "Okay",
  );
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
  });
  readonly #form: HTMLFormElement = form(
    { style: "display: flex; gap: 10px;" },
    label(
      { class: "layout-option" },
      input({ type: "radio", name: "layout", value: "long" }),
      SVG(`\
					<svg viewBox="-1 -1 28 22">
						<rect x="0" y="0" width="26" height="20" fill="none" stroke="currentColor" stroke-width="1"/>
						<rect x="2" y="2" width="12" height="10" fill="currentColor"/>
						<rect x="15" y="2" width="4" height="10" fill="currentColor"/>
						<rect x="20" y="2" width="4" height="10" fill="currentColor"/>
						<rect x="2" y="13" width="22" height="5" fill="currentColor"/>
					</svg>
				`),
      div("Long"),
    ),
    label(
      { class: "layout-option" },
      input({ type: "radio", name: "layout", value: "tall" }),
      SVG(`\
					<svg viewBox="-1 -1 28 22">
						<rect x="0" y="0" width="26" height="20" fill="none" stroke="currentColor" stroke-width="1"/>
						<rect x="11" y="2" width="8" height="16" fill="currentColor"/>
						<rect x="20" y="2" width="4" height="16" fill="currentColor"/>
						<rect x="2" y="2" width="8" height="16" fill="currentColor"/>
					</svg>
				`),
      div("Tall"),
    ),
  );

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt noSelection", style: "width: 300px;" },
    h2("Layout"),
    this.#form,
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
    this.#okayButton.addEventListener("click", this.#confirm);
    this.#cancelButton.addEventListener("click", this.#close);
    this.container.addEventListener("keydown", this.#whenKeyPressed);

    (this.#form.elements.namedItem("layout") as RadioNodeList).value = this.#doc.prefs.layout;
  }

  #close = (): void => {
    this.#doc.closePrompt();
  };

  public cleanUp = (): void => {
    this.#okayButton.removeEventListener("click", this.#confirm);
    this.#cancelButton.removeEventListener("click", this.#close);
    this.container.removeEventListener("keydown", this.#whenKeyPressed);
  };

  #whenKeyPressed = (event: KeyboardEvent): void => {
    if ((event.target as Element).tagName !== "BUTTON" && event.keyCode === 13) {
      // Enter key
      this.#confirm();
    }
  };

  #confirm = (): void => {
    this.#doc.prefs.layout = (this.#form.elements.namedItem("layout") as RadioNodeList).value;
    this.#doc.prefs.save();
    Layout.setLayout(this.#doc.prefs.layout);
    this.#close();
  };
}
