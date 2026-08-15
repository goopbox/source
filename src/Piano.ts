// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config } from "../synth/SynthConfig.js";
import { ColorConfig } from "./ColorConfig.js";
import { SongDocument } from "./SongDocument.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { EasyPointers } from "./EasyPointers.js";

export class Piano {
  private readonly _pianoContainer: HTMLDivElement = HTML.div({
    style:
      "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;",
  });
  private readonly _drumContainer: HTMLDivElement = HTML.div({
    style:
      "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;",
  });
  private readonly _preview: HTMLDivElement = HTML.div({
    style: `width: 100%; height: 40px; border: 2px solid ${ColorConfig.text}; position: absolute; pointer-events: none;`,
  });
  public readonly container: HTMLDivElement = HTML.div(
    {
      style:
        "width: 32px; height: 100%; overflow: hidden; position: relative; flex-shrink: 0; touch-action: none;",
    },
    this._pianoContainer,
    this._drumContainer,
    this._preview,
  );

  private readonly _pointers: EasyPointers = new EasyPointers(this.container, {
    preventTouchGestureScrolling: true,
  });

  private readonly _editorHeight: number = 481;
  private readonly _pianoKeys: HTMLDivElement[] = [];
  private readonly _pianoLabels: HTMLDivElement[] = [];

  private _pitchHeight!: number;
  private _pitchCount!: number;
  private _cursorPitch!: number;
  private _playedPitch: number = -1;
  private _renderedScale: number = -1;
  private _renderedDrums: boolean = false;
  private _renderedComposingKey: number = -1;
  private _renderedBaseVisibleOctave: number = -1;
  private _renderedPitchCount: number = -1;
  private readonly _renderedLiveInputPitches: number[] = [];

  constructor(private _doc: SongDocument) {
    for (let i: number = 0; i < Config.drumCount; i++) {
      const drumLabel: HTMLDivElement = HTML.div(
        { class: "pitch-label" },
        String(i + 1),
      );
      this._drumContainer.appendChild(
        HTML.div(
          {
            class: "pitch-button",
            style: `background-color: ${ColorConfig.blackPianoKey}; color: ${ColorConfig.text};`,
          },
          drumLabel,
        ),
      );
    }

    this.container.addEventListener("pointerenter", this._onPointerMove);
    this.container.addEventListener("pointerleave", this._onPointerLeave);
    this.container.addEventListener("pointerdown", this._onPointerDown);
    this.container.addEventListener("pointermove", this._onPointerMove);
    this.container.addEventListener("pointerup", this._onPointerUp);
    this.container.addEventListener("pointercancel", this._onPointerUp);

    this._doc.notifier.watch(this._documentChanged);
    this._documentChanged();

    window.requestAnimationFrame(this._onAnimationFrame);
  }

  private _updateCursorPitch(): void {
    const scale: ReadonlyArray<boolean> =
      Config.scales[this._doc.song.scale].flags;
    const mouseY: number =
      this._pointers.latest.getPointInNormalized(this.container).y || 0;

    const mousePitch: number = Math.max(
      0,
      Math.min(this._pitchCount - 1, (1 - mouseY) * this._pitchCount),
    );
    if (
      scale[Math.floor(mousePitch) % Config.pitchesPerOctave] ||
      this._doc.song.getChannelIsNoise(this._doc.channel)
    ) {
      this._cursorPitch = Math.floor(mousePitch);
    } else {
      let topPitch: number = Math.floor(mousePitch) + 1;
      let bottomPitch: number = Math.floor(mousePitch) - 1;
      while (!scale[topPitch % Config.pitchesPerOctave]) {
        topPitch++;
      }
      while (!scale[bottomPitch % Config.pitchesPerOctave]) {
        bottomPitch--;
      }
      let topRange: number = topPitch;
      let bottomRange: number = bottomPitch + 1;
      if (
        topPitch % Config.pitchesPerOctave == 0 ||
        topPitch % Config.pitchesPerOctave == 7
      ) {
        topRange -= 0.5;
      }
      if (
        bottomPitch % Config.pitchesPerOctave == 0 ||
        bottomPitch % Config.pitchesPerOctave == 7
      ) {
        bottomRange += 0.5;
      }
      this._cursorPitch =
        mousePitch - bottomRange > topRange - mousePitch
          ? topPitch
          : bottomPitch;
    }
  }

