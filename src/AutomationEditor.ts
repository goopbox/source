// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config, type AutomationValueDomain } from "../synth/SynthConfig.js";
import {
  AutomationEvent,
  AutomationOperation,
  AutomationPoint,
  AutomationRow,
  ChannelKind,
  mapAutomationClipboardValue,
  type Pattern,
} from "../synth/synth.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { SongDocument } from "./SongDocument.js";
import {
  AutomationRowSelectionState,
  type AutomationRowSelection,
} from "./AutomationSelection.js";
import { ChangeGroup } from "./Change.js";
import { ColorConfig } from "./ColorConfig.js";
import { prettyNumber } from "./EditorConfig.js";
import {
  bendAutomationEvent,
  clipAutomationEvent,
  deleteAutomationRange,
} from "./AutomationEditing.js";
import {
  ChangeAutomationEvents,
  ChangeAutomationOperation,
  ChangeAutomationRowCount,
  ChangeAutomationTargetChannel,
  ChangeAutomationTargetElement,
  ChangeAutomationTargetInstrument,
  ChangeEnsurePatternExists,
} from "./changes.js";

interface AutomationClipboard {
  readonly version: 2;
  readonly duration: number;
  readonly targetId: string;
  readonly targetIndex: number;
  readonly operation: AutomationOperation;
  readonly domain: AutomationValueDomain | null;
  readonly events: Array<{
    start: number;
    end: number;
    points: Array<{ time: number; value: number }>;
  }>;
}

interface AutomationDrag {
  readonly pointerId: number;
  readonly rowIndex: number;
  readonly eventIndex: number;
  readonly pointIndex: number;
  readonly mode:
    | "create"
    | "event"
    | "selection"
    | "selection-start"
    | "selection-end"
    | "selection-contents";
  readonly startClientX: number;
  readonly startClientY: number;
  readonly original: AutomationEvent[];
  readonly originalRange: AutomationRowSelection | null;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly cursorPart: number;
  readonly anchorStart: number;
  readonly anchorEnd: number;
  dragging: boolean;
  horizontal: boolean;
  previewEvent: AutomationEvent | null;
  change: ChangeAutomationEvents | null;
}

interface AutomationCursor {
  valid: boolean;
  rowIndex: number;
  exactPart: number;
  part: number;
  eventIndex: number;
  event: AutomationEvent | null;
  previous: AutomationEvent | null;
  next: AutomationEvent | null;
  start: number;
  end: number;
}

function cloneEvents(events: readonly AutomationEvent[]): AutomationEvent[] {
  return events.map((event: AutomationEvent): AutomationEvent => event.clone());
}

function isAutomationClipboard(value: unknown): value is AutomationClipboard {
  if (value == null || typeof value != "object") return false;
  const copy = value as Partial<AutomationClipboard>;
  if (
    copy.version != 2 ||
    !Number.isFinite(copy.duration) ||
    copy.duration! <= 0 ||
    typeof copy.targetId != "string" ||
    copy.targetId.length == 0 ||
    copy.targetId.length > Config.automationTargetIdLengthMax ||
    !Number.isInteger(copy.targetIndex) ||
    copy.targetIndex! < 0 ||
    copy.targetIndex! > Config.automationTargetIndexMax ||
    !Number.isInteger(copy.operation) ||
    copy.operation! < AutomationOperation.Multiply ||
    copy.operation! > AutomationOperation.Set ||
    !Array.isArray(copy.events) ||
    copy.events.length > Config.automationEventsPerRowMax
  ) return false;
  if (
    copy.domain != null &&
    (!Number.isFinite(copy.domain.min) ||
      !Number.isFinite(copy.domain.max) ||
      typeof copy.domain.integer != "boolean" ||
      copy.domain.max < copy.domain.min)
  ) return false;
  for (const event of copy.events) {
    if (
      event == null ||
      typeof event != "object" ||
      !Number.isFinite(event.start) ||
      !Number.isFinite(event.end) ||
      event.start < 0 ||
      event.end > copy.duration! ||
      event.end <= event.start ||
      !Array.isArray(event.points) ||
      event.points.length == 0 ||
      event.points.length > Config.automationPointsPerEventMax
    ) return false;
    let previousTime: number = -1;
    for (let pointIndex: number = 0; pointIndex < event.points.length; pointIndex++) {
      const point = event.points[pointIndex];
      if (
        point == null ||
        typeof point != "object" ||
        !Number.isFinite(point.time) ||
        !Number.isFinite(point.value) ||
        Math.abs(point.value) > Config.automationValueMagnitudeMax ||
        (copy.domain != null &&
          (point.value < copy.domain.min || point.value > copy.domain.max)) ||
        point.time <= previousTime ||
        point.time < 0 ||
        point.time > event.end - event.start ||
        (pointIndex == 0 && point.time != 0)
      ) return false;
      previousTime = point.time;
    }
  }
  return true;
}

export class AutomationSettings {
  public readonly container: HTMLDivElement = HTML.div({
    class: "automation-settings editor-controls groupedSettings",
  });
  private readonly _rowsInput: HTMLInputElement = HTML.input({
    type: "number",
    min: String(Config.automationRowCountMin),
    max: String(Config.automationRowCountMax),
    step: "1",
  });

  public constructor(private readonly _doc: SongDocument) {
    this._rowsInput.addEventListener("change", (): void => {
      const value: number = Math.max(
        Config.automationRowCountMin,
        Math.min(Config.automationRowCountMax, Math.floor(Number(this._rowsInput.value))),
      );
      this._doc.record(new ChangeAutomationRowCount(this._doc, value));
    });
  }

  private _targetName(index: number): string {
    const kind: ChannelKind = this._doc.song.getChannelKind(index);
    const relative: number = this._doc.song.getChannelIndexInKind(index) + 1;
    return `${kind == ChannelKind.pitch ? "Pitch" : "Noise"} ${relative}`;
  }

