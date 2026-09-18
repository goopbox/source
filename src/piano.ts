// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "./color-config.js";
import { Config } from "../synth/synth-config.js";
import { EasyPointers } from "./easy-pointers.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { SongDocument } from "./song-document.js";

export class Piano {
  #doc: SongDocument;
  readonly #pianoContainer: HTMLDivElement = HTML.div({
    style:
      "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;",
  });
  readonly #drumContainer: HTMLDivElement = HTML.div({
    style:
      "width: 100%; height: 100%; display: flex; flex-direction: column-reverse; align-items: stretch;",
  });
  readonly #preview: HTMLDivElement = HTML.div({
    style: `width: 100%; height: 40px; border: 2px solid ${ColorConfig.text}; position: absolute; pointer-events: none;`,
  });
  public readonly container: HTMLDivElement = HTML.div(
    {
      style:
        "width: 32px; height: 100%; overflow: hidden; position: relative; flex-shrink: 0; touch-action: none;",
    },
    this.#pianoContainer,
    this.#drumContainer,
    this.#preview,
  );

  readonly #pointers: EasyPointers = new EasyPointers(this.container, {
    preventTouchGestureScrolling: true,
  });

  readonly #editorHeight: number = 481;
  readonly #pianoKeys: HTMLDivElement[] = [];
  readonly #pianoLabels: HTMLDivElement[] = [];

  #pitchHeight!: number;
  #pitchCount!: number;
  #cursorPitch!: number;
  #playedPitch = -1;
  #renderedScale = -1;
  #renderedDrums = false;
  #renderedComposingKey = -1;
  #renderedBaseVisibleOctave = -1;
  #renderedPitchCount = -1;
  readonly #renderedLiveInputPitches: number[] = [];

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    for (let i = 0; i < Config.drumCount; i++) {
      const drumLabel: HTMLDivElement = HTML.div({ class: "pitch-label" }, String(i + 1));
      this.#drumContainer.append(
        HTML.div(
          {
            class: "pitch-button",
            style: `background-color: ${ColorConfig.blackPianoKey}; color: ${ColorConfig.text};`,
          },
          drumLabel,
        ),
      );
    }

    this.container.addEventListener("pointerenter", this.#onPointerMove);
    this.container.addEventListener("pointerleave", this.#onPointerLeave);
    this.container.addEventListener("pointerdown", this.#onPointerDown);
    this.container.addEventListener("pointermove", this.#onPointerMove);
    this.container.addEventListener("pointerup", this.#onPointerUp);
    this.container.addEventListener("pointercancel", this.#onPointerUp);

    this.#doc.notifier.watch(this.#documentChanged);
    this.#documentChanged();

    window.requestAnimationFrame(this.#onAnimationFrame);
  }

  #updateCursorPitch(): void {
    const scale: readonly boolean[] = Config.scales[this.#doc.song.scale]!.flags,
      mouseY: number = this.#pointers.latest.getPointInNormalized(this.container).y || 0,
      mousePitch: number = Math.max(
        0,
        Math.min(this.#pitchCount - 1, (1 - mouseY) * this.#pitchCount),
      );
    if (
      scale[Math.floor(mousePitch) % Config.pitchesPerOctave]! ||
      this.#doc.song.getChannelIsNoise(this.#doc.channel)
    ) {
      this.#cursorPitch = Math.floor(mousePitch);
    } else {
      let topPitch: number = Math.floor(mousePitch) + 1,
        bottomPitch: number = Math.floor(mousePitch) - 1;
      while (!scale[topPitch % Config.pitchesPerOctave]!) {
        topPitch++;
      }
      while (!scale[bottomPitch % Config.pitchesPerOctave]!) {
        bottomPitch--;
      }
      let topRange: number = topPitch,
        bottomRange: number = bottomPitch + 1;
      if (topPitch % Config.pitchesPerOctave === 0 || topPitch % Config.pitchesPerOctave === 7) {
        topRange -= 0.5;
      }
      if (
        bottomPitch % Config.pitchesPerOctave === 0 ||
        bottomPitch % Config.pitchesPerOctave === 7
      ) {
        bottomRange += 0.5;
      }
      this.#cursorPitch = mousePitch - bottomRange > topRange - mousePitch ? topPitch : bottomPitch;
    }
  }

  #playLiveInput(): void {
    if (this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      return;
    }
    const octaveOffset: number =
        this.#doc.getBaseVisibleOctave(this.#doc.channel) * Config.pitchesPerOctave +
        (this.#doc.song.getChannelIsNoise(this.#doc.channel)
          ? 0
          : this.#doc.song.composingKey - this.#doc.song.key),
      currentPitch: number = this.#cursorPitch + octaveOffset;
    if (this.#playedPitch === currentPitch) {
      return;
    }
    this.#doc.performance.removePerformedPitch(this.#playedPitch);
    this.#playedPitch = currentPitch;
    this.#doc.performance.addPerformedPitch(currentPitch);
  }

  #releaseLiveInput(): void {
    this.#doc.performance.removePerformedPitch(this.#playedPitch);
    this.#playedPitch = -1;
  }

  #onPointerLeave = (_event: PointerEvent): void => {
    this.#updatePreview();
  };

  #onPointerDown = (_event: PointerEvent): void => {
    if (this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      return;
    }
    this.#doc.synth.maintainLiveInput();
    this.#updateCursorPitch();
    this.#playLiveInput();
    this.#updatePreview();
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      return;
    }
    this.#doc.synth.maintainLiveInput();
    this.#updateCursorPitch();
    if (event.pointer!.isDown) {
      this.#playLiveInput();
    }
    this.#updatePreview();
  };

  #onPointerUp = (_event: PointerEvent): void => {
    this.#releaseLiveInput();
    this.#updatePreview();
  };

  #onAnimationFrame = (): void => {
    window.requestAnimationFrame(this.#onAnimationFrame);

    let liveInputChanged = false;
    const liveInputPitchCount: number = this.#doc.performance.pitchesAreTemporary()
      ? 0
      : this.#doc.synth.liveInputPitches.length;
    if (this.#renderedLiveInputPitches.length !== liveInputPitchCount) {
      liveInputChanged = true;
    }
    for (let i = 0; i < liveInputPitchCount; i++) {
      if (this.#renderedLiveInputPitches[i]! !== this.#doc.synth.liveInputPitches[i]!) {
        this.#renderedLiveInputPitches[i] = this.#doc.synth.liveInputPitches[i]!;
        liveInputChanged = true;
      }
    }
    this.#renderedLiveInputPitches.length = liveInputPitchCount;

    if (liveInputChanged) {
      this.#updatePreview();
    }
  };

  #updatePreview(): void {
    if (this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      this.#preview.style.display = "none";
      return;
    }
    const previewIsVisible = this.#pointers.latest.isHovering;
    this.#preview.style.display = previewIsVisible ? "" : "none";
    if (previewIsVisible) {
      const pitchHeight: number =
        this.#pitchHeight / (this.#editorHeight / this.container.clientHeight);

      this.#preview.style.left = "0px";
      this.#preview.style.top = `${pitchHeight * (this.#pitchCount - this.#cursorPitch - 1)}px`;
      this.#preview.style.height = `${pitchHeight}px`;
    }

    const octaveOffset: number =
        this.#doc.getBaseVisibleOctave(this.#doc.channel) * Config.pitchesPerOctave +
        (this.#doc.song.getChannelIsNoise(this.#doc.channel)
          ? 0
          : this.#doc.song.composingKey - this.#doc.song.key),
      container: HTMLDivElement = this.#doc.song.getChannelIsNoise(this.#doc.channel)
        ? this.#drumContainer
        : this.#pianoContainer,
      children: HTMLCollection = container.children;
    for (let i = 0; i < children.length; i++) {
      const child: Element = children[i]!;
      child.classList.toggle(
        "pressed",
        !(this.#renderedLiveInputPitches.indexOf(i + octaveOffset) === -1),
      );
    }
  }

  #documentChanged = (): void => {
    if (this.#doc.song.getChannelIsAutomation(this.#doc.channel)) {
      if (this.#playedPitch !== -1) {
        this.#releaseLiveInput();
      }
      this.#pianoContainer.style.display = "none";
      this.#drumContainer.style.display = "none";
      this.#preview.style.display = "none";
      this.#renderedPitchCount = -1;
      return;
    }
    const isDrum: boolean = this.#doc.song.getChannelIsNoise(this.#doc.channel);
    this.#pitchCount = isDrum ? Config.drumCount : this.#doc.getVisiblePitchCount();
    this.#pitchHeight = this.#editorHeight / this.#pitchCount;
    this.#updateCursorPitch();
    if (this.#pointers.latest.isDown) {
      this.#playLiveInput();
    }
    const baseVisibleOctave: number = this.#doc.getBaseVisibleOctave(this.#doc.channel);

    if (
      this.#renderedScale === this.#doc.song.scale &&
      this.#renderedComposingKey === this.#doc.song.composingKey &&
      this.#renderedDrums === isDrum &&
      this.#renderedBaseVisibleOctave === baseVisibleOctave &&
      this.#renderedPitchCount === this.#pitchCount
    ) {
      return;
    }

    this.#renderedScale = this.#doc.song.scale;
    this.#renderedComposingKey = this.#doc.song.composingKey;
    this.#renderedDrums = isDrum;
    this.#renderedBaseVisibleOctave = baseVisibleOctave;

    this.#pianoContainer.style.display = isDrum ? "none" : "flex";
    this.#drumContainer.style.display = isDrum ? "flex" : "none";

    if (!isDrum) {
      if (this.#renderedPitchCount !== this.#pitchCount) {
        this.#pianoContainer.innerHTML = "";
        for (let i = 0; i < this.#pitchCount; i++) {
          const pianoLabel: HTMLDivElement = HTML.div({ class: "pitch-label" }),
            pianoKey: HTMLDivElement = HTML.div(
              { class: "pitch-button", style: "background-color: gray;" },
              pianoLabel,
            );
          this.#pianoContainer.append(pianoKey);
          this.#pianoLabels[i] = pianoLabel;
          this.#pianoKeys[i] = pianoKey;
        }
        this.#pianoLabels.length = this.#pitchCount;
        this.#pianoKeys.length = this.#pitchCount;
        this.#renderedPitchCount = this.#pitchCount;
      }

      for (let j = 0; j < this.#pitchCount; j++) {
        const pitchNameIndex: number =
            (j + Config.keys[this.#doc.song.composingKey]!.basePitch) % Config.pitchesPerOctave,
          isWhiteKey: boolean = Config.keys[pitchNameIndex]!.isWhiteKey;
        this.#pianoKeys[j]!.style.backgroundColor = isWhiteKey
          ? ColorConfig.whitePianoKey
          : ColorConfig.blackPianoKey;
        if (Config.scales[this.#doc.song.scale]!.flags[j % Config.pitchesPerOctave]!) {
          this.#pianoKeys[j]!.classList.remove("disabled");
          this.#pianoLabels[j]!.style.display = "";

          const label: HTMLDivElement = this.#pianoLabels[j]!;
          label.style.color = isWhiteKey ? ColorConfig.blackText : ColorConfig.text;
          label.textContent =
            Piano.getPitchName(pitchNameIndex, j) +
            (j % Config.pitchesPerOctave === 0
              ? baseVisibleOctave + Math.floor(j / Config.pitchesPerOctave)
              : "");
        } else {
          this.#pianoKeys[j]!.classList.add("disabled");
          this.#pianoLabels[j]!.style.display = "none";
        }
      }
    }
    this.#updatePreview();
  };

  public static getPitchName(pitchNameIndex: number, scaleIndex: number): string {
    let text: string;

    if (Config.keys[pitchNameIndex]!.isWhiteKey) {
      text = Config.keys[pitchNameIndex]!.name;
    } else {
      const shiftDir: number = Config.blackKeyNameParents[scaleIndex % Config.pitchesPerOctave]!;
      text =
        Config.keys[
          (pitchNameIndex + Config.pitchesPerOctave + shiftDir) % Config.pitchesPerOctave
        ]!.name;
      if (shiftDir === 1) {
        text += "♭";
      } else if (shiftDir === -1) {
        text += "♯";
      }
    }

    return text;
  }
}
