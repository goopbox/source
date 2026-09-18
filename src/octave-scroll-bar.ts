// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { ChangeOctave } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { EasyPointers } from "./easy-pointers.js";
import type { SongDocument } from "./song-document.js";

export class OctaveScrollBar {
  #doc: SongDocument;
  readonly #editorWidth: number = 20;
  readonly #editorHeight: number = 481;
  readonly #notchHeight: number = 4.0;
  readonly #octaveCount: number = Config.pitchOctaves;
  readonly #octaveHeight: number = (this.#editorHeight - this.#notchHeight) / this.#octaveCount;

  readonly #handle: SVGRectElement = SVG.rect({
    fill: ColorConfig.uiWidgetBackground,
    x: 2,
    y: 0,
    width: this.#editorWidth - 4,
  });
  readonly #handleHighlight: SVGRectElement = SVG.rect({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": 2,
    "pointer-events": "none",
    x: 1,
    y: 0,
    width: this.#editorWidth - 2,
  });
  readonly #upHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.text,
    "pointer-events": "none",
  });
  readonly #downHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.text,
    "pointer-events": "none",
  });

  readonly #svg: SVGSVGElement = SVG.svg({
    style: `background-color: ${ColorConfig.background}; touch-action: pan-x; position: absolute;`,
    width: this.#editorWidth,
    height: "100%",
    viewBox: "0 0 20 481",
    preserveAspectRatio: "none",
  });
  public readonly container: HTMLDivElement = HTML.div(
    {
      id: "octaveScrollBarContainer",
      style: "width: 20px; height: 100%; overflow: hidden; position: relative; flex-shrink: 0;",
    },
    this.#svg,
  );

  readonly #pointers: EasyPointers = new EasyPointers(this.container, {
    preventTouchGestureScrolling: true,
  });

  #mouseY = 0;
  #dragging = false;
  #dragStart!: number;
  #barBottom!: number;
  #barHeight!: number;
  #renderedBarBottom = -1;
  #renderedVisibleOctaveCount = -1;
  #change: ChangeOctave | null = null;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.#doc.notifier.watch(this.#documentChanged);
    this.#documentChanged();

    this.#svg.append(this.#handle);

    // Notches:
    for (let i = 0; i <= this.#octaveCount; i++) {
      this.#svg.append(
        SVG.rect({
          fill: ColorConfig.tonic,
          x: 0,
          y: i * this.#octaveHeight,
          width: this.#editorWidth,
          height: this.#notchHeight,
        }),
      );
    }

    this.#svg.append(this.#handleHighlight);
    this.#svg.append(this.#upHighlight);
    this.#svg.append(this.#downHighlight);

    const center: number = this.#editorWidth * 0.5,
      base = 20,
      tip = 9,
      arrowWidth = 6;
    this.#upHighlight.setAttribute(
      "d",
      `M ${center} ${tip} L ${center + arrowWidth} ${base} L ${center - arrowWidth} ${base} z`,
    );
    this.#downHighlight.setAttribute(
      "d",
      `M ${center} ${this.#editorHeight - tip} L ${center + arrowWidth} ${this.#editorHeight - base} L ${center - arrowWidth} ${this.#editorHeight - base} z`,
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
    this.#mouseY =
      this.#pointers.latest.getPointInNormalized(this.container).y * this.#editorHeight;
    if (!this.#doc.song.getChannelIsPitch(this.#doc.channel)) {
      return;
    }
    this.#updatePreview();

    if (this.#mouseY >= this.#barBottom - this.#barHeight && this.#mouseY <= this.#barBottom) {
      this.#dragging = true;
      this.#change = null;
      this.#dragStart = this.#mouseY;
    }
  };

  #onPointerMove = (_event: PointerEvent): void => {
    this.#mouseY =
      this.#pointers.latest.getPointInNormalized(this.container).y * this.#editorHeight;
    if (!this.#doc.song.getChannelIsPitch(this.#doc.channel)) {
      return;
    }
    if (this.#dragging) {
      const visibleOctaveCount: number = this.#doc.getVisibleOctaveCount(),
        scrollableOctaves: number = Config.pitchOctaves - visibleOctaveCount,
        continuingProspectiveChange: boolean = this.#doc.lastChangeWas(this.#change),
        oldValue: number = continuingProspectiveChange
          ? this.#change!.oldValue
          : this.#doc.song.channels[this.#doc.channel]!.octave,
        currentOctave: number = this.#doc.getBaseVisibleOctave(this.#doc.channel);
      let octave: number = currentOctave;
      while (this.#mouseY - this.#dragStart < -this.#octaveHeight * 0.5) {
        if (octave < scrollableOctaves) {
          octave++;
          this.#dragStart -= this.#octaveHeight;
        } else {
          break;
        }
      }
      while (this.#mouseY - this.#dragStart > this.#octaveHeight * 0.5) {
        if (octave > 0) {
          octave--;
          this.#dragStart += this.#octaveHeight;
        } else {
          break;
        }
      }

      this.#change = new ChangeOctave(
        this.#doc,
        oldValue,
        Math.floor(octave + visibleOctaveCount * 0.5),
      );
      this.#doc.setProspectiveChange(this.#change);
    }

    this.#updatePreview();
  };

  #onPointerUp = (_event: PointerEvent): void => {
    if (this.#doc.song.getChannelIsPitch(this.#doc.channel)) {
      if (this.#dragging) {
        if (this.#change != null) {
          this.#doc.record(this.#change);
        }
      } else {
        const visibleOctaveCount: number = this.#doc.getVisibleOctaveCount(),
          scrollableOctaves: number = Config.pitchOctaves - visibleOctaveCount,
          canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#change),
          oldValue: number = canReplaceLastChange
            ? this.#change!.oldValue
            : this.#doc.song.channels[this.#doc.channel]!.octave,
          currentOctave: number = this.#doc.getBaseVisibleOctave(this.#doc.channel);
        if (this.#mouseY < this.#barBottom - this.#barHeight * 0.5) {
          if (currentOctave < scrollableOctaves) {
            this.#change = new ChangeOctave(
              this.#doc,
              oldValue,
              Math.floor(currentOctave + 1 + visibleOctaveCount * 0.5),
            );
            this.#doc.record(this.#change, canReplaceLastChange);
          }
        } else if (currentOctave > 0) {
          this.#change = new ChangeOctave(
            this.#doc,
            oldValue,
            Math.floor(currentOctave - 1 + visibleOctaveCount * 0.5),
          );
          this.#doc.record(this.#change, canReplaceLastChange);
        }
      }
    }
    this.#dragging = false;
    this.#updatePreview();
  };

  #updatePreview(): void {
    const showHighlight: boolean = this.#pointers.latest.isHovering;
    let showUpHighlight = false,
      showDownHighlight = false,
      showHandleHighlight = false;

    if (showHighlight) {
      if (this.#mouseY < this.#barBottom - this.#barHeight) {
        showUpHighlight = true;
      } else if (this.#mouseY > this.#barBottom) {
        showDownHighlight = true;
      } else {
        showHandleHighlight = true;
      }
    }

    this.#upHighlight.style.display = showUpHighlight ? "" : "none";
    this.#downHighlight.style.display = showDownHighlight ? "" : "none";
    this.#handleHighlight.style.display = showHandleHighlight ? "" : "none";
  }

  #documentChanged = (): void => {
    if (!this.#doc.song.getChannelIsPitch(this.#doc.channel)) {
      this.#dragging = false;
      this.#svg.style.display = "none";
      this.#updatePreview();
      return;
    }
    this.#barBottom =
      this.#editorHeight - this.#octaveHeight * this.#doc.getBaseVisibleOctave(this.#doc.channel);
    this.#svg.style.display = "";
    const visibleOctaveCount: number = this.#doc.getVisibleOctaveCount();
    if (
      this.#renderedBarBottom !== this.#barBottom ||
      this.#renderedVisibleOctaveCount !== visibleOctaveCount
    ) {
      this.#renderedBarBottom = this.#barBottom;
      this.#renderedVisibleOctaveCount = visibleOctaveCount;
      this.#barHeight = this.#octaveHeight * visibleOctaveCount + this.#notchHeight;
      this.#handle.setAttribute("height", String(this.#barHeight));
      this.#handleHighlight.setAttribute("height", String(this.#barHeight));
      this.#handle.setAttribute("y", String(this.#barBottom - this.#barHeight));
      this.#handleHighlight.setAttribute("y", String(this.#barBottom - this.#barHeight));
    }
    this.#updatePreview();
  };
}
