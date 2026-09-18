// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeSequence, type UndoableChange } from "./change.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { type Instrument, Synth, clamp } from "../synth/synth.js";
import { ChangeFadeInOut } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { EasyPointers } from "./easy-pointers.js";
import type { SongDocument } from "./song-document.js";

export class FadeInOutEditor {
  #doc: SongDocument;
  readonly #editorWidth: number = 120;
  readonly #editorHeight: number = 26;
  readonly #fadeCurve: SVGPathElement = SVG.path({
    fill: ColorConfig.uiWidgetBackground,
    "pointer-events": "none",
  });
  readonly #dottedLinePath: SVGPathElement = SVG.path({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1,
    "stroke-dasharray": "3, 2",
    "pointer-events": "none",
  });
  readonly #controlCurve: SVGPathElement = SVG.path({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "pointer-events": "none",
  });
  readonly #svg: SVGSVGElement = SVG.svg(
    {
      style: `background-color: ${ColorConfig.background};`,
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${this.#editorWidth} ${this.#editorHeight}`,
      preserveAspectRatio: "none",
    },
    this.#fadeCurve,
    this.#dottedLinePath,
    this.#controlCurve,
  );
  public readonly container: HTMLElement = HTML.div(
    {
      class: "fadeInOut",
      style: "height: 100%; touch-action: pan-y; cursor: col-resize;",
    },
    this.#svg,
  );

  #mouseX = 0;
  #mouseXStart = 0;
  #mouseDown = false;
  #mouseDragging = false;
  #draggingFadeIn = false;
  #dragChange: UndoableChange | null = null;
  #renderedFadeIn = -1;
  #renderedFadeOut = -1;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const dottedLineX: number = this.#fadeOutToX(Config.fadeOutNeutral);
    this.#dottedLinePath.setAttribute(
      "d",
      `M ${dottedLineX} 0 L ${dottedLineX} ${this.#editorHeight}`,
    );

    new EasyPointers(this.container);
    //This.container.addEventListener("pointerenter", this._onPointerMove);
    //This.container.addEventListener("pointerleave", this._onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerUp);
  }

  #fadeInToX(fadeIn: number) {
    return 1.0 + ((this.#editorWidth - 2.0) * 0.4 * fadeIn) / (Config.fadeInRange - 1);
  }
  #xToFadeIn(x: number) {
    return clamp(
      0,
      Config.fadeInRange,
      Math.round(((x - 1.0) * (Config.fadeInRange - 1)) / (0.4 * this.#editorWidth - 2.0)),
    );
  }
  #fadeOutToX(fadeOut: number) {
    return (
      1.0 + (this.#editorWidth - 2.0) * (0.5 + (0.5 * fadeOut) / (Config.fadeOutTicks.length - 1))
    );
  }
  #xToFadeOut(x: number) {
    return clamp(
      0,
      Config.fadeOutTicks.length,
      Math.round(
        ((Config.fadeOutTicks.length - 1) * ((x - 1.0) / (this.#editorWidth - 2.0) - 0.5)) / 0.5,
      ),
    );
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#mouseX = event.pointer!.getPointIn(this.#svg).x;
    this.#mouseXStart = this.#mouseX;
    this.#mouseDown = true;
    this.#mouseDragging = false;
    const instrument: Instrument =
        this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!,
      fadeInX: number = this.#fadeInToX(instrument.fadeIn),
      fadeOutX: number = this.#fadeOutToX(instrument.fadeOut);
    this.#draggingFadeIn = this.#mouseXStart < (fadeInX + fadeOutX) / 2.0;
    this.#dragChange = new ChangeSequence();
    this.#doc.setProspectiveChange(this.#dragChange);
  };

  #onPointerMove = (event: PointerEvent): void => {
    this.#mouseX = event.pointer!.getPointIn(this.#svg).x;
    if (this.#dragChange != null && this.#doc.lastChangeWas(this.#dragChange)) {
      this.#dragChange.undo();
    } else {
      this.#mouseDown = false;
    }
    this.#dragChange = null;

    if (this.#mouseDown) {
      const sequence: ChangeSequence = new ChangeSequence();
      this.#dragChange = sequence;
      this.#doc.setProspectiveChange(this.#dragChange);

      if (Math.abs(this.#mouseX - this.#mouseXStart) > 4.0) {
        this.#mouseDragging = true;
      }

      if (this.#mouseDragging) {
        const instrument: Instrument =
          this.#doc.song.channels[this.#doc.channel]!.instruments[
            this.#doc.getCurrentInstrument()
          ]!;
        if (this.#draggingFadeIn) {
          sequence.append(
            new ChangeFadeInOut(
              this.#doc,
              this.#xToFadeIn(
                this.#fadeInToX(instrument.fadeIn) + this.#mouseX - this.#mouseXStart,
              ),
              instrument.fadeOut,
            ),
          );
        } else {
          sequence.append(
            new ChangeFadeInOut(
              this.#doc,
              instrument.fadeIn,
              this.#xToFadeOut(
                this.#fadeOutToX(instrument.fadeOut) + this.#mouseX - this.#mouseXStart,
              ),
            ),
          );
        }
      }
    }
  };

  #onPointerUp = (_event: PointerEvent): void => {
    if (this.#mouseDown && this.#doc.lastChangeWas(this.#dragChange) && this.#dragChange != null) {
      if (this.#mouseDragging) {
        this.#doc.record(this.#dragChange);
      } else {
        const instrument: Instrument =
          this.#doc.song.channels[this.#doc.channel]!.instruments[
            this.#doc.getCurrentInstrument()
          ]!;
        if (this.#draggingFadeIn) {
          this.#doc.record(
            new ChangeFadeInOut(this.#doc, this.#xToFadeIn(this.#mouseX), instrument.fadeOut),
          );
        } else {
          this.#doc.record(
            new ChangeFadeInOut(this.#doc, instrument.fadeIn, this.#xToFadeOut(this.#mouseX)),
          );
        }
      }
    }
    this.#dragChange = null;
    this.#mouseDragging = false;
    this.#mouseDown = false;
  };

  public render(): void {
    const instrument: Instrument =
      this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!;

    if (
      this.#renderedFadeIn === instrument.fadeIn &&
      this.#renderedFadeOut === instrument.fadeOut
    ) {
      return;
    }

    const fadeInX: number = this.#fadeInToX(instrument.fadeIn),
      fadeOutX: number = this.#fadeOutToX(instrument.fadeOut);
    this.#controlCurve.setAttribute(
      "d",
      `M ${fadeInX} 0 L ${fadeInX} ${this.#editorHeight} M ${fadeOutX} 0 L ${fadeOutX} ${this.#editorHeight}`,
    );

    const dottedLineX: number = this.#fadeOutToX(Config.fadeOutNeutral);
    let fadePath = "";
    fadePath += `M 0 ${this.#editorHeight} `;
    fadePath += `L ${fadeInX} 0 `;
    if (Synth.fadeOutSettingToTicks(instrument.fadeOut) > 0) {
      fadePath += `L ${dottedLineX} 0 `;
      fadePath += `L ${fadeOutX} ${this.#editorHeight} `;
    } else {
      fadePath += `L ${fadeOutX} 0 `;
      fadePath += `L ${dottedLineX} ${this.#editorHeight} `;
    }
    fadePath += "z";
    this.#fadeCurve.setAttribute("d", fadePath);
  }
}
