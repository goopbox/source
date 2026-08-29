// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config, type AutomationValueDomain } from "../synth/SynthConfig.js";
import {
  Event,
  EventPoint,
  AutomationRow,
  ChannelKind,
  mapAutomationClipboardValue,
  sanitizeAutomationValue,
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
  bendEvent,
  clipEvent,
  cloneEvents,
  deleteEventRange,
  editEventTime,
  eventPath,
  moveEventRange,
  nearestEventPointIndex,
  repeatEvents,
} from "./EventEditing.js";
import {
  ChangeEvents,
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
  readonly startX: number;
  readonly startY: number;
  readonly original: Event[];
  readonly originalRange: AutomationRowSelection | null;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly cursorPart: number;
  readonly anchorStart: number;
  readonly anchorEnd: number;
  dragging: boolean;
  horizontal: boolean;
  previewEvent: Event | null;
  change: ChangeEvents | null;
}

interface AutomationCursor {
  valid: boolean;
  rowIndex: number;
  exactPart: number;
  part: number;
  eventIndex: number;
  event: Event | null;
  previous: Event | null;
  next: Event | null;
  start: number;
  end: number;
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

  public render(): void {
    if (!this._doc.song.getChannelIsAutomation(this._doc.channel)) return;
    const channel = this._doc.song.channels[this._doc.channel];
    if (document.activeElement != this._rowsInput)
      this._rowsInput.value = String(channel.automationRows.length);
    const rowCountControl: HTMLDivElement = HTML.div(
      { class: "selectRow" },
      HTML.label("Rows"),
      this._rowsInput,
    );
    const groups: HTMLDivElement[] = [rowCountControl];
    for (let rowIndex: number = 0; rowIndex < channel.automationRows.length; rowIndex++) {
      const row: AutomationRow = channel.automationRows[rowIndex];
      groups.push(
        HTML.div(
          { class: "settingsGroup automation-surface" },
          HTML.div({ class: "settingsGroupTitle" }, HTML.span(`Automation ${rowIndex + 1}`)),
          HTML.div({ class: "selectRow" }, this._makeTargetSelect(row, rowIndex)),
          ...(row.targetChannel == -1 && !row.targetChannelMissing
            ? []
            : [HTML.div({ class: "selectRow" }, this._makeInstrumentSelect(row, rowIndex))]),
          HTML.div({ class: "selectRow" }, this._makeElementSelect(row, rowIndex)),
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
    this._mouseX = (event.clientX - rect.left) *
      (rect.width > 0 ? this._editorWidth / rect.width : 1);
    this._mouseY = (event.clientY - rect.top) *
      (rect.height > 0 ? this._editorHeight / rect.height : 1);
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
    const events: readonly Event[] =
      pattern?.automationEvents[cursor.rowIndex] ?? [];
    const matchingPart: number = Math.max(
      0,
      Math.min(this._partsPerBar() - 0.0001, cursor.exactPart),
    );
    for (let index: number = 0; index < events.length; index++) {
      const event: Event = events[index];
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
  ): Event | null {
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
      start = Math.max(0, start);
      end = Math.min(this._partsPerBar(), end);
    }
    if (start >= end) return null;
    const domain: AutomationValueDomain | null = this._rowDomain(drag.rowIndex);
    const value: number = domain?.max ?? 0;
    return new Event(start, end, [
      new EventPoint(0, value),
      new EventPoint(end - start, value),
    ]);
  }

  private _nearestPointIndex(event: Event, absolutePart: number): number {
    return nearestEventPointIndex(
      event,
      absolutePart,
      this._partWidth > 0 ? 5 / this._partWidth : 0,
    );
  }

  private _editEventHorizontally(
    drag: AutomationDrag,
    currentPart: number,
  ): Event[] {
    const delta: number = currentPart - drag.cursorPart;
    return editEventTime(
      drag.original,
      drag.eventIndex,
      drag.pointIndex,
      delta,
      this._getMinDivision(),
      this._partsPerBar(),
      Config.automationPointsPerEventMax,
    );
  }

  private _editEventVertically(
    drag: AutomationDrag,
    currentPart: number,
    pointerY: number,
    uniform: boolean,
  ): Event[] {
    const replacement: Event[] = cloneEvents(drag.original);
    const event: Event | undefined = drag.original[drag.eventIndex];
    const domain: AutomationValueDomain | null = this._rowDomain(drag.rowIndex);
    if (event == undefined || domain == null) return replacement;
    const selectedPoint: EventPoint | undefined = event.points[drag.pointIndex];
    const bendPart: number = selectedPoint == undefined
      ? currentPart
      : event.start + selectedPoint.time;
    const pixelsForFullRange: number = Math.max(40, this._rowHeight * 1.5);
    const valueDelta: number =
      ((drag.startY - pointerY) / pixelsForFullRange) *
      (domain.max - domain.min);
    replacement[drag.eventIndex] = bendEvent(
      event,
      bendPart,
      valueDelta,
      (value: number): number => sanitizeAutomationValue(value, domain),
      uniform,
      Config.automationPointsPerEventMax,
    );
    return replacement;
  }

  private _applyReplacement(
    drag: AutomationDrag,
    replacement: Event[],
  ): void {
    if (replacement.length > Config.automationEventsPerRowMax) return;
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return;
    drag.change = new ChangeEvents(
      this._doc,
      pattern.automationEvents[drag.rowIndex],
      replacement,
    );
    this._doc.setProspectiveChange(drag.change);
  }

  private _restoreDrag(drag: AutomationDrag): void {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern != null && drag.change != null) {
      new ChangeEvents(
        this._doc,
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
    const original: Event[] = cloneEvents(
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
      startX: this._mouseX,
      startY: this._mouseY,
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

    const dx: number = this._mouseX - drag.startX;
    const dy: number = this._mouseY - drag.startY;
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
        const replacement: Event[] = drag.horizontal
          ? this._editEventHorizontally(drag, currentPart)
          : this._editEventVertically(
              drag,
              currentPart,
              this._mouseY,
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
        } else if (drag.eventIndex >= 0) {
          this._applyReplacement(
            drag,
            this._editEventVertically(drag, currentPart, this._mouseY, true),
          );
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
              new ChangeEvents(
                this._doc,
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
          moveEventRange(drag.original, drag.originalRange, delta),
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
      const automationEvent: Event | null = drag.previewEvent;
      if (automationEvent != null) {
        const group: ChangeGroup = new ChangeGroup();
        const pattern: Pattern | null = this._ensurePattern(group);
        if (pattern != null) {
          pattern.ensureAutomationRowCount(drag.rowIndex + 1);
          const oldEvents: Event[] = pattern.automationEvents[drag.rowIndex];
          const replacement: Event[] = deleteEventRange(
            oldEvents,
            automationEvent.start,
            automationEvent.end,
          ).concat(automationEvent).sort(
              (a: Event, b: Event): number => a.start - b.start,
          );
          if (replacement.length <= Config.automationEventsPerRowMax) {
            group.append(
              new ChangeEvents(
                this._doc,
                pattern.automationEvents[drag.rowIndex],
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
          const oldEvents: Event[] = pattern.automationEvents[drag.rowIndex];
          const replacement: Event[] = oldEvents.filter(
            (_event: Event, index: number): boolean =>
              index != drag.eventIndex,
          );
          this._doc.record(
            new ChangeEvents(
              this._doc,
              pattern.automationEvents[drag.rowIndex],
              replacement,
            ),
          );
        }
      }
    } else if (drag.mode == "selection") {
      if (drag.change != null) {
        this._doc.record(drag.change);
      } else if (!drag.dragging || !drag.horizontal) {
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
    event: Event,
    rowIndex: number,
    domain: AutomationValueDomain | null,
    showValue: boolean,
  ): string {
    const centerY: number = (rowIndex + 0.5) * this._rowHeight;
    return eventPath(event, {
      partWidth: this._partWidth,
      radius: Math.max(1, this._rowHeight / 2 + 1),
      centerY: (): number => centerY,
      valueScale: (point: EventPoint): number => showValue
        ? this._normalizedValue(point.value, domain)
        : 1,
    });
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
    const event: Event | null =
      this._drag?.previewEvent ??
      this._cursor.event ??
      (() => {
        const domain: AutomationValueDomain | null =
          this._rowDomain(this._cursor.rowIndex);
        const value: number = domain?.max ?? 0;
        return new Event(this._cursor.start, this._cursor.end, [
          new EventPoint(0, value),
          new EventPoint(this._cursor.end - this._cursor.start, value),
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

  private _copySelected(): boolean {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const rowIndex: number = this.selection.activeRow;
    const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
    const row: AutomationRow | undefined =
      this._doc.song.channels[this._doc.channel].automationRows[rowIndex];
    if (pattern == null || range == null || row == undefined) return false;
    const events: Event[] = [];
    for (const event of pattern.automationEvents[rowIndex] ?? []) {
      const clipped: Event | null = clipEvent(
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
      domain: row.getValueDomain(),
      events: events.map((event: Event) => ({
        start: event.start,
        end: event.end,
        points: event.points.map((point: EventPoint) => ({
          time: point.time,
          value: point.value,
        })),
      })),
    };
    window.localStorage.setItem("automationCopy", JSON.stringify(copy));
    return true;
  }

  public copy(): boolean {
    const copied: boolean = this._copySelected();
    this.clearSelection();
    return copied;
  }

  public deleteSelected(): boolean {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return false;
    const group: ChangeGroup = new ChangeGroup();
    let changed: boolean = false;
    for (const rowIndex of this.selection.rangeRows()) {
      const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
      if (range == null) continue;
      const oldEvents: Event[] = pattern.automationEvents[rowIndex] ?? [];
      const replacement: Event[] = deleteEventRange(
        oldEvents,
        range.start,
        range.end,
      );
      if (replacement.length > Config.automationEventsPerRowMax) continue;
      if (
        replacement.length == oldEvents.length &&
        replacement.every(
          (event: Event, index: number): boolean =>
            event.start == oldEvents[index].start &&
            event.end == oldEvents[index].end,
        )
      ) continue;
      group.append(
        new ChangeEvents(
          this._doc,
          pattern.automationEvents[rowIndex],
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
    if (!this._copySelected()) {
      this.clearSelection();
      return false;
    }
    return this.deleteSelected();
  }

  public paste(): boolean {
    try {
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
      const selectedRange: AutomationRowSelection | null =
        this.selection.getRange(rowIndex);
      const destination: AutomationRowSelection = selectedRange ?? {
        start: 0,
        end: this._partsPerBar(),
      };
      const destinationDomain: AutomationValueDomain | null = row.getValueDomain();
      const compatible: boolean =
        value.targetId == row.targetId &&
        value.targetIndex == row.targetIndex;
      const sourceEvents: Event[] = value.events.map(
        (source): Event => new Event(
          source.start,
          source.end,
          source.points.map(
            (point): EventPoint => new EventPoint(
              point.time,
              mapAutomationClipboardValue(
                point.value,
                compatible,
                value.domain,
                destinationDomain,
              ),
            ),
          ),
        ),
      );
      const pasted: Event[] = repeatEvents(
        sourceEvents,
        value.duration,
        destination,
      );
      if (pasted.length == 0) return false;
      const existingPattern: Pattern | null =
        this._doc.getCurrentPattern(this._barOffset);
      const existingEvents: Event[] =
        existingPattern?.automationEvents[rowIndex] ?? [];
      const replacement: Event[] = deleteEventRange(
        existingEvents,
        destination.start,
        destination.end,
      ).concat(pasted).sort(
        (a: Event, b: Event): number => a.start - b.start,
      );
      if (replacement.length > Config.automationEventsPerRowMax) return false;
      const group: ChangeGroup = new ChangeGroup();
      const pattern: Pattern | null = this._ensurePattern(group);
      if (pattern == null) return false;
      pattern.ensureAutomationRowCount(rowIndex + 1);
      group.append(
        new ChangeEvents(
          this._doc,
          pattern.automationEvents[rowIndex],
          replacement,
        ),
      );
      this._doc.record(group);
      return true;
    } finally {
      this.selection.clearRanges();
      this.render();
    }
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
