import { type ChipWaveSettings, type Instrument } from "../synth/synth.js";
import { ChangeChipWaveLoop } from "./changes.js";
import { Config } from "../synth/synth-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SampleAssetData } from "../synth/synth-controller.js";
import type { SongDocument } from "./song-document.js";

const { button, canvas, dialog, div, h2, input, label, span } = HTML;

type Marker = "offset" | "loopStart" | "loopEnd";

const markerRows: readonly {
    readonly marker: Marker;
    readonly centerY: number;
    readonly endY: number;
  }[] = [
    { marker: "offset", centerY: 14, endY: 24 },
    { marker: "loopStart", centerY: 34, endY: 44 },
    { marker: "loopEnd", centerY: 54, endY: 64 },
  ],
  waveformTop = 68;

export class ChipWaveLoopPrompt implements Prompt {
  readonly #doc: SongDocument;
  readonly #operatorIndex: number | null;
  // Opening the prompt leaves playback alone. Preview performs a non-restoring pause.
  public readonly pausePlayback: boolean = false;
  readonly #canvas: HTMLCanvasElement = canvas({
    class: "chip-wave-loop-canvas",
    "aria-label": "Sample waveform with draggable offset and loop markers",
  });
  readonly #offsetInput: HTMLInputElement = this.#makePositionInput("Sample offset");
  readonly #loopStartInput: HTMLInputElement = this.#makePositionInput("Loop start");
  readonly #loopEndInput: HTMLInputElement = this.#makePositionInput("Loop end");
  readonly #oneshotInput: HTMLInputElement = input({
    type: "checkbox",
    title: "One-shot",
  });
  readonly #status: HTMLDivElement = div({
    class: "chip-wave-loop-status",
  });
  readonly #zoomOutButton: HTMLButtonElement = button(
    { type: "button", title: "Zoom out", "aria-label": "Zoom out" },
    "-",
  );
  readonly #zoomInButton: HTMLButtonElement = button(
    { type: "button", title: "Zoom in", "aria-label": "Zoom in" },
    "+",
  );
  readonly #resetZoomButton: HTMLButtonElement = button({ type: "button" }, "Fit");
  readonly #previewButton: HTMLButtonElement = button(
    { class: "playButton", type: "button" },
    "Preview",
  );
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    title: "Cancel",
    "aria-label": "Cancel",
  });
  readonly #okayButton: HTMLButtonElement = button({ class: "okayButton", type: "button" }, "Okay");

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt chipWaveLoopPrompt" },
    h2("Chip Wave Loop"),
    div(
      { class: "chip-wave-loop-viewer" },
      div(
        { class: "chip-wave-loop-toolbar" },
        span("Drag markers or the waveform. Scroll to zoom."),
        div(this.#zoomOutButton, this.#resetZoomButton, this.#zoomInButton),
      ),
      div({ class: "chip-wave-loop-canvas-container" }, this.#canvas),
    ),
    div(
      { class: "chip-wave-loop-fields" },
      label(span("Offset"), this.#offsetInput),
      label(span("Loop start"), this.#loopStartInput),
      label(span("Loop end"), this.#loopEndInput),
      label({ class: "chip-wave-oneshot" }, this.#oneshotInput, span("One-shot")),
    ),
    this.#status,
    div({ class: "chip-wave-loop-actions" }, this.#previewButton, this.#okayButton),
    this.#cancelButton,
  );

  readonly #sampleId: string;
  readonly #initialSettings: ChipWaveSettings;
  readonly #resizeObserver: ResizeObserver;
  #sampleData: SampleAssetData | null = null;
  #offset = 0;
  #loopStart = 0;
  #loopEnd = 1;
  #viewStart = 0;
  #viewEnd = 1;
  #dragMarker: Marker | null = null;
  #panning = false;
  #pointerId: number | null = null;
  #pointerStartX = 0;
  #panStart = 0;
  #previewing = false;

  public constructor(_doc: SongDocument, _operatorIndex: number | null) {
    this.#doc = _doc;
    this.#operatorIndex = _operatorIndex;
    const instrument: Instrument =
      this.#doc.song.channels[this.#doc.channel]!.instruments[this.#doc.getCurrentInstrument()]!;
    this.#initialSettings =
      this.#operatorIndex == null
        ? instrument.chipWaveSettings
        : instrument.operators[this.#operatorIndex]!.chipWaveSettings;
    const waveIndex: number =
        this.#operatorIndex == null
          ? instrument.chipWave
          : instrument.operators[this.#operatorIndex]!.wave - 1,
      sampleId: string | undefined = Config.chipWaves[waveIndex]?.sampleId;
    if (sampleId === undefined) {
      throw new Error("Chip wave loop controls require a sample asset.");
    }
    this.#sampleId = sampleId;
    this.#oneshotInput.checked = this.#initialSettings.oneshot;

    this.#resizeObserver = new ResizeObserver(this.#draw);
    this.#resizeObserver.observe(this.#canvas);
    this.#doc.synth.assetLoadEvents.addEventListener("change", this.#whenAssetStateChanged);
    this.#canvas.addEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.addEventListener("pointermove", this.#onPointerMove);
    this.#canvas.addEventListener("pointerup", this.#onPointerUp);
    this.#canvas.addEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    this.#canvas.addEventListener("dblclick", this.#fitView);
    this.#offsetInput.addEventListener("input", this.#whenInputChanged);
    this.#loopStartInput.addEventListener("input", this.#whenInputChanged);
    this.#loopEndInput.addEventListener("input", this.#whenInputChanged);
    this.#zoomOutButton.addEventListener("click", this.#zoomOut);
    this.#zoomInButton.addEventListener("click", this.#zoomIn);
    this.#resetZoomButton.addEventListener("click", this.#fitView);
    this.#previewButton.addEventListener("click", this.#preview);
    this.#okayButton.addEventListener("click", this.#save);
    this.#cancelButton.addEventListener("click", this.#close);
    this.#loadSampleData();
    setTimeout(() => this.#offsetInput.focus(), 0);
  }

  #makePositionInput(title: string): HTMLInputElement {
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

  #loadSampleData(): void {
    const data: SampleAssetData | null = this.#doc.synth.getSampleAsset(this.#sampleId);
    if (data == null) {
      const status = this.#doc.synth.getAssetLoadStatus(this.#sampleId);
      this.#status.textContent =
        status === "error"
          ? `Failed to load sample: ${this.#doc.synth.getAssetLoadError(this.#sampleId) ?? "Unknown error"}`
          : "Loading sample waveform...";
      this.#previewButton.disabled = true;
      this.#okayButton.disabled = true;
      return;
    }
    if (this.#sampleData != null) {
      return;
    }
    if (data.samples.length === 0) {
      this.#status.textContent = "The sample contains no audio frames.";
      this.#previewButton.disabled = true;
      this.#okayButton.disabled = true;
      return;
    }
    this.#sampleData = data;
    const length: number = data.samples.length;
    this.#offset = Math.round(this.#initialSettings.offset * length);
    this.#loopStart = Math.round(this.#initialSettings.loopStart * length);
    this.#loopEnd = Math.round(this.#initialSettings.loopEnd * length);
    this.#normalizePositions("loopEnd");
    this.#viewStart = 0;
    this.#viewEnd = length;
    for (const positionInput of [this.#offsetInput, this.#loopStartInput, this.#loopEndInput]) {
      positionInput.max = String(length);
    }
    this.#status.textContent = `${length.toLocaleString()} samples at ${data.sampleRate.toLocaleString()} Hz`;
    this.#previewButton.disabled = false;
    this.#okayButton.disabled = false;
    this.#syncInputs();
    this.#draw();
  }

  #normalizePositions(changed: Marker): void {
    const length: number = this.#sampleData?.samples.length ?? 1;
    this.#offset = Math.round(Math.max(0, Math.min(length, this.#offset)));
    this.#loopStart = Math.round(Math.max(0, Math.min(length, this.#loopStart)));
    this.#loopEnd = Math.round(Math.max(0, Math.min(length, this.#loopEnd)));
    if (changed === "loopStart") {
      this.#loopStart = Math.min(Math.max(0, length - 1), this.#loopStart);
      this.#loopEnd = Math.max(this.#loopStart + 1, this.#loopEnd);
    } else if (changed === "loopEnd") {
      this.#loopEnd = Math.max(this.#loopStart + 1, this.#loopEnd);
      if (this.#loopEnd > length) {
        this.#loopEnd = length;
        this.#loopStart = Math.min(this.#loopStart, Math.max(0, length - 1));
      }
    }
  }

  #syncInputs(): void {
    this.#offsetInput.value = String(this.#offset);
    this.#loopStartInput.value = String(this.#loopStart);
    this.#loopEndInput.value = String(this.#loopEnd);
  }

  #whenInputChanged = (event: Event): void => {
    if (this.#sampleData == null) {
      return;
    }
    const target: HTMLInputElement = event.currentTarget as HTMLInputElement,
      value = Number(target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    let changed: Marker;
    if (target === this.#offsetInput) {
      this.#offset = value;
      changed = "offset";
    } else if (target === this.#loopStartInput) {
      this.#loopStart = value;
      changed = "loopStart";
    } else {
      this.#loopEnd = value;
      changed = "loopEnd";
    }
    this.#normalizePositions(changed);
    this.#syncInputs();
    this.#draw();
  };

  #getCanvasPoint(event: PointerEvent | WheelEvent): {
    x: number;
    y: number;
  } {
    const bounds: DOMRect = this.#canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  #sampleToX(sample: number, width: number): number {
    return ((sample - this.#viewStart) * width) / (this.#viewEnd - this.#viewStart);
  }

  #xToSample(x: number, width: number): number {
    return (
      this.#viewStart +
      (Math.max(0, Math.min(width, x)) / width) * (this.#viewEnd - this.#viewStart)
    );
  }

  #pickMarkerRow(y: number): Marker | null {
    if (y < 0) {
      return null;
    }
    for (const row of markerRows) {
      if (y < row.endY) {
        return row.marker;
      }
    }
    return null;
  }

  #pickMarker(x: number, y: number, width: number): Marker | null {
    const rowMarker: Marker | null = this.#pickMarkerRow(y);
    if (rowMarker != null) {
      return rowMarker;
    }
    if (y < waveformTop) {
      return null;
    }
    const markers: { marker: Marker; sample: number }[] = [
      { marker: "offset", sample: this.#offset },
      { marker: "loopStart", sample: this.#loopStart },
      { marker: "loopEnd", sample: this.#loopEnd },
    ];
    let best: Marker | null = null,
      bestDistance = Infinity;
    for (const marker of markers) {
      const xDistance: number = Math.abs(x - this.#sampleToX(marker.sample, width));
      if (xDistance <= 5 && xDistance < bestDistance) {
        best = marker.marker;
        bestDistance = xDistance;
      }
    }
    return best;
  }

  #setMarker(marker: Marker, value: number): void {
    if (marker === "offset") {
      this.#offset = value;
    } else if (marker === "loopStart") {
      this.#loopStart = value;
    } else {
      this.#loopEnd = value;
    }
    this.#normalizePositions(marker);
    this.#syncInputs();
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (this.#sampleData == null || event.button !== 0) {
      return;
    }
    const point = this.#getCanvasPoint(event),
      width: number = this.#canvas.getBoundingClientRect().width,
      rowMarker: Marker | null = this.#pickMarkerRow(point.y);
    this.#dragMarker = rowMarker ?? this.#pickMarker(point.x, point.y, width);
    this.#panning = this.#dragMarker == null && point.y >= waveformTop;
    if (this.#dragMarker == null && !this.#panning) {
      return;
    }
    this.#pointerId = event.pointerId;
    this.#pointerStartX = point.x;
    this.#panStart = this.#viewStart;
    if (rowMarker != null) {
      this.#setMarker(rowMarker, Math.round(this.#xToSample(point.x, width)));
      this.#draw();
    }
    this.#canvas.setPointerCapture(event.pointerId);
    this.#canvas.style.cursor = this.#panning ? "grabbing" : "ew-resize";
    event.preventDefault();
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#sampleData == null) {
      return;
    }
    const point = this.#getCanvasPoint(event),
      width: number = this.#canvas.getBoundingClientRect().width;
    if (this.#pointerId !== event.pointerId) {
      const marker: Marker | null = this.#pickMarker(point.x, point.y, width);
      this.#canvas.style.cursor =
        marker == null ? (point.y >= waveformTop ? "grab" : "default") : "ew-resize";
      return;
    }
    if (this.#dragMarker != null) {
      this.#setMarker(this.#dragMarker, Math.round(this.#xToSample(point.x, width)));
    } else if (this.#panning) {
      const length: number = this.#sampleData.samples.length,
        viewSpan: number = this.#viewEnd - this.#viewStart,
        delta: number = ((this.#pointerStartX - point.x) * viewSpan) / Math.max(1, width);
      this.#viewStart = Math.max(0, Math.min(length - viewSpan, this.#panStart + delta));
      this.#viewEnd = this.#viewStart + viewSpan;
    }
    this.#draw();
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (this.#pointerId !== event.pointerId) {
      return;
    }
    this.#pointerId = null;
    this.#dragMarker = null;
    this.#panning = false;
    const point = this.#getCanvasPoint(event),
      width: number = this.#canvas.getBoundingClientRect().width;
    this.#canvas.style.cursor =
      this.#pickMarker(point.x, point.y, width) == null
        ? point.y >= waveformTop
          ? "grab"
          : "default"
        : "ew-resize";
  };

  #zoomAt(x: number, factor: number): void {
    if (this.#sampleData == null) {
      return;
    }
    const length: number = this.#sampleData.samples.length,
      width: number = this.#canvas.getBoundingClientRect().width,
      oldSpan: number = this.#viewEnd - this.#viewStart,
      newSpan: number = Math.max(Math.min(length, 32), Math.min(length, oldSpan * factor)),
      anchor: number = this.#xToSample(x, width),
      ratio: number = Math.max(0, Math.min(1, x / Math.max(1, width)));
    this.#viewStart = Math.max(0, Math.min(length - newSpan, anchor - newSpan * ratio));
    this.#viewEnd = this.#viewStart + newSpan;
    this.#draw();
  }

  #onWheel = (event: WheelEvent): void => {
    if (this.#sampleData == null) {
      return;
    }
    event.preventDefault();
    this.#zoomAt(this.#getCanvasPoint(event).x, event.deltaY > 0 ? 1.25 : 0.8);
  };

  #zoomOut = (): void => this.#zoomAt(this.#canvas.getBoundingClientRect().width / 2, 2);
  #zoomIn = (): void => this.#zoomAt(this.#canvas.getBoundingClientRect().width / 2, 0.5);
  #fitView = (): void => {
    if (this.#sampleData == null) {
      return;
    }
    this.#viewStart = 0;
    this.#viewEnd = this.#sampleData.samples.length;
    this.#draw();
  };

  #draw = (): void => {
    const bounds: DOMRect = this.#canvas.getBoundingClientRect(),
      width: number = Math.max(1, bounds.width),
      height: number = Math.max(1, bounds.height),
      pixelRatio: number = window.devicePixelRatio || 1,
      pixelWidth: number = Math.round(width * pixelRatio),
      pixelHeight: number = Math.round(height * pixelRatio);
    if (this.#canvas.width !== pixelWidth) {
      this.#canvas.width = pixelWidth;
    }
    if (this.#canvas.height !== pixelHeight) {
      this.#canvas.height = pixelHeight;
    }
    const context: CanvasRenderingContext2D | null = this.#canvas.getContext("2d");
    if (context == null) {
      return;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const styles: CSSStyleDeclaration = getComputedStyle(this.container),
      background: string = styles.getPropertyValue("--background").trim(),
      widget: string = styles.getPropertyValue("--ui-widget-background").trim(),
      text: string = styles.getPropertyValue("--text").trim();
    context.fillStyle = background || "#111";
    context.fillRect(0, 0, width, height);
    context.fillStyle = widget || "#444";
    const markerAreaBottom: number = markerRows.at(-1)!.endY;
    context.fillRect(0, markerAreaBottom, width, height - markerAreaBottom);

    if (this.#sampleData == null) {
      return;
    }
    const samples: Float32Array = this.#sampleData.samples,
      waveformHeight: number = height - waveformTop - 4,
      middle: number = waveformTop + waveformHeight / 2,
      amplitude: number = Math.max(1, waveformHeight / 2 - 2),
      offsetX: number = this.#sampleToX(this.#offset, width),
      loopStartX: number = this.#sampleToX(this.#loopStart, width),
      loopEndX: number = this.#sampleToX(this.#loopEnd, width);
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
    for (let x = 0; x < width; x++) {
      const sampleStart: number = Math.max(0, Math.floor(this.#xToSample(x, width))),
        sampleEnd: number = Math.min(
          samples.length,
          Math.max(sampleStart + 1, Math.ceil(this.#xToSample(x + 1, width))),
        );
      let minimum = 1,
        maximum = -1;
      const sampleStep: number = Math.max(1, Math.floor((sampleEnd - sampleStart) / 64));
      for (let index: number = sampleStart; index < sampleEnd; index += sampleStep) {
        minimum = Math.min(minimum, samples[index]!);
        maximum = Math.max(maximum, samples[index]!);
      }
      context.moveTo(x + 0.5, middle - maximum * amplitude);
      context.lineTo(x + 0.5, middle - minimum * amplitude);
    }
    context.stroke();

    const drawMarker = (marker: Marker, markerX: number, markerY: number, color: string): void => {
      if (markerX < -20 || markerX > width + 20) {
        return;
      }
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(markerX, markerY + 7);
      context.lineTo(markerX, height);
      context.stroke();
      context.beginPath();
      if (marker === "offset") {
        context.moveTo(markerX - 6, markerY - 6);
        context.lineTo(markerX + 6, markerY - 6);
        context.lineTo(markerX, markerY + 6);
      } else {
        const direction: number = marker === "loopStart" ? 1 : -1;
        context.moveTo(markerX - 6 * direction, markerY - 6);
        context.lineTo(markerX, markerY - 6);
        context.lineTo(markerX + 6 * direction, markerY);
        context.lineTo(markerX, markerY + 6);
        context.lineTo(markerX - 6 * direction, markerY + 6);
      }
      context.closePath();
      context.fill();
    };
    drawMarker("offset", offsetX, markerRows[0]!.centerY, "#f4a261");
    drawMarker("loopStart", loopStartX, markerRows[1]!.centerY, "#2a9d8f");
    drawMarker("loopEnd", loopEndX, markerRows[2]!.centerY, "#e76f51");
  };

  #save = (): void => {
    if (this.#sampleData == null) {
      return;
    }
    const length: number = this.#sampleData.samples.length,
      change = new ChangeChipWaveLoop(this.#doc, this.#operatorIndex, {
        offset: this.#offset / length,
        loopStart: this.#loopStart / length,
        loopEnd: this.#loopEnd / length,
        oneshot: this.#oneshotInput.checked,
      });
    this.#doc.closePrompt();
    this.#doc.record(change);
  };

  #preview = (): void => {
    if (this.#sampleData == null) {
      return;
    }
    if (this.#previewing) {
      this.#doc.synth.stopSamplePreview();
      this.#setPreviewing(false);
      return;
    }
    if (this.#doc.synth.playing) {
      this.#doc.performance.pause();
    }
    const started: boolean = this.#doc.synth.playSamplePreview(
      this.#sampleId,
      {
        offsetFrame: this.#offset,
        loopStartFrame: this.#loopStart,
        loopEndFrame: this.#loopEnd,
        oneshot: this.#oneshotInput.checked,
      },
      this.#previewEnded,
    );
    this.#setPreviewing(started);
  };

  #previewEnded = (): void => this.#setPreviewing(false);

  #setPreviewing(previewing: boolean): void {
    this.#previewing = previewing;
    this.#previewButton.classList.toggle("playButton", !previewing);
    this.#previewButton.classList.toggle("stopButton", previewing);
    this.#previewButton.textContent = previewing ? "Stop" : "Preview";
  }

  #whenAssetStateChanged = (): void => this.#loadSampleData();
  #close = (): void => this.#doc.closePrompt();

  public cleanUp = (): void => {
    this.#resizeObserver.disconnect();
    this.#doc.synth.assetLoadEvents.removeEventListener("change", this.#whenAssetStateChanged);
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.removeEventListener("wheel", this.#onWheel);
    this.#canvas.removeEventListener("dblclick", this.#fitView);
    this.#offsetInput.removeEventListener("input", this.#whenInputChanged);
    this.#loopStartInput.removeEventListener("input", this.#whenInputChanged);
    this.#loopEndInput.removeEventListener("input", this.#whenInputChanged);
    this.#zoomOutButton.removeEventListener("click", this.#zoomOut);
    this.#zoomInButton.removeEventListener("click", this.#zoomIn);
    this.#resetZoomButton.removeEventListener("click", this.#fitView);
    this.#previewButton.removeEventListener("click", this.#preview);
    this.#okayButton.removeEventListener("click", this.#save);
    this.#cancelButton.removeEventListener("click", this.#close);
    this.#doc.synth.stopSamplePreview();
  };
}
