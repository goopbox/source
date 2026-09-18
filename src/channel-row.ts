// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type ChannelColors, ColorConfig, type ColorGradient } from "./color-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Pattern } from "../synth/synth.js";
import type { SongDocument } from "./song-document.js";

const patternHeight = 28;

export class Box {
  readonly #text: Text = document.createTextNode("");
  readonly #label: HTMLElement = HTML.div({ class: "channelBoxLabel" }, this.#text);
  public readonly container: HTMLElement = HTML.div(
    {
      class: "channelBox",
      style: `margin: 1px; height: ${patternHeight - 2}px;`,
    },
    this.#label,
  );
  #renderedIndex = -1;
  public constructor(color: ColorGradient) {
    this.container.style.background = ColorConfig.uiWidgetBackground;
    this.#label.style.setProperty("--pattern-number-gradient", ColorConfig.cssGradient(color));
  }

  public setWidth(width: number): void {
    this.container.style.width = `${width - 2}px`; // There's a 1 pixel margin on either side.
  }

  public setIndex(index: number, selected: boolean, empty: boolean, color: ColorGradient): void {
    if (this.#renderedIndex !== index) {
      this.#renderedIndex = index;
      this.#text.data = String(index);
    }
    this.#label.style.setProperty(
      "--pattern-number-gradient",
      selected
        ? ColorConfig.cssGradient([ColorConfig.background, ColorConfig.background])
        : ColorConfig.cssGradient(color),
    );
    this.#label.classList.toggle("smaller-digits", index >= 100);
    this.container.style.background = selected
      ? ColorConfig.cssGradient(color)
      : empty
        ? ColorConfig.surface
        : index === 0
          ? "none"
          : ColorConfig.uiWidgetBackground;
  }
}

export class ChannelRow {
  readonly #doc: SongDocument;
  public static patternHeight = patternHeight;

  #renderedBarWidth = -1;
  #boxes: Box[] = [];
  public readonly number: HTMLElement;
  readonly #boxContainer: HTMLElement;

  public readonly container: HTMLElement;

  public constructor(
    _doc: SongDocument,
    public readonly index: number,
  ) {
    this.#doc = _doc;
    this.number = HTML.div(
      { class: "channelNumber", title: `Channel ${index + 1}` },
      String(index + 1),
    );
    this.#boxContainer = HTML.div({ class: "channelBoxes" });
    this.container = HTML.div({ class: "channelRow" }, this.number, this.#boxContainer);
  }

  public render(): void {
    const barWidth: number = this.#doc.getBarWidth();
    if (this.#boxes.length !== this.#doc.song.barCount) {
      for (let x: number = this.#boxes.length; x < this.#doc.song.barCount; x++) {
        const box: Box = new Box(
          ColorConfig.getChannelColor(this.#doc.song, this.index).secondaryChannel,
        );
        box.setWidth(barWidth);
        this.#boxContainer.append(box.container);
        this.#boxes[x] = box;
      }
      for (let x: number = this.#doc.song.barCount; x < this.#boxes.length; x++) {
        this.#boxContainer.removeChild(this.#boxes[x]!.container);
      }
      this.#boxes.length = this.#doc.song.barCount;
    }

    if (this.#renderedBarWidth !== barWidth) {
      this.#renderedBarWidth = barWidth;
      for (let x = 0; x < this.#boxes.length; x++) {
        this.#boxes[x]!.setWidth(barWidth);
      }
    }

    let hasContent = false;
    for (let i = 0; i < this.#boxes.length; i++) {
      const pattern: Pattern | null = this.#doc.song.getPattern(this.index, i),
        patternIndex: number = this.#doc.song.channels[this.index]!.bars[i]!,
        selected: boolean = i === this.#doc.bar && this.index === this.#doc.channel,
        dim: boolean =
          pattern == null || !pattern.hasContent(this.#doc.song.getChannelKind(this.index)),
        empty: boolean = patternIndex !== 0 && dim;
      hasContent ||= !dim;

      const box: Box = this.#boxes[i]!;
      if (i < this.#doc.song.barCount) {
        const colors: ChannelColors = ColorConfig.getChannelColor(this.#doc.song, this.index);
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
    this.number.classList.toggle("has-content", hasContent);
    this.number.classList.toggle("selected", this.index === this.#doc.channel);
  }

  public setDragOffset(offset: number): void {
    this.container.style.transform = offset === 0 ? "" : `translateY(${offset}px)`;
    this.container.classList.toggle("reorder-preview", offset !== 0);
  }

  public setBarDragOffset(bar: number, offset: number): void {
    const box: Box | undefined = this.#boxes[bar]!;
    if (box === undefined) {
      return;
    }
    box.container.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
    box.container.classList.toggle("reorder-preview", offset !== 0);
  }
}