  private _makeTargetSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select();
    menu.appendChild(HTML.option({ value: "-1" }, "Song"));
    for (let channelIndex: number = 0; channelIndex < this._doc.song.getChannelCount(); channelIndex++) {
      if (this._doc.song.getChannelIsAutomation(channelIndex)) continue;
      menu.appendChild(
        HTML.option({ value: String(channelIndex) }, this._targetName(channelIndex)),
      );
    }
    const valid: boolean =
      row.targetChannel == -1
        ? !row.targetChannelMissing
        : !row.targetChannelMissing &&
          row.targetChannel >= 0 &&
          row.targetChannel < this._doc.song.getChannelCount() &&
          !this._doc.song.getChannelIsAutomation(row.targetChannel) &&
          this._doc.song.getChannelKind(row.targetChannel) == row.targetChannelKind;
    if (!valid) {
      const relative: number = Math.max(0, row.targetChannel) + 1;
      const kind: string = row.targetChannelKind == ChannelKind.noise ? "Noise" : "Pitch";
      menu.appendChild(
        HTML.option({ value: "missing", selected: true, disabled: true }, `Missing ${kind} ${relative}`),
      );
      menu.classList.add("invalid-reference");
    } else {
      menu.value = String(row.targetChannel);
    }
    menu.addEventListener("change", (): void => {
      this._doc.record(
        new ChangeAutomationTargetChannel(this._doc, rowIndex, Number(menu.value)),
      );
    });
    return menu;
  }

  private _makeInstrumentSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select();
    if (row.targetChannel == -1 && !row.targetChannelMissing) {
      menu.appendChild(HTML.option({ value: "-1" }, "N/A"));
      menu.disabled = true;
      return menu;
    }
    const channel = this._doc.song.channels[row.targetChannel];
    if (channel != undefined && !this._doc.song.getChannelIsAutomation(row.targetChannel)) {
      for (let index: number = 0; index < channel.instruments.length; index++) {
        menu.appendChild(HTML.option({ value: String(index) }, `Instrument ${index + 1}`));
      }
    }
    const valid: boolean =
      !row.targetChannelMissing &&
      !row.targetInstrumentMissing &&
      channel != undefined &&
      row.targetInstrument >= 0 &&
      row.targetInstrument < channel.instruments.length;
    if (!valid) {
      menu.appendChild(
        HTML.option(
          { value: "missing", selected: true, disabled: true },
          `Missing Instrument ${Math.max(0, row.targetInstrument) + 1}`,
        ),
      );
      menu.classList.add("invalid-reference");
      menu.disabled = row.targetChannelMissing;
    } else {
      menu.value = String(row.targetInstrument);
    }
    menu.addEventListener("change", (): void => {
      this._doc.record(
        new ChangeAutomationTargetInstrument(this._doc, rowIndex, Number(menu.value)),
      );
    });
    return menu;
  }

  private _makeElementSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select();
    const choices: Array<{ id: string; index: number; name: string }> = [];
    if (row.targetChannel == -1 && !row.targetChannelMissing) {
      const tempo = Config.automationTargets.dictionary["tempo"];
      choices.push({ id: tempo.name, index: 0, name: tempo.displayName });
    } else if (!row.targetChannelMissing && !row.targetInstrumentMissing) {
      const instrument =
        this._doc.song.channels[row.targetChannel]?.instruments[row.targetInstrument];
      if (instrument != undefined) {
        for (const choice of Config.getAutomationTargetsForInstrument(instrument)) {
          choices.push({
            id: choice.target.name,
            index: choice.index,
            name: choice.displayName,
          });
        }
      }
    }
    for (const choice of choices) {
      menu.appendChild(
        HTML.option({ value: `${choice.id}:${choice.index}` }, choice.name),
      );
    }
    const currentValue: string = `${row.targetId}:${row.targetIndex}`;
    const valid: boolean =
      !row.targetElementMissing &&
      choices.some((choice): boolean => `${choice.id}:${choice.index}` == currentValue);
    if (!valid) {
      menu.appendChild(
        HTML.option(
          { value: "missing", selected: true, disabled: true },
          `Missing ${row.targetId}${row.targetIndex > 0 ? ` ${row.targetIndex + 1}` : ""}`,
        ),
      );
      menu.classList.add("invalid-reference");
      if (choices.length == 0) menu.disabled = true;
    } else {
      menu.value = currentValue;
    }
    menu.addEventListener("change", (): void => {
      const separator: number = menu.value.lastIndexOf(":");
      this._doc.record(
        new ChangeAutomationTargetElement(
          this._doc,
          rowIndex,
          menu.value.slice(0, separator),
          Number(menu.value.slice(separator + 1)),
        ),
      );
    });
    return menu;
  }

  private _makeOperationSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select(
      HTML.option({ value: String(AutomationOperation.Multiply) }, "Multiply"),
      HTML.option({ value: String(AutomationOperation.Add) }, "Add"),
      HTML.option({ value: String(AutomationOperation.Set) }, "Set"),
    );
    menu.value = String(row.operation);
    menu.addEventListener("change", (): void => {
      this._doc.record(
        new ChangeAutomationOperation(
          this._doc,
          rowIndex,
          Number(menu.value) as AutomationOperation,
        ),
      );
    });
    return menu;
  }

  public render(): void {
    if (!this._doc.song.getChannelIsAutomation(this._doc.channel)) return;
    const channel = this._doc.song.channels[this._doc.channel];
    if (document.activeElement != this._rowsInput)
      this._rowsInput.value = String(channel.automationRows.length);
    const rowCountControl: HTMLDivElement = HTML.div(
      { class: "settingsGroup" },
      HTML.div(
        { class: "selectRow" },
        HTML.label("Rows"),
        this._rowsInput,
      ),
    );
    const groups: HTMLDivElement[] = [rowCountControl];
    for (let rowIndex: number = 0; rowIndex < channel.automationRows.length; rowIndex++) {
      const row: AutomationRow = channel.automationRows[rowIndex];
      groups.push(
        HTML.div(
          { class: "settingsGroup automation-surface" },
          HTML.div({ class: "settingsGroupTitle" }, HTML.span(`Automation ${rowIndex + 1}`)),
          HTML.div({ class: "selectRow" }, HTML.label("Target"), this._makeTargetSelect(row, rowIndex)),
          HTML.div({ class: "selectRow" }, HTML.label("Instrument"), this._makeInstrumentSelect(row, rowIndex)),
          HTML.div({ class: "selectRow" }, HTML.label("Target element"), this._makeElementSelect(row, rowIndex)),
          HTML.div({ class: "selectRow" }, HTML.label("Operation"), this._makeOperationSelect(row, rowIndex)),
        ),
      );
    }
    this.container.replaceChildren(...groups);
  }
}

