// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeBarOrder, ChangeChannelBar, ChangeChannelOrder } from "./changes.js";
import { EasyPointers, type Point2d } from "./easy-pointers.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { ChangeGroup } from "./change.js";
import { ChannelRow } from "./channel-row.js";
import { ColorConfig } from "./color-config.js";
import type { SongDocument } from "./song-document.js";

interface ReorderDrag {
  kind: "bar" | "channel";
  source: number;
  target: number;
  startPointer: number;
  offset: number;
  moved: boolean;
}

export class TrackEditor {
  #doc: SongDocument;
  public static readonly channelNumberWidth: number = 18;
  public static readonly barNumberHeight: number = 10;
  readonly #barNumbers: HTMLElement[] = [];
  readonly #barNumberContainer: HTMLElement = HTML.div(
    { class: "barNumbers" },
    HTML.div({ class: "trackCorner" }),
  );
  readonly #channelRowContainer: HTMLElement = HTML.div({
    style: "display: flex; flex-direction: column;",
  });
  readonly #playhead: SVGRectElement = SVG.rect({
    fill: ColorConfig.text,
    x: 0,
    y: 0,
    width: 4,
    height: 128,
  });
  readonly #boxHighlight: SVGRectElement = SVG.rect({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": 2,
    "pointer-events": "none",
    x: 1,
    y: 1,
    width: 30,
    height: 30,
  });
  readonly #upHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.background,
    stroke: ColorConfig.background,
    "stroke-width": 1,
    "pointer-events": "none",
  });
  readonly #downHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.background,
    stroke: ColorConfig.background,
    "stroke-width": 1,
    "pointer-events": "none",
  });
  readonly #selectionRect: SVGRectElement = SVG.rect({
    fill: ColorConfig.boxSelectionFill,
    stroke: ColorConfig.text,
    "stroke-width": 2,
    "stroke-dasharray": "5, 3",
    "pointer-events": "none",
    display: "none",
    x: 1,
    y: 1,
    width: 62,
    height: 62,
  });
  readonly #svg: SVGSVGElement = SVG.svg(
    { style: `position: absolute; top: ${TrackEditor.barNumberHeight}px;` },
    this.#selectionRect,
    this.#boxHighlight,
    this.#upHighlight,
    this.#downHighlight,
    this.#playhead,
  );
  readonly #barReorderLine: HTMLElement = HTML.div({
    class: "reorder-line vertical",
  });
  readonly #channelReorderLine: HTMLElement = HTML.div({
    class: "reorder-line horizontal",
  });
  public readonly container: HTMLElement = HTML.div(
    { class: "noSelection", style: "position: relative;" },
    this.#barNumberContainer,
    this.#channelRowContainer,
    this.#svg,
    this.#barReorderLine,
    this.#channelReorderLine,
  );

  readonly #pointers: EasyPointers = new EasyPointers(this.container);

  readonly #channels: ChannelRow[] = [];
  #pointerX = 0;
  #pointerY = 0;
  #mouseX = 0;
  #mouseY = 0;
  #mouseStartBar = 0;
  #mouseStartChannel = 0;
  #mouseBar = 0;
  #mouseChannel = 0;
  #mouseDragging = false;
  #reorderDrag: ReorderDrag | null = null;
  #barWidth = 32;
  #renderedEditorWidth = -1;
  #renderedEditorHeight = -1;
  #renderedPlayhead = -1;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    window.requestAnimationFrame(this.#animatePlayhead);

    this.container.addEventListener("pointerenter", this.#onPointerMove);
    this.container.addEventListener("pointerleave", this.#onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerCancel);
  }

  #animatePlayhead = (_timestamp: number): void => {
    const playhead = TrackEditor.channelNumberWidth + this.#barWidth * this.#doc.synth.playhead - 2;
    if (this.#renderedPlayhead !== playhead) {
      this.#renderedPlayhead = playhead;
      this.#playhead.setAttribute("x", `${playhead}`);
    }
    window.requestAnimationFrame(this.#animatePlayhead);
  };

  public movePlayheadToMouse(): boolean {
    if (this.#pointers.latest.isPresent) {
      this.#doc.synth.playhead = this.#mouseBar + (this.#mouseX % this.#barWidth) / this.#barWidth;
      return true;
    }
    return false;
  }

  #dragBoxSelection(): void {
    this.#doc.selection.setTrackSelection(
      this.#doc.selection.boxSelectionX0,
      this.#mouseBar,
      this.#doc.selection.boxSelectionY0,
      this.#mouseChannel,
    );
    this.#doc.selection.selectionUpdated();
  }

  #updateMousePos(event: PointerEvent): void {
    const point: Point2d = event.pointer!.getPointIn(this.container);
    this.#pointerX = point.x;
    this.#pointerY = point.y;
    this.#mouseX = point.x - TrackEditor.channelNumberWidth;
    this.#mouseY = point.y - TrackEditor.barNumberHeight;
    this.#mouseBar = Math.floor(
      Math.min(this.#doc.song.barCount - 1, Math.max(0, this.#mouseX / this.#barWidth)),
    );
    this.#mouseChannel = Math.floor(
      Math.min(
        this.#doc.song.getChannelCount() - 1,
        Math.max(0, this.#mouseY / ChannelRow.patternHeight),
      ),
    );
  }

  #startReorderDrag(event: PointerEvent): boolean {
    const target: EventTarget | null = event.target;
    if (!(target instanceof Element)) {
      return false;
    }

    const barNumber: HTMLElement | null = target.closest(".barNumber");
    if (barNumber != null) {
      const source: number = this.#barNumbers.indexOf(barNumber);
      if (source !== -1) {
        this.#reorderDrag = {
          kind: "bar",
          source,
          target: source,
          startPointer: this.#pointerX,
          offset: 0,
          moved: false,
        };
        barNumber.classList.add("reorder-active");
        event.preventDefault();
        return true;
      }
    }

    const channelNumber: HTMLElement | null = target.closest(".channelNumber");
    if (channelNumber != null) {
      const source: number = this.#channels.findIndex(
        (channel: ChannelRow): boolean => channel.number === channelNumber,
      );
      if (source !== -1) {
        this.#reorderDrag = {
          kind: "channel",
          source,
          target: source,
          startPointer: this.#pointerY,
          offset: 0,
          moved: false,
        };
        channelNumber.classList.add("reorder-active");
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  #getChannelDragBounds(source: number): [number, number] {
    if (source < this.#doc.song.pitchChannelCount) {
      return [0, this.#doc.song.pitchChannelCount - 1];
    }
    const automationStart: number =
      this.#doc.song.pitchChannelCount + this.#doc.song.noiseChannelCount;
    if (source < automationStart) {
      return [this.#doc.song.pitchChannelCount, automationStart - 1];
    }
    return [automationStart, this.#doc.song.getChannelCount() - 1];
  }

  #updateReorderDrag(): void {
    const drag: ReorderDrag | null = this.#reorderDrag;
    if (drag == null) {
      return;
    }

    const itemSize: number = drag.kind === "bar" ? this.#barWidth : ChannelRow.patternHeight,
      pointer: number = drag.kind === "bar" ? this.#pointerX : this.#pointerY,
      [minimum, maximum]: [number, number] =
        drag.kind === "bar"
          ? [0, this.#doc.song.barCount - 1]
          : this.#getChannelDragBounds(drag.source);
    drag.offset = Math.max(
      (minimum - drag.source) * itemSize,
      Math.min((maximum - drag.source) * itemSize, pointer - drag.startPointer),
    );
    drag.target = Math.max(
      minimum,
      Math.min(maximum, drag.source + Math.round(drag.offset / itemSize)),
    );
    drag.moved ||= Math.abs(drag.offset) >= 1;
    this.#renderReorderPreview();
  }

  #renderReorderPreview(): void {
    const drag: ReorderDrag | null = this.#reorderDrag;
    if (drag == null) {
      return;
    }

    if (drag.kind === "bar") {
      const number: HTMLElement | undefined = this.#barNumbers[drag.source]!;
      if (number !== undefined) {
        number.style.transform = drag.offset === 0 ? "" : `translateX(${drag.offset}px)`;
        number.classList.toggle("reorder-preview", drag.offset !== 0);
      }
      for (const channel of this.#channels) {
        channel.setBarDragOffset(drag.source, drag.offset);
      }
      this.#barReorderLine.style.left = `${TrackEditor.channelNumberWidth + drag.target * this.#barWidth}px`;
      this.#barReorderLine.style.display = drag.moved ? "block" : "none";
      this.#channelReorderLine.style.display = "none";
    } else {
      const channel: ChannelRow | undefined = this.#channels[drag.source]!;
      if (channel !== undefined) {
        channel.setDragOffset(drag.offset);
      }
      this.#channelReorderLine.style.top = `${
        TrackEditor.barNumberHeight + drag.target * ChannelRow.patternHeight
      }px`;
      this.#channelReorderLine.style.display = drag.moved ? "block" : "none";
      this.#barReorderLine.style.display = "none";
    }
  }

  #clearReorderPreview(): void {
    const drag: ReorderDrag | null = this.#reorderDrag;
    if (drag != null) {
      if (drag.kind === "bar") {
        const number: HTMLElement | undefined = this.#barNumbers[drag.source]!;
        if (number !== undefined) {
          number.style.transform = "";
          number.classList.remove("reorder-preview", "reorder-active");
        }
        for (const channel of this.#channels) {
          channel.setBarDragOffset(drag.source, 0);
        }
      } else {
        const channel: ChannelRow | undefined = this.#channels[drag.source]!;
        if (channel !== undefined) {
          channel.setDragOffset(0);
          channel.number.classList.remove("reorder-active");
        }
      }
    }
    this.#barReorderLine.style.display = "none";
    this.#channelReorderLine.style.display = "none";
  }

  #remapMovedIndex(index: number, source: number, target: number): number {
    if (index === source) {
      return target;
    }
    if (source < target && index > source && index <= target) {
      return index - 1;
    }
    if (target < source && index >= target && index < source) {
      return index + 1;
    }
    return index;
  }

  #finishReorderDrag(): boolean {
    const drag: ReorderDrag | null = this.#reorderDrag;
    if (drag == null) {
      return false;
    }

    this.#clearReorderPreview();
    this.#reorderDrag = null;
    if (drag.source === drag.target) {
      return true;
    }

    const change: ChangeGroup = new ChangeGroup();
    if (drag.kind === "bar") {
      const newBar: number = this.#remapMovedIndex(this.#doc.bar, drag.source, drag.target);
      change.append(new ChangeBarOrder(this.#doc, drag.source, drag.target));
      change.append(new ChangeChannelBar(this.#doc, this.#doc.channel, newBar));
    } else {
      const newChannel: number = this.#remapMovedIndex(this.#doc.channel, drag.source, drag.target);
      change.append(
        new ChangeChannelOrder(this.#doc, drag.source, drag.source, drag.target - drag.source),
      );
      change.append(new ChangeChannelBar(this.#doc, newChannel, this.#doc.bar));
    }
    this.#doc.selection.resetBoxSelection();
    this.#doc.selection.selectionUpdated();
    this.#doc.record(change);
    return true;
  }

  #onPointerLeave = (_event: PointerEvent): void => {
    this.#updatePreview();
  };

  #onPointerDown = (event: PointerEvent): void => {
    this.#updateMousePos(event);
    if (this.#startReorderDrag(event)) {
      this.#mouseDragging = true;
      this.#updatePreview();
      return;
    }
    this.#mouseStartBar = this.#mouseBar;
    this.#mouseStartChannel = this.#mouseChannel;
    if (event.shiftKey) {
      this.#mouseDragging = true;
      this.#doc.selection.setTrackSelection(
        this.#doc.selection.boxSelectionX0,
        this.#mouseBar,
        this.#doc.selection.boxSelectionY0,
        this.#mouseChannel,
      );
      this.#doc.selection.selectionUpdated();
    } else {
      this.#mouseDragging = false;
      if (this.#doc.channel !== this.#mouseChannel || this.#doc.bar !== this.#mouseBar) {
        this.#doc.selection.setChannelBar(this.#mouseChannel, this.#mouseBar);
        this.#mouseDragging = true;
      }
      this.#doc.selection.resetBoxSelection();
    }
  };

  #onPointerMove = (event: PointerEvent): void => {
    this.#updateMousePos(event);
    if (this.#reorderDrag != null) {
      if (event.pointer!.isDown) {
        this.#updateReorderDrag();
      }
      this.#updatePreview();
      return;
    }
    if (event.pointer!.isDown) {
      if (
        this.#mouseStartBar !== this.#mouseBar ||
        this.#mouseStartChannel !== this.#mouseChannel
      ) {
        this.#mouseDragging = true;
      }
      this.#dragBoxSelection();
    }
    this.#updatePreview();
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (this.#reorderDrag != null) {
      this.#updateMousePos(event);
      this.#updateReorderDrag();
    }
    if (this.#finishReorderDrag()) {
      this.#mouseDragging = false;
      this.#updatePreview();
      return;
    }
    if (!this.#mouseDragging) {
      if (this.#doc.channel === this.#mouseChannel && this.#doc.bar === this.#mouseBar) {
        const up: boolean = this.#mouseY % ChannelRow.patternHeight < ChannelRow.patternHeight / 2,
          patternCount: number = this.#doc.song.patternsPerChannel;
        this.#doc.selection.setPattern(
          (this.#doc.song.channels[this.#mouseChannel]!.bars[this.#mouseBar]! +
            (up ? 1 : patternCount)) %
            (patternCount + 1),
        );
      }
    }
    this.#mouseDragging = false;
    this.#updatePreview();
  };

  #onPointerCancel = (_event: PointerEvent): void => {
    this.#clearReorderPreview();
    this.#reorderDrag = null;
    this.#mouseDragging = false;
    this.#updatePreview();
  };

  #updatePreview(): void {
    if (this.#reorderDrag != null) {
      this.#boxHighlight.style.display = "none";
      this.#upHighlight.style.display = "none";
      this.#downHighlight.style.display = "none";
      return;
    }
    const channel: number = this.#mouseChannel,
      bar: number = this.#mouseBar,
      selected: boolean = bar === this.#doc.bar && channel === this.#doc.channel;

    if (this.#pointers.latest.isHovering && !selected) {
      this.#boxHighlight.setAttribute(
        "x",
        `${TrackEditor.channelNumberWidth + 1 + this.#barWidth * bar}`,
      );
      this.#boxHighlight.setAttribute("y", `${1 + ChannelRow.patternHeight * channel}`);
      this.#boxHighlight.setAttribute("height", `${ChannelRow.patternHeight - 2}`);
      this.#boxHighlight.setAttribute("width", `${this.#barWidth - 2}`);
      this.#boxHighlight.style.display = "";
    } else {
      this.#boxHighlight.style.display = "none";
    }

    if (this.#pointers.latest.isPresent && selected) {
      const up: boolean = this.#mouseY % ChannelRow.patternHeight < ChannelRow.patternHeight / 2,
        center: number = TrackEditor.channelNumberWidth + this.#barWidth * (bar + 0.8),
        middle: number = ChannelRow.patternHeight * (channel + 0.5),
        base: number = ChannelRow.patternHeight * 0.1,
        tip: number = ChannelRow.patternHeight * 0.4,
        width: number = ChannelRow.patternHeight * 0.175;

      this.#upHighlight.setAttribute("fill", up ? ColorConfig.text : ColorConfig.background);
      this.#downHighlight.setAttribute("fill", up ? ColorConfig.background : ColorConfig.text);

      this.#upHighlight.setAttribute(
        "d",
        `M ${center} ${middle - tip} L ${center + width} ${middle - base} L ${center - width} ${middle - base} z`,
      );
      this.#downHighlight.setAttribute(
        "d",
        `M ${center} ${middle + tip} L ${center + width} ${middle + base} L ${center - width} ${middle + base} z`,
      );

      this.#upHighlight.style.display = "";
      this.#downHighlight.style.display = "";
    } else {
      this.#upHighlight.style.display = "none";
      this.#downHighlight.style.display = "none";
    }
  }

  public render(): void {
    this.#barWidth = this.#doc.getBarWidth();
    if (this.#barNumbers.length !== this.#doc.song.barCount) {
      for (let bar = this.#barNumbers.length; bar < this.#doc.song.barCount; bar++) {
        const number = HTML.div({ class: "barNumber", title: `Bar ${bar + 1}` }, String(bar + 1));
        this.#barNumberContainer.append(number);
        this.#barNumbers.push(number);
      }
      for (let bar = this.#doc.song.barCount; bar < this.#barNumbers.length; bar++) {
        this.#barNumbers[bar]!.remove();
      }
      this.#barNumbers.length = this.#doc.song.barCount;
    }
    for (let bar = 0; bar < this.#barNumbers.length; bar++) {
      const number = this.#barNumbers[bar]!;
      let hasContent = false;
      for (let channel = 0; channel < this.#doc.song.getChannelCount(); channel++) {
        const pattern = this.#doc.song.getPattern(channel, bar);
        if (pattern != null && pattern.hasContent(this.#doc.song.getChannelKind(channel))) {
          hasContent = true;
          break;
        }
      }
      number.style.width = `${this.#barWidth}px`;
      number.classList.toggle("has-content", hasContent);
      number.classList.toggle("selected", bar === this.#doc.bar);
    }

    if (this.#channels.length !== this.#doc.song.getChannelCount()) {
      for (let y: number = this.#channels.length; y < this.#doc.song.getChannelCount(); y++) {
        const channelRow: ChannelRow = new ChannelRow(this.#doc, y);
        this.#channels[y] = channelRow;
        this.#channelRowContainer.append(channelRow.container);
      }

      for (let y: number = this.#doc.song.getChannelCount(); y < this.#channels.length; y++) {
        this.#channelRowContainer.removeChild(this.#channels[y]!.container);
      }

      this.#channels.length = this.#doc.song.getChannelCount();
      this.#pointers.latest.cancel();
    }

    for (let j = 0; j < this.#doc.song.getChannelCount(); j++) {
      this.#channels[j]!.render();
    }

    const editorWidth: number =
      TrackEditor.channelNumberWidth + this.#barWidth * this.#doc.song.barCount;
    if (this.#renderedEditorWidth !== editorWidth) {
      this.#renderedEditorWidth = editorWidth;
      this.#channelRowContainer.style.width = `${editorWidth}px`;
      this.container.style.width = `${editorWidth}px`;
      this.#svg.setAttribute("width", `${editorWidth}`);
      this.#pointers.latest.cancel();
    }

    const editorHeight: number = this.#doc.song.getChannelCount() * ChannelRow.patternHeight;
    if (this.#renderedEditorHeight !== editorHeight) {
      this.#renderedEditorHeight = editorHeight;
      this.#svg.setAttribute("height", `${editorHeight}`);
      this.#playhead.setAttribute("height", `${editorHeight}`);
      this.container.style.height = `${TrackEditor.barNumberHeight + editorHeight}px`;
    }

    if (this.#doc.selection.boxSelectionActive) {
      // TODO: This causes the selection rectangle to repaint every time the
      // Editor renders and the selection is visible. Check if anything changed
      // Before overwriting the attributes?
      this.#selectionRect.setAttribute(
        "x",
        String(
          TrackEditor.channelNumberWidth + this.#barWidth * this.#doc.selection.boxSelectionBar + 1,
        ),
      );
      this.#selectionRect.setAttribute(
        "y",
        String(ChannelRow.patternHeight * this.#doc.selection.boxSelectionChannel + 1),
      );
      this.#selectionRect.setAttribute(
        "width",
        String(this.#barWidth * this.#doc.selection.boxSelectionWidth - 2),
      );
      this.#selectionRect.setAttribute(
        "height",
        String(ChannelRow.patternHeight * this.#doc.selection.boxSelectionHeight - 2),
      );
      this.#selectionRect.setAttribute("display", "");
    } else {
      this.#selectionRect.setAttribute("display", "none");
    }

    this.#updatePreview();
  }
}
