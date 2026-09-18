// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { EasyPointers, type Point2d } from "./easy-pointers.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import type { Instrument, SpectrumWave } from "../synth/synth.js";
import { ChangeSpectrum } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import type { SongDocument } from "./song-document.js";
import { prettyNumber } from "./editor-config.js";

export class SpectrumEditor {
  #doc: SongDocument;
  #spectrumIndex: number | null;
  readonly #editorWidth: number = 120;
  readonly #editorHeight: number = 26;
  readonly #fill: SVGPathElement = SVG.path({
    fill: ColorConfig.uiWidgetBackground,
    "pointer-events": "none",
  });
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
  readonly #arrow: SVGPathElement = SVG.path({
    fill: "currentColor",
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
    this.#fill,
    this.#octaves,
    this.#fifths,
    this.#curve,
    this.#arrow,
  );

  public readonly container: HTMLElement = HTML.div(
    {
      class: "spectrum",
      style: "height: 100%; touch-action: none; cursor: crosshair;",
    },
    this.#svg,
  );

  #mouseX = 0;
  #mouseY = 0;
  #freqPrev = 0;
  #ampPrev = 0;
  #change: ChangeSpectrum | null = null;
  #renderedPath = "";

  public constructor(_doc: SongDocument, _spectrumIndex: number | null) {
    this.#doc = _doc;
    this.#spectrumIndex = _spectrumIndex;
    for (let i = 0; i < Config.spectrumControlPoints; i += Config.spectrumControlPointsPerOctave) {
      this.#octaves.append(
        SVG.rect({
          fill: ColorConfig.tonic,
          x: ((i + 1) * this.#editorWidth) / (Config.spectrumControlPoints + 2) - 1,
          y: 0,
          width: 2,
          height: this.#editorHeight,
        }),
      );
    }
    for (let i = 4; i <= Config.spectrumControlPoints; i += Config.spectrumControlPointsPerOctave) {
      this.#fifths.append(
        SVG.rect({
          fill: ColorConfig.fifthNote,
          x: ((i + 1) * this.#editorWidth) / (Config.spectrumControlPoints + 2) - 1,
          y: 0,
          width: 2,
          height: this.#editorHeight,
        }),
      );
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
    return ((Config.spectrumControlPoints + 2) * x) / this.#editorWidth - 1;
  }

  #yToAmp(y: number): number {
    return Config.spectrumMax * (1 - (y - 1) / (this.#editorHeight - 2));
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
        spectrumWave: SpectrumWave =
          this.#spectrumIndex == null
            ? instrument.spectrumWave
            : instrument.drumsetSpectrumWaves[this.#spectrumIndex]!;

      if (freq !== this.#freqPrev) {
        const slope: number = (amp - this.#ampPrev) / (freq - this.#freqPrev),
          offset: number = this.#ampPrev - this.#freqPrev * slope,
          lowerFreq: number = Math.ceil(Math.min(this.#freqPrev, freq)),
          upperFreq: number = Math.floor(Math.max(this.#freqPrev, freq));
        for (let i: number = lowerFreq; i <= upperFreq; i++) {
          if (i < 0 || i >= Config.spectrumControlPoints) {
            continue;
          }
          spectrumWave.spectrum[i] = Math.max(
            0,
            Math.min(Config.spectrumMax, Math.round(i * slope + offset)),
          );
        }
      }

      spectrumWave.spectrum[
        Math.max(0, Math.min(Config.spectrumControlPoints - 1, Math.round(freq)))
      ] = Math.max(0, Math.min(Config.spectrumMax, Math.round(amp)));

      this.#freqPrev = freq;
      this.#ampPrev = amp;

      this.#change = new ChangeSpectrum(this.#doc, instrument, spectrumWave);
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
      spectrumWave: SpectrumWave =
        this.#spectrumIndex == null
          ? instrument.spectrumWave
          : instrument.drumsetSpectrumWaves[this.#spectrumIndex]!,
      controlPointToHeight = (point: number): number =>
        (1 - point / Config.spectrumMax) * (this.#editorHeight - 1) + 1;

    let lastValue = 0,
      path = `M 0 ${prettyNumber(this.#editorHeight)} `;
    for (let i = 0; i < Config.spectrumControlPoints; i++) {
      const nextValue: number = spectrumWave.spectrum[i]!;
      if (lastValue !== 0 || nextValue !== 0) {
        path += "L ";
      } else {
        path += "M ";
      }
      path += `${prettyNumber(
        ((i + 1) * this.#editorWidth) / (Config.spectrumControlPoints + 2),
      )} ${prettyNumber(controlPointToHeight(nextValue))} `;
      lastValue = nextValue;
    }

    const lastHeight: number = controlPointToHeight(lastValue);
    if (lastValue > 0) {
      path += `L ${this.#editorWidth - 1} ${prettyNumber(lastHeight)} `;
    }

    if (this.#renderedPath !== path) {
      this.#renderedPath = path;
      this.#curve.setAttribute("d", path);
      this.#fill.setAttribute(
        "d",
        `${path}L ${this.#editorWidth} ${prettyNumber(lastHeight)} L ${
          this.#editorWidth
        } ${prettyNumber(this.#editorHeight)} L 0 ${prettyNumber(this.#editorHeight)} z `,
      );

      this.#arrow.setAttribute(
        "d",
        `M ${this.#editorWidth} ${prettyNumber(lastHeight)} L ${
          this.#editorWidth - 4
        } ${prettyNumber(lastHeight - 4)} L ${this.#editorWidth - 4} ${prettyNumber(
          lastHeight + 4,
        )} z`,
      );
      this.#arrow.style.display = lastValue > 0 ? "" : "none";
    }
  }
}
