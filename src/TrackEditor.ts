// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "./ColorConfig.js";
import { SongDocument } from "./SongDocument.js";
import { ChannelRow } from "./ChannelRow.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { EasyPointers, Point2d } from "./EasyPointers.js";

export class TrackEditor {
  public static readonly channelNumberWidth: number = 18;
  public static readonly barNumberHeight: number = 10;
  private readonly _barNumbers: HTMLElement[] = [];
  private readonly _barNumberContainer: HTMLElement = HTML.div(
    { class: "barNumbers" },
    HTML.div({ class: "trackCorner" }),
  );
  private readonly _channelRowContainer: HTMLElement = HTML.div({
    style: "display: flex; flex-direction: column;",
  });
  private readonly _playhead: SVGRectElement = SVG.rect({
    fill: ColorConfig.text,
    x: 0,
    y: 0,
    width: 4,
    height: 128,
  });
  private readonly _boxHighlight: SVGRectElement = SVG.rect({
    fill: "none",
    stroke: ColorConfig.text,
    "stroke-width": 2,
    "pointer-events": "none",
    x: 1,
    y: 1,
    width: 30,
    height: 30,
  });
  private readonly _upHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.background,
    stroke: ColorConfig.background,
    "stroke-width": 1,
    "pointer-events": "none",
  });
  private readonly _downHighlight: SVGPathElement = SVG.path({
    fill: ColorConfig.background,
    stroke: ColorConfig.background,
    "stroke-width": 1,
    "pointer-events": "none",
  });
  private readonly _selectionRect: SVGRectElement = SVG.rect({
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
  private readonly _svg: SVGSVGElement = SVG.svg(
    { style: `position: absolute; top: ${TrackEditor.barNumberHeight}px;` },
    this._selectionRect,
    this._boxHighlight,
    this._upHighlight,
    this._downHighlight,
    this._playhead,
  );
  public readonly container: HTMLElement = HTML.div(
    { class: "noSelection", style: "position: relative;" },
    this._barNumberContainer,
    this._channelRowContainer,
    this._svg,
  );

  private readonly _pointers: EasyPointers = new EasyPointers(this.container);

  private readonly _channels: ChannelRow[] = [];
  private _mouseX: number = 0;
  private _mouseY: number = 0;
  private _mouseStartBar: number = 0;
  private _mouseStartChannel: number = 0;
  private _mouseBar: number = 0;
  private _mouseChannel: number = 0;
  private _mouseDragging = false;
  private _barWidth: number = 32;
  private _renderedEditorWidth: number = -1;
  private _renderedEditorHeight: number = -1;
  private _renderedPlayhead: number = -1;

  constructor(private _doc: SongDocument) {
    window.requestAnimationFrame(this._animatePlayhead);

    this.container.addEventListener("pointerenter", this._onPointerMove);
    this.container.addEventListener("pointerleave", this._onPointerLeave);
    this.container.addEventListener("pointerdown", this._onPointerDown);
    this.container.addEventListener("pointermove", this._onPointerMove);
    this.container.addEventListener("pointerup", this._onPointerUp);
    //this.container.addEventListener("pointercancel", this._onPointerUp);
  }

  private _animatePlayhead = (_timestamp: number): void => {
    const playhead =
      TrackEditor.channelNumberWidth +
      this._barWidth * this._doc.synth.playhead -
      2;
    if (this._renderedPlayhead != playhead) {
      this._renderedPlayhead = playhead;
      this._playhead.setAttribute("x", "" + playhead);
    }
    window.requestAnimationFrame(this._animatePlayhead);
  };

  public movePlayheadToMouse(): boolean {
    if (this._pointers.latest.isPresent) {
      this._doc.synth.playhead =
        this._mouseBar + (this._mouseX % this._barWidth) / this._barWidth;
      return true;
    }
    return false;
  }

  private _dragBoxSelection(): void {
    this._doc.selection.setTrackSelection(
      this._doc.selection.boxSelectionX0,
      this._mouseBar,
      this._doc.selection.boxSelectionY0,
      this._mouseChannel,
    );
    this._doc.selection.selectionUpdated();
  }

  private _updateMousePos(event: PointerEvent): void {
    const point: Point2d = event.pointer!.getPointIn(this.container);
    this._mouseX = point.x - TrackEditor.channelNumberWidth;
    this._mouseY = point.y - TrackEditor.barNumberHeight;
    this._mouseBar = Math.floor(
      Math.min(
        this._doc.song.barCount - 1,
        Math.max(0, this._mouseX / this._barWidth),
      ),
    );
    this._mouseChannel = Math.floor(
      Math.min(
        this._doc.song.getChannelCount() - 1,
        Math.max(0, this._mouseY / ChannelRow.patternHeight),
      ),
    );
  }

  private _onPointerLeave = (_event: PointerEvent): void => {
    this._updatePreview();
  };

  private _onPointerDown = (event: PointerEvent): void => {
    this._updateMousePos(event);
    this._mouseStartBar = this._mouseBar;
    this._mouseStartChannel = this._mouseChannel;
    if (event.shiftKey) {
      this._mouseDragging = true;
      this._doc.selection.setTrackSelection(
        this._doc.selection.boxSelectionX0,
        this._mouseBar,
        this._doc.selection.boxSelectionY0,
        this._mouseChannel,
      );
      this._doc.selection.selectionUpdated();
    } else {
      this._mouseDragging = false;
      if (
        this._doc.channel != this._mouseChannel ||
        this._doc.bar != this._mouseBar
      ) {
        this._doc.selection.setChannelBar(this._mouseChannel, this._mouseBar);
        this._mouseDragging = true;
      }
      this._doc.selection.resetBoxSelection();
    }
  };

  private _onPointerMove = (event: PointerEvent): void => {
    this._updateMousePos(event);
    if (event.pointer!.isDown) {
      if (
        this._mouseStartBar != this._mouseBar ||
        this._mouseStartChannel != this._mouseChannel
      ) {
        this._mouseDragging = true;
      }
      this._dragBoxSelection();
    }
    this._updatePreview();
  };

  private _onPointerUp = (_event: PointerEvent): void => {
    if (!this._mouseDragging) {
      if (
        this._doc.channel == this._mouseChannel &&
        this._doc.bar == this._mouseBar
      ) {
        const up: boolean =
          this._mouseY % ChannelRow.patternHeight <
          ChannelRow.patternHeight / 2;
        const patternCount: number = this._doc.song.patternsPerChannel;
        this._doc.selection.setPattern(
          (this._doc.song.channels[this._mouseChannel].bars[this._mouseBar] +
            (up ? 1 : patternCount)) %
            (patternCount + 1),
        );
      }
    }
    this._mouseDragging = false;
    this._updatePreview();
  };

  private _updatePreview(): void {
    let channel: number = this._mouseChannel;
    let bar: number = this._mouseBar;

    const selected: boolean =
      bar == this._doc.bar && channel == this._doc.channel;

    if (this._pointers.latest.isHovering && !selected) {
      this._boxHighlight.setAttribute(
        "x",
        "" + (TrackEditor.channelNumberWidth + 1 + this._barWidth * bar),
      );
      this._boxHighlight.setAttribute(
        "y",
        "" + (1 + ChannelRow.patternHeight * channel),
      );
      this._boxHighlight.setAttribute(
        "height",
        "" + (ChannelRow.patternHeight - 2),
      );
      this._boxHighlight.setAttribute("width", "" + (this._barWidth - 2));
      this._boxHighlight.style.display = "";
    } else {
      this._boxHighlight.style.display = "none";
    }

    if (this._pointers.latest.isPresent && selected) {
      const up: boolean =
        this._mouseY % ChannelRow.patternHeight < ChannelRow.patternHeight / 2;
      const center: number =
        TrackEditor.channelNumberWidth + this._barWidth * (bar + 0.8);
      const middle: number = ChannelRow.patternHeight * (channel + 0.5);
      const base: number = ChannelRow.patternHeight * 0.1;
      const tip: number = ChannelRow.patternHeight * 0.4;
      const width: number = ChannelRow.patternHeight * 0.175;

      this._upHighlight.setAttribute(
        "fill",
        up ? ColorConfig.text : ColorConfig.background,
      );
      this._downHighlight.setAttribute(
        "fill",
        !up ? ColorConfig.text : ColorConfig.background,
      );

      this._upHighlight.setAttribute(
        "d",
        `M ${center} ${middle - tip} L ${center + width} ${middle - base} L ${center - width} ${middle - base} z`,
      );
      this._downHighlight.setAttribute(
        "d",
        `M ${center} ${middle + tip} L ${center + width} ${middle + base} L ${center - width} ${middle + base} z`,
      );

      this._upHighlight.style.display = "";
      this._downHighlight.style.display = "";
    } else {
      this._upHighlight.style.display = "none";
      this._downHighlight.style.display = "none";
    }
  }

  public render(): void {
    this._barWidth = this._doc.getBarWidth();
    if (this._barNumbers.length != this._doc.song.barCount) {
      for (
        let bar = this._barNumbers.length;
        bar < this._doc.song.barCount;
        bar++
      ) {
        const number = HTML.div(
          { class: "barNumber", title: `Bar ${bar + 1}` },
          String(bar + 1),
        );
        this._barNumberContainer.appendChild(number);
        this._barNumbers.push(number);
      }
      for (
        let bar = this._doc.song.barCount;
        bar < this._barNumbers.length;
        bar++
      )
        this._barNumbers[bar].remove();
      this._barNumbers.length = this._doc.song.barCount;
    }
    for (let bar = 0; bar < this._barNumbers.length; bar++) {
      const number = this._barNumbers[bar];
      number.style.width = this._barWidth + "px";
      number.classList.toggle("selected", bar == this._doc.bar);
    }

    if (this._channels.length != this._doc.song.getChannelCount()) {
      for (
        let y: number = this._channels.length;
        y < this._doc.song.getChannelCount();
        y++
      ) {
        const channelRow: ChannelRow = new ChannelRow(this._doc, y);
        this._channels[y] = channelRow;
        this._channelRowContainer.appendChild(channelRow.container);
      }

      for (
        let y: number = this._doc.song.getChannelCount();
        y < this._channels.length;
        y++
      ) {
        this._channelRowContainer.removeChild(this._channels[y].container);
      }

      this._channels.length = this._doc.song.getChannelCount();
      this._pointers.latest.cancel();
    }

    for (let j: number = 0; j < this._doc.song.getChannelCount(); j++) {
      this._channels[j].render();
    }

    const editorWidth: number =
      TrackEditor.channelNumberWidth + this._barWidth * this._doc.song.barCount;
    if (this._renderedEditorWidth != editorWidth) {
      this._renderedEditorWidth = editorWidth;
      this._channelRowContainer.style.width = editorWidth + "px";
      this.container.style.width = editorWidth + "px";
      this._svg.setAttribute("width", editorWidth + "");
      this._pointers.latest.cancel();
    }

    const editorHeight: number =
      this._doc.song.getChannelCount() * ChannelRow.patternHeight;
    if (this._renderedEditorHeight != editorHeight) {
      this._renderedEditorHeight = editorHeight;
      this._svg.setAttribute("height", "" + editorHeight);
      this._playhead.setAttribute("height", "" + editorHeight);
      this.container.style.height =
        TrackEditor.barNumberHeight + editorHeight + "px";
    }

    if (this._doc.selection.boxSelectionActive) {
      // TODO: This causes the selection rectangle to repaint every time the
      // editor renders and the selection is visible. Check if anything changed
      // before overwriting the attributes?
      this._selectionRect.setAttribute(
        "x",
        String(
          TrackEditor.channelNumberWidth +
            this._barWidth * this._doc.selection.boxSelectionBar +
            1,
        ),
      );
      this._selectionRect.setAttribute(
        "y",
        String(
          ChannelRow.patternHeight * this._doc.selection.boxSelectionChannel +
            1,
        ),
      );
      this._selectionRect.setAttribute(
        "width",
        String(this._barWidth * this._doc.selection.boxSelectionWidth - 2),
      );
      this._selectionRect.setAttribute(
        "height",
        String(
          ChannelRow.patternHeight * this._doc.selection.boxSelectionHeight - 2,
        ),
      );
      this._selectionRect.setAttribute("display", "");
    } else {
      this._selectionRect.setAttribute("display", "none");
    }

    this._updatePreview();
  }
}
