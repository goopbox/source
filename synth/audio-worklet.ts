// Copyright (c) John Nesky and contributing authors, distributed under the MIT license.

import { SynthEngine } from "./synth.js";
import type {
  LiveInputState,
  SynthCommand,
  SynthEvent,
  TransportSnapshot,
} from "./audio-worklet-protocol.js";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  protected readonly port: MessagePort;
  public constructor();
  public abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

class SynthProcessor extends AudioWorkletProcessor {
  private readonly synth: SynthEngine = new SynthEngine();
  private initialized: boolean = false;
  private usable: boolean = true;
  private liveInputDeadline: number = 0;
  private renderedFrames: number = 0;
  private lastReportFrame: number = 0;
  private lastPlaying: boolean = false;
  private lastRecording: boolean = false;
  private lastCountIn: boolean = false;
  private idleReported: boolean = false;

  public constructor() {
    super();
    this.synth.setSampleRate(sampleRate);
    this.port.onmessage = (event: MessageEvent<SynthCommand>): void =>
      this.handleCommand(event.data);
  }

  private setLiveInput(state: LiveInputState): void {
    this.synth.liveInputPitches.length = state.pitches.length;
    for (let i: number = 0; i < state.pitches.length; i++)
      this.synth.liveInputPitches[i] = state.pitches[i]!;
    this.synth.liveInputInstruments.length = state.instruments.length;
    for (let i: number = 0; i < state.instruments.length; i++)
      this.synth.liveInputInstruments[i] = state.instruments[i]!;
    this.synth.liveInputChannel = state.channel;
    this.synth.liveInputDuration = state.duration;
    this.synth.liveInputStarted = state.started;
    this.maintainLiveInput();
  }

  private setLiveInputInstruments(instruments: readonly number[]): void {
    this.synth.liveInputInstruments.length = instruments.length;
    for (let i: number = 0; i < instruments.length; i++)
      this.synth.liveInputInstruments[i] = instruments[i]!;
  }

  private maintainLiveInput(): void {
    this.liveInputDeadline = this.renderedFrames + sampleRate * 10;
    this.idleReported = false;
  }

  private setSong(
    serializedSong: Uint8Array,
    mutedChannels: readonly boolean[],
  ): void {
    this.synth.setSong(serializedSong);
    const song = this.synth.song;
    if (song == null) return;
    for (let i: number = 0; i < song.channels.length; i++)
      song.channels[i]!.muted = mutedChannels[i] ?? false;
  }

  private handleCommand(command: SynthCommand): void {
    try {
      switch (command.type) {
        case "initialize":
          this.setSong(command.song, command.mutedChannels);
          this.synth.playhead = command.playhead;
          this.synth.loopRepeatCount = command.loopRepeatCount;
          this.synth.enableMetronome = command.metronomeEnabled;
          this.synth.countInMetronome = command.countInEnabled;
          this.setLiveInput(command.liveInput);
          if (command.recording) this.synth.startRecording();
          else if (command.playing) this.synth.play();
          this.initialized = true;
          this.postSnapshot("ready");
          break;
        case "setSong":
          this.setSong(command.song, command.mutedChannels);
          break;
        case "setAsset":
          this.synth.setAsset(
            command.sampleId,
            new Float32Array(command.samples),
            command.sampleRate,
          );
          break;
        case "setSoundFont":
          this.synth.setSoundFont(command.soundFontId, command.data);
          break;
        case "play":
          this.synth.play();
          this.idleReported = false;
          break;
        case "pause":
          this.synth.pause();
          break;
        case "startRecording":
          this.synth.startRecording();
          this.idleReported = false;
          break;
        case "setPlayhead":
          this.synth.playhead = command.playhead;
          this.postSnapshot("transport");
          break;
        case "jumpIntoLoop":
          this.synth.jumpIntoLoop();
          this.postSnapshot("transport");
          break;
        case "goToBar":
          this.synth.goToBar(command.bar);
          this.postSnapshot("transport");
          break;
        case "goToNextBar":
          this.synth.goToNextBar();
          this.postSnapshot("transport");
          break;
        case "goToPrevBar":
          this.synth.goToPrevBar();
          this.postSnapshot("transport");
          break;
        case "snapToBar":
          this.synth.snapToBar();
          this.postSnapshot("transport");
          break;
        case "snapToStart":
          this.synth.snapToStart();
          this.postSnapshot("transport");
          break;
        case "resetEffects":
          this.synth.resetEffects();
          break;
        case "setLoopRepeatCount":
          this.synth.loopRepeatCount = command.loopRepeatCount;
          break;
        case "setMetronomeEnabled":
          this.synth.enableMetronome = command.enabled;
          break;
        case "setCountInEnabled":
          this.synth.countInMetronome = command.enabled;
          this.postSnapshot("transport");
          break;
        case "setLiveInput":
          this.setLiveInput(command.state);
          break;
        case "setLiveInputChannel":
          this.synth.liveInputChannel = command.channel;
          break;
        case "setLiveInputInstruments":
          this.setLiveInputInstruments(command.instruments);
          break;
        case "maintainLiveInput":
          this.maintainLiveInput();
          break;
        case "shutdown":
          this.synth.pause();
          this.synth.resetEffects();
          this.usable = false;
          break;
      }
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      this.port.postMessage({
        type: "initializationError",
        message,
      } satisfies SynthEvent);
    }
  }

  private snapshot(): TransportSnapshot {
    return {
      playhead: this.synth.playhead,
      playing: this.synth.playing,
      recording: this.synth.recording,
      countIn: this.synth.countInMetronome,
    };
  }

  private postSnapshot(type: "ready" | "transport" | "playbackEnded"): void {
    this.port.postMessage({ type, ...this.snapshot() } satisfies SynthEvent);
    this.lastPlaying = this.synth.playing;
    this.lastRecording = this.synth.recording;
    this.lastCountIn = this.synth.countInMetronome;
  }

  public process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    if (!this.usable) return false;
    const output: Float32Array[] | undefined = outputs[0];
    const left: Float32Array | undefined = output?.[0];
    const right: Float32Array | undefined = output?.[1];
    if (left == null || right == null) return true;

    const wasPlaying: boolean = this.synth.playing;
    if (
      this.initialized &&
      (wasPlaying || this.renderedFrames < this.liveInputDeadline)
    ) {
      this.synth.synthesize(left, right, left.length, wasPlaying);
    }
    this.renderedFrames += left.length;

    if (!this.initialized) return true;
    if (wasPlaying && !this.synth.playing) {
      this.postSnapshot("playbackEnded");
    } else if (
      this.synth.playing != this.lastPlaying ||
      this.synth.recording != this.lastRecording ||
      this.synth.countInMetronome != this.lastCountIn
    ) {
      this.postSnapshot("transport");
    } else if (this.renderedFrames - this.lastReportFrame >= sampleRate / 50) {
      this.lastReportFrame = this.renderedFrames;
      this.postSnapshot("transport");
    }

    if (
      !this.synth.playing &&
      this.renderedFrames >= this.liveInputDeadline &&
      !this.idleReported
    ) {
      this.idleReported = true;
      this.port.postMessage({ type: "idle" } satisfies SynthEvent);
    }
    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
