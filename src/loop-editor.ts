// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChangeChannelBar, ChangeLoop } from "./changes.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";
import { ColorConfig } from "./color-config.js";
import type { SongDocument } from "./song-document.js";
import { TrackEditor } from "./track-editor.js";

//Import {EasyPointers} from "./easy-pointers.js";

/*
Unfortunately, I ran into a bug on iOS when I tried to update this component to
use EasyPointers. Vertical dragging cancels all events as expected to allow for
scrolling, but horizontal dragging cancels mouse and pointer events without
cancelling touch events. This seems to be because the loop editor is inside a
horizontally scrollable container, despite the fact that the widget has
"touch-action: pan-y" and no scrolling actually occurs. If I want to support
horizontal dragging, I either have to use touch events or move the loop editor
outside of a horizontally scrollable container. I considered moving it outside
the scrollable container (the track and mute editor container) and listening for
scroll events to realign the editors, but that would complicate the positioning
of the horizontal browser scroll bars (visible in fullscreen layouts). For the
time being, I'm keeping the old touch events implementation, but I've added a
commented-out EasyPointers implementation as well. Hopefully one day I'll be
able to remove the mouse and touch event implementations.
*/

interface Cursor {
  startBar: number;
  mode: number;
}

interface Endpoints {
  start: number;
  length: number;
}

export class LoopEditor {
  #doc: SongDocument;
  readonly #editorHeight: number = 20;
  readonly #startMode: number = 0;
  readonly #endMode: number = 1;
  readonly #bothMode: number = 2;