export class AutomationEditor {
  public readonly container: HTMLDivElement;
  public readonly selection: AutomationRowSelectionState =
    new AutomationRowSelectionState();

  private readonly _backgroundPattern: SVGPatternElement;
  private readonly _backgroundTile: SVGRectElement = SVG.rect();
  private readonly _svgBackground: SVGRectElement = SVG.rect({
    "pointer-events": "none",
  });
  private readonly _svgSelections: SVGGElement = SVG.g({
    "pointer-events": "none",
  });
  private readonly _svgEvents: SVGGElement = SVG.g({
    "pointer-events": "none",
  });
  private readonly _svgPreview: SVGPathElement = SVG.path({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": "2",
    "pointer-events": "none",
  });
  private readonly _svgPlayhead: SVGRectElement = SVG.rect({
    width: "4",
    fill: ColorConfig.text,
    "pointer-events": "none",
  });
  private readonly _svgContent: SVGGElement;
  private readonly _svg: SVGSVGElement;
  private readonly _blurSvg: SVGSVGElement | null;

  private _drag: AutomationDrag | null = null;
  private _cursor: AutomationCursor = this._emptyCursor();
  private _editorWidth: number = 0;
  private _editorHeight: number = 0;
  private _rowHeight: number = 0;
  private _partWidth: number = 0;
  private _mouseX: number = -1;
  private _mouseY: number = -1;
  private _pointerPresent: boolean = false;
  private _lastMousePart: number = 0;
  private _playheadX: number = 0;

  public constructor(
    private readonly _doc: SongDocument,
    private readonly _interactive: boolean,
    private readonly _barOffset: number,
  ) {
    const patternId: string = `automationEditorBackground${_barOffset}`;
    this._backgroundPattern = SVG.pattern({
      id: patternId,
      x: "0",
      y: "0",
      patternUnits: "userSpaceOnUse",
    }, this._backgroundTile);
    this._svgBackground.setAttribute("fill", `url(#${patternId})`);
    this._svgContent = SVG.g(
      this._svgBackground,
      this._svgSelections,
      this._svgEvents,
      this._svgPreview,
      this._svgPlayhead,
    );
    this._svg = SVG.svg(
      {
        class: "automation-editor-svg",
        width: "100%",
        height: "100%",
        role: _interactive ? "application" : "img",
        "aria-label": _interactive ? "Automation pattern editor" : "Automation pattern preview",
      },
      SVG.defs(this._backgroundPattern),
      this._svgContent,
    );
    this.container = HTML.div(
      { class: "automation-editor noSelection" },
      this._svg,
    );

    if (_interactive) {
      this._blurSvg = null;
      this._svg.addEventListener("pointerenter", this._onPointerEnter);
      this._svg.addEventListener("pointerleave", this._onPointerLeave);
      this._svg.addEventListener("pointerdown", this._onPointerDown);
      this._svg.addEventListener("pointermove", this._onPointerMove);
      this._svg.addEventListener("pointerup", this._onPointerUp);
      this._svg.addEventListener("pointercancel", this._onPointerCancel);
      window.requestAnimationFrame(this._animatePlayhead);
    } else {
      this.container.classList.add(
        "pattern-preview",
        _barOffset < 0 ? "pattern-preview-previous" : "pattern-preview-next",
      );
      this._svg.classList.add("pattern-preview-sharp");
      this._svgPlayhead.style.display = "none";
      this._svgPreview.style.display = "none";
      this._blurSvg = SVG.svg({
        class: "pattern-preview-blur",
        width: "100%",
        height: "100%",
        "aria-hidden": "true",
      });
      this.container.insertBefore(this._blurSvg, this._svg);
    }
  }

  private _emptyCursor(): AutomationCursor {
    return {
      valid: false,
      rowIndex: 0,
      exactPart: 0,
      part: 0,
      eventIndex: -1,
      event: null,
      previous: null,
      next: null,
      start: 0,
      end: 0,
    };
  }

  private _partsPerBar(): number {
    return this._doc.song.beatsPerBar * Config.partsPerBeat;
  }

  private _getMinDivision(): number {
    return Config.partsPerBeat /
      Config.rhythms[this._doc.song.rhythm].stepsPerBeat;
  }

  private _getMaxDivision(): number {
    const stepsPerBeat: number =
      Config.rhythms[this._doc.song.rhythm].stepsPerBeat;
    if (stepsPerBeat % 4 == 0) return Config.partsPerBeat / 2;
    if (stepsPerBeat % 3 == 0) return Config.partsPerBeat / 3;
    if (stepsPerBeat % 2 == 0) return Config.partsPerBeat / 2;
    return Config.partsPerBeat;
  }

  private _snapPart(part: number): number {
    const division: number = this._getMinDivision();
    return Math.floor(part / division) * division;
  }

  private _clampPart(part: number): number {
    return Math.max(0, Math.min(this._partsPerBar(), part));
  }

  private _updateMouse(event: PointerEvent): void {
    const rect: DOMRect = this._svg.getBoundingClientRect();
    this._mouseX = event.clientX - rect.left;
    this._mouseY = event.clientY - rect.top;
    if (this._partWidth > 0) {
      this._lastMousePart = this._clampPart(this._mouseX / this._partWidth);
    }
  }

