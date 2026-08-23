import { Config } from "../synth/SynthConfig.js";
import { type ChipWaveSettings, Instrument } from "../synth/synth.js";
import type { SampleAssetData } from "../synth/SynthController.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { SongDocument } from "./SongDocument.js";
import type { Prompt } from "./Prompt.js";
import { ChangeChipWaveLoop } from "./changes.js";

const { button, canvas, dialog, div, h2, input, label, span } = HTML;

type Marker = "offset" | "loopStart" | "loopEnd";

const markerRows: ReadonlyArray<{
  readonly marker: Marker;
  readonly centerY: number;
  readonly endY: number;
}> = [
  { marker: "offset", centerY: 14, endY: 24 },
  { marker: "loopStart", centerY: 34, endY: 44 },
  { marker: "loopEnd", centerY: 54, endY: 64 },
];
const waveformTop: number = 68;

export class ChipWaveLoopPrompt implements Prompt {
  public readonly pausePlayback: boolean = false;
  private readonly _canvas: HTMLCanvasElement = canvas({
    class: "chip-wave-loop-canvas",
    "aria-label": "Sample waveform with draggable offset and loop markers",
  });
  private readonly _offsetInput: HTMLInputElement = this._makePositionInput(
    "Sample offset",
  );
  private readonly _loopStartInput: HTMLInputElement = this._makePositionInput(
    "Loop start",
  );
  private readonly _loopEndInput: HTMLInputElement = this._makePositionInput(
    "Loop end",
  );
  private readonly _oneshotInput: HTMLInputElement = input({
    type: "checkbox",
    title: "One-shot",
  });
  private readonly _status: HTMLDivElement = div({
    class: "chip-wave-loop-status",
  });
  private readonly _zoomOutButton: HTMLButtonElement = button(
    { type: "button", title: "Zoom out", "aria-label": "Zoom out" },
    "-",
  );
  private readonly _zoomInButton: HTMLButtonElement = button(
    { type: "button", title: "Zoom in", "aria-label": "Zoom in" },
    "+",
  );
  private readonly _resetZoomButton: HTMLButtonElement = button(
    { type: "button" },
    "Fit",
  );
  private readonly _cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    title: "Cancel",
    "aria-label": "Cancel",
  });
  private readonly _okayButton: HTMLButtonElement = button(
    { class: "okayButton", type: "button" },
    "Okay",
  );

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt chipWaveLoopPrompt" },
    h2("Chip Wave Loop"),
    div(
      { class: "chip-wave-loop-viewer" },
      div(
        { class: "chip-wave-loop-toolbar" },
        span("Drag markers or the waveform. Scroll to zoom."),
        div(
          this._zoomOutButton,
          this._resetZoomButton,
          this._zoomInButton,
        ),
      ),
      div({ class: "chip-wave-loop-canvas-container" }, this._canvas),
    ),
    div(
      { class: "chip-wave-loop-fields" },
      label(span("Offset"), this._offsetInput),
      label(span("Loop start"), this._loopStartInput),
      label(span("Loop end"), this._loopEndInput),
      label(
        { class: "chip-wave-oneshot" },
        this._oneshotInput,
        span("One-shot"),
      ),
    ),
    this._status,
    div({ class: "chip-wave-loop-actions" }, this._okayButton),
    this._cancelButton,
  );

  private readonly _sampleId: string;
  private readonly _initialSettings: ChipWaveSettings;
  private readonly _resizeObserver: ResizeObserver;
  private _sampleData: SampleAssetData | null = null;
  private _offset: number = 0;
  private _loopStart: number = 0;
  private _loopEnd: number = 1;
  private _viewStart: number = 0;
  private _viewEnd: number = 1;
  private _dragMarker: Marker | null = null;
  private _panning: boolean = false;
  private _pointerId: number | null = null;
  private _pointerStartX: number = 0;
  private _panStart: number = 0;

  constructor(
    private readonly _doc: SongDocument,
    private readonly _operatorIndex: number | null,
  ) {
    const instrument: Instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
    this._initialSettings =
      this._operatorIndex == null
        ? instrument.chipWaveSettings
        : instrument.operators[this._operatorIndex].chipWaveSettings;
    const waveIndex: number =
      this._operatorIndex == null
        ? instrument.chipWave
        : instrument.operators[this._operatorIndex].wave - 1;
    const sampleId: string | undefined = Config.chipWaves[waveIndex]?.sampleId;
    if (sampleId == undefined)
      throw new Error("Chip wave loop controls require a sample asset.");
    this._sampleId = sampleId;
    this._oneshotInput.checked = this._initialSettings.oneshot;

    this._resizeObserver = new ResizeObserver(this._draw);
    this._resizeObserver.observe(this._canvas);
    this._doc.synth.assetLoadEvents.addEventListener(
      "change",
      this._whenAssetStateChanged,
    );
    this._canvas.addEventListener("pointerdown", this._onPointerDown);
    this._canvas.addEventListener("pointermove", this._onPointerMove);
    this._canvas.addEventListener("pointerup", this._onPointerUp);
    this._canvas.addEventListener("pointercancel", this._onPointerUp);
    this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
    this._canvas.addEventListener("dblclick", this._fitView);
    this._offsetInput.addEventListener("input", this._whenInputChanged);
    this._loopStartInput.addEventListener("input", this._whenInputChanged);
    this._loopEndInput.addEventListener("input", this._whenInputChanged);
    this._zoomOutButton.addEventListener("click", this._zoomOut);
    this._zoomInButton.addEventListener("click", this._zoomIn);
    this._resetZoomButton.addEventListener("click", this._fitView);
    this._okayButton.addEventListener("click", this._save);
    this._cancelButton.addEventListener("click", this._close);
    this._loadSampleData();
    setTimeout(() => this._offsetInput.focus());
  }

  private _makePositionInput(title: string): HTMLInputElement {
    return input({
      type: "number",
      min: "0",
      max: "0",
      step: "1",
      value: "0",
      title,
      inputMode: "numeric",
    });
  }

  private _loadSampleData(): void {
    const data: SampleAssetData | null =
      this._doc.synth.getSampleAsset(this._sampleId);
    if (data == null) {
      const status = this._doc.synth.getAssetLoadStatus(this._sampleId);
      this._status.textContent =
        status == "error"
          ? `Failed to load sample: ${this._doc.synth.getAssetLoadError(this._sampleId) ?? "Unknown error"}`
          : "Loading sample waveform...";
      this._okayButton.disabled = true;
      return;
    }
    if (this._sampleData != null) return;
    if (data.samples.length == 0) {
      this._status.textContent = "The sample contains no audio frames.";
      this._okayButton.disabled = true;
      return;
    }
    this._sampleData = data;
    const length: number = data.samples.length;
    this._offset = Math.round(this._initialSettings.offset * length);
    this._loopStart = Math.round(this._initialSettings.loopStart * length);
    this._loopEnd = Math.round(this._initialSettings.loopEnd * length);
    this._normalizePositions("loopEnd");
    this._viewStart = 0;
    this._viewEnd = length;
    for (const positionInput of [
      this._offsetInput,
      this._loopStartInput,
      this._loopEndInput,
    ])
      positionInput.max = String(length);
    this._status.textContent = `${length.toLocaleString()} samples at ${data.sampleRate.toLocaleString()} Hz`;
    this._okayButton.disabled = false;
    this._syncInputs();
    this._draw();
  }

  private _normalizePositions(changed: Marker): void {
    const length: number = this._sampleData?.samples.length ?? 1;
    this._offset = Math.round(Math.max(0, Math.min(length, this._offset)));
    this._loopStart = Math.round(
      Math.max(0, Math.min(length, this._loopStart)),
    );
    this._loopEnd = Math.round(Math.max(0, Math.min(length, this._loopEnd)));
    if (changed == "loopStart") {
      this._loopStart = Math.min(
        Math.max(0, length - 1),
        this._loopStart,
      );
      this._loopEnd = Math.max(this._loopStart + 1, this._loopEnd);
    } else if (changed == "loopEnd") {
      this._loopEnd = Math.max(this._loopStart + 1, this._loopEnd);
      if (this._loopEnd > length) {
        this._loopEnd = length;
        this._loopStart = Math.min(this._loopStart, Math.max(0, length - 1));
      }
    }
  }

  private _syncInputs(): void {
    this._offsetInput.value = String(this._offset);
    this._loopStartInput.value = String(this._loopStart);
    this._loopEndInput.value = String(this._loopEnd);
  }

  private _whenInputChanged = (event: Event): void => {
    if (this._sampleData == null) return;
    const target: HTMLInputElement = event.currentTarget as HTMLInputElement;
    const value: number = Number(target.value);
    if (!Number.isFinite(value)) return;
    let changed: Marker;
    if (target == this._offsetInput) {
      this._offset = value;
      changed = "offset";
    } else if (target == this._loopStartInput) {
      this._loopStart = value;
      changed = "loopStart";
    } else {
      this._loopEnd = value;
      changed = "loopEnd";
    }
    this._normalizePositions(changed);
    this._syncInputs();
    this._draw();
  };

  private _getCanvasPoint(event: PointerEvent | WheelEvent): {
    x: number;
    y: number;
  } {
    const bounds: DOMRect = this._canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private _sampleToX(sample: number, width: number): number {
    return ((sample - this._viewStart) * width) / (this._viewEnd - this._viewStart);
  }

  private _xToSample(x: number, width: number): number {
    return (
      this._viewStart +
      (Math.max(0, Math.min(width, x)) / width) *
        (this._viewEnd - this._viewStart)
    );
  }

  private _pickMarkerRow(y: number): Marker | null {
    if (y < 0) return null;
    for (const row of markerRows) {
      if (y < row.endY) return row.marker;
    }
    return null;
  }

  private _pickMarker(x: number, y: number, width: number): Marker | null {
    const rowMarker: Marker | null = this._pickMarkerRow(y);
    if (rowMarker != null) return rowMarker;
    if (y < waveformTop) return null;
    const markers: Array<{ marker: Marker; sample: number }> = [
      { marker: "offset", sample: this._offset },
      { marker: "loopStart", sample: this._loopStart },
      { marker: "loopEnd", sample: this._loopEnd },
    ];
    let best: Marker | null = null;
    let bestDistance: number = Infinity;
    for (const marker of markers) {
      const xDistance: number = Math.abs(
        x - this._sampleToX(marker.sample, width),
      );
      if (xDistance <= 5 && xDistance < bestDistance) {
        best = marker.marker;
        bestDistance = xDistance;
      }
    }
    return best;
  }

  private _setMarker(marker: Marker, value: number): void {
    if (marker == "offset") this._offset = value;
    else if (marker == "loopStart") this._loopStart = value;
    else this._loopEnd = value;
    this._normalizePositions(marker);
    this._syncInputs();
  }

  private _onPointerDown = (event: PointerEvent): void => {
    if (this._sampleData == null || event.button != 0) return;
    const point = this._getCanvasPoint(event);
    const width: number = this._canvas.getBoundingClientRect().width;
    const rowMarker: Marker | null = this._pickMarkerRow(point.y);
    this._dragMarker = rowMarker ?? this._pickMarker(point.x, point.y, width);
    this._panning = this._dragMarker == null && point.y >= waveformTop;
    if (this._dragMarker == null && !this._panning) return;
    this._pointerId = event.pointerId;
    this._pointerStartX = point.x;
    this._panStart = this._viewStart;
    if (rowMarker != null) {
      this._setMarker(
        rowMarker,
        Math.round(this._xToSample(point.x, width)),
      );
      this._draw();
    }
    this._canvas.setPointerCapture(event.pointerId);
    this._canvas.style.cursor = this._panning ? "grabbing" : "ew-resize";
    event.preventDefault();
  };

  private _onPointerMove = (event: PointerEvent): void => {
    if (this._sampleData == null) return;
    const point = this._getCanvasPoint(event);
    const width: number = this._canvas.getBoundingClientRect().width;
    if (this._pointerId != event.pointerId) {
      const marker: Marker | null = this._pickMarker(
        point.x,
        point.y,
        width,
      );
      this._canvas.style.cursor =
        marker != null
          ? "ew-resize"
          : point.y >= waveformTop
            ? "grab"
            : "default";
      return;
    }
    if (this._dragMarker != null) {
      this._setMarker(
        this._dragMarker,
        Math.round(this._xToSample(point.x, width)),
      );
    } else if (this._panning) {
      const length: number = this._sampleData.samples.length;
      const span: number = this._viewEnd - this._viewStart;
      const delta: number =
        ((this._pointerStartX - point.x) * span) / Math.max(1, width);
      this._viewStart = Math.max(
        0,
        Math.min(length - span, this._panStart + delta),
      );
      this._viewEnd = this._viewStart + span;
    }
    this._draw();
  };

  private _onPointerUp = (event: PointerEvent): void => {
    if (this._pointerId != event.pointerId) return;
    this._pointerId = null;
    this._dragMarker = null;
    this._panning = false;
    const point = this._getCanvasPoint(event);
    const width: number = this._canvas.getBoundingClientRect().width;
    this._canvas.style.cursor =
      this._pickMarker(point.x, point.y, width) != null
        ? "ew-resize"
        : point.y >= waveformTop
          ? "grab"
          : "default";
  };

  private _zoomAt(x: number, factor: number): void {
    if (this._sampleData == null) return;
    const length: number = this._sampleData.samples.length;
    const width: number = this._canvas.getBoundingClientRect().width;
    const oldSpan: number = this._viewEnd - this._viewStart;
    const newSpan: number = Math.max(
      Math.min(length, 32),
      Math.min(length, oldSpan * factor),
    );
    const anchor: number = this._xToSample(x, width);
    const ratio: number = Math.max(0, Math.min(1, x / Math.max(1, width)));
    this._viewStart = Math.max(
      0,
      Math.min(length - newSpan, anchor - newSpan * ratio),
    );
    this._viewEnd = this._viewStart + newSpan;
    this._draw();
  }

  private _onWheel = (event: WheelEvent): void => {
    if (this._sampleData == null) return;
    event.preventDefault();
    this._zoomAt(this._getCanvasPoint(event).x, event.deltaY > 0 ? 1.25 : 0.8);
  };

  private _zoomOut = (): void => this._zoomAt(
    this._canvas.getBoundingClientRect().width / 2,
    2,
  );
  private _zoomIn = (): void => this._zoomAt(
    this._canvas.getBoundingClientRect().width / 2,
    0.5,
  );
  private _fitView = (): void => {
    if (this._sampleData == null) return;
    this._viewStart = 0;
    this._viewEnd = this._sampleData.samples.length;
    this._draw();
  };

  private _draw = (): void => {
    const bounds: DOMRect = this._canvas.getBoundingClientRect();
    const width: number = Math.max(1, bounds.width);
    const height: number = Math.max(1, bounds.height);
    const pixelRatio: number = window.devicePixelRatio || 1;
    const pixelWidth: number = Math.round(width * pixelRatio);
    const pixelHeight: number = Math.round(height * pixelRatio);
    if (this._canvas.width != pixelWidth) this._canvas.width = pixelWidth;
    if (this._canvas.height != pixelHeight) this._canvas.height = pixelHeight;
    const context: CanvasRenderingContext2D | null = this._canvas.getContext("2d");
    if (context == null) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const styles: CSSStyleDeclaration = getComputedStyle(this.container);
    const background: string = styles.getPropertyValue("--background").trim();
    const widget: string = styles
      .getPropertyValue("--ui-widget-background")
      .trim();
    const text: string = styles.getPropertyValue("--text").trim();
    context.fillStyle = background || "#111";
    context.fillRect(0, 0, width, height);
    context.fillStyle = widget || "#444";
    const markerAreaBottom: number = markerRows[markerRows.length - 1].endY;
    context.fillRect(0, markerAreaBottom, width, height - markerAreaBottom);

    if (this._sampleData == null) return;
    const samples: Float32Array = this._sampleData.samples;
    const waveformHeight: number = height - waveformTop - 4;
    const middle: number = waveformTop + waveformHeight / 2;
    const amplitude: number = Math.max(1, waveformHeight / 2 - 2);
    const offsetX: number = this._sampleToX(this._offset, width);
    const loopStartX: number = this._sampleToX(this._loopStart, width);
    const loopEndX: number = this._sampleToX(this._loopEnd, width);
    context.fillStyle = "rgb(42 157 143 / 14%)";
    context.fillRect(
      Math.max(0, loopStartX),
      waveformTop,
      Math.max(0, Math.min(width, loopEndX) - Math.max(0, loopStartX)),
      waveformHeight,
    );
    context.strokeStyle = text || "#ddd";
    context.globalAlpha = 0.3;
    context.beginPath();
    context.moveTo(0, middle + 0.5);
    context.lineTo(width, middle + 0.5);
    context.stroke();
    context.globalAlpha = 1;

    context.strokeStyle = text || "#ddd";
    context.beginPath();
    for (let x: number = 0; x < width; x++) {
      const sampleStart: number = Math.max(
        0,
        Math.floor(this._xToSample(x, width)),
      );
      const sampleEnd: number = Math.min(
        samples.length,
        Math.max(sampleStart + 1, Math.ceil(this._xToSample(x + 1, width))),
      );
      let minimum: number = 1;
      let maximum: number = -1;
      const sampleStep: number = Math.max(
        1,
        Math.floor((sampleEnd - sampleStart) / 64),
      );
      for (
        let index: number = sampleStart;
        index < sampleEnd;
        index += sampleStep
      ) {
        minimum = Math.min(minimum, samples[index]);
        maximum = Math.max(maximum, samples[index]);
      }
      context.moveTo(x + 0.5, middle - maximum * amplitude);
      context.lineTo(x + 0.5, middle - minimum * amplitude);
    }
    context.stroke();

    const drawMarker = (
      marker: Marker,
      markerX: number,
      markerY: number,
      color: string,
    ): void => {
      if (markerX < -20 || markerX > width + 20) return;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(markerX, markerY + 7);
      context.lineTo(markerX, height);
      context.stroke();
      context.beginPath();
      if (marker == "offset") {
        context.moveTo(markerX - 6, markerY - 6);
        context.lineTo(markerX + 6, markerY - 6);
        context.lineTo(markerX, markerY + 6);
      } else {
        const direction: number = marker == "loopStart" ? 1 : -1;
        context.moveTo(markerX - 6 * direction, markerY - 6);
        context.lineTo(markerX, markerY - 6);
        context.lineTo(markerX + 6 * direction, markerY);
        context.lineTo(markerX, markerY + 6);
        context.lineTo(markerX - 6 * direction, markerY + 6);
      }
      context.closePath();
      context.fill();
    };
    drawMarker("offset", offsetX, markerRows[0].centerY, "#f4a261");
    drawMarker("loopStart", loopStartX, markerRows[1].centerY, "#2a9d8f");
    drawMarker("loopEnd", loopEndX, markerRows[2].centerY, "#e76f51");
  };

  private _save = (): void => {
    if (this._sampleData == null) return;
    const length: number = this._sampleData.samples.length;
    const change = new ChangeChipWaveLoop(this._doc, this._operatorIndex, {
      offset: this._offset / length,
      loopStart: this._loopStart / length,
      loopEnd: this._loopEnd / length,
      oneshot: this._oneshotInput.checked,
    });
    this._doc.closePrompt();
    this._doc.record(change);
  };

  private _whenAssetStateChanged = (): void => this._loadSampleData();
  private _close = (): void => this._doc.closePrompt();

  public cleanUp = (): void => {
    this._resizeObserver.disconnect();
    this._doc.synth.assetLoadEvents.removeEventListener(
      "change",
      this._whenAssetStateChanged,
    );
    this._canvas.removeEventListener("pointerdown", this._onPointerDown);
    this._canvas.removeEventListener("pointermove", this._onPointerMove);
    this._canvas.removeEventListener("pointerup", this._onPointerUp);
    this._canvas.removeEventListener("pointercancel", this._onPointerUp);
    this._canvas.removeEventListener("wheel", this._onWheel);
    this._canvas.removeEventListener("dblclick", this._fitView);
    this._offsetInput.removeEventListener("input", this._whenInputChanged);
    this._loopStartInput.removeEventListener("input", this._whenInputChanged);
    this._loopEndInput.removeEventListener("input", this._whenInputChanged);
    this._zoomOutButton.removeEventListener("click", this._zoomOut);
    this._zoomInButton.removeEventListener("click", this._zoomIn);
    this._resetZoomButton.removeEventListener("click", this._fitView);
    this._okayButton.removeEventListener("click", this._save);
    this._cancelButton.removeEventListener("click", this._close);
  };
}
