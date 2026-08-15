// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Pattern } from "../synth/synth.js";
import { ColorConfig, type ChannelColors } from "./ColorConfig.js";
import { SongDocument } from "./SongDocument.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";

export class Box {
  private readonly _text: Text = document.createTextNode("");
  private readonly _label: HTMLElement = HTML.div(
    { class: "channelBoxLabel" },
    this._text,
  );
  public readonly container: HTMLElement = HTML.div(
    {
      class: "channelBox",
      style: `margin: 1px; height: ${ChannelRow.patternHeight - 2}px;`,
    },
    this._label,
  );
  private _renderedIndex: number = -1;
  constructor(_channel: number, color: string) {
    this.container.style.background = ColorConfig.uiWidgetBackground;
    this._label.style.color = color;
  }

  public setWidth(width: number): void {
    this.container.style.width = width - 2 + "px"; // there's a 1 pixel margin on either side.
  }

  public setIndex(
    index: number,
    selected: boolean,
    empty: boolean,
    color: string,
  ): void {
    if (this._renderedIndex != index) {
      this._renderedIndex = index;
      this._text.data = String(index);
    }
    this._label.style.color = selected ? ColorConfig.background : color;
    this._label.classList.toggle("smaller-digits", index >= 100);
    this.container.style.background = selected
      ? color
      : empty
        ? ColorConfig.surface
        : index == 0
          ? "none"
          : ColorConfig.uiWidgetBackground;
  }
}

export class ChannelRow {
  public static patternHeight: number = 28;

  private _renderedBarWidth: number = -1;
  private _boxes: Box[] = [];
  private readonly _number: HTMLElement;
  private readonly _boxContainer: HTMLElement;

  public readonly container: HTMLElement;

  constructor(
    private readonly _doc: SongDocument,
    public readonly index: number,
  ) {
    this._number = HTML.div(
      { class: "channelNumber", title: `Channel ${index + 1}` },
      String(index + 1),
    );
    this._boxContainer = HTML.div({ class: "channelBoxes" });
    this.container = HTML.div(
      { class: "channelRow" },
      this._number,
      this._boxContainer,
    );
  }

  public render(): void {
    const barWidth: number = this._doc.getBarWidth();
    if (this._boxes.length != this._doc.song.barCount) {
      for (
        let x: number = this._boxes.length;
        x < this._doc.song.barCount;
        x++
      ) {
        const box: Box = new Box(
          this.index,
          ColorConfig.getChannelColor(this._doc.song, this.index)
            .secondaryChannel,
        );
        box.setWidth(barWidth);
        this._boxContainer.appendChild(box.container);
        this._boxes[x] = box;
      }
      for (
        let x: number = this._doc.song.barCount;
        x < this._boxes.length;
        x++
      ) {
        this._boxContainer.removeChild(this._boxes[x].container);
      }
      this._boxes.length = this._doc.song.barCount;
    }

    if (this._renderedBarWidth != barWidth) {
      this._renderedBarWidth = barWidth;
      for (let x: number = 0; x < this._boxes.length; x++) {
        this._boxes[x].setWidth(barWidth);
      }
    }

    for (let i: number = 0; i < this._boxes.length; i++) {
      const pattern: Pattern | null = this._doc.song.getPattern(this.index, i);
      const patternIndex: number = this._doc.song.channels[this.index].bars[i];
      const selected: boolean =
        i == this._doc.bar && this.index == this._doc.channel;
      const dim: boolean = pattern == null || pattern.notes.length == 0;
      const empty: boolean = patternIndex != 0 && dim;

      const box: Box = this._boxes[i];
      if (i < this._doc.song.barCount) {
        const colors: ChannelColors = ColorConfig.getChannelColor(
          this._doc.song,
          this.index,
        );
        box.setIndex(
          patternIndex,
          selected,
          empty,
          dim && !selected ? colors.secondaryChannel : colors.primaryChannel,
        );
        box.container.style.visibility = "visible";
      } else {
        box.container.style.visibility = "hidden";
      }
    }
    this._number.classList.toggle("selected", this.index == this._doc.channel);
  }
}