  private _updateCursor(): void {
    const cursor: AutomationCursor = this._emptyCursor();
    this._cursor = cursor;
    const channel = this._doc.song.channels[this._doc.channel];
    if (
      !this._interactive ||
      this._editorWidth <= 0 ||
      this._editorHeight <= 0 ||
      this._rowHeight <= 0 ||
      this._mouseX < 0 ||
      this._mouseX > this._editorWidth ||
      this._mouseY < 0 ||
      this._mouseY > this._editorHeight ||
      channel.automationRows.length == 0
    ) return;

    cursor.rowIndex = Math.max(
      0,
      Math.min(
        channel.automationRows.length - 1,
        Math.floor(this._mouseY / this._rowHeight),
      ),
    );
    cursor.exactPart = this._clampPart(this._mouseX / this._partWidth);
    const minDivision: number = this._getMinDivision();
    cursor.part = this._snapPart(
      Math.max(0, Math.min(this._partsPerBar() - minDivision, cursor.exactPart)),
    );

    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const events: readonly AutomationEvent[] =
      pattern?.automationEvents[cursor.rowIndex] ?? [];
    const matchingPart: number = Math.max(
      0,
      Math.min(this._partsPerBar() - 0.0001, cursor.exactPart),
    );
    for (let index: number = 0; index < events.length; index++) {
      const event: AutomationEvent = events[index];
      if (event.end <= matchingPart) {
        cursor.previous = event;
        continue;
      }
      if (event.start <= matchingPart) {
        cursor.event = event;
        cursor.eventIndex = index;
      } else {
        cursor.next = event;
      }
      break;
    }

    if (cursor.event != null) {
      cursor.start = cursor.event.start;
      cursor.end = cursor.event.end;
    } else {
      const defaultLength: number = this._getMaxDivision();
      const fullBeats: number = Math.floor(cursor.part / Config.partsPerBeat);
      const modMouse: number = cursor.part % Config.partsPerBeat;
      cursor.start = fullBeats * Config.partsPerBeat;
      if (defaultLength < Config.partsPerBeat) {
        cursor.start += Math.floor(modMouse / defaultLength) * defaultLength;
      }
      cursor.end = cursor.start + defaultLength;
      const forceStart: number = cursor.previous?.end ?? 0;
      const forceEnd: number = cursor.next?.start ?? this._partsPerBar();
      if (cursor.start < forceStart) {
        cursor.start = forceStart;
        cursor.end = Math.min(forceEnd, cursor.start + defaultLength);
      } else if (cursor.end > forceEnd) {
        cursor.end = forceEnd;
        cursor.start = Math.max(forceStart, cursor.end - defaultLength);
      }
      if (cursor.start >= cursor.end) return;
    }
    cursor.valid = true;
  }

  private _selectionHandle(rowIndex: number, start: boolean): boolean {
    const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
    if (range == null || this._partWidth <= 0) return false;
    const edge: number = start ? range.start : range.end;
    return Math.abs(this._cursor.exactPart - edge) <= 5 / this._partWidth;
  }

  private _cursorIsInSelection(): boolean {
    return this._cursor.valid &&
      this.selection.contains(this._cursor.rowIndex, this._cursor.exactPart);
  }

  private _selectionAnchor(cursor: AutomationCursor): AutomationRowSelection {
    if (cursor.event != null) {
      return { start: cursor.event.start, end: cursor.event.end };
    }
    const start: number = Math.max(
      0,
      Math.min(
        (this._doc.song.beatsPerBar - 1) * Config.partsPerBeat,
        Math.floor(cursor.exactPart / Config.partsPerBeat) * Config.partsPerBeat,
      ),
    );
    return { start, end: start + Config.partsPerBeat };
  }

  private _rowDomain(rowIndex: number): AutomationValueDomain | null {
    return this._doc.song.channels[this._doc.channel]
      .automationRows[rowIndex]?.getValueDomain() ?? null;
  }

  private _makeCreationEvent(
    drag: AutomationDrag,
    currentPart: number,
    dragged: boolean,
  ): AutomationEvent | null {
    let start: number = drag.cursorStart;
    let end: number = drag.cursorEnd;
    if (dragged) {
      const minDivision: number = this._getMinDivision();
      if (currentPart < drag.cursorPart) {
        start = currentPart;
        end = drag.cursorPart + minDivision;
      } else {
        start = drag.cursorPart;
        end = currentPart + minDivision;
      }
      const previous: AutomationEvent | null = this._cursor.previous;
      const next: AutomationEvent | null = this._cursor.next;
      start = Math.max(previous?.end ?? 0, start);
      end = Math.min(next?.start ?? this._partsPerBar(), end);
    }
    if (start >= end) return null;
    const domain: AutomationValueDomain | null = this._rowDomain(drag.rowIndex);
    const value: number = domain?.max ?? 0;
    return new AutomationEvent(start, end, [
      new AutomationPoint(0, value),
      new AutomationPoint(end - start, value),
    ]);
  }

