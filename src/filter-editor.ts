// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeFilterAddPoint, ChangeFilterMovePoint } from "./changes.js";
import { ChangeSequence, type UndoableChange } from "./change.js";
import { Config, FilterType } from "../synth/synth-config.js";
import { EasyPointers, type Point2d } from "./easy-pointers.js";
import { FilterCoefficients, FrequencyResponse } from "../synth/filtering.js";
import { FilterControlPoint, type FilterSettings, type Instrument } from "../synth/synth.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { ColorConfig } from "./color-config.js";
import type { SongDocument } from "./song-document.js";
import { prettyNumber } from "./editor-config.js";

export class FilterEditor {
  #doc: SongDocument;
  readonly #editorWidth: number = 120;
  readonly #editorHeight: number = 26;
  readonly #pointRadius: number = 2;
  readonly #responsePath: SVGPathElement = SVG.path({
    fill: ColorConfig.uiWidgetBackground,
    "pointer-events": "none",
  });
  //Private readonly _octaves: SVGSVGElement = SVG.svg({"pointer-events": "none", overflow: "visible"});
  readonly #controlPointPath: SVGPathElement = SVG.path({
    fill: "currentColor",
    "pointer-events": "none",
  });
  readonly #dottedLinePath: SVGPathElement = SVG.path({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1,
    "stroke-dasharray": "3, 2",
    "pointer-events": "none",
  });
  readonly #highlight: SVGCircleElement = SVG.circle({
    fill: "white",
    stroke: "none",
    "pointer-events": "none",
    r: 4,
  });
  readonly #svg: SVGSVGElement = SVG.svg(
    {
      style: `background-color: ${ColorConfig.background};`,
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${this.#editorWidth} ${this.#editorHeight}`,
      preserveAspectRatio: "none",
    },
    this.#responsePath,
    //This._octaves,
    this.#dottedLinePath,
    this.#highlight,
    this.#controlPointPath,
  );
  readonly #label: HTMLDivElement = HTML.div({
    style:
      "position: absolute; bottom: 0; left: 2px; font-size: 8px; line-height: 1; pointer-events: none;",
  });

  public readonly container: HTMLElement = HTML.div(
    {
      class: "filterEditor",
      style: "height: 100%; position: relative; touch-action: none;",
    },
    this.#svg,
    this.#label,
  );

  readonly #pointers: EasyPointers = new EasyPointers(this.container, {
    preventTouchGestureScrolling: true,
  });

  #useNoteFilter = false;
  #touchMode = false;
  #mouseX = 0;
  #mouseY = 0;
  #mouseDown = false;
  #mouseDragging = false;
  #addingPoint = false;
  #deletingPoint = false;
  #addedType: FilterType = FilterType.peak;
  #selectedIndex = 0;
  #freqStart = 0;
  #gainStart = 0;
  #dragChange: UndoableChange | null = null;

  #filterSettings!: FilterSettings;
  #renderedSelectedIndex = -1;
  #renderedPointCount = -1;
  #renderedPointTypes = -1;
  #renderedPointFreqs = -1;
  #renderedPointGains = -1;
  //Private _renderedKey: number = -1;

  public constructor(_doc: SongDocument, useNoteFilter = false) {
    this.#doc = _doc;
    this.#useNoteFilter = useNoteFilter;
    /*
		For (let i: number = 0; i < Config.filterFreqRange * Config.filterFreqStep; i++) {
			this._octaves.appendChild(SVG.rect({fill: ColorConfig.tonic, x: i * this._editorWidth / (Config.filterFreqRange * Config.filterFreqStep) - 0.5, y: 0, width: 1, height: this._editorHeight}));
		}
		*/
    this.container.addEventListener("pointerenter", this.#onPointerMove);
    this.container.addEventListener("pointerleave", this.#onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerUp);
  }

  #xToFreq(x: number): number {
    return (Config.filterFreqRange * x) / this.#editorWidth - 0.5;
  }
  #freqToX(freq: number): number {
    return (this.#editorWidth * (freq + 0.5)) / Config.filterFreqRange;
  }
  #yToGain(y: number): number {
    return (Config.filterGainRange - 1) * (1 - (y - 0.5) / (this.#editorHeight - 1));
  }
  #gainToY(gain: number): number {
    return (this.#editorHeight - 1) * (1 - gain / (Config.filterGainRange - 1)) + 0.5;
  }

  #onPointerLeave = (_event: PointerEvent): void => {
    this.#updatePath();
  };

  #updateMousePos(event: PointerEvent): void {
    const point: Point2d = event.pointer!.getPointInNormalized(this.container);
    this.#mouseX = point.x * this.#editorWidth;
    this.#mouseY = point.y * this.#editorHeight;
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#mouseDown = true;
    this.#touchMode = event.pointer!.isTouch;
    this.#updateMousePos(event);
    const sequence: ChangeSequence = new ChangeSequence();
    this.#dragChange = sequence;
    this.#doc.setProspectiveChange(this.#dragChange);
    this.#updateCursor();
    this.#whenCursorMoved(event);
  };

  #updateCursor(): void {
    this.#freqStart = this.#xToFreq(this.#mouseX);
    this.#gainStart = this.#yToGain(this.#mouseY);

    this.#addingPoint = true;
    this.#selectedIndex = -1;
    let nearestDistance: number = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#filterSettings.controlPointCount; i++) {
      const point: FilterControlPoint = this.#filterSettings.controlPoints[i]!,
        distance: number = Math.sqrt(
          (this.#freqToX(point.freq) - this.#mouseX) ** 2 +
            (this.#gainToY(point.gain) - this.#mouseY) ** 2,
        );
      if (
        (distance <= 13 || this.#filterSettings.controlPointCount >= Config.filterMaxPoints) &&
        distance < nearestDistance
      ) {
        nearestDistance = distance;
        this.#selectedIndex = i;
        this.#addingPoint = false;
      }
    }
    if (this.#addingPoint) {
      const ratio: number = this.#mouseX / this.#editorWidth;
      if (ratio < 0.2) {
        this.#addedType = FilterType.highPass;
      } else if (ratio < 0.8) {
        this.#addedType = FilterType.peak;
      } else {
        this.#addedType = FilterType.lowPass;
      }
    }
  }

  #onPointerMove = (event: PointerEvent): void => {
    this.#updateMousePos(event);
    if (!this.#mouseDown) {
      this.#updateCursor();
    }
    this.#whenCursorMoved(event);
  };

  #whenCursorMoved(_event: PointerEvent): void {
    if (this.#dragChange != null && this.#doc.lastChangeWas(this.#dragChange)) {
      this.#dragChange.undo();
    } else {
      this.#mouseDown = false;
    }
    this.#dragChange = null;
    this.#deletingPoint = false;

    if (this.#mouseDown) {
      const sequence: ChangeSequence = new ChangeSequence();
      this.#dragChange = sequence;
      this.#doc.setProspectiveChange(this.#dragChange);

      if (this.#addingPoint) {
        const gain: number = Math.max(
            0,
            Math.min(Config.filterGainRange - 1, Math.round(this.#yToGain(this.#mouseY))),
          ),
          freq: number = this.#findNearestFreqSlot(
            this.#filterSettings,
            this.#xToFreq(this.#mouseX),
            -1,
          );
        if (freq >= 0 && freq < Config.filterFreqRange) {
          const point: FilterControlPoint = new FilterControlPoint();
          point.type = this.#addedType;
          point.freq = freq;
          point.gain = gain;
          sequence.append(
            new ChangeFilterAddPoint(
              this.#doc,
              this.#filterSettings,
              point,
              this.#filterSettings.controlPointCount,
              this.#useNoteFilter,
            ),
          );
        } else {
          this.#deletingPoint = true;
        }
      } else if (
        this.#selectedIndex >= this.#filterSettings.controlPointCount ||
        this.#selectedIndex === -1
      ) {
        this.#dragChange = null;
        this.#mouseDown = false;
      } else {
        const freqDelta: number = this.#xToFreq(this.#mouseX) - this.#freqStart,
          gainDelta: number = this.#yToGain(this.#mouseY) - this.#gainStart,
          point: FilterControlPoint = this.#filterSettings.controlPoints[this.#selectedIndex]!,
          gain: number = Math.max(
            0,
            Math.min(Config.filterGainRange - 1, Math.round(point.gain + gainDelta)),
          ),
          freq: number = this.#findNearestFreqSlot(
            this.#filterSettings,
            point.freq + freqDelta,
            this.#selectedIndex,
          );

        if (
          Math.round(freqDelta) !== 0.0 ||
          Math.round(gainDelta) !== 0.0 ||
          freq !== point.freq ||
          gain !== point.gain
        ) {
          this.#mouseDragging = true;
        }

        if (freq >= 0 && freq < Config.filterFreqRange) {
          sequence.append(
            new ChangeFilterMovePoint(this.#doc, point, point.freq, freq, point.gain, gain),
          );
        } else {
          sequence.append(
            new ChangeFilterAddPoint(
              this.#doc,
              this.#filterSettings,
              point,
              this.#selectedIndex,
              this.#useNoteFilter,
              true,
            ),
          );
          this.#deletingPoint = true;
        }
      }
    }
    this.#updatePath();
  }

  #onPointerUp = (_event: PointerEvent): void => {
    if (this.#mouseDown && this.#doc.lastChangeWas(this.#dragChange) && this.#dragChange != null) {
      if (!this.#addingPoint && !this.#mouseDragging && !this.#touchMode) {
        if (
          this.#selectedIndex < this.#filterSettings.controlPointCount &&
          this.#selectedIndex !== -1
        ) {
          const point: FilterControlPoint =
            this.#filterSettings.controlPoints[this.#selectedIndex]!;
          this.#doc.record(
            new ChangeFilterAddPoint(
              this.#doc,
              this.#filterSettings,
              point,
              this.#selectedIndex,
              this.#useNoteFilter,
              true,
            ),
          );
        }
      } else {
        this.#doc.record(this.#dragChange);
      }
      this.#updatePath();
    }
    this.#dragChange = null;
    this.#mouseDragging = false;
    this.#deletingPoint = false;
    this.#mouseDown = false;
    this.#updateCursor();
  };

  #findNearestFreqSlot(
    filterSettings: FilterSettings,
    targetFreq: number,
    ignoreIndex: number,
  ): number {
    const roundedFreq: number = Math.round(targetFreq);
    let lowerFreq: number = roundedFreq,
      upperFreq: number = roundedFreq,
      tryingLower: boolean = roundedFreq <= targetFreq;
    while (true) {
      let foundConflict = false;
      const currentFreq: number = tryingLower ? lowerFreq : upperFreq;
      for (let i = 0; i < filterSettings.controlPointCount; i++) {
        if (i === ignoreIndex) {
          continue;
        }
        if (filterSettings.controlPoints[i]!.freq === currentFreq) {
          foundConflict = true;
          break;
        }
      }
      if (!foundConflict) {
        return currentFreq;
      }
      tryingLower = !tryingLower;
      if (tryingLower) {
        lowerFreq--;
      }
      if (!tryingLower) {
        upperFreq++;
      }
    }
  }

  static #circlePath(cx: number, cy: number, radius: number, reverse = false): string {
    return (
      `M ${cx - radius} ${cy} ` +
      `a ${radius} ${radius} 0 1 ${reverse ? 1 : 0} ${radius * 2} 0 ` +
      `a ${radius} ${radius} 0 1 ${reverse ? 1 : 0} ${-radius * 2} 0 `
    );
  }

  #updatePath(): void {
    this.#highlight.style.display = "none";
    this.#label.textContent = "";

    let controlPointPath = "",
      dottedLinePath = "";
    for (let i = 0; i < this.#filterSettings.controlPointCount; i++) {
      const point: FilterControlPoint = this.#filterSettings.controlPoints[i]!,
        pointX: number = this.#freqToX(point.freq),
        pointY: number = this.#gainToY(point.gain);

      controlPointPath += FilterEditor.#circlePath(pointX, pointY, this.#pointRadius);

      if (point.type === FilterType.highPass) {
        dottedLinePath += `M ${0} ${pointY} L ${pointX} ${pointY} `;
      } else if (point.type === FilterType.lowPass) {
        dottedLinePath += `M ${this.#editorWidth} ${pointY} L ${pointX} ${pointY} `;
      }

      if (this.#selectedIndex === i && this.#pointers.latest.isHovering) {
        this.#highlight.setAttribute("cx", String(pointX));
        this.#highlight.setAttribute("cy", String(pointY));
        this.#highlight.style.display = "";
      }
      if (
        (this.#selectedIndex === i ||
          (this.#addingPoint &&
            this.#mouseDown &&
            i === this.#filterSettings.controlPointCount - 1)) &&
        this.#pointers.latest.isPresent &&
        !this.#deletingPoint
      ) {
        this.#label.textContent = `${i + 1}: ${Config.filterTypeNames[point.type]!}`; // + " " + prettyNumber(point.getHz()) + "Hz";
      }
    }
    this.#controlPointPath.setAttribute("d", controlPointPath);
    this.#dottedLinePath.setAttribute("d", dottedLinePath);
    if (this.#addingPoint && this.#pointers.latest.isHovering) {
      this.#label.textContent = `+ ${Config.filterTypeNames[this.#addedType]!}`;
    }

    //Let volumeCompensation: number = 1.0;
    const standardSampleRate = 44_800,
      filters: FilterCoefficients[] = [];
    for (let i = 0; i < this.#filterSettings.controlPointCount; i++) {
      const point: FilterControlPoint = this.#filterSettings.controlPoints[i]!,
        filter: FilterCoefficients = new FilterCoefficients();
      point.toCoefficients(filter, standardSampleRate);
      filters.push(filter);
      //VolumeCompensation *= point.getVolumeCompensationMult();
    }

    const response: FrequencyResponse = new FrequencyResponse();
    let responsePath = `M 0 ${this.#editorHeight} `;
    for (let i = -1; i <= Config.filterFreqRange; i++) {
      const hz: number = FilterControlPoint.getHzFromSettingValue(i),
        cornerRadiansPerSample: number = (2.0 * Math.PI * hz) / standardSampleRate,
        real: number = Math.cos(cornerRadiansPerSample),
        imag: number = Math.sin(cornerRadiansPerSample);

      let linearGain = 1.0; //VolumeCompensation;
      for (const filter of filters) {
        response.analyzeComplex(filter, real, imag);
        linearGain *= response.magnitude();
      }

      const gainSetting: number =
          Math.log2(linearGain) / Config.filterGainStep + Config.filterGainCenter,
        y: number = this.#gainToY(gainSetting),
        x: number = this.#freqToX(i);
      responsePath += `L ${prettyNumber(x)} ${prettyNumber(y)} `;
    }

    responsePath += `L ${this.#editorWidth} ${this.#editorHeight} L 0 ${this.#editorHeight} z `;
    this.#responsePath.setAttribute("d", responsePath);
  }

  public render(): void {
    const instrument: Instrument =
        this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!,
      filterSettings: FilterSettings = this.#useNoteFilter
        ? instrument.noteFilter
        : instrument.eqFilter;
    if (this.#filterSettings !== filterSettings) {
      this.#dragChange = null;
      this.#mouseDown = false;
    }
    this.#filterSettings = filterSettings;
    if (!this.#mouseDown) {
      this.#updateCursor();
    }

    let pointTypes = 0,
      pointFreqs = 0,
      pointGains = 0;
    for (let i = 0; i < filterSettings.controlPointCount; i++) {
      const point: FilterControlPoint = filterSettings.controlPoints[i]!;
      pointTypes = pointTypes * FilterType.length + point.type;
      pointFreqs = pointFreqs * Config.filterFreqRange + point.freq;
      pointGains = pointGains * Config.filterGainRange + point.gain;
    }
    if (
      this.#renderedSelectedIndex !== this.#selectedIndex ||
      this.#renderedPointCount !== filterSettings.controlPointCount ||
      this.#renderedPointTypes !== pointTypes ||
      this.#renderedPointFreqs !== pointFreqs ||
      this.#renderedPointGains !== pointGains
    ) {
      this.#renderedSelectedIndex = this.#selectedIndex;
      this.#renderedPointCount = filterSettings.controlPointCount;
      this.#renderedPointTypes = pointTypes;
      this.#renderedPointFreqs = pointFreqs;
      this.#renderedPointGains = pointGains;
      this.#updatePath();
    }

    /*
		If (this._renderedKey != this._doc.song.key) {
			this._renderedKey = this._doc.song.key;
			const tonicHz: number = Instrument.frequencyFromPitch(Config.keys[this._doc.song.key].basePitch);
			const x: number = this._freqToX(FilterControlPoint.getSettingValueFromHz(tonicHz));
			this._octaves.setAttribute("x", String(x));
		}
		*/
  }
}
