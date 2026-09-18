// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export {
  type Dictionary,
  type DictionaryArray,
  EnvelopeType,
  InstrumentType,
  type Transition,
  type Chord,
  type Envelope,
  Config,
} from "../synth/synth-config.js";
export { EditorConfig } from "./editor-config.js";
export { ColorConfig } from "./color-config.js";

export { SongEditor } from "./song-editor.js";
export {
  EventPoint,
  Event,
  NotePin,
  Note,
  Pattern,
  Instrument,
  Channel,
  Song,
  SynthEngine,
} from "../synth/synth.js";
export { SynthController as Synth } from "../synth/synth-controller.js";
export { SongDocument } from "./song-document.js";
export { ExportPrompt } from "./export-prompt.js";
export { ChangePreset } from "./changes.js";
export {
  fastFourierTransform,
  forwardRealFourierTransform,
  inverseRealFourierTransform,
} from "../synth/fft.js";
export { FilterCoefficients, FrequencyResponse, DynamicBiquadFilter } from "../synth/filtering.js";

// To initialize:
// New app.SongEditor(document.getElementById("app"));