  private _nearestPointIndex(event: AutomationEvent, absolutePart: number): number {
    let nearestIndex: number = 0;
    let nearestDistance: number = Number.POSITIVE_INFINITY;
    for (let index: number = 0; index < event.points.length; index++) {
      const distance: number = Math.abs(
        event.start + event.points[index].time - absolutePart,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    return nearestIndex;
  }

  private _resizeEventStart(
    event: AutomationEvent,
    start: number,
  ): AutomationEvent {
    if (start >= event.start) {
      return clipAutomationEvent(event, start, event.end) ?? event.clone();
    }
    const offset: number = event.start - start;
    const points: AutomationPoint[] = [];
    if (event.points.length < Config.automationPointsPerEventMax) {
      points.push(new AutomationPoint(0, event.points[0].value));
    }
    for (const point of event.points) {
      points.push(
        new AutomationPoint(
          points.length == 0 ? 0 : point.time + offset,
          point.value,
        ),
      );
    }
    return new AutomationEvent(start, event.end, points);
  }

  private _resizeEventEnd(
    event: AutomationEvent,
    end: number,
  ): AutomationEvent {
    if (end <= event.end) {
      return clipAutomationEvent(event, event.start, end) ?? event.clone();
    }
    const points: AutomationPoint[] = event.points.map(
      (point: AutomationPoint): AutomationPoint => point.clone(),
    );
    if (points.length < Config.automationPointsPerEventMax) {
      points.push(
        new AutomationPoint(
          end - event.start,
          event.points[event.points.length - 1].value,
        ),
      );
    } else {
      points[points.length - 1].time = end - event.start;
    }
    return new AutomationEvent(event.start, end, points);
  }

  private _editEventHorizontally(
    drag: AutomationDrag,
    currentPart: number,
  ): AutomationEvent[] {
    const replacement: AutomationEvent[] = cloneEvents(drag.original);
    const event: AutomationEvent | undefined = replacement[drag.eventIndex];
    if (event == undefined) return replacement;
    const originalEvent: AutomationEvent = drag.original[drag.eventIndex];
    const pointIndex: number = drag.pointIndex;
    const lastPointIndex: number = originalEvent.points.length - 1;
    const delta: number = currentPart - drag.cursorPart;
    const minDivision: number = this._getMinDivision();
    if (pointIndex == 0) {
      const previousEnd: number = drag.original[drag.eventIndex - 1]?.end ?? 0;
      const start: number = Math.max(
        previousEnd,
        Math.min(originalEvent.end - minDivision, originalEvent.start + delta),
      );
      replacement[drag.eventIndex] = this._resizeEventStart(originalEvent, start);
    } else if (pointIndex == lastPointIndex) {
      const nextStart: number =
        drag.original[drag.eventIndex + 1]?.start ?? this._partsPerBar();
      const end: number = Math.max(
        originalEvent.start + minDivision,
        Math.min(nextStart, originalEvent.end + delta),
      );
      replacement[drag.eventIndex] = this._resizeEventEnd(originalEvent, end);
    } else {
      const point: AutomationPoint = event.points[pointIndex];
      const previousTime: number = event.points[pointIndex - 1].time;
      const nextTime: number = event.points[pointIndex + 1].time;
      point.time = Math.max(
        previousTime + 0.001,
        Math.min(nextTime - 0.001, originalEvent.points[pointIndex].time + delta),
      );
    }
    return replacement;
  }

  private _editEventVertically(
    drag: AutomationDrag,
    currentPart: number,
    clientY: number,
    uniform: boolean,
  ): AutomationEvent[] {
    const replacement: AutomationEvent[] = cloneEvents(drag.original);
    const event: AutomationEvent | undefined = drag.original[drag.eventIndex];
    const domain: AutomationValueDomain | null = this._rowDomain(drag.rowIndex);
    if (event == undefined || domain == null) return replacement;
    const pixelsForFullRange: number = Math.max(40, this._rowHeight * 1.5);
    const valueDelta: number =
      ((drag.startClientY - clientY) / pixelsForFullRange) *
      (domain.max - domain.min);
    replacement[drag.eventIndex] = bendAutomationEvent(
      event,
      currentPart,
      valueDelta,
      domain,
      uniform,
    );
    return replacement;
  }

  private _moveSelection(
    events: readonly AutomationEvent[],
    range: AutomationRowSelection,
    delta: number,
  ): AutomationEvent[] {
    const moved: AutomationEvent[] = [];
    for (const event of events) {
      const selected: AutomationEvent | null = clipAutomationEvent(
        event,
        range.start,
        range.end,
      );
      if (selected == null) continue;
      selected.start += delta;
      selected.end += delta;
      moved.push(selected);
    }
    const newStart: number = range.start + delta;
    const newEnd: number = range.end + delta;
    const remaining: AutomationEvent[] = deleteAutomationRange(
      deleteAutomationRange(events, range.start, range.end),
      newStart,
      newEnd,
    );
    return remaining.concat(moved).sort(
      (a: AutomationEvent, b: AutomationEvent): number => a.start - b.start,
    );
  }

  private _applyReplacement(
    drag: AutomationDrag,
    replacement: AutomationEvent[],
  ): void {
    if (replacement.length > Config.automationEventsPerRowMax) return;
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return;
    drag.change = new ChangeAutomationEvents(
      this._doc,
      pattern,
      drag.rowIndex,
      pattern.automationEvents[drag.rowIndex],
      replacement,
    );
    this._doc.setProspectiveChange(drag.change);
  }

  private _restoreDrag(drag: AutomationDrag): void {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern != null && drag.change != null) {
      new ChangeAutomationEvents(
        this._doc,
        pattern,
        drag.rowIndex,
        pattern.automationEvents[drag.rowIndex],
        drag.original,
      );
    }
    if (drag.originalRange == null) this.selection.clearRange(drag.rowIndex);
    else {
      this.selection.setRange(
        drag.rowIndex,
        drag.originalRange.start,
        drag.originalRange.end,
      );
    }
    this._doc.forgetLastChange();
  }

  private _onPointerEnter = (event: PointerEvent): void => {
    this._pointerPresent = true;
    this._updateMouse(event);
    this._updateCursor();
    this._updatePreview();
  };

  private _onPointerLeave = (): void => {
    if (this._drag == null) this._pointerPresent = false;
    this._updatePreview();
  };

  private _onPointerDown = (event: PointerEvent): void => {
    if (event.button != 0) return;
    this._pointerPresent = true;
    this._updateMouse(event);
    this._updateCursor();
    if (!this._cursor.valid) return;

    const cursor: AutomationCursor = this._cursor;
    const rowIndex: number = cursor.rowIndex;
    this.selection.activeRow = rowIndex;
    const originalRange: AutomationRowSelection | null =
      this.selection.getRange(rowIndex);
    const anchor: AutomationRowSelection = this._selectionAnchor(cursor);
    let mode: AutomationDrag["mode"];
    if (this._selectionHandle(rowIndex, true)) mode = "selection-start";
    else if (this._selectionHandle(rowIndex, false)) mode = "selection-end";
    else if (event.shiftKey) mode = "selection";
    else if (this._cursorIsInSelection()) mode = "selection-contents";
    else mode = cursor.event == null ? "create" : "event";

    if (mode == "create" || mode == "event") this.selection.clearRange(rowIndex);
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const original: AutomationEvent[] = cloneEvents(
      pattern?.automationEvents[rowIndex] ?? [],
    );
    const pointIndex: number = cursor.event == null
      ? -1
      : this._nearestPointIndex(cursor.event, cursor.exactPart);
    const drag: AutomationDrag = {
      pointerId: event.pointerId,
      rowIndex,
      eventIndex: cursor.eventIndex,
      pointIndex,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      original,
      originalRange,
      cursorStart: cursor.start,
      cursorEnd: cursor.end,
      cursorPart: cursor.part,
      anchorStart: anchor.start,
      anchorEnd: anchor.end,
      dragging: false,
      horizontal: false,
      previewEvent: null,
      change: null,
    };
    if (mode == "create") {
      drag.previewEvent = this._makeCreationEvent(drag, cursor.part, false);
    }
    this._drag = drag;
    this._svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.render();
  };

  private _onPointerMove = (event: PointerEvent): void => {
    this._updateMouse(event);
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId) {
      this._updateCursor();
      this._updatePreview();
      return;
    }

    const dx: number = event.clientX - drag.startClientX;
    const dy: number = event.clientY - drag.startClientY;
    if (!drag.dragging && Math.hypot(dx, dy) > 5) {
      drag.dragging = true;
      drag.horizontal = Math.abs(dx) >= Math.abs(dy);
    }
    if (!drag.dragging) return;

    const currentPart: number = this._snapPart(this._lastMousePart);
    switch (drag.mode) {
      case "create":
        drag.previewEvent = this._makeCreationEvent(
          drag,
          currentPart,
          drag.horizontal,
        );
        break;
      case "event": {
        const replacement: AutomationEvent[] = drag.horizontal
          ? this._editEventHorizontally(drag, currentPart)
          : this._editEventVertically(
              drag,
              currentPart,
              event.clientY,
              event.ctrlKey || event.metaKey,
            );
        this._applyReplacement(drag, replacement);
        break;
      }
      case "selection-start": {
        const end: number = drag.originalRange?.end ?? drag.anchorEnd;
        this.selection.setRange(drag.rowIndex, this._clampPart(currentPart), end);
        break;
      }
      case "selection-end": {
        const start: number = drag.originalRange?.start ?? drag.anchorStart;
        this.selection.setRange(drag.rowIndex, start, this._clampPart(currentPart));
        break;
      }
      case "selection":
        if (drag.horizontal) {
          if (currentPart < drag.anchorStart) {
            this.selection.setRange(drag.rowIndex, currentPart, drag.anchorEnd);
          } else {
            this.selection.setRange(
              drag.rowIndex,
              drag.anchorStart,
              Math.min(this._partsPerBar(), currentPart + this._getMinDivision()),
            );
          }
        }
        break;
      case "selection-contents": {
        if (!drag.horizontal || drag.originalRange == null) break;
        const division: number = this._getMinDivision();
        let delta: number =
          Math.round(dx / (this._partWidth * division)) * division;
        delta = Math.max(
          -drag.originalRange.start,
          Math.min(this._partsPerBar() - drag.originalRange.end, delta),
        );
        if (delta == 0) {
          if (drag.change != null) {
            const pattern: Pattern | null =
              this._doc.getCurrentPattern(this._barOffset);
            if (pattern != null) {
              new ChangeAutomationEvents(
                this._doc,
                pattern,
                drag.rowIndex,
                pattern.automationEvents[drag.rowIndex],
                drag.original,
              );
            }
            drag.change = null;
            this._doc.forgetLastChange();
          }
          this.selection.setRange(
            drag.rowIndex,
            drag.originalRange.start,
            drag.originalRange.end,
          );
          break;
        }
        this.selection.setRange(
          drag.rowIndex,
          drag.originalRange.start + delta,
          drag.originalRange.end + delta,
        );
        this._applyReplacement(
          drag,
          this._moveSelection(drag.original, drag.originalRange, delta),
        );
        break;
      }
    }
    event.preventDefault();
    this.render();
  };

