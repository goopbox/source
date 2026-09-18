// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  type AutomationRow,
  ChannelKind,
  Event,
  EventPoint,
  type Pattern,
  mapAutomationClipboardValue,
  sanitizeAutomationValue,
} from "../synth/synth.js";
import {
  type AutomationRowSelection,
  AutomationRowSelectionState,
} from "./automation-selection.js";
import { type AutomationValueDomain, Config } from "../synth/synth-config.js";
import {
  ChangeAutomationRowCount,
  ChangeAutomationTargetChannel,
  ChangeAutomationTargetElement,
  ChangeAutomationTargetInstrument,
  ChangeEnsurePatternExists,
  ChangeEvents,
} from "./changes.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
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
} from "./event-editing.js";
import { ChangeGroup } from "./change.js";
import { ColorConfig } from "./color-config.js";
import type { SongDocument } from "./song-document.js";
import { prettyNumber } from "./editor-config.js";

interface AutomationClipboard {
  readonly version: 2;
  readonly duration: number;
  readonly targetId: string;
  readonly targetIndex: number;
  readonly domain: AutomationValueDomain | null;
  readonly events: {
    start: number;
    end: number;
    points: { time: number; value: number }[];
  }[];
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
  if (value == null || typeof value !== "object") {
    return false;
  }
  const copy = value as Partial<AutomationClipboard>;
  if (
    copy.version !== 2 ||
    !Number.isFinite(copy.duration) ||
    copy.duration! <= 0 ||
    typeof copy.targetId !== "string" ||
    copy.targetId.length === 0 ||
    copy.targetId.length > Config.automationTargetIdLengthMax ||
    !Number.isInteger(copy.targetIndex) ||
    copy.targetIndex! < 0 ||
    copy.targetIndex! > Config.automationTargetIndexMax ||
    !Array.isArray(copy.events) ||
    copy.events.length > Config.automationEventsPerRowMax
  ) {
    return false;
  }
  if (
    copy.domain != null &&
    (!Number.isFinite(copy.domain.min) ||
      !Number.isFinite(copy.domain.max) ||
      typeof copy.domain.integer !== "boolean" ||
      copy.domain.max < copy.domain.min)
  ) {
    return false;
  }
  for (const event of copy.events) {
    if (
      event == null ||
      typeof event !== "object" ||
      !Number.isFinite(event.start) ||
      !Number.isFinite(event.end) ||
      event.start < 0 ||
      event.end > copy.duration! ||
      event.end <= event.start ||
      !Array.isArray(event.points) ||
      event.points.length === 0 ||
      event.points.length > Config.automationPointsPerEventMax
    ) {
      return false;
    }
    let previousTime = -1;
    for (let pointIndex = 0; pointIndex < event.points.length; pointIndex++) {
      const point = event.points[pointIndex]!;
      if (
        point == null ||
        typeof point !== "object" ||
        !Number.isFinite(point.time) ||
        !Number.isFinite(point.value) ||
        Math.abs(point.value) > Config.automationValueMagnitudeMax ||
        (copy.domain != null && (point.value < copy.domain.min || point.value > copy.domain.max)) ||
        point.time <= previousTime ||
        point.time < 0 ||
        point.time > event.end - event.start ||
        (pointIndex === 0 && point.time !== 0)
      ) {
        return false;
      }
      previousTime = point.time;
    }
  }
  return true;
}

