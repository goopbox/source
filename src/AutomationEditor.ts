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
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { SongDocument } from "./SongDocument.js";
import { AutomationRowSelectionState } from "./AutomationSelection.js";
import { ChangeGroup } from "./Change.js";
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
  readonly version: 1;
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
  readonly mode: "move" | "start" | "end" | "point";
  readonly startClientX: number;
  readonly startClientY: number;
  readonly original: AutomationEvent[];
  change: ChangeAutomationEvents | null;
}

function cloneEvents(events: readonly AutomationEvent[]): AutomationEvent[] {
  return events.map((event: AutomationEvent): AutomationEvent => event.clone());
}

function isAutomationClipboard(value: unknown): value is AutomationClipboard {
  if (value == null || typeof value != "object") return false;
  const copy = value as Partial<AutomationClipboard>;
  if (
    copy.version != 1 ||
    typeof copy.targetId != "string" ||
    !Number.isInteger(copy.targetIndex) ||
    !Number.isInteger(copy.operation) ||
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
    this.container.style.setProperty(
      "--beats-per-bar",
      String(this._doc.song.beatsPerBar),
    );
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
  public readonly container: HTMLDivElement = HTML.div({
    class: "automation-editor noSelection",
  });
  public readonly selection: AutomationRowSelectionState =
    new AutomationRowSelectionState();
  private _drag: AutomationDrag | null = null;
  private _lastMousePart: number = 0;

  public constructor(
    private readonly _doc: SongDocument,
    private readonly _interactive: boolean,
    private readonly _barOffset: number,
  ) {
    if (!_interactive) this.container.classList.add("automation-preview");
    this.container.addEventListener("dblclick", this._onDoubleClick);
    this.container.addEventListener("contextmenu", this._onContextMenu);
    if (_interactive) {
      this.container.addEventListener("pointerdown", this._onPointerDown);
      this.container.addEventListener("pointermove", this._onPointerMove);
      this.container.addEventListener("pointerup", this._onPointerUp);
      this.container.addEventListener("pointercancel", this._onPointerCancel);
    }
  }

  private _partsPerBar(): number {
    return this._doc.song.beatsPerBar * Config.partsPerBeat;
  }

  private _getLane(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(".automation-lane") : null;
  }

  private _getLiveTarget(event: MouseEvent): Element | null {
    // Pointer-down rendering replaces the lane, so the browser retargets the
    // resulting double-click to the editor container.
    const eventTarget: EventTarget | null = event.target;
    if (eventTarget instanceof Element && this._getLane(eventTarget) != null)
      return eventTarget;
    const target: Element | null = document.elementFromPoint(
      event.clientX,
      event.clientY,
    );
    return target != null && this.container.contains(target) ? target : null;
  }

  private _partAt(clientX: number, lane: HTMLElement): number {
    const rect: DOMRect = lane.getBoundingClientRect();
    return Math.max(0, Math.min(this._partsPerBar(), ((clientX - rect.left) / rect.width) * this._partsPerBar()));
  }

  private _snapPart(part: number): number {
    return Math.round(part * 4) / 4;
  }

  private _valueAt(clientY: number, lane: HTMLElement, domain: AutomationValueDomain | null): number {
    if (domain == null) return 0;
    const rect: DOMRect = lane.getBoundingClientRect();
    const normalized: number = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    const value: number = domain.min + normalized * (domain.max - domain.min);
    return domain.integer ? Math.round(value) : value;
  }

  private _ensurePattern(group?: ChangeGroup): Pattern | null {
    const bar: number = this._doc.bar + this._barOffset;
    if (bar < 0 || bar >= this._doc.song.barCount) return null;
    if (this._doc.getCurrentPattern(this._barOffset) == null) {
      const ensure = new ChangeEnsurePatternExists(this._doc, this._doc.channel, bar);
      if (group == undefined) this._doc.record(ensure);
      else group.append(ensure);
    }
    return this._doc.getCurrentPattern(this._barOffset);
  }

  private _onDoubleClick = (event: MouseEvent): void => {
    if (!this._interactive) return;
    const target: Element | null = this._getLiveTarget(event);
    const lane: HTMLElement | null = this._getLane(target);
    if (lane == null) return;
    const rowIndex: number = Number(lane.dataset["row"]);
    const group: ChangeGroup = new ChangeGroup();
    const pattern: Pattern | null = this._ensurePattern(group);
    if (pattern == null) return;
    pattern.ensureAutomationRowCount(rowIndex + 1);
    const row: AutomationRow =
      this._doc.song.channels[this._doc.channel].automationRows[rowIndex];
    const domain: AutomationValueDomain | null = row.getValueDomain();
    const eventElement: HTMLElement | null =
      target?.closest<HTMLElement>(".automation-event") ?? null;
    if (eventElement != null) {
      const eventIndex: number = Number(eventElement.dataset["event"]);
      const oldEvents: AutomationEvent[] = pattern.automationEvents[rowIndex];
      const replacement: AutomationEvent[] = cloneEvents(oldEvents);
      const automationEvent: AutomationEvent = replacement[eventIndex];
      if (automationEvent.points.length >= Config.automationPointsPerEventMax) return;
      const absolutePart: number = this._snapPart(this._partAt(event.clientX, lane));
      const time: number = Math.max(0, Math.min(automationEvent.end - automationEvent.start, absolutePart - automationEvent.start));
      if (automationEvent.points.some((point): boolean => point.time == time)) return;
      automationEvent.points.push(
        new AutomationPoint(time, this._valueAt(event.clientY, lane, domain)),
      );
      automationEvent.points.sort((a, b) => a.time - b.time);
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
      this.render();
      return;
    }
    const events: AutomationEvent[] = pattern.automationEvents[rowIndex];
    const requestedStart: number = Math.min(
      this._partsPerBar() - 0.25,
      this._snapPart(this._partAt(event.clientX, lane)),
    );
    const previous: AutomationEvent | undefined = [...events]
      .reverse()
      .find((candidate): boolean => candidate.end <= requestedStart);
    const next: AutomationEvent | undefined = events.find(
      (candidate): boolean => candidate.start >= requestedStart,
    );
    const start: number = Math.max(previous?.end ?? 0, requestedStart);
    const end: number = Math.min(
      next?.start ?? this._partsPerBar(),
      start + Config.partsPerBeat,
    );
    if (end - start < 0.25) return;
    const value: number = this._valueAt(event.clientY, lane, domain);
    const oldEvents: AutomationEvent[] = events;
    const replacement: AutomationEvent[] = cloneEvents(oldEvents);
    replacement.push(
      new AutomationEvent(start, end, [
        new AutomationPoint(0, value),
        new AutomationPoint(end - start, value),
      ]),
    );
    replacement.sort((a, b) => a.start - b.start);
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
    const newIndex: number = replacement.findIndex(
      (candidate): boolean => candidate.start == start && candidate.end == end,
    );
    this.selection.selectOnly(rowIndex, [newIndex]);
    this.render();
  };

  private _onContextMenu = (event: MouseEvent): void => {
    if (!this._interactive || !(event.target instanceof Element)) return;
    const lane: HTMLElement | null = this._getLane(event.target);
    const eventElement: HTMLElement | null =
      event.target.closest<HTMLElement>(".automation-event");
    const pointElement: HTMLElement | null =
      event.target.closest<HTMLElement>(".automation-point");
    if (lane == null || eventElement == null || pointElement == null) return;
    const rowIndex: number = Number(lane.dataset["row"]);
    const eventIndex: number = Number(eventElement.dataset["event"]);
    const pointIndex: number = Number(pointElement.dataset["point"]);
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const oldEvents: AutomationEvent[] | undefined =
      pattern?.automationEvents[rowIndex];
    const automationEvent: AutomationEvent | undefined =
      oldEvents?.[eventIndex];
    if (
      pattern == null ||
      oldEvents == undefined ||
      automationEvent == undefined ||
      automationEvent.points.length <= 2 ||
      pointIndex <= 0 ||
      pointIndex >= automationEvent.points.length - 1
    ) return;
    const replacement: AutomationEvent[] = cloneEvents(oldEvents);
    replacement[eventIndex].points.splice(pointIndex, 1);
    this._doc.record(
      new ChangeAutomationEvents(
        this._doc,
        pattern,
        rowIndex,
        oldEvents,
        replacement,
      ),
    );
    event.preventDefault();
    this.render();
  };

  private _onPointerDown = (event: PointerEvent): void => {
    const lane: HTMLElement | null = this._getLane(event.target);
    if (lane == null || !(event.target instanceof Element)) return;
    const eventElement: HTMLElement | null = event.target.closest<HTMLElement>(".automation-event");
    const rowIndex: number = Number(lane.dataset["row"]);
    this.selection.activeRow = rowIndex;
    this._lastMousePart = this._partAt(event.clientX, lane);
    if (eventElement == null) {
      this.render();
      return;
    }
    const eventIndex: number = Number(eventElement.dataset["event"]);
    this.selection.select(rowIndex, eventIndex, event.ctrlKey || event.metaKey || event.shiftKey);
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return;
    const handle: HTMLElement | null = event.target.closest<HTMLElement>("[data-handle]");
    const point: HTMLElement | null = event.target.closest<HTMLElement>(".automation-point");
    const mode: AutomationDrag["mode"] = point != null
      ? "point"
      : handle?.dataset["handle"] == "start"
        ? "start"
        : handle?.dataset["handle"] == "end"
          ? "end"
          : "move";
    this._drag = {
      pointerId: event.pointerId,
      rowIndex,
      eventIndex,
      pointIndex: point == null ? -1 : Number(point.dataset["point"]),
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      original: cloneEvents(pattern.automationEvents[rowIndex]),
      change: null,
    };
    this.container.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.render();
  };

  private _onPointerMove = (event: PointerEvent): void => {
    const lane: HTMLElement | null = this._getLane(event.target) ??
      this.container.querySelector<HTMLElement>(`.automation-lane[data-row="${this._drag?.rowIndex ?? -1}"]`);
    if (lane != null) this._lastMousePart = this._partAt(event.clientX, lane);
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId || lane == null) return;
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return;
    const replacement: AutomationEvent[] = cloneEvents(drag.original);
    const automationEvent: AutomationEvent | undefined = replacement[drag.eventIndex];
    if (automationEvent == undefined) return;
    const rect: DOMRect = lane.getBoundingClientRect();
    const deltaPart: number = this._snapPart(((event.clientX - drag.startClientX) / rect.width) * this._partsPerBar());
    const duration: number = automationEvent.end - automationEvent.start;
    const previousEvent: AutomationEvent | undefined = replacement[drag.eventIndex - 1];
    const nextEvent: AutomationEvent | undefined = replacement[drag.eventIndex + 1];
    if (drag.mode == "move") {
      const start: number = Math.max(
        previousEvent?.end ?? 0,
        Math.min(
          (nextEvent?.start ?? this._partsPerBar()) - duration,
          automationEvent.start + deltaPart,
        ),
      );
      automationEvent.start = start;
      automationEvent.end = start + duration;
    } else if (drag.mode == "start") {
      const oldStart: number = automationEvent.start;
      const start: number = Math.max(
        previousEvent?.end ?? 0,
        Math.min(automationEvent.end - 0.25, oldStart + deltaPart),
      );
      const newDuration: number = automationEvent.end - start;
      automationEvent.start = start;
      for (const point of automationEvent.points)
        point.time = (point.time * newDuration) / duration;
      automationEvent.points[0].time = 0;
      automationEvent.points[automationEvent.points.length - 1].time = automationEvent.end - automationEvent.start;
    } else if (drag.mode == "end") {
      automationEvent.end = Math.max(
        automationEvent.start + 0.25,
        Math.min(nextEvent?.start ?? this._partsPerBar(), automationEvent.end + deltaPart),
      );
      const newDuration: number = automationEvent.end - automationEvent.start;
      for (const point of automationEvent.points)
        point.time = (point.time * newDuration) / duration;
      automationEvent.points[0].time = 0;
      automationEvent.points[automationEvent.points.length - 1].time = newDuration;
    } else {
      const row: AutomationRow =
        this._doc.song.channels[this._doc.channel].automationRows[drag.rowIndex];
      const point: AutomationPoint | undefined = automationEvent.points[drag.pointIndex];
      if (point == undefined) return;
      const first: boolean = drag.pointIndex == 0;
      const last: boolean = drag.pointIndex == automationEvent.points.length - 1;
      const previousTime: number = automationEvent.points[drag.pointIndex - 1]?.time ?? 0;
      const nextTime: number = automationEvent.points[drag.pointIndex + 1]?.time ?? duration;
      point.time = first
        ? 0
        : last
          ? duration
          : Math.max(
              previousTime + 0.001,
              Math.min(nextTime - 0.001, this._snapPart(point.time + deltaPart)),
            );
      point.value = this._valueAt(event.clientY, lane, row.getValueDomain());
    }
    replacement.sort((a, b) => a.start - b.start);
    drag.change = new ChangeAutomationEvents(
      this._doc,
      pattern,
      drag.rowIndex,
      pattern.automationEvents[drag.rowIndex],
      replacement,
    );
    this._doc.setProspectiveChange(drag.change);
    event.preventDefault();
    this.render();
  };

  private _onPointerUp = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId) return;
    if (drag.change != null) this._doc.record(drag.change);
    this._drag = null;
    this.container.releasePointerCapture(event.pointerId);
    this.render();
  };

  private _onPointerCancel = (event: PointerEvent): void => {
    const drag: AutomationDrag | null = this._drag;
    if (drag == null || drag.pointerId != event.pointerId) return;
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern != null) {
      new ChangeAutomationEvents(
        this._doc,
        pattern,
        drag.rowIndex,
        pattern.automationEvents[drag.rowIndex],
        drag.original,
      );
    }
    this._doc.forgetLastChange();
    this._drag = null;
    this.render();
  };

  public movePlayheadToMouse(): boolean {
    if (!this._interactive || !this.container.matches(":hover")) return false;
    this._doc.synth.playhead = this._doc.bar + this._lastMousePart / this._partsPerBar();
    return true;
  }

  public copy(): boolean {
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    if (pattern == null) return false;
    const rowIndex: number = this.selection.activeRow;
    const row: AutomationRow | undefined =
      this._doc.song.channels[this._doc.channel].automationRows[rowIndex];
    if (row == undefined) return false;
    const selected: number[] = this.selection.getSelected(rowIndex);
    if (selected.length == 0) return false;
    const events: AutomationEvent[] = selected
      .map((index: number): AutomationEvent | undefined => pattern.automationEvents[rowIndex]?.[index])
      .filter((event): event is AutomationEvent => event != undefined);
    if (events.length == 0) return false;
    const copy: AutomationClipboard = {
      version: 1,
      targetId: row.targetId,
      targetIndex: row.targetIndex,
      operation: row.operation,
      domain: row.getValueDomain(),
      events: events.map((event): AutomationClipboard["events"][number] => ({
        start: event.start,
        end: event.end,
        points: event.points.map((point) => ({ time: point.time, value: point.value })),
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
    for (const rowIndex of this.selection.rows()) {
      const selected: Set<number> = new Set(this.selection.getSelected(rowIndex));
      const oldEvents: AutomationEvent[] = pattern.automationEvents[rowIndex] ?? [];
      const replacement: AutomationEvent[] = oldEvents.filter(
        (_event, eventIndex): boolean => !selected.has(eventIndex),
      );
      if (replacement.length == oldEvents.length) continue;
      group.append(
        new ChangeAutomationEvents(this._doc, pattern, rowIndex, oldEvents, replacement),
      );
      this.selection.selectOnly(rowIndex, []);
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
    const group: ChangeGroup = new ChangeGroup();
    const pattern: Pattern | null = this._ensurePattern(group);
    if (pattern == null) return false;
    const destinationDomain: AutomationValueDomain | null = row.getValueDomain();
    const compatible: boolean =
      value.targetId == row.targetId &&
      value.targetIndex == row.targetIndex &&
      value.operation == row.operation;
    const pasted: AutomationEvent[] = value.events.map((source): AutomationEvent => {
      const points: AutomationPoint[] = source.points.map((point): AutomationPoint => {
        const pointValue: number = mapAutomationClipboardValue(
          point.value,
          compatible,
          value.domain,
          destinationDomain,
        );
        return new AutomationPoint(point.time, pointValue);
      });
      return new AutomationEvent(source.start, source.end, points);
    });
    pattern.ensureAutomationRowCount(rowIndex + 1);
    const oldEvents: AutomationEvent[] = pattern.automationEvents[rowIndex];
    const replacement: AutomationEvent[] = cloneEvents(oldEvents)
      .filter(
        (existing): boolean =>
          !pasted.some(
            (incoming): boolean =>
              existing.start < incoming.end && incoming.start < existing.end,
          ),
      )
      .concat(pasted);
    replacement.sort((a, b) => a.start - b.start);
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
    const pastedSet: Set<AutomationEvent> = new Set(pasted);
    this.selection.selectOnly(
      rowIndex,
      replacement.flatMap((event, index): number[] =>
        pastedSet.has(event) ? [index] : [],
      ),
    );
    this.render();
    return true;
  }

  private _renderEvent(
    lane: HTMLDivElement,
    event: AutomationEvent,
    row: AutomationRow,
    rowIndex: number,
    eventIndex: number,
  ): void {
    const domain: AutomationValueDomain | null = row.getValueDomain();
    const duration: number = event.end - event.start;
    const element: HTMLDivElement = HTML.div({
      class: `automation-event${this.selection.isSelected(rowIndex, eventIndex) ? " selected" : ""}`,
      "data-event": String(eventIndex),
      style: `left:${(event.start / this._partsPerBar()) * 100}%;width:${(duration / this._partsPerBar()) * 100}%;`,
      title: `${event.start} -> ${event.end}`,
    });
    element.appendChild(HTML.span({ class: "automation-resize start", "data-handle": "start" }));
    for (let pointIndex: number = 0; pointIndex < event.points.length; pointIndex++) {
      const point: AutomationPoint = event.points[pointIndex];
      const normalized: number =
        domain == null || domain.max == domain.min
          ? 0.5
          : (point.value - domain.min) / (domain.max - domain.min);
      element.appendChild(
        HTML.button({
          type: "button",
          class: "automation-point",
          "data-point": String(pointIndex),
          style: `left:${duration <= 0 ? 0 : (point.time / duration) * 100}%;bottom:${Math.max(0, Math.min(1, normalized)) * 100}%;`,
          title: String(point.value),
          "aria-label": `Point ${pointIndex + 1}, value ${point.value}`,
        }),
      );
    }
    element.appendChild(HTML.span({ class: "automation-resize end", "data-handle": "end" }));
    lane.appendChild(element);
  }

  public render(): void {
    if (!this._doc.song.getChannelIsAutomation(this._doc.channel)) return;
    this.container.style.setProperty(
      "--beats-per-bar",
      String(this._doc.song.beatsPerBar),
    );
    const channel = this._doc.song.channels[this._doc.channel];
    const pattern: Pattern | null = this._doc.getCurrentPattern(this._barOffset);
    const eventCounts: number[] = channel.automationRows.map(
      (_row, rowIndex): number => pattern?.automationEvents[rowIndex]?.length ?? 0,
    );
    this.selection.trim(channel.automationRows.length, eventCounts);
    const rows: HTMLDivElement[] = [];
    for (let rowIndex: number = 0; rowIndex < channel.automationRows.length; rowIndex++) {
      const lane: HTMLDivElement = HTML.div({
        class: `automation-lane${this.selection.activeRow == rowIndex ? " active" : ""}`,
        "data-row": String(rowIndex),
      });
      lane.appendChild(HTML.span({ class: "automation-row-number" }, String(rowIndex + 1)));
      const events: AutomationEvent[] = pattern?.automationEvents[rowIndex] ?? [];
      for (let eventIndex: number = 0; eventIndex < events.length; eventIndex++) {
        this._renderEvent(
          lane,
          events[eventIndex],
          channel.automationRows[rowIndex],
          rowIndex,
          eventIndex,
        );
      }
      rows.push(lane);
    }
    this.container.replaceChildren(...rows);
  }
}