  private _onPointerUp = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId) return;

    if (drag.mode == "create") {
      const automationEvent: AutomationEvent | null = drag.previewEvent;
      if (automationEvent != null) {
        const group: ChangeGroup = new ChangeGroup();
        const pattern: Pattern | null = this._ensurePattern(group);
        if (pattern != null) {
          pattern.ensureAutomationRowCount(drag.rowIndex + 1);
          const oldEvents: AutomationEvent[] = pattern.automationEvents[drag.rowIndex];
          if (oldEvents.length < Config.automationEventsPerRowMax) {
            const replacement: AutomationEvent[] = cloneEvents(oldEvents);
            replacement.push(automationEvent);
            replacement.sort(
              (a: AutomationEvent, b: AutomationEvent): number => a.start - b.start,
            );
            group.append(
              new ChangeAutomationEvents(
                this._doc,
                pattern,
                drag.rowIndex,
                oldEvents,
                replacement,
              ),
            );
            this._doc.record(group);
          }
        }
      }
    } else if (drag.mode == "event") {
      if (drag.change != null) {
        this._doc.record(drag.change);
      } else if (!drag.dragging) {
        const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
        if (pattern != null && drag.eventIndex >= 0) {
          const oldEvents: AutomationEvent[] = pattern.automationEvents[drag.rowIndex];
          const replacement: AutomationEvent[] = oldEvents.filter(
            (_event: AutomationEvent, index: number): boolean =>
              index != drag.eventIndex,
          );
          this._doc.record(
            new ChangeAutomationEvents(
              this._doc,
              pattern,
              drag.rowIndex,
              oldEvents,
              replacement,
            ),
          );
        }
      }
    } else if (drag.mode == "selection") {
      if (!drag.dragging || !drag.horizontal) {
        if (
          drag.originalRange != null &&
          drag.originalRange.start <= this._cursor.exactPart &&
          this._cursor.exactPart <= drag.originalRange.end
        ) {
          this.selection.clearRange(drag.rowIndex);
        } else {
          this.selection.setRange(
            drag.rowIndex,
            drag.anchorStart,
            drag.anchorEnd,
          );
        }
      }
    } else if (drag.mode == "selection-contents" && drag.change != null) {
      this._doc.record(drag.change);
    }

    this._drag = null;
    if (this._svg.hasPointerCapture(event.pointerId)) {
      this._svg.releasePointerCapture(event.pointerId);
    }
    this._updateCursor();
    this.render();
  };

  private _onPointerCancel = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId) return;
    this._restoreDrag(drag);
    this._drag = null;
    this._updateCursor();
    this.render();
  };

  private _ensurePattern(group?: ChangeGroup): Pattern | null {
    const bar: number = this._doc.bar + this._barOffset;
    if (bar < 0 || bar >= this._doc.song.barCount) return null;
    if (this._doc.getCurrentPattern(this._barOffset) == null) {
      const ensure: ChangeEnsurePatternExists = new ChangeEnsurePatternExists(
        this._doc,
        this._doc.channel,
        bar,
      );
      if (group == undefined) this._doc.record(ensure);
      else group.append(ensure);
    }
    return this._doc.getCurrentPattern(this._barOffset);
  }

  private _normalizedValue(
    value: number,
    domain: AutomationValueDomain | null,
  ): number {
    if (domain == null || domain.max == domain.min) return 0.5;
    return Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
  }

  private _eventPath(
    event: AutomationEvent,
    rowIndex: number,
    domain: AutomationValueDomain | null,
    showValue: boolean,
  ): string {
    if (event.points.length == 0) return "";
    const points: AutomationPoint[] = event.points.slice();
    const duration: number = event.end - event.start;
    const finalPoint: AutomationPoint = points[points.length - 1];
    if (finalPoint.time < duration) {
      points.push(new AutomationPoint(duration, finalPoint.value));
    }
    const centerY: number = (rowIndex + 0.5) * this._rowHeight;
    const radius: number = Math.max(1, this._rowHeight / 2 + 1);
    const totalWidth: number = this._partWidth * (event.end - event.start);
    const endOffset: number = 0.5 * Math.max(0, Math.min(2, totalWidth - 1));
    const position = (point: AutomationPoint, index: number): [number, number] => {
      const edgeOffset: number = index == 0
        ? endOffset
        : index == points.length - 1
          ? -endOffset
          : 0;
      const x: number = this._partWidth * (event.start + point.time) + edgeOffset;
      const size: number = showValue
        ? this._normalizedValue(point.value, domain)
        : 1;
      return [x, radius * size];
    };
    const first: [number, number] = position(points[0], 0);
    let path: string = `M ${prettyNumber(first[0])} ${prettyNumber(centerY + first[1])} `;
    path += `L ${prettyNumber(first[0])} ${prettyNumber(centerY - first[1])} `;
    for (let index: number = 1; index < points.length; index++) {
      const [x, size]: [number, number] = position(points[index], index);
      path += `L ${prettyNumber(x)} ${prettyNumber(centerY - size)} `;
    }
    for (let index: number = points.length - 1; index >= 0; index--) {
      const [x, size]: [number, number] = position(points[index], index);
      path += `L ${prettyNumber(x)} ${prettyNumber(centerY + size)} `;
    }
    return path + "z";
  }

  private _selectionPath(range: AutomationRowSelection, rowIndex: number): string {
    const left: number = this._partWidth * range.start;
    const right: number = this._partWidth * range.end;
    const top: number = rowIndex * this._rowHeight + 1;
    const bottom: number = (rowIndex + 1) * this._rowHeight - 1;
    return `M ${prettyNumber(left)} ${prettyNumber(top)} L ${prettyNumber(right)} ${prettyNumber(top)} L ${prettyNumber(right)} ${prettyNumber(bottom)} L ${prettyNumber(left)} ${prettyNumber(bottom)} z`;
  }

  private _updatePreview(): void {
    if (
      !this._interactive ||
      !this._pointerPresent ||
      !this._cursor.valid ||
      (this._drag != null && this._drag.mode != "create")
    ) {
      this._svgPreview.setAttribute("display", "none");
      return;
    }
    this._svgPreview.setAttribute("display", "");
    const range: AutomationRowSelection | null =
      this.selection.getRange(this._cursor.rowIndex);
    if (
      range != null &&
      (this._selectionHandle(this._cursor.rowIndex, true) ||
        this._selectionHandle(this._cursor.rowIndex, false) ||
        this._cursorIsInSelection())
    ) {
      this._svgPreview.setAttribute(
        "d",
        this._selectionPath(range, this._cursor.rowIndex),
      );
      return;
    }
    const event: AutomationEvent | null =
      this._drag?.previewEvent ??
      this._cursor.event ??
      (() => {
        const domain: AutomationValueDomain | null =
          this._rowDomain(this._cursor.rowIndex);
        const value: number = domain?.max ?? 0;
        return new AutomationEvent(this._cursor.start, this._cursor.end, [
          new AutomationPoint(0, value),
          new AutomationPoint(this._cursor.end - this._cursor.start, value),
        ]);
      })();
    this._svgPreview.setAttribute(
      "d",
      this._eventPath(
        event,
        this._cursor.rowIndex,
        this._rowDomain(this._cursor.rowIndex),
        true,
      ),
    );
  }

  private _animatePlayhead = (): void => {
    const playheadBar: number = Math.floor(this._doc.synth.playhead);
    if (
      this._doc.synth.playing &&
      playheadBar == this._doc.bar + this._barOffset
    ) {
      this._svgPlayhead.setAttribute("display", "");
      const target: number = this._doc.synth.playhead - playheadBar;
      if (Math.abs(target - this._playheadX) > 0.1) this._playheadX = target;
      else this._playheadX += (target - this._playheadX) * 0.2;
      this._svgPlayhead.setAttribute(
        "x",
        prettyNumber(this._playheadX * this._editorWidth - 2),
      );
    } else {
      this._svgPlayhead.setAttribute("display", "none");
    }
    window.requestAnimationFrame(this._animatePlayhead);
  };

  public movePlayheadToMouse(): boolean {
    if (!this._interactive || !this._pointerPresent) return false;
    this._doc.synth.playhead =
      this._doc.bar + this._barOffset + this._lastMousePart / this._partsPerBar();
    return true;
  }

  public clearSelection(): void {
    this.selection.clearRanges();
    this.render();
  }

  public selectAll(): void {
    this.selection.setRange(
      this.selection.activeRow,
      0,
      this._partsPerBar(),
    );
    this.render();
  }

  public copy(): boolean {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const rowIndex: number = this.selection.activeRow;
    const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
    const row: AutomationRow | undefined =
      this._doc.song.channels[this._doc.channel].automationRows[rowIndex];
    if (pattern == null || range == null || row == undefined) return false;
    const events: AutomationEvent[] = [];
    for (const event of pattern.automationEvents[rowIndex] ?? []) {
      const clipped: AutomationEvent | null = clipAutomationEvent(
        event,
        range.start,
        range.end,
      );
      if (clipped == null) continue;
      clipped.start -= range.start;
      clipped.end -= range.start;
      events.push(clipped);
    }
    if (events.length == 0) return false;
    const copy: AutomationClipboard = {
      version: 2,
      duration: range.end - range.start,
      targetId: row.targetId,
      targetIndex: row.targetIndex,
      operation: row.operation,
      domain: row.getValueDomain(),
      events: events.map((event: AutomationEvent) => ({
        start: event.start,
        end: event.end,
        points: event.points.map((point: AutomationPoint) => ({
          time: point.time,
          value: point.value,
        })),
      })),
    };
    window.localStorage.setItem("automationCopy", JSON.stringify(copy));
    return true;
  }

  public deleteSelected(): boolean {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return false;
    const group: ChangeGroup = new ChangeGroup();
    let changed: boolean = false;
    for (const rowIndex of this.selection.rangeRows()) {
      const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
      if (range == null) continue;
      const oldEvents: AutomationEvent[] = pattern.automationEvents[rowIndex] ?? [];
      const replacement: AutomationEvent[] = deleteAutomationRange(
        oldEvents,
        range.start,
        range.end,
      );
      if (replacement.length > Config.automationEventsPerRowMax) continue;
      if (
        replacement.length == oldEvents.length &&
        replacement.every(
          (event: AutomationEvent, index: number): boolean =>
            event.start == oldEvents[index].start &&
            event.end == oldEvents[index].end,
        )
      ) continue;
      group.append(
        new ChangeAutomationEvents(
          this._doc,
          pattern,
          rowIndex,
          oldEvents,
          replacement,
        ),
      );
      this.selection.clearRange(rowIndex);
      changed = true;
    }
    if (changed) this._doc.record(group);
    this.render();
    return changed;
  }

  public cut(): boolean {
    if (!this.copy()) return false;
    return this.deleteSelected();
  }

  public paste(): boolean {
    let value: unknown;
    try {
      value = JSON.parse(String(window.localStorage.getItem("automationCopy")));
    } catch {
      return false;
    }
    if (!isAutomationClipboard(value)) return false;
    const rowIndex: number = this.selection.activeRow;
    const row: AutomationRow | undefined =
      this._doc.song.channels[this._doc.channel].automationRows[rowIndex];
    if (row == undefined) return false;
    const destination: AutomationRowSelection | null =
      this.selection.getRange(rowIndex);
    const anchor: number = destination?.start ?? 0;
    const destinationDomain: AutomationValueDomain | null = row.getValueDomain();
    const compatible: boolean =
      value.targetId == row.targetId &&
      value.targetIndex == row.targetIndex &&
      value.operation == row.operation;
    const pasted: AutomationEvent[] = [];
    for (const source of value.events) {
      const shifted: AutomationEvent = new AutomationEvent(
        source.start + anchor,
        source.end + anchor,
        source.points.map(
          (point): AutomationPoint => new AutomationPoint(
            point.time,
            mapAutomationClipboardValue(
              point.value,
              compatible,
              value.domain,
              destinationDomain,
            ),
          ),
        ),
      );
      const clipped: AutomationEvent | null = clipAutomationEvent(
        shifted,
        0,
        this._partsPerBar(),
      );
      if (clipped != null) pasted.push(clipped);
    }
    if (pasted.length == 0) return false;
    const existingPattern: Pattern | null =
      this._doc.getCurrentPattern(this._barOffset);
    const existingEvents: AutomationEvent[] =
      existingPattern?.automationEvents[rowIndex] ?? [];
    let replacement: AutomationEvent[] = destination == null
      ? cloneEvents(existingEvents)
      : deleteAutomationRange(
          existingEvents,
          destination.start,
          destination.end,
        );
    for (const event of pasted) {
      replacement = deleteAutomationRange(replacement, event.start, event.end);
    }
    replacement = replacement.concat(pasted).sort(
      (a: AutomationEvent, b: AutomationEvent): number => a.start - b.start,
    );
    if (replacement.length > Config.automationEventsPerRowMax) return false;
    const group: ChangeGroup = new ChangeGroup();
    const pattern: Pattern | null = this._ensurePattern(group);
    if (pattern == null) return false;
    pattern.ensureAutomationRowCount(rowIndex + 1);
    const oldEvents: AutomationEvent[] = pattern.automationEvents[rowIndex];
    group.append(
      new ChangeAutomationEvents(
        this._doc,
        pattern,
        rowIndex,
        oldEvents,
        replacement,
      ),
    );
    this._doc.record(group);
    this.selection.setRange(
      rowIndex,
      anchor,
      Math.min(this._partsPerBar(), anchor + value.duration),
    );
    this.render();
    return true;
  }

  public render(): void {
    if (!this._doc.song.getChannelIsAutomation(this._doc.channel)) return;
    const channel = this._doc.song.channels[this._doc.channel];
    const rowCount: number = channel.automationRows.length;
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    this.selection.trim(rowCount, this._partsPerBar());

    this._editorWidth = this.container.clientWidth;
    this._editorHeight = this.container.clientHeight;
    this._rowHeight = rowCount == 0 ? 0 : this._editorHeight / rowCount;
    this._partWidth = this._partsPerBar() == 0
      ? 0
      : this._editorWidth / this._partsPerBar();
    const beatWidth: number = this._editorWidth / this._doc.song.beatsPerBar;
    this._backgroundPattern.setAttribute("width", String(beatWidth));
    this._backgroundPattern.setAttribute("height", String(this._rowHeight));
    this._backgroundTile.setAttribute("x", "1");
    this._backgroundTile.setAttribute("y", "1");
    this._backgroundTile.setAttribute("width", String(Math.max(0, beatWidth - 2)));
    this._backgroundTile.setAttribute("height", String(Math.max(0, this._rowHeight - 2)));
    this._backgroundTile.setAttribute("fill", ColorConfig.pitchRow);
    this._svgBackground.setAttribute("width", String(this._editorWidth));
    this._svgBackground.setAttribute("height", String(this._editorHeight));
    this._svgPlayhead.setAttribute("height", String(this._editorHeight));

    const selections: SVGRectElement[] = [];
    if (this._interactive) {
      for (const rowIndex of this.selection.rangeRows()) {
        const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
        if (range == null) continue;
        selections.push(SVG.rect({
          x: String(this._partWidth * range.start),
          y: String(rowIndex * this._rowHeight + 1),
          width: String(this._partWidth * (range.end - range.start)),
          height: String(Math.max(0, this._rowHeight - 2)),
          fill: ColorConfig.boxSelectionFill,
          stroke: ColorConfig.text,
          "stroke-width": "2",
          "stroke-dasharray": "5, 3",
        }));
      }
    }
    this._svgSelections.replaceChildren(...selections);

    const paths: SVGPathElement[] = [];
    for (let rowIndex: number = 0; rowIndex < rowCount; rowIndex++) {
      const domain: AutomationValueDomain | null =
        channel.automationRows[rowIndex].getValueDomain();
      for (const event of pattern?.automationEvents[rowIndex] ?? []) {
        paths.push(SVG.path({
          d: this._eventPath(event, rowIndex, domain, false),
          fill: "var(--automation-secondary-note)",
        }));
        paths.push(SVG.path({
          d: this._eventPath(event, rowIndex, domain, true),
          fill: "var(--automation-primary-note)",
        }));
      }
    }
    this._svgEvents.replaceChildren(...paths);

    if (this._interactive) {
      if (this._drag == null) this._updateCursor();
      this._updatePreview();
    }
    if (this._blurSvg != null) {
      this._blurSvg.replaceChildren(this._svgContent.cloneNode(true));
    }
  }
}