export class AutomationSettings {
  readonly #doc: SongDocument;
  public readonly container: HTMLDivElement = HTML.div({
    class: "automation-settings editor-controls groupedSettings",
  });
  readonly #rowsInput: HTMLInputElement = HTML.input({
    type: "number",
    min: String(Config.automationRowCountMin),
    max: String(Config.automationRowCountMax),
    step: "1",
  });

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.#rowsInput.addEventListener("change", (): void => {
      const value: number = Math.max(
        Config.automationRowCountMin,
        Math.min(Config.automationRowCountMax, Math.floor(Number(this.#rowsInput.value))),
      );
      this.#doc.record(new ChangeAutomationRowCount(this.#doc, value));
    });
  }

  #targetName(index: number): string {
    const kind: ChannelKind = this.#doc.song.getChannelKind(index),
      relative: number = this.#doc.song.getChannelIndexInKind(index) + 1;
    return `${kind === ChannelKind.pitch ? "Pitch" : "Noise"} ${relative}`;
  }

  #makeTargetSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select();
    menu.append(HTML.option({ value: "-1" }, "Song"));
    for (let channelIndex = 0; channelIndex < this.#doc.song.getChannelCount(); channelIndex++) {
      if (this.#doc.song.getChannelIsAutomation(channelIndex)) {
        continue;
      }
      menu.append(HTML.option({ value: String(channelIndex) }, this.#targetName(channelIndex)));
    }
    const valid: boolean =
      row.targetChannel === -1
        ? !row.targetChannelMissing
        : !row.targetChannelMissing &&
          row.targetChannel >= 0 &&
          row.targetChannel < this.#doc.song.getChannelCount() &&
          !this.#doc.song.getChannelIsAutomation(row.targetChannel) &&
          this.#doc.song.getChannelKind(row.targetChannel) === row.targetChannelKind;
    if (valid) {
      menu.value = String(row.targetChannel);
    } else {
      const relative: number = Math.max(0, row.targetChannel) + 1,
        kind: string = row.targetChannelKind === ChannelKind.noise ? "Noise" : "Pitch";
      menu.appendChild(
        HTML.option(
          { value: "missing", selected: true, disabled: true },
          `Missing ${kind} ${relative}`,
        ),
      );
      menu.classList.add("invalid-reference");
    }
    menu.addEventListener("change", (): void => {
      this.#doc.record(new ChangeAutomationTargetChannel(this.#doc, rowIndex, Number(menu.value)));
    });
    return menu;
  }

  #makeInstrumentSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select();
    if (row.targetChannel === -1 && !row.targetChannelMissing) {
      menu.append(HTML.option({ value: "-1" }, "N/A"));
      menu.disabled = true;
      return menu;
    }
    const channel = this.#doc.song.channels[row.targetChannel]!;
    if (channel !== undefined && !this.#doc.song.getChannelIsAutomation(row.targetChannel)) {
      for (let index = 0; index < channel.instruments.length; index++) {
        menu.append(HTML.option({ value: String(index) }, `Instrument ${index + 1}`));
      }
    }
    const valid: boolean =
      !row.targetChannelMissing &&
      !row.targetInstrumentMissing &&
      channel !== undefined &&
      row.targetInstrument >= 0 &&
      row.targetInstrument < channel.instruments.length;
    if (valid) {
      menu.value = String(row.targetInstrument);
    } else {
      menu.appendChild(
        HTML.option(
          { value: "missing", selected: true, disabled: true },
          `Missing Instrument ${Math.max(0, row.targetInstrument) + 1}`,
        ),
      );
      menu.classList.add("invalid-reference");
      menu.disabled = row.targetChannelMissing;
    }
    menu.addEventListener("change", (): void => {
      this.#doc.record(
        new ChangeAutomationTargetInstrument(this.#doc, rowIndex, Number(menu.value)),
      );
    });
    return menu;
  }

  #makeElementSelect(row: AutomationRow, rowIndex: number): HTMLSelectElement {
    const menu: HTMLSelectElement = HTML.select(),
      choices: { id: string; index: number; name: string }[] = [];
    if (row.targetChannel === -1 && !row.targetChannelMissing) {
      const tempo = Config.modulationTargets.dictionary["tempo"]!;
      choices.push({ id: tempo.name, index: 0, name: tempo.displayName });
    } else if (!row.targetChannelMissing && !row.targetInstrumentMissing) {
      const instrument =
        this.#doc.song.channels[row.targetChannel]?.instruments[row.targetInstrument];
      if (instrument !== undefined) {
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
      menu.append(HTML.option({ value: `${choice.id}:${choice.index}` }, choice.name));
    }
    const currentValue = `${row.targetId}:${row.targetIndex}`,
      valid: boolean =
        !row.targetElementMissing &&
        choices.some((choice): boolean => `${choice.id}:${choice.index}` === currentValue);
    if (valid) {
      menu.value = currentValue;
    } else {
      menu.appendChild(
        HTML.option(
          { value: "missing", selected: true, disabled: true },
          `Missing ${row.targetId}${row.targetIndex > 0 ? ` ${row.targetIndex + 1}` : ""}`,
        ),
      );
      menu.classList.add("invalid-reference");
      if (choices.length === 0) {
        menu.disabled = true;
      }
    }
    menu.addEventListener("change", (): void => {
      const separator: number = menu.value.lastIndexOf(":");
      this.#doc.record(
        new ChangeAutomationTargetElement(
          this.#doc,
          rowIndex,
          menu.value.slice(0, separator),
          Number(menu.value.slice(separator + 1)),
        ),
      );
    });
    return menu;
  }

  public render(): void {
    if (!this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      return;
    }
    const channel = this.#doc.song.channels[this.#doc.channel]!;
    if (document.activeElement !== this.#rowsInput) {
      this.#rowsInput.value = String(channel.automationRows.length);
    }
    const rowCountControl: HTMLDivElement = HTML.div(
        { class: "selectRow" },
        HTML.label("Rows"),
        this.#rowsInput,
      ),
      groups: HTMLDivElement[] = [rowCountControl];
    for (let rowIndex = 0; rowIndex < channel.automationRows.length; rowIndex++) {
      const row: AutomationRow = channel.automationRows[rowIndex]!;
      groups.push(
        HTML.div(
          { class: "settingsGroup automation-surface" },
          HTML.div({ class: "settingsGroupTitle" }, HTML.span(`Automation ${rowIndex + 1}`)),
          HTML.div({ class: "selectRow" }, this.#makeTargetSelect(row, rowIndex)),
          ...(row.targetChannel === -1 && !row.targetChannelMissing
            ? []
            : [HTML.div({ class: "selectRow" }, this.#makeInstrumentSelect(row, rowIndex))]),
          HTML.div({ class: "selectRow" }, this.#makeElementSelect(row, rowIndex)),
        ),
      );
    }
    this.container.replaceChildren(...groups);
  }
}

export class AutomationEditor {
  readonly #doc: SongDocument;
  readonly #interactive: boolean;
  readonly #barOffset: number;
  public readonly container: HTMLDivElement;
  public readonly selection: AutomationRowSelectionState = new AutomationRowSelectionState();

  readonly #backgroundPattern: SVGPatternElement;
  readonly #backgroundTile: SVGRectElement = SVG.rect();
  readonly #svgBackground: SVGRectElement = SVG.rect({
    "pointer-events": "none",
  });
  readonly #svgSelections: SVGGElement = SVG.g({
    "pointer-events": "none",
  });
  readonly #svgEvents: SVGGElement = SVG.g({
    "pointer-events": "none",
  });
  readonly #secondaryNoteGradient = ColorConfig.svgGradient([
    "var(--channel-secondary-note-start)",
    "var(--channel-secondary-note-end)",
  ]);
  readonly #primaryNoteGradient = ColorConfig.svgGradient([
    "var(--channel-primary-note-start)",
    "var(--channel-primary-note-end)",
  ]);
  readonly #svgPreview: SVGPathElement = SVG.path({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": "2",
    "pointer-events": "none",
  });
  readonly #svgPreviewFill: SVGPathElement = SVG.path({
    display: "none",
    fill: this.#secondaryNoteGradient.paint,
    "pointer-events": "none",
  });
  readonly #svgPlayhead: SVGRectElement = SVG.rect({
    width: "4",
    fill: ColorConfig.text,
    "pointer-events": "none",
  });
  readonly #svgContent: SVGGElement;
  readonly #svg: SVGSVGElement;
  readonly #blurSvg: SVGSVGElement | null;

  #drag: AutomationDrag | null = null;
  #cursor: AutomationCursor = this.#emptyCursor();
  #editorWidth = 0;
  #editorHeight = 0;
  #rowHeight = 0;
  #partWidth = 0;
  #mouseX = -1;
  #mouseY = -1;
  #pointerPresent = false;
  #lastMousePart = 0;

  public constructor(_doc: SongDocument, _interactive: boolean, _barOffset: number) {
    this.#doc = _doc;
    this.#interactive = _interactive;
    this.#barOffset = _barOffset;
    const patternId = `automationEditorBackground${_barOffset}`;
    this.#backgroundPattern = SVG.pattern(
      {
        id: patternId,
        x: "0",
        y: "0",
        patternUnits: "userSpaceOnUse",
      },
      this.#backgroundTile,
    );
    this.#svgBackground.setAttribute("fill", `url(#${patternId})`);
    this.#svgContent = SVG.g(
      this.#svgBackground,
      this.#svgSelections,
      this.#svgEvents,
      this.#svgPreviewFill,
      this.#svgPreview,
      this.#svgPlayhead,
    );
    this.#svg = SVG.svg(
      {
        class: "automation-editor-svg",
        width: "100%",
        height: "100%",
        role: _interactive ? "application" : "img",
        "aria-label": _interactive ? "Automation pattern editor" : "Automation pattern preview",
      },
      SVG.defs(
        this.#backgroundPattern,
        this.#secondaryNoteGradient.definition,
        this.#primaryNoteGradient.definition,
      ),
      this.#svgContent,
    );
    this.container = HTML.div({ class: "automation-editor noSelection" }, this.#svg);

    if (_interactive) {
      this.#blurSvg = null;
      this.#svg.addEventListener("pointerenter", this.#onPointerEnter);
      this.#svg.addEventListener("pointerleave", this.#onPointerLeave);
      this.#svg.addEventListener("pointerdown", this.#onPointerDown);
      this.#svg.addEventListener("pointermove", this.#onPointerMove);
      this.#svg.addEventListener("pointerup", this.#onPointerUp);
      this.#svg.addEventListener("pointercancel", this.#onPointerCancel);
      window.requestAnimationFrame(this.#animatePlayhead);
    } else {
      this.container.classList.add(
        "pattern-preview",
        _barOffset < 0 ? "pattern-preview-previous" : "pattern-preview-next",
      );
      this.#svg.classList.add("pattern-preview-sharp");
      this.#svgPlayhead.style.display = "none";
      this.#svgPreview.style.display = "none";
      this.#blurSvg = SVG.svg({
        class: "pattern-preview-blur",
        width: "100%",
        height: "100%",
        "aria-hidden": "true",
      });
      this.container.insertBefore(this.#blurSvg, this.#svg);
    }
  }

  #emptyCursor(): AutomationCursor {
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

  #partsPerBar(): number {
    return this.#doc.song.beatsPerBar * Config.partsPerBeat;
  }

  #getMinDivision(): number {
    return Config.partsPerBeat / Config.rhythms[this.#doc.song.rhythm]!.stepsPerBeat;
  }

  #getMaxDivision(): number {
    const stepsPerBeat: number = Config.rhythms[this.#doc.song.rhythm]!.stepsPerBeat;
    if (stepsPerBeat % 4 === 0) {
      return Config.partsPerBeat / 2;
    }
    if (stepsPerBeat % 3 === 0) {
      return Config.partsPerBeat / 3;
    }
    if (stepsPerBeat % 2 === 0) {
      return Config.partsPerBeat / 2;
    }
    return Config.partsPerBeat;
  }

  #snapPart(part: number): number {
    const division: number = this.#getMinDivision();
    return Math.floor(part / division) * division;
  }

  #clampPart(part: number): number {
    return Math.max(0, Math.min(this.#partsPerBar(), part));
  }

  #updateMouse(event: PointerEvent): void {
    const rect: DOMRect = this.#svg.getBoundingClientRect();
    this.#mouseX =
      (event.clientX - rect.left) * (rect.width > 0 ? this.#editorWidth / rect.width : 1);
    this.#mouseY =
      (event.clientY - rect.top) * (rect.height > 0 ? this.#editorHeight / rect.height : 1);
    if (this.#partWidth > 0) {
      this.#lastMousePart = this.#clampPart(this.#mouseX / this.#partWidth);
    }
  }

  #updateCursor(): void {
    const cursor: AutomationCursor = this.#emptyCursor();
    this.#cursor = cursor;
    const channel = this.#doc.song.channels[this.#doc.channel]!;
    if (
      !this.#interactive ||
      this.#editorWidth <= 0 ||
      this.#editorHeight <= 0 ||
      this.#rowHeight <= 0 ||
      this.#mouseX < 0 ||
      this.#mouseX > this.#editorWidth ||
      this.#mouseY < 0 ||
      this.#mouseY > this.#editorHeight ||
      channel.automationRows.length === 0
    ) {
      return;
    }

    cursor.rowIndex = Math.max(
      0,
      Math.min(channel.automationRows.length - 1, Math.floor(this.#mouseY / this.#rowHeight)),
    );
    cursor.exactPart = this.#clampPart(this.#mouseX / this.#partWidth);
    const minDivision: number = this.#getMinDivision();
    cursor.part = this.#snapPart(
      Math.max(0, Math.min(this.#partsPerBar() - minDivision, cursor.exactPart)),
    );

    const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset),
      events: readonly Event[] = pattern?.automationEvents[cursor.rowIndex] ?? [],
      matchingPart: number = Math.max(0, Math.min(this.#partsPerBar() - 0.0001, cursor.exactPart));
    for (let index = 0; index < events.length; index++) {
      const event: Event = events[index]!;
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

    if (cursor.event == null) {
      const defaultLength: number = this.#getMaxDivision(),
        fullBeats: number = Math.floor(cursor.part / Config.partsPerBeat),
        modMouse: number = cursor.part % Config.partsPerBeat;
      cursor.start = fullBeats * Config.partsPerBeat;
      if (defaultLength < Config.partsPerBeat) {
        cursor.start += Math.floor(modMouse / defaultLength) * defaultLength;
      }
      cursor.end = cursor.start + defaultLength;
      const forceStart: number = cursor.previous?.end ?? 0,
        forceEnd: number = cursor.next?.start ?? this.#partsPerBar();
      if (cursor.start < forceStart) {
        cursor.start = forceStart;
        cursor.end = Math.min(forceEnd, cursor.start + defaultLength);
      } else if (cursor.end > forceEnd) {
        cursor.end = forceEnd;
        cursor.start = Math.max(forceStart, cursor.end - defaultLength);
      }
      if (cursor.start >= cursor.end) {
        return;
      }
    } else {
      cursor.start = cursor.event.start;
      cursor.end = cursor.event.end;
    }
    cursor.valid = true;
  }

  #selectionHandle(rowIndex: number, start: boolean): boolean {
    const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
    if (range == null || this.#partWidth <= 0) {
      return false;
    }
    const edge: number = start ? range.start : range.end;
    return Math.abs(this.#cursor.exactPart - edge) <= 5 / this.#partWidth;
  }

  #cursorIsInSelection(): boolean {
    return (
      this.#cursor.valid && this.selection.contains(this.#cursor.rowIndex, this.#cursor.exactPart)
    );
  }

  #selectionAnchor(cursor: AutomationCursor): AutomationRowSelection {
    if (cursor.event != null) {
      return { start: cursor.event.start, end: cursor.event.end };
    }
    const start: number = Math.max(
      0,
      Math.min(
        (this.#doc.song.beatsPerBar - 1) * Config.partsPerBeat,
        Math.floor(cursor.exactPart / Config.partsPerBeat) * Config.partsPerBeat,
      ),
    );
    return { start, end: start + Config.partsPerBeat };
  }

  #rowDomain(rowIndex: number): AutomationValueDomain | null {
    return (
      this.#doc.song.channels[this.#doc.channel]!.automationRows[rowIndex]?.getValueDomain() ?? null
    );
  }

  #makeCreationEvent(drag: AutomationDrag, currentPart: number, dragged: boolean): Event | null {
    let start: number = drag.cursorStart,
      end: number = drag.cursorEnd;
    if (dragged) {
      const minDivision: number = this.#getMinDivision();
      if (currentPart < drag.cursorPart) {
        start = currentPart;
        end = drag.cursorPart + minDivision;
      } else {
        start = drag.cursorPart;
        end = currentPart + minDivision;
      }
      start = Math.max(0, start);
      end = Math.min(this.#partsPerBar(), end);
    }
    if (start >= end) {
      return null;
    }
    const domain: AutomationValueDomain | null = this.#rowDomain(drag.rowIndex),
      value: number = domain?.max ?? 0;
    return new Event(start, end, [new EventPoint(0, value), new EventPoint(end - start, value)]);
  }

  #nearestPointIndex(event: Event, absolutePart: number): number {
    return nearestEventPointIndex(
      event,
      absolutePart,
      this.#partWidth > 0 ? 5 / this.#partWidth : 0,
    );
  }

  #editEventHorizontally(drag: AutomationDrag, currentPart: number): Event[] {
    const event: Event | undefined = drag.original[drag.eventIndex]!,
      lastPointIndex: number = (event?.points.length ?? 0) - 1,
      pointPart: number =
        drag.pointIndex === 0
          ? (event?.start ?? drag.cursorPart)
          : drag.pointIndex === lastPointIndex
            ? (event?.end ?? drag.cursorPart)
            : (event?.start ?? 0) + (event?.points[drag.pointIndex]?.time ?? drag.cursorPart),
      delta: number = currentPart - pointPart;
    return editEventTime(
      drag.original,
      drag.eventIndex,
      drag.pointIndex,
      delta,
      this.#getMinDivision(),
      this.#partsPerBar(),
      Config.automationPointsPerEventMax,
    );
  }

  #editEventVertically(
    drag: AutomationDrag,
    currentPart: number,
    pointerY: number,
    uniform: boolean,
  ): Event[] {
    const replacement: Event[] = cloneEvents(drag.original),
      event: Event | undefined = drag.original[drag.eventIndex]!,
      domain: AutomationValueDomain | null = this.#rowDomain(drag.rowIndex);
    if (event === undefined || domain == null) {
      return replacement;
    }
    const selectedPoint: EventPoint | undefined = event.points[drag.pointIndex]!,
      bendPart: number =
        selectedPoint === undefined ? currentPart : event.start + selectedPoint.time,
      pixelsForFullRange: number = Math.max(40, this.#rowHeight * 1.5),
      valueDelta: number =
        ((drag.startY - pointerY) / pixelsForFullRange) * (domain.max - domain.min);
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

  #applyReplacement(drag: AutomationDrag, replacement: Event[]): void {
    if (replacement.length > Config.automationEventsPerRowMax) {
      return;
    }
    const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset);
    if (pattern == null) {
      return;
    }
    if (drag.change != null) {
      drag.change.undo();
    }
    drag.change = new ChangeEvents(
      this.#doc,
      pattern.automationEvents[drag.rowIndex]!,
      replacement,
    );
    this.#doc.setProspectiveChange(drag.change);
  }

  #restoreDrag(drag: AutomationDrag): void {
    if (drag.change != null) {
      drag.change.undo();
    }
    if (drag.originalRange == null) {
      this.selection.clearRange(drag.rowIndex);
    } else {
      this.selection.setRange(drag.rowIndex, drag.originalRange.start, drag.originalRange.end);
    }
    this.#doc.forgetLastChange();
  }

  #onPointerEnter = (event: PointerEvent): void => {
    this.#pointerPresent = true;
    this.#updateMouse(event);
    this.#updateCursor();
    this.#updatePreview();
  };

  #onPointerLeave = (): void => {
    if (this.#drag == null) {
      this.#pointerPresent = false;
    }
    this.#updatePreview();
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.#pointerPresent = true;
    this.#updateMouse(event);
    this.#updateCursor();
    if (!this.#cursor.valid) {
      return;
    }

    const cursor: AutomationCursor = this.#cursor,
      rowIndex: number = cursor.rowIndex;
    this.selection.activeRow = rowIndex;
    const originalRange: AutomationRowSelection | null = this.selection.getRange(rowIndex),
      anchor: AutomationRowSelection = this.#selectionAnchor(cursor);
    let mode: AutomationDrag["mode"];
    if (this.#selectionHandle(rowIndex, true)) {
      mode = "selection-start";
    } else if (this.#selectionHandle(rowIndex, false)) {
      mode = "selection-end";
    } else if (event.shiftKey) {
      mode = "selection";
    } else if (this.#cursorIsInSelection()) {
      mode = "selection-contents";
    } else {
      mode = cursor.event == null ? "create" : "event";
    }

    if (mode === "create" || mode === "event") {
      this.selection.clearRange(rowIndex);
    }
    const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset),
      original: Event[] = cloneEvents(pattern?.automationEvents[rowIndex] ?? []),
      pointIndex: number =
        cursor.event == null ? -1 : this.#nearestPointIndex(cursor.event, cursor.exactPart),
      drag: AutomationDrag = {
        pointerId: event.pointerId,
        rowIndex,
        eventIndex: cursor.eventIndex,
        pointIndex,
        mode,
        startX: this.#mouseX,
        startY: this.#mouseY,
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
    if (mode === "create") {
      drag.previewEvent = this.#makeCreationEvent(drag, cursor.part, false);
    }
    this.#drag = drag;
    this.#svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.render();
  };

  #onPointerMove = (event: PointerEvent): void => {
    this.#updateMouse(event);
    const drag: AutomationDrag | null = this.#drag;
    if (drag == null || drag.pointerId !== event.pointerId) {
      this.#updateCursor();
      this.#updatePreview();
      return;
    }

    const dx: number = this.#mouseX - drag.startX,
      dy: number = this.#mouseY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) > 5) {
      drag.dragging = true;
      drag.horizontal = Math.abs(dx) >= Math.abs(dy);
    }
    if (!drag.dragging) {
      return;
    }

    const currentPart: number = this.#snapPart(this.#lastMousePart);
    switch (drag.mode) {
      case "create": {
        drag.previewEvent = this.#makeCreationEvent(drag, currentPart, drag.horizontal);
        break;
      }
      case "event": {
        const replacement: Event[] = drag.horizontal
          ? this.#editEventHorizontally(drag, currentPart)
          : this.#editEventVertically(
              drag,
              currentPart,
              this.#mouseY,
              event.ctrlKey || event.metaKey,
            );
        this.#applyReplacement(drag, replacement);
        break;
      }
      case "selection-start": {
        const end: number = drag.originalRange?.end ?? drag.anchorEnd;
        this.selection.setRange(drag.rowIndex, this.#clampPart(currentPart), end);
        break;
      }
      case "selection-end": {
        const start: number = drag.originalRange?.start ?? drag.anchorStart;
        this.selection.setRange(drag.rowIndex, start, this.#clampPart(currentPart));
        break;
      }
      case "selection": {
        if (drag.horizontal) {
          if (currentPart < drag.anchorStart) {
            this.selection.setRange(drag.rowIndex, currentPart, drag.anchorEnd);
          } else {
            this.selection.setRange(
              drag.rowIndex,
              drag.anchorStart,
              Math.min(this.#partsPerBar(), currentPart + this.#getMinDivision()),
            );
          }
        } else if (drag.eventIndex >= 0) {
          this.#applyReplacement(
            drag,
            this.#editEventVertically(drag, currentPart, this.#mouseY, true),
          );
        }
        break;
      }
      case "selection-contents": {
        if (!drag.horizontal || drag.originalRange == null) {
          break;
        }
        const division: number = this.#getMinDivision();
        let delta: number = Math.round(dx / (this.#partWidth * division)) * division;
        delta = Math.max(
          -drag.originalRange.start,
          Math.min(this.#partsPerBar() - drag.originalRange.end, delta),
        );
        if (delta === 0) {
          if (drag.change != null) {
            drag.change.undo();
            drag.change = null;
            this.#doc.forgetLastChange();
          }
          this.selection.setRange(drag.rowIndex, drag.originalRange.start, drag.originalRange.end);
          break;
        }
        this.selection.setRange(
          drag.rowIndex,
          drag.originalRange.start + delta,
          drag.originalRange.end + delta,
        );
        this.#applyReplacement(drag, moveEventRange(drag.original, drag.originalRange, delta));
        break;
      }
    }
    event.preventDefault();
    this.render();
  };

  #onPointerUp = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this.#drag;
    if (drag == null || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.mode === "create") {
      const automationEvent: Event | null = drag.previewEvent;
      if (automationEvent != null) {
        const group: ChangeGroup = new ChangeGroup(),
          pattern: Pattern | null = this.#ensurePattern(group);
        if (pattern != null) {
          pattern.ensureAutomationRowCount(drag.rowIndex + 1);
          const oldEvents: Event[] = pattern.automationEvents[drag.rowIndex]!,
            replacement: Event[] = deleteEventRange(
              oldEvents,
              automationEvent.start,
              automationEvent.end,
            )
              .concat(automationEvent)
              .sort((a: Event, b: Event): number => a.start - b.start);
          if (replacement.length <= Config.automationEventsPerRowMax) {
            group.append(
              new ChangeEvents(this.#doc, pattern.automationEvents[drag.rowIndex]!, replacement),
            );
            this.#doc.record(group);
          }
        }
      }
    } else if (drag.mode === "event") {
      if (drag.change != null) {
        this.#doc.record(drag.change);
      } else if (!drag.dragging) {
        const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset);
        if (pattern != null && drag.eventIndex >= 0) {
          const oldEvents: Event[] = pattern.automationEvents[drag.rowIndex]!,
            replacement: Event[] = oldEvents.filter(
              (_event: Event, index: number): boolean => index !== drag.eventIndex,
            );
          this.#doc.record(
            new ChangeEvents(this.#doc, pattern.automationEvents[drag.rowIndex]!, replacement),
          );
        }
      }
    } else if (drag.mode === "selection") {
      if (drag.change != null) {
        this.#doc.record(drag.change);
      } else if (!drag.dragging || !drag.horizontal) {
        if (
          drag.originalRange != null &&
          drag.originalRange.start <= this.#cursor.exactPart &&
          this.#cursor.exactPart <= drag.originalRange.end
        ) {
          this.selection.clearRange(drag.rowIndex);
        } else {
          this.selection.setRange(drag.rowIndex, drag.anchorStart, drag.anchorEnd);
        }
      }
    } else if (drag.mode === "selection-contents" && drag.change != null) {
      this.#doc.record(drag.change);
    }

    this.#drag = null;
    if (this.#svg.hasPointerCapture(event.pointerId)) {
      this.#svg.releasePointerCapture(event.pointerId);
    }
    this.#updateCursor();
    this.render();
  };

  #onPointerCancel = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this.#drag;
    if (drag == null || drag.pointerId !== event.pointerId) {
      return;
    }
    this.#restoreDrag(drag);
    this.#drag = null;
    this.#updateCursor();
    this.render();
  };

  #ensurePattern(group?: ChangeGroup): Pattern | null {
    const bar: number = this.#doc.bar + this.#barOffset;
    if (bar < 0 || bar >= this.#doc.song.barCount) {
      return null;
    }
    if (this.#doc.getCurrentPattern(this.#barOffset) == null) {
      const ensure: ChangeEnsurePatternExists = new ChangeEnsurePatternExists(
        this.#doc,
        this.#doc.channel,
        bar,
      );
      if (group === undefined) {
        this.#doc.record(ensure);
      } else {
        group.append(ensure);
      }
    }
    return this.#doc.getCurrentPattern(this.#barOffset);
  }

  #normalizedValue(value: number, domain: AutomationValueDomain | null): number {
    if (domain == null || domain.max === domain.min) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
  }

  #eventPath(
    event: Event,
    rowIndex: number,
    domain: AutomationValueDomain | null,
    showValue: boolean,
  ): string {
    const centerY: number = (rowIndex + 0.5) * this.#rowHeight;
    return eventPath(event, {
      partWidth: this.#partWidth,
      radius: Math.max(1, this.#rowHeight / 2 + 1),
      centerY: (): number => centerY,
      valueScale: (point: EventPoint): number =>
        showValue ? this.#normalizedValue(point.value, domain) : 1,
    });
  }

  #selectionPath(range: AutomationRowSelection, rowIndex: number): string {
    const left: number = this.#partWidth * range.start,
      right: number = this.#partWidth * range.end,
      top: number = rowIndex * this.#rowHeight + 1,
      bottom: number = (rowIndex + 1) * this.#rowHeight - 1;
    return `M ${prettyNumber(left)} ${prettyNumber(top)} L ${prettyNumber(right)} ${prettyNumber(top)} L ${prettyNumber(right)} ${prettyNumber(bottom)} L ${prettyNumber(left)} ${prettyNumber(bottom)} z`;
  }

  #updatePreview(): void {
    if (
      !this.#interactive ||
      !this.#pointerPresent ||
      !this.#cursor.valid ||
      (this.#drag != null && this.#drag.mode !== "create")
    ) {
      this.#svgPreviewFill.setAttribute("display", "none");
      this.#svgPreview.setAttribute("display", "none");
      return;
    }
    this.#svgPreview.setAttribute("display", "");
    const creating: boolean = this.#drag?.mode === "create";
    this.#svgPreview.setAttribute("fill", creating ? this.#primaryNoteGradient.paint : "none");
    this.#svgPreview.setAttribute("stroke", creating ? "none" : ColorConfig.text);
    const range: AutomationRowSelection | null = this.selection.getRange(this.#cursor.rowIndex);
    if (
      range != null &&
      (this.#selectionHandle(this.#cursor.rowIndex, true) ||
        this.#selectionHandle(this.#cursor.rowIndex, false) ||
        this.#cursorIsInSelection())
    ) {
      this.#svgPreview.setAttribute("d", this.#selectionPath(range, this.#cursor.rowIndex));
      this.#svgPreviewFill.setAttribute("display", "none");
      return;
    }
    const event: Event | null =
      this.#drag?.previewEvent ??
      this.#cursor.event ??
      (() => {
        const domain: AutomationValueDomain | null = this.#rowDomain(this.#cursor.rowIndex),
          value: number = domain?.max ?? 0;
        return new Event(this.#cursor.start, this.#cursor.end, [
          new EventPoint(0, value),
          new EventPoint(this.#cursor.end - this.#cursor.start, value),
        ]);
      })();
    this.#svgPreview.setAttribute(
      "d",
      this.#eventPath(event, this.#cursor.rowIndex, this.#rowDomain(this.#cursor.rowIndex), true),
    );
    if (creating) {
      this.#svgPreviewFill.setAttribute("display", "");
      this.#svgPreviewFill.setAttribute(
        "d",
        this.#eventPath(
          event,
          this.#cursor.rowIndex,
          this.#rowDomain(this.#cursor.rowIndex),
          false,
        ),
      );
    } else {
      this.#svgPreviewFill.setAttribute("display", "none");
    }
  }

  #animatePlayhead = (): void => {
    const playheadBar: number = Math.floor(this.#doc.synth.playhead);
    if (this.#doc.synth.playing && playheadBar === this.#doc.bar + this.#barOffset) {
      this.#svgPlayhead.setAttribute("display", "");
      const target: number = this.#doc.synth.playhead - playheadBar;
      this.#svgPlayhead.setAttribute("x", prettyNumber(target * this.#editorWidth - 2));
    } else {
      this.#svgPlayhead.setAttribute("display", "none");
    }
    window.requestAnimationFrame(this.#animatePlayhead);
  };

  public movePlayheadToMouse(): boolean {
    if (!this.#interactive || !this.#pointerPresent) {
      return false;
    }
    this.#doc.synth.playhead =
      this.#doc.bar + this.#barOffset + this.#lastMousePart / this.#partsPerBar();
    return true;
  }

  public clearSelection(): void {
    this.selection.clearRanges();
    this.render();
  }

  public selectAll(): void {
    this.selection.setRange(this.selection.activeRow, 0, this.#partsPerBar());
    this.render();
  }

  #copySelected(): boolean {
    const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset),
      rowIndex: number = this.selection.activeRow,
      range: AutomationRowSelection | null = this.selection.getRange(rowIndex),
      row: AutomationRow | undefined =
        this.#doc.song.channels[this.#doc.channel]!.automationRows[rowIndex]!;
    if (pattern == null || range == null || row === undefined) {
      return false;
    }
    const events: Event[] = [];
    for (const event of pattern.automationEvents[rowIndex] ?? []) {
      const clipped: Event | null = clipEvent(event, range.start, range.end);
      if (clipped == null) {
        continue;
      }
      clipped.start -= range.start;
      clipped.end -= range.start;
      events.push(clipped);
    }
    if (events.length === 0) {
      return false;
    }
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
    const copied: boolean = this.#copySelected();
    this.clearSelection();
    return copied;
  }

  public deleteSelected(): boolean {
    const pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset);
    if (pattern == null) {
      return false;
    }
    const group: ChangeGroup = new ChangeGroup();
    let changed = false;
    for (const rowIndex of this.selection.rangeRows()) {
      const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
      if (range == null) {
        continue;
      }
      const oldEvents: Event[] = pattern.automationEvents[rowIndex] ?? [],
        replacement: Event[] = deleteEventRange(oldEvents, range.start, range.end);
      if (replacement.length > Config.automationEventsPerRowMax) {
        continue;
      }
      if (
        replacement.length === oldEvents.length &&
        replacement.every(
          (event: Event, index: number): boolean =>
            event.start === oldEvents[index]!.start && event.end === oldEvents[index]!.end,
        )
      ) {
        continue;
      }
      group.append(new ChangeEvents(this.#doc, pattern.automationEvents[rowIndex]!, replacement));
      this.selection.clearRange(rowIndex);
      changed = true;
    }
    if (changed) {
      this.#doc.record(group);
    }
    this.render();
    return changed;
  }

  public cut(): boolean {
    if (!this.#copySelected()) {
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
      if (!isAutomationClipboard(value)) {
        return false;
      }
      const rowIndex: number = this.selection.activeRow,
        row: AutomationRow | undefined =
          this.#doc.song.channels[this.#doc.channel]!.automationRows[rowIndex]!;
      if (row === undefined) {
        return false;
      }
      const selectedRange: AutomationRowSelection | null = this.selection.getRange(rowIndex),
        destination: AutomationRowSelection = selectedRange ?? {
          start: 0,
          end: this.#partsPerBar(),
        },
        destinationDomain: AutomationValueDomain | null = row.getValueDomain(),
        compatible: boolean =
          value.targetId === row.targetId && value.targetIndex === row.targetIndex,
        sourceEvents: Event[] = value.events.map(
          (source): Event =>
            new Event(
              source.start,
              source.end,
              source.points.map(
                (point): EventPoint =>
                  new EventPoint(
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
        ),
        pasted: Event[] = repeatEvents(sourceEvents, value.duration, destination);
      if (pasted.length === 0) {
        return false;
      }
      const existingPattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset),
        existingEvents: Event[] = existingPattern?.automationEvents[rowIndex] ?? [],
        replacement: Event[] = deleteEventRange(existingEvents, destination.start, destination.end)
          .concat(pasted)
          .sort((a: Event, b: Event): number => a.start - b.start);
      if (replacement.length > Config.automationEventsPerRowMax) {
        return false;
      }
      const group: ChangeGroup = new ChangeGroup(),
        pattern: Pattern | null = this.#ensurePattern(group);
      if (pattern == null) {
        return false;
      }
      pattern.ensureAutomationRowCount(rowIndex + 1);
      group.append(new ChangeEvents(this.#doc, pattern.automationEvents[rowIndex]!, replacement));
      this.#doc.record(group);
      return true;
    } finally {
      this.selection.clearRanges();
      this.render();
    }
  }

  public render(): void {
    if (!this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      return;
    }
    const channel = this.#doc.song.channels[this.#doc.channel]!,
      rowCount: number = channel.automationRows.length,
      pattern: Pattern | null = this.#doc.getCurrentPattern(this.#barOffset);
    this.selection.trim(rowCount, this.#partsPerBar());

    this.#editorWidth = this.container.clientWidth;
    this.#editorHeight = this.container.clientHeight;
    this.#rowHeight = rowCount === 0 ? 0 : this.#editorHeight / rowCount;
    this.#partWidth = this.#partsPerBar() === 0 ? 0 : this.#editorWidth / this.#partsPerBar();
    const beatWidth: number = this.#editorWidth / this.#doc.song.beatsPerBar;
    this.#backgroundPattern.setAttribute("width", String(beatWidth));
    this.#backgroundPattern.setAttribute("height", String(this.#rowHeight));
    this.#backgroundTile.setAttribute("x", "1");
    this.#backgroundTile.setAttribute("y", "1");
    this.#backgroundTile.setAttribute("width", String(Math.max(0, beatWidth - 2)));
    this.#backgroundTile.setAttribute("height", String(Math.max(0, this.#rowHeight - 2)));
    this.#backgroundTile.setAttribute("fill", ColorConfig.pitchRow);
    this.#svgBackground.setAttribute("width", String(this.#editorWidth));
    this.#svgBackground.setAttribute("height", String(this.#editorHeight));
    this.#svgPlayhead.setAttribute("height", String(this.#editorHeight));

    const selections: SVGRectElement[] = [];
    if (this.#interactive) {
      for (const rowIndex of this.selection.rangeRows()) {
        const range: AutomationRowSelection | null = this.selection.getRange(rowIndex);
        if (range == null) {
          continue;
        }
        selections.push(
          SVG.rect({
            x: String(this.#partWidth * range.start),
            y: String(rowIndex * this.#rowHeight + 1),
            width: String(this.#partWidth * (range.end - range.start)),
            height: String(Math.max(0, this.#rowHeight - 2)),
            fill: ColorConfig.boxSelectionFill,
            stroke: ColorConfig.text,
            "stroke-width": "2",
            "stroke-dasharray": "5, 3",
          }),
        );
      }
    }
    this.#svgSelections.replaceChildren(...selections);

    const paths: SVGPathElement[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const domain: AutomationValueDomain | null =
        channel.automationRows[rowIndex]!.getValueDomain();
      for (const event of pattern?.automationEvents[rowIndex] ?? []) {
        paths.push(
          SVG.path({
            d: this.#eventPath(event, rowIndex, domain, false),
            fill: this.#secondaryNoteGradient.paint,
          }),
          SVG.path({
            d: this.#eventPath(event, rowIndex, domain, true),
            fill: this.#primaryNoteGradient.paint,
          }),
        );
      }
    }
    this.#svgEvents.replaceChildren(...paths);

    if (this.#interactive) {
      if (this.#drag == null) {
        this.#updateCursor();
      }
      this.#updatePreview();
    }
    if (this.#blurSvg != null) {
      this.#blurSvg.replaceChildren(this.#svgContent.cloneNode(true));
    }
  }
}
