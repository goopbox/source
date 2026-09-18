// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";

import { ColorConfig } from "./color-config.js";
import type { SongDocument } from "./song-document.js";

export class MuteEditor {
  #doc: SongDocument;
  readonly #loopIcon: SVGPathElement = SVG.path({
    d: "M 4 2 L 4 0 L 7 3 L 4 6 L 4 4 Q 2 4 2 6 Q 2 8 4 8 L 4 10 Q 0 10 0 6 Q 0 2 4 2 M 8 10 L 8 12 L 5 9 L 8 6 L 8 8 Q 10 8 10 6 Q 10 4 8 4 L 8 2 Q 12 2 12 6 Q 12 10 8 10 z",
  });
  readonly #loopButton: HTMLButtonElement = HTML.button(
    { class: "loop-toggle", type: "button", title: "Toggle Loop" },
    SVG.svg({ width: 12, height: 12, viewBox: "0 0 12 12" }, this.#loopIcon),
  );
  readonly #headerFiller: HTMLDivElement = HTML.div({
    class: "muteHeaderFiller",
  });

  public readonly container: HTMLElement = HTML.div({ class: "muteEditor" });

  readonly #buttons: HTMLButtonElement[] = [];

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.container.append(this.#headerFiller);
    this.container.append(this.#loopButton);
    this.container.addEventListener("click", this.#onClick);
    this.#loopButton.addEventListener("click", this.#toggleLoop);
  }

  #toggleLoop = (): void => {
    this.#doc.synth.loopRepeatCount = this.#doc.synth.loopRepeatCount === -1 ? 0 : -1;
    this.#doc.notifier.changed();
  };

  #onClick = (event: MouseEvent): void => {
    const index = this.#buttons.indexOf(event.target as HTMLButtonElement);
    if (index === -1) {
      return;
    }
    this.#doc.song.channels[index]!.muted = !this.#doc.song.channels[index]!.muted;
    this.#doc.notifier.changed();
  };

  public render(): void {
    if (this.#buttons.length !== this.#doc.song.getChannelCount()) {
      for (let y: number = this.#buttons.length; y < this.#doc.song.getChannelCount(); y++) {
        const muteButton: HTMLButtonElement = HTML.button({
          class: "mute-button",
          title: "Mute (M), Mute All (⇧M), Solo (S), Exclude (⇧S)",
        });
        this.container.insertBefore(muteButton, this.#loopButton);
        this.#buttons[y] = muteButton;
      }
      for (let y: number = this.#doc.song.getChannelCount(); y < this.#buttons.length; y++) {
        this.#buttons[y]!.remove();
      }
      this.#buttons.length = this.#doc.song.getChannelCount();

      // Always put this at the bottom, below all the other buttons, to cover up the loop editor when scrolling.
      this.container.append(this.#loopButton);
    }

    const loopEnabled: boolean = this.#doc.synth.loopRepeatCount === -1;
    this.#loopIcon.setAttribute("fill", loopEnabled ? ColorConfig.text : ColorConfig.disabledLoop);
    this.#loopButton.setAttribute("aria-pressed", String(loopEnabled));

    for (let y = 0; y < this.#doc.song.getChannelCount(); y++) {
      this.#buttons[y]!.classList.toggle("muted", this.#doc.song.channels[y]!.muted);
    }
  }
}
