// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { EasyPointers, type Point2d } from "./easy-pointers.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import type { HarmonicsWave, Instrument } from "../synth/synth.js";
import { ChangeHarmonics } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import type { SongDocument } from "./song-document.js";
import { prettyNumber } from "./editor-config.js";

export class HarmonicsEditor {
  #doc: SongDocument;
  readonly #editorWidth: number = 120;
  readonly #editorHeight: number = 26;
  readonly #octaves: SVGSVGElement = SVG.svg({
    "pointer-events": "none",
  });
  readonly #fifths: SVGSVGElement = SVG.svg({
    "pointer-events": "none",
  });
  readonly #curve: SVGPathElement = SVG.path({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "pointer-events": "none",
  });
  readonly #lastControlPoints: SVGRectElement[] = [];
  readonly #lastControlPointContainer: SVGSVGElement = SVG.svg({
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
    this.#octaves,
    this.#fifths,
    this.#curve,
    this.#lastControlPointContainer,
  );

  public readonly container: HTMLElement = HTML.div(
    {
      class: "harmonics",
      style: "height: 100%; touch-action: none; cursor: crosshair;",
    },
    this.#svg,
  );

  #mouseX = 0;
  #mouseY = 0;
  #freqPrev = 0;
  #ampPrev = 0;
  #change: ChangeHarmonics | null = null;
  #renderedPath = "";

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    for (let i = 1; i <= Config.harmonicsControlPoints; i *= 2) {
      this.#octaves.append(
        SVG.rect({
          fill: ColorConfig.tonic,
          x: ((i - 0.5) * (this.#editorWidth - 8)) / (Config.harmonicsControlPoints - 1) - 1,
          y: 0,
          width: 2,
          height: this.#editorHeight,
        }),
      );
    }
    for (let i = 3; i <= Config.harmonicsControlPoints; i *= 2) {
      this.#fifths.append(
        SVG.rect({
          fill: ColorConfig.fifthNote,
          x: ((i - 0.5) * (this.#editorWidth - 8)) / (Config.harmonicsControlPoints - 1) - 1,
          y: 0,
          width: 2,
          height: this.#editorHeight,
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      const rect: SVGRectElement = SVG.rect({
        fill: "currentColor",
        x: this.#editorWidth - i * 2 - 1,
        y: 0,
        width: 1,
        height: this.#editorHeight,
      });
      this.#lastControlPoints.push(rect);
      this.#lastControlPointContainer.append(rect);
    }

    new EasyPointers(this.container, { preventTouchGestureScrolling: true });
    //This.container.addEventListener("pointerenter", this._onPointerMove);
    //This.container.addEventListener("pointerleave", this._onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerUp);
  }

  #xToFreq(x: number): number {
    return ((Config.harmonicsControlPoints - 1) * x) / (this.#editorWidth - 8) - 0.5;
  }

  #yToAmp(y: number): number {
    return Config.harmonicsMax * (1 - y / this.#editorHeight);
  }

  #updateMousePos(event: PointerEvent): void {
    const point: Point2d = event.pointer!.getPointInNormalized(this.container);
    this.#mouseX = point.x * this.#editorWidth;
    this.#mouseY = point.y * this.#editorHeight;
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#updateMousePos(event);
    this.#freqPrev = this.#xToFreq(this.#mouseX);
    this.#ampPrev = this.#yToAmp(this.#mouseY);
    this.#whenCursorMoved(event);
  };

  #onPointerMove = (event: PointerEvent): void => {
    this.#updateMousePos(event);
    this.#whenCursorMoved(event);
  };

  #whenCursorMoved(event: PointerEvent): void {
    if (event.pointer!.isDown) {
      const freq: number = this.#xToFreq(this.#mouseX),
        amp: number = this.#yToAmp(this.#mouseY),
        instrument: Instrument =
          this.#doc.song.channels[this.#doc.channel]!.instruments[
            this.#doc.getCurrentInstrument()
          ]!,
        harmonicsWave: HarmonicsWave = instrument.harmonicsWave; //(this._harmonicsIndex == null) ? instrument.harmonicsWave : instrument.drumsetSpectrumWaves[this._harmonicsIndex];

      if (freq !== this.#freqPrev) {
        const slope: number = (amp - this.#ampPrev) / (freq - this.#freqPrev),
          offset: number = this.#ampPrev - this.#freqPrev * slope,
          lowerFreq: number = Math.ceil(Math.min(this.#freqPrev, freq)),
          upperFreq: number = Math.floor(Math.max(this.#freqPrev, freq));
        for (let i: number = lowerFreq; i <= upperFreq; i++) {
          if (i < 0 || i >= Config.harmonicsControlPoints) {
            continue;
          }
          harmonicsWave.harmonics[i] = Math.max(
            0,
            Math.min(Config.harmonicsMax, Math.round(i * slope + offset)),
          );
        }
      }

      harmonicsWave.harmonics[
        Math.max(0, Math.min(Config.harmonicsControlPoints - 1, Math.round(freq)))
      ] = Math.max(0, Math.min(Config.harmonicsMax, Math.round(amp)));

      this.#freqPrev = freq;
      this.#ampPrev = amp;

      this.#change = new ChangeHarmonics(this.#doc, instrument, harmonicsWave);
      this.#doc.setProspectiveChange(this.#change);
    }
  }

  #onPointerUp = (_event: PointerEvent): void => {
    this.#doc.record(this.#change!);
    this.#change = null;
  };

  public render(): void {
    const instrument: Instrument =
        this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!,
      harmonicsWave: HarmonicsWave = instrument.harmonicsWave, //(this._harmonicsIndex == null) ? instrument.harmonicsWave : instrument.drumsetSpectrumWaves[this._harmonicsIndex];
      controlPointToHeight = (point: number): number =>
        (1 - point / Config.harmonicsMax) * this.#editorHeight,
      bottom: string = prettyNumber(this.#editorHeight);
    let path = "";
    for (let i = 0; i < Config.harmonicsControlPoints - 1; i++) {
      if (harmonicsWave.harmonics[i] === 0) {
        continue;
      }
      const xPos: string = prettyNumber(
        ((i + 0.5) * (this.#editorWidth - 8)) / (Config.harmonicsControlPoints - 1),
      );
      path += `M ${xPos} ${bottom} `;
      path += `L ${xPos} ${prettyNumber(controlPointToHeight(harmonicsWave.harmonics[i]!))} `;
    }

    const lastHeight: number = controlPointToHeight(
      harmonicsWave.harmonics[Config.harmonicsControlPoints - 1]!,
    );
    for (let i = 0; i < 4; i++) {
      const rect: SVGRectElement = this.#lastControlPoints[i]!;
      rect.setAttribute("y", prettyNumber(lastHeight));
      rect.setAttribute("height", prettyNumber(this.#editorHeight - lastHeight));
    }

    if (this.#renderedPath !== path) {
      this.#renderedPath = path;
      this.#curve.setAttribute("d", path);
    }
  }
}
