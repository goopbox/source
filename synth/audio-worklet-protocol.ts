// Copyright (c) John Nesky and contributing authors, distributed under the MIT license.

export interface LiveInputState {
  readonly pitches: readonly number[];
  readonly channel: number;
  readonly instruments: readonly number[];
  readonly duration: number;
  readonly started: boolean;
}

export type SynthCommand =
  | {
      readonly type: "initialize";
      readonly song: Uint8Array;
      readonly mutedChannels: readonly boolean[];
      readonly playhead: number;
      readonly playing: boolean;
      readonly recording: boolean;
      readonly loopRepeatCount: number;
      readonly metronomeEnabled: boolean;
      readonly countInEnabled: boolean;
      readonly liveInput: LiveInputState;
    }
  | {
      readonly type: "setSong";
      readonly song: Uint8Array;
      readonly mutedChannels: readonly boolean[];
    }
  | {
      readonly type: "setAsset";
      readonly sampleId: string;
      readonly samples: ArrayBuffer;
      readonly sampleRate: number;
    }
  | {
      readonly type: "setSoundFont";
      readonly soundFontId: string;
      readonly data: ArrayBuffer;
    }
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "startRecording" }
  | { readonly type: "setPlayhead"; readonly playhead: number }
  | { readonly type: "jumpIntoLoop" }
  | { readonly type: "goToBar"; readonly bar: number }
  | { readonly type: "goToNextBar" }
  | { readonly type: "goToPrevBar" }
  | { readonly type: "snapToBar" }
  | { readonly type: "snapToStart" }
  | { readonly type: "resetEffects" }
  | { readonly type: "setLoopRepeatCount"; readonly loopRepeatCount: number }
  | { readonly type: "setMetronomeEnabled"; readonly enabled: boolean }
  | { readonly type: "setCountInEnabled"; readonly enabled: boolean }
  | { readonly type: "setLiveInput"; readonly state: LiveInputState }
  | { readonly type: "setLiveInputChannel"; readonly channel: number }
  | {
      readonly type: "setLiveInputInstruments";
      readonly instruments: readonly number[];
    }
  | { readonly type: "maintainLiveInput" }
  | { readonly type: "shutdown" };

export interface TransportSnapshot {
  readonly playhead: number;
  readonly playing: boolean;
  readonly recording: boolean;
  readonly countIn: boolean;
}

export type SynthEvent =
  | ({ readonly type: "ready" } & TransportSnapshot)
  | { readonly type: "initializationError"; readonly message: string }
  | ({ readonly type: "transport" } & TransportSnapshot)
  | ({ readonly type: "playbackEnded" } & TransportSnapshot)
  | { readonly type: "idle" };