  private _playLiveInput(): void {
    const octaveOffset: number =
      this._doc.getBaseVisibleOctave(this._doc.channel) *
        Config.pitchesPerOctave +
      (this._doc.song.getChannelIsNoise(this._doc.channel)
        ? 0
        : this._doc.song.composingKey - this._doc.song.key);
    const currentPitch: number = this._cursorPitch + octaveOffset;
    if (this._playedPitch == currentPitch) return;
    this._doc.performance.removePerformedPitch(this._playedPitch);
    this._playedPitch = currentPitch;
    this._doc.performance.addPerformedPitch(currentPitch);
  }

  private _releaseLiveInput(): void {
    this._doc.performance.removePerformedPitch(this._playedPitch);
    this._playedPitch = -1;
  }

  private _onPointerLeave = (_event: PointerEvent): void => {
    this._updatePreview();
  };

  private _onPointerDown = (_event: PointerEvent): void => {
    this._doc.synth.maintainLiveInput();
    this._updateCursorPitch();
    this._playLiveInput();
    this._updatePreview();
  };

  private _onPointerMove = (event: PointerEvent): void => {
    this._doc.synth.maintainLiveInput();
    this._updateCursorPitch();
    if (event.pointer!.isDown) this._playLiveInput();
    this._updatePreview();
  };

  private _onPointerUp = (_event: PointerEvent): void => {
    this._releaseLiveInput();
    this._updatePreview();
  };

  private _onAnimationFrame = (): void => {
    window.requestAnimationFrame(this._onAnimationFrame);

    let liveInputChanged: boolean = false;
    const liveInputPitchCount: number =
      !this._doc.performance.pitchesAreTemporary()
        ? this._doc.synth.liveInputPitches.length
        : 0;
    if (this._renderedLiveInputPitches.length != liveInputPitchCount) {
      liveInputChanged = true;
    }
    for (let i: number = 0; i < liveInputPitchCount; i++) {
      if (
        this._renderedLiveInputPitches[i] != this._doc.synth.liveInputPitches[i]
      ) {
        this._renderedLiveInputPitches[i] = this._doc.synth.liveInputPitches[i];
        liveInputChanged = true;
      }
    }
    this._renderedLiveInputPitches.length = liveInputPitchCount;

    if (liveInputChanged) {
      this._updatePreview();
    }
  };

  private _updatePreview(): void {
    const previewIsVisible = this._pointers.latest.isHovering;
    this._preview.style.display = previewIsVisible ? "" : "none";
    if (previewIsVisible) {
      const pitchHeight: number =
        this._pitchHeight / (this._editorHeight / this.container.clientHeight);

      this._preview.style.left = "0px";
      this._preview.style.top =
        pitchHeight * (this._pitchCount - this._cursorPitch - 1) + "px";
      this._preview.style.height = pitchHeight + "px";
    }

    const octaveOffset: number =
      this._doc.getBaseVisibleOctave(this._doc.channel) *
        Config.pitchesPerOctave +
      (this._doc.song.getChannelIsNoise(this._doc.channel)
        ? 0
        : this._doc.song.composingKey - this._doc.song.key);
    const container: HTMLDivElement = this._doc.song.getChannelIsNoise(
      this._doc.channel,
    )
      ? this._drumContainer
      : this._pianoContainer;
    const children: HTMLCollection = container.children;
    for (let i: number = 0; i < children.length; i++) {
      const child: Element = children[i];
      if (this._renderedLiveInputPitches.indexOf(i + octaveOffset) == -1) {
        child.classList.remove("pressed");
      } else {
        child.classList.add("pressed");
      }
    }
  }

