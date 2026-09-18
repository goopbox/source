// Distributed under the Unlicense.

import { EditorConfig } from "./editor-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";

const { button, dialog, div, h2 } = HTML;

/** Chooses a base type without applying a full, destructive preset. */
export class InstrumentTypePrompt implements Prompt {
  readonly #close: () => void;
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
    "aria-label": "Close",
  });
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  public constructor(choose: (preset: string) => void, _close: () => void) {
    this.#close = _close;
    const items: HTMLButtonElement[] = [],
      types = EditorConfig.presetCategories[0]!.presets;
    for (let index = 0; index < types.length; index++) {
      const preset = types[index]!,
        item = button({ class: "presetPromptItem", type: "button" }, preset.name);
      item.addEventListener("click", () => {
        choose(String(index));
        this.#close();
      });
      items.push(item);
    }
    this.container = dialog(
      { class: "prompt noSelection instrumentTypePrompt" },
      h2("Instrument Type"),
      div({ class: "promptGrid" }, ...items),
      this.#cancelButton,
    );
    this.#cancelButton.addEventListener("click", this.#close);
  }

  public cleanUp = (): void => this.#cancelButton.removeEventListener("click", this.#close);
}