  readonly #loop: SVGPathElement = SVG.path({
    fill: "none",
    stroke: ColorConfig.accent,
    "stroke-width": 4,
  });
  readonly #highlight: SVGPathElement = SVG.path({
    fill: ColorConfig.text,
    "pointer-events": "none",
  });

  readonly #svg: SVGSVGElement = SVG.svg(
    {
      style: `position: absolute; left: ${TrackEditor.channelNumberWidth}px;`,
      height: this.#editorHeight,
    },
    this.#loop,
    this.#highlight,
  );

  public readonly container: HTMLElement = HTML.div(
    { class: "loopEditor", style: "touch-action: pan-y;" },
    this.#svg,
  );

  //Private readonly _pointers: EasyPointers = new EasyPointers(this.container);

  #barWidth = 32;
  #change: ChangeLoop | null = null;
  #cursor: Cursor = { startBar: -1, mode: -1 };

  // The following properties are only necessary because of the ios pointer events bug.
  #mouseX = 0;
  #clientStartX = 0;
  #clientStartY = 0;
  #startedScrolling = false;
  #draggingHorizontally = false;
  #mouseDown = false;
  #mouseOver = false;

  #renderedLoopStart = -1;
  #renderedLoopStop = -1;
  #renderedBarCount = 0;
  #renderedBarWidth = -1;
  #renderedLoopEnabled: boolean | null = null;
  #renderedHighlightVisible: boolean | null = null;
  #renderedHighlightPath = "";

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.#updateCursorStatus();
    this.#render();
    this.#doc.notifier.watch(this.#documentChanged);

    this.container.addEventListener("mousedown", this.#whenMousePressed);
    document.addEventListener("mousemove", this.#whenMouseMoved);
    document.addEventListener("mouseup", this.#whenCursorReleased);
    this.container.addEventListener("mouseover", this.#whenMouseOver);
    this.container.addEventListener("mouseout", this.#whenMouseOut);

    this.container.addEventListener("touchstart", this.#whenTouchPressed);
    this.container.addEventListener("touchmove", this.#whenTouchMoved);
    this.container.addEventListener("touchend", this.#whenTouchReleased);
    this.container.addEventListener("touchcancel", this.#whenTouchReleased);

    //This.container.addEventListener("pointerenter", this._onPointerMove);
    //This.container.addEventListener("pointerleave", this._onPointerLeave);
    //This.container.addEventListener("pointerdown", this._onPointerDown);
    //This.container.addEventListener("pointermove", this._onPointerMove);
    //This.container.addEventListener("pointerup", this._onPointerUp);
    //This.container.addEventListener("pointercancel", this._onPointerUp);
  }

  #getPointerBarPos(): number {
    return this.#mouseX / this.#barWidth;
    //Return this._pointers.latest.getPointIn(this.container).x / this._barWidth;
  }

  #updateCursorStatus(): void {
    const bar: number = this.#getPointerBarPos();
    this.#cursor.startBar = bar;

    if (
      bar > this.#doc.song.loopStart - 0.25 &&
      bar < this.#doc.song.loopStart + this.#doc.song.loopLength + 0.25
    ) {
      if (bar - this.#doc.song.loopStart < this.#doc.song.loopLength * 0.5) {
        this.#cursor.mode = this.#startMode;
      } else {
        this.#cursor.mode = this.#endMode;
      }
    } else {
      this.#cursor.mode = this.#bothMode;
    }
  }

  #findEndPoints(middle: number): Endpoints {
    let start: number = Math.round(middle - this.#doc.song.loopLength / 2),
      end: number = start + this.#doc.song.loopLength;
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > this.#doc.song.barCount) {
      start -= end - this.#doc.song.barCount;
      end = this.#doc.song.barCount;
    }
    return { start, length: end - start };
  }

  #whenMouseOver = (_event: MouseEvent): void => {
    if (this.#mouseOver) {
      return;
    }
    this.#mouseOver = true;
    this.#updatePreview();
  };

  #whenMouseOut = (_event: MouseEvent): void => {
    if (!this.#mouseOver) {
      return;
    }
    this.#mouseOver = false;
    this.#updatePreview();
  };

  //Private _onPointerLeave = (event: PointerEvent): void => {
  //	This._updatePreview();
  //}

  #whenMousePressed = (event: MouseEvent): void => {
    event.preventDefault();
    this.#mouseDown = true;
    const boundingRect: ClientRect = this.#svg.getBoundingClientRect();
    this.#mouseX = (event.clientX || event.pageX) - boundingRect.left;
    this.#updateCursorStatus();
    this.#updatePreview();
    this.#whenMouseMoved(event);
  };

  #whenTouchPressed = (event: TouchEvent): void => {
    this.#mouseDown = true;
    const boundingRect: ClientRect = this.#svg.getBoundingClientRect();
    this.#mouseX = event.touches[0]!.clientX - boundingRect.left;
    this.#updateCursorStatus();
    this.#updatePreview();
    this.#clientStartX = event.touches[0]!.clientX;
    this.#clientStartY = event.touches[0]!.clientY;
    this.#draggingHorizontally = false;
    this.#startedScrolling = false;
  };

  //Private _onPointerDown = (event: PointerEvent): void => {
  //	This._updateCursorStatus();
  //	This._onPointerMove(event);
  //	This._updatePreview();
  //}

  #whenMouseMoved = (event: MouseEvent): void => {
    const boundingRect: ClientRect = this.#svg.getBoundingClientRect();
    this.#mouseX = (event.clientX || event.pageX) - boundingRect.left;
    this.#whenCursorMoved();
  };

  #whenTouchMoved = (event: TouchEvent): void => {
    if (!this.#mouseDown) {
      return;
    }
    const boundingRect: ClientRect = this.#svg.getBoundingClientRect();
    this.#mouseX = event.touches[0]!.clientX - boundingRect.left;

    if (!this.#draggingHorizontally && !this.#startedScrolling) {
      if (Math.abs(event.touches[0]!.clientY - this.#clientStartY) > 10) {
        this.#startedScrolling = true;
      } else if (Math.abs(event.touches[0]!.clientX - this.#clientStartX) > 10) {
        this.#draggingHorizontally = true;
      }
    }

    if (this.#draggingHorizontally) {
      this.#whenCursorMoved();
      event.preventDefault();
    }
  };

  //Private _onPointerMove = (event: PointerEvent): void => {
  //	This._whenCursorMoved();
  //}

  #whenCursorMoved(): void {
    if (this.#mouseDown) {
      //If (event.pointer!.isDown) {
      let oldStart: number = this.#doc.song.loopStart,
        oldEnd: number = this.#doc.song.loopStart + this.#doc.song.loopLength;
      if (this.#change != null && this.#doc.lastChangeWas(this.#change)) {
        oldStart = this.#change.oldStart;
        oldEnd = oldStart + this.#change.oldLength;
      }

      const bar: number = this.#getPointerBarPos();
      let start: number, end: number, temp: number;
      if (this.#cursor.mode === this.#startMode) {
        start = oldStart + Math.round(bar - this.#cursor.startBar);
        end = oldEnd;
        if (start < 0) {
          start = 0;
        }
        if (start >= this.#doc.song.barCount) {
          start = this.#doc.song.barCount;
        }
        if (start === end) {
          start = end - 1;
        } else if (start > end) {
          temp = start;
          start = end;
          end = temp;
        }
        this.#change = new ChangeLoop(this.#doc, oldStart, oldEnd - oldStart, start, end - start);
      } else if (this.#cursor.mode === this.#endMode) {
        start = oldStart;
        end = oldEnd + Math.round(bar - this.#cursor.startBar);
        if (end < 0) {
          end = 0;
        }
        if (end >= this.#doc.song.barCount) {
          end = this.#doc.song.barCount;
        }
        if (end === start) {
          end = start + 1;
        } else if (end < start) {
          temp = start;
          start = end;
          end = temp;
        }
        this.#change = new ChangeLoop(this.#doc, oldStart, oldEnd - oldStart, start, end - start);
      } else if (this.#cursor.mode === this.#bothMode) {
        const endPoints: Endpoints = this.#findEndPoints(bar);
        this.#change = new ChangeLoop(
          this.#doc,
          oldStart,
          oldEnd - oldStart,
          endPoints.start,
          endPoints.length,
        );
      }
      if (this.#doc.synth.loopRepeatCount !== 0) {
        this.#doc.synth.jumpIntoLoop();
        if (this.#doc.prefs.autoFollow) {
          new ChangeChannelBar(
            this.#doc,
            this.#doc.channel,
            Math.floor(this.#doc.synth.playhead),
            true,
          );
        }
      }
      this.#doc.setProspectiveChange(this.#change);
    } else {
      // The pointer is not down, just update the cursor.
      this.#updateCursorStatus();
      this.#updatePreview();
    }
  }

  #whenTouchReleased = (event: TouchEvent): void => {
    event.preventDefault();
    if (!this.#startedScrolling) {
      this.#whenCursorMoved();
      this.#mouseOver = false;
      this.#whenCursorReleased(event);
      this.#updatePreview();
    }
    this.#mouseDown = false;
  };

  #whenCursorReleased = (_event: Event): void => {
    if (this.#change != null) {
      this.#doc.record(this.#change);
    }
    this.#change = null;
    this.#mouseDown = false;
    this.#updateCursorStatus();
    this.#render();
  };

  //Private _onPointerUp = (event: PointerEvent): void => {
  //	If (this._change != null) this._doc.record(this._change);
  //	This._change = null;
  //	This._updateCursorStatus();
  //	This._render();
  //}

  #updatePreview(): void {
    const showHighlight: boolean = this.#mouseOver && !this.#mouseDown;
    //Const showHighlight: boolean = this._pointers.latest.isHovering;
    if (this.#renderedHighlightVisible !== showHighlight) {
      this.#renderedHighlightVisible = showHighlight;
      this.#highlight.style.display = showHighlight ? "" : "none";
    }

    if (showHighlight) {
      const radius: number = this.#editorHeight / 2;

      let highlightStart: number = this.#doc.song.loopStart * this.#barWidth,
        highlightStop: number =
          (this.#doc.song.loopStart + this.#doc.song.loopLength) * this.#barWidth;
      if (this.#cursor.mode === this.#startMode) {
        highlightStop = this.#doc.song.loopStart * this.#barWidth + radius * 2;
      } else if (this.#cursor.mode === this.#endMode) {
        highlightStart =
          (this.#doc.song.loopStart + this.#doc.song.loopLength) * this.#barWidth - radius * 2;
      } else {
        const endPoints: Endpoints = this.#findEndPoints(this.#cursor.startBar);
        highlightStart = endPoints.start * this.#barWidth;
        highlightStop = (endPoints.start + endPoints.length) * this.#barWidth;
      }

      const highlightPath: string =
        `M ${highlightStart + radius} ${4} ` +
        `L ${highlightStop - radius} ${4} ` +
        `A ${radius - 4} ${radius - 4} ${0} ${0} ${1} ${highlightStop - radius} ${this.#editorHeight - 4} ` +
        `L ${highlightStart + radius} ${this.#editorHeight - 4} ` +
        `A ${radius - 4} ${radius - 4} ${0} ${0} ${1} ${highlightStart + radius} ${4} ` +
        `z`;
      if (this.#renderedHighlightPath !== highlightPath) {
        this.#renderedHighlightPath = highlightPath;
        this.#highlight.setAttribute("d", highlightPath);
      }
    }
  }

  #documentChanged = (): void => {
    this.#render();
  };

  #render(): void {
    this.#barWidth = this.#doc.getBarWidth();
    const loopEnabled: boolean = this.#doc.synth.loopRepeatCount === -1;
    if (this.#renderedLoopEnabled !== loopEnabled) {
      this.#renderedLoopEnabled = loopEnabled;
      this.#loop.setAttribute(
        "stroke",
        loopEnabled ? ColorConfig.accent : ColorConfig.disabledLoop,
      );
    }

    const radius: number = this.#editorHeight / 2,
      loopStart: number = this.#doc.song.loopStart * this.#barWidth,
      loopStop: number = (this.#doc.song.loopStart + this.#doc.song.loopLength) * this.#barWidth;

    if (
      this.#renderedBarCount !== this.#doc.song.barCount ||
      this.#renderedBarWidth !== this.#barWidth
    ) {
      this.#renderedBarCount = this.#doc.song.barCount;
      this.#renderedBarWidth = this.#barWidth;
      const editorWidth = TrackEditor.channelNumberWidth + this.#barWidth * this.#doc.song.barCount;
      this.container.style.width = `${editorWidth}px`;
      this.#svg.setAttribute("width", `${editorWidth - TrackEditor.channelNumberWidth}`);
    }

    if (this.#renderedLoopStart !== loopStart || this.#renderedLoopStop !== loopStop) {
      this.#renderedLoopStart = loopStart;
      this.#renderedLoopStop = loopStop;
      this.#loop.setAttribute(
        "d",
        `M ${loopStart + radius} ${2} ` +
          `L ${loopStop - radius} ${2} ` +
          `A ${radius - 2} ${radius - 2} ${0} ${0} ${1} ${loopStop - radius} ${this.#editorHeight - 2} ` +
          `L ${loopStart + radius} ${this.#editorHeight - 2} ` +
          `A ${radius - 2} ${radius - 2} ${0} ${0} ${1} ${loopStart + radius} ${2} ` +
          `z`,
      );
    }

    this.#updatePreview();
  }
}
