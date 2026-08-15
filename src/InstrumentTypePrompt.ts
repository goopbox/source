// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { EditorConfig } from "./EditorConfig.js";
import type { Prompt } from "./Prompt.js";

const { button, dialog, div, h2 } = HTML;

/** Chooses a base type without applying a full, destructive preset. */
export class InstrumentTypePrompt implements Prompt {
  private readonly _cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
    "aria-label": "Close",
  });
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  constructor(
    choose: (preset: string) => void,
    private readonly _close: () => void,
  ) {
    const items: HTMLButtonElement[] = [];
    const types = EditorConfig.presetCategories[0]!.presets;
    for (let index = 0; index < types.length; index++) {
      const preset = types[index]!;
      const item = button(
        { class: "presetPromptItem", type: "button" },
        preset.name,
      );
      item.addEventListener("click", () => {
        choose(String(index));
        this._close();
      });
      items.push(item);
    }
    this.container = dialog(
      { class: "prompt noSelection instrumentTypePrompt" },
      h2("Instrument Type"),
      div({ class: "promptGrid" }, ...items),
      this._cancelButton,
    );
    this._cancelButton.addEventListener("click", this._close);
  }

  public cleanUp = (): void =>
    this._cancelButton.removeEventListener("click", this._close);
}
