// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { SongDocument } from "./SongDocument.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { ColorConfig } from "./ColorConfig.js";

export class MuteEditor {
  private readonly _loopIcon: SVGPathElement = SVG.path({
    d: "M 4 2 L 4 0 L 7 3 L 4 6 L 4 4 Q 2 4 2 6 Q 2 8 4 8 L 4 10 Q 0 10 0 6 Q 0 2 4 2 M 8 10 L 8 12 L 5 9 L 8 6 L 8 8 Q 10 8 10 6 Q 10 4 8 4 L 8 2 Q 12 2 12 6 Q 12 10 8 10 z",
  });
  private readonly _loopButton: HTMLButtonElement = HTML.button(
    { class: "loop-toggle", type: "button", title: "Toggle Loop" },
    SVG.svg({ width: 12, height: 12, viewBox: "0 0 12 12" }, this._loopIcon),
  );
  private readonly _headerFiller: HTMLDivElement = HTML.div({
    class: "muteHeaderFiller",
  });

  public readonly container: HTMLElement = HTML.div({ class: "muteEditor" });

  private readonly _buttons: HTMLButtonElement[] = [];

  constructor(private _doc: SongDocument) {
    this.container.appendChild(this._headerFiller);
    this.container.appendChild(this._loopButton);
    this.container.addEventListener("click", this._onClick);
    this._loopButton.addEventListener("click", this._toggleLoop);
  }

  private _toggleLoop = (): void => {
    this._doc.synth.loopRepeatCount =
      this._doc.synth.loopRepeatCount == -1 ? 0 : -1;
    this._doc.notifier.changed();
  };

  private _onClick = (event: MouseEvent): void => {
    const index = this._buttons.indexOf(<HTMLButtonElement>event.target);
    if (index == -1) return;
    this._doc.song.channels[index].muted =
      !this._doc.song.channels[index].muted;
    this._doc.notifier.changed();
  };

  public render(): void {
    if (this._buttons.length != this._doc.song.getChannelCount()) {
      for (
        let y: number = this._buttons.length;
        y < this._doc.song.getChannelCount();
        y++
      ) {
        const muteButton: HTMLButtonElement = HTML.button({
          class: "mute-button",
          title: "Mute (M), Mute All (⇧M), Solo (S), Exclude (⇧S)",
        });
        this.container.insertBefore(muteButton, this._loopButton);
        this._buttons[y] = muteButton;
      }
      for (
        let y: number = this._doc.song.getChannelCount();
        y < this._buttons.length;
        y++
      ) {
        this._buttons[y].remove();
      }
      this._buttons.length = this._doc.song.getChannelCount();

      // Always put this at the bottom, below all the other buttons, to cover up the loop editor when scrolling.
      this.container.appendChild(this._loopButton);
    }

    const loopEnabled: boolean = this._doc.synth.loopRepeatCount == -1;
    this._loopIcon.setAttribute(
      "fill",
      loopEnabled ? ColorConfig.text : ColorConfig.disabledLoop,
    );
    this._loopButton.setAttribute("aria-pressed", String(loopEnabled));

    for (let y: number = 0; y < this._doc.song.getChannelCount(); y++) {
      if (this._doc.song.channels[y].muted) {
        this._buttons[y].classList.add("muted");
      } else {
        this._buttons[y].classList.remove("muted");
      }
    }
  }
}