  private _documentChanged = (): void => {
    const isDrum: boolean = this._doc.song.getChannelIsNoise(this._doc.channel);
    this._pitchCount = isDrum
      ? Config.drumCount
      : this._doc.getVisiblePitchCount();
    this._pitchHeight = this._editorHeight / this._pitchCount;
    this._updateCursorPitch();
    if (this._pointers.latest.isDown) this._playLiveInput();
    const baseVisibleOctave: number = this._doc.getBaseVisibleOctave(
      this._doc.channel,
    );

    if (
      this._renderedScale == this._doc.song.scale &&
      this._renderedComposingKey == this._doc.song.composingKey &&
      this._renderedDrums == isDrum &&
      this._renderedBaseVisibleOctave == baseVisibleOctave &&
      this._renderedPitchCount == this._pitchCount
    )
      return;

    this._renderedScale = this._doc.song.scale;
    this._renderedComposingKey = this._doc.song.composingKey;
    this._renderedDrums = isDrum;
    this._renderedBaseVisibleOctave = baseVisibleOctave;

    this._pianoContainer.style.display = isDrum ? "none" : "flex";
    this._drumContainer.style.display = isDrum ? "flex" : "none";

    if (!isDrum) {
      if (this._renderedPitchCount != this._pitchCount) {
        this._pianoContainer.innerHTML = "";
        for (let i: number = 0; i < this._pitchCount; i++) {
          const pianoLabel: HTMLDivElement = HTML.div({ class: "pitch-label" });
          const pianoKey: HTMLDivElement = HTML.div(
            { class: "pitch-button", style: "background-color: gray;" },
            pianoLabel,
          );
          this._pianoContainer.appendChild(pianoKey);
          this._pianoLabels[i] = pianoLabel;
          this._pianoKeys[i] = pianoKey;
        }
        this._pianoLabels.length = this._pitchCount;
        this._pianoKeys.length = this._pitchCount;
        this._renderedPitchCount = this._pitchCount;
      }

      for (let j: number = 0; j < this._pitchCount; j++) {
        const pitchNameIndex: number =
          (j + Config.keys[this._doc.song.composingKey].basePitch) %
          Config.pitchesPerOctave;
        const isWhiteKey: boolean = Config.keys[pitchNameIndex].isWhiteKey;
        this._pianoKeys[j].style.backgroundColor = isWhiteKey
          ? ColorConfig.whitePianoKey
          : ColorConfig.blackPianoKey;
        if (
          !Config.scales[this._doc.song.scale].flags[
            j % Config.pitchesPerOctave
          ]
        ) {
          this._pianoKeys[j].classList.add("disabled");
          this._pianoLabels[j].style.display = "none";
        } else {
          this._pianoKeys[j].classList.remove("disabled");
          this._pianoLabels[j].style.display = "";

          const label: HTMLDivElement = this._pianoLabels[j];
          label.style.color = isWhiteKey
            ? ColorConfig.blackText
            : ColorConfig.text;
          label.textContent =
            Piano.getPitchName(pitchNameIndex, j) +
            (j % Config.pitchesPerOctave == 0
              ? baseVisibleOctave + Math.floor(j / Config.pitchesPerOctave)
              : "");
        }
      }
    }
    this._updatePreview();
  };

  public static getPitchName(
    pitchNameIndex: number,
    scaleIndex: number,
  ): string {
    let text: string;

    if (Config.keys[pitchNameIndex].isWhiteKey) {
      text = Config.keys[pitchNameIndex].name;
    } else {
      const shiftDir: number =
        Config.blackKeyNameParents[scaleIndex % Config.pitchesPerOctave];
      text =
        Config.keys[
          (pitchNameIndex + Config.pitchesPerOctave + shiftDir) %
            Config.pitchesPerOctave
        ].name;
      if (shiftDir == 1) {
        text += "♭";
      } else if (shiftDir == -1) {
        text += "♯";
      }
    }

    return text;
  }
}
