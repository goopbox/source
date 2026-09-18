// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";

import { ColorConfig } from "./color-config.js";
import { EasyPointers } from "./easy-pointers.js";
import type { SongDocument } from "./song-document.js";

export class BarScrollBar {
  #doc: SongDocument;
  readonly #editorWidth: number = 512;
  readonly #editorHeight: number = 20;

  readonly #notches: SVGSVGElement = SVG.svg({
    "pointer-events": "none",
  });
  readonly #handle: SVGRectElement = SVG.rect({
    fill: ColorConfig.uiWidgetBackground,
    x: 0,
    y: 2,
    width: 10,
    height: this.#editorHeight - 4,
  });
  readonly #handleHighlight: SVGRectElement = SVG.rect({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": 2,
    "pointer-events": "none",
    x: 0,
    y: 1,
    width: 10,
    height: this.#editorHeight - 2,
  });
  readonly #leftHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.text,
    "pointer-events": "none",
  });
  readonly #rightHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.text,
    "pointer-events": "none",
  });

  readonly #svg: SVGSVGElement = SVG.svg(
    {
      style: `background-color: ${ColorConfig.background}; touch-action: pan-y; position: absolute;`,
      width: this.#editorWidth,
      height: this.#editorHeight,
    },
    this.#notches,
    this.#handle,
    this.#handleHighlight,
    this.#leftHighlight,
    this.#rightHighlight,
  );

  public readonly container: HTMLElement = HTML.div(
    {
      class: "barScrollBar",
      style: "width: 512px; height: 20px; overflow: hidden; position: relative;",
    },
    this.#svg,
  );

  readonly #pointers: EasyPointers = new EasyPointers(this.container);

  #mouseX = 0;
  #dragging = false;
  #dragStart!: number;
  #notchSpace!: number;
  #renderedNotchCount = -1;
  #renderedScrollBarPos = -1;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const center: number = this.#editorHeight * 0.5,
      base = 20,
      tip = 9,
      arrowHeight = 6;
    this.#leftHighlight.setAttribute(
      "d",
      `M ${tip} ${center} L ${base} ${center + arrowHeight} L ${base} ${center - arrowHeight} z`,
    );
    this.#rightHighlight.setAttribute(
      "d",
      `M ${this.#editorWidth - tip} ${center} L ${this.#editorWidth - base} ${center + arrowHeight} L ${this.#editorWidth - base} ${center - arrowHeight} z`,
    );

    this.container.addEventListener("pointerenter", this.#onPointerMove);
    this.container.addEventListener("pointerleave", this.#onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerUp);
  }

  #onPointerLeave = (_event: PointerEvent): void => {
    this.#updatePreview();
  };

  #onPointerDown = (_event: PointerEvent): void => {
    this.#mouseX = this.#pointers.latest.getPointIn(this.#svg).x;
    this.#updatePreview();
    if (
      this.#mouseX >= this.#doc.barScrollPos * this.#notchSpace &&
      this.#mouseX <= (this.#doc.barScrollPos + this.#doc.trackVisibleBars) * this.#notchSpace
    ) {
      this.#dragging = true;
      this.#dragStart = this.#mouseX;
    }
  };

  #onPointerMove = (_event: PointerEvent): void => {
    this.#mouseX = this.#pointers.latest.getPointIn(this.#svg).x;
    if (this.#dragging) {
      while (this.#mouseX - this.#dragStart < -this.#notchSpace * 0.5) {
        if (this.#doc.barScrollPos > 0) {
          this.#doc.barScrollPos--;
          this.#dragStart -= this.#notchSpace;
          this.#doc.notifier.changed();
        } else {
          break;
        }
      }
      while (this.#mouseX - this.#dragStart > this.#notchSpace * 0.5) {
        if (this.#doc.barScrollPos < this.#doc.song.barCount - this.#doc.trackVisibleBars) {
          this.#doc.barScrollPos++;
          this.#dragStart += this.#notchSpace;
          this.#doc.notifier.changed();
        } else {
          break;
        }
      }
    }
    this.#updatePreview();
  };

  #onPointerUp = (_event: PointerEvent): void => {
    if (!this.#dragging) {
      if (this.#mouseX < (this.#doc.barScrollPos + 8) * this.#notchSpace) {
        if (this.#doc.barScrollPos > 0) {
          this.#doc.barScrollPos--;
        }
      } else if (this.#doc.barScrollPos < this.#doc.song.barCount - this.#doc.trackVisibleBars) {
        this.#doc.barScrollPos++;
      }
      this.#doc.notifier.changed();
    }
    this.#dragging = false;
    this.#updatePreview();
  };

  #updatePreview(): void {
    const showHighlight: boolean = this.#pointers.latest.isHovering;
    let showleftHighlight = false,
      showRightHighlight = false,
      showHandleHighlight = false;

    if (showHighlight) {
      if (this.#mouseX < this.#doc.barScrollPos * this.#notchSpace) {
        showleftHighlight = true;
      } else if (
        this.#mouseX >
        (this.#doc.barScrollPos + this.#doc.trackVisibleBars) * this.#notchSpace
      ) {
        showRightHighlight = true;
      } else {
        showHandleHighlight = true;
      }
    }

    this.#leftHighlight.style.display = showleftHighlight ? "" : "none";
    this.#rightHighlight.style.display = showRightHighlight ? "" : "none";
    this.#handleHighlight.style.display = showHandleHighlight ? "" : "none";
  }

  public render(): void {
    this.#notchSpace =
      (this.#editorWidth - 1) / Math.max(this.#doc.trackVisibleBars, this.#doc.song.barCount);

    const resized: boolean = this.#renderedNotchCount !== this.#doc.song.barCount;
    if (resized) {
      this.#renderedNotchCount = this.#doc.song.barCount;

      while (this.#notches.firstChild) {
        this.#notches.removeChild(this.#notches.firstChild);
      }

      for (let i = 0; i <= this.#doc.song.barCount; i++) {
        const lineHeight: number =
          i % 16 === 0 ? 0 : i % 4 === 0 ? this.#editorHeight / 8 : this.#editorHeight / 3;
        this.#notches.append(
          SVG.rect({
            fill: ColorConfig.uiWidgetBackground,
            x: i * this.#notchSpace - 1,
            y: lineHeight,
            width: 2,
            height: this.#editorHeight - lineHeight * 2,
          }),
        );
      }
    }

    if (resized || this.#renderedScrollBarPos !== this.#doc.barScrollPos) {
      this.#renderedScrollBarPos = this.#doc.barScrollPos;
      this.#handle.setAttribute("x", String(this.#notchSpace * this.#doc.barScrollPos));
      this.#handle.setAttribute("width", String(this.#notchSpace * this.#doc.trackVisibleBars));
      this.#handleHighlight.setAttribute("x", String(this.#notchSpace * this.#doc.barScrollPos));
      this.#handleHighlight.setAttribute(
        "width",
        String(this.#notchSpace * this.#doc.trackVisibleBars),
      );
    }

    this.#updatePreview();
  }
}
