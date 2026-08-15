// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  type DictionaryArray,
  type NamedOption,
  InstrumentType,
  toNameMap,
} from "../synth/SynthConfig.js";

export interface PresetCategory extends NamedOption {
  readonly presets: DictionaryArray<Preset>;
}

export interface Preset extends NamedOption {
  readonly isNoise?: boolean;
  readonly generalMidi?: boolean;
  readonly midiProgram?: number;
  readonly midiSubharmonicOctaves?: number;
  readonly customType?: InstrumentType;
  readonly settings?: any;
}

export const isOnMac: boolean =
  /^Mac/i.test(navigator.platform) ||
  /Mac OS X/i.test(navigator.userAgent) ||
  /^(iPhone|iPad|iPod)/i.test(navigator.platform) ||
  /(iPhone|iPad|iPod)/i.test(navigator.userAgent);
export const ctrlSymbol: string = isOnMac ? "⌘" : "Ctrl+";
export const ctrlName: string = isOnMac ? "command" : "control";

export function prettyNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0*$/, "");
}

export class EditorConfig {
  public static readonly presetCategories: DictionaryArray<PresetCategory> =
    toNameMap([
      {
        name: "Custom Instruments",
        presets: <DictionaryArray<Preset>>toNameMap([
          { name: "chip wave", customType: InstrumentType.chip },
          { name: "FM (expert)", customType: InstrumentType.fm },
          { name: "basic noise", customType: InstrumentType.noise },
          { name: "spectrum", customType: InstrumentType.spectrum },
          { name: "drumset", customType: InstrumentType.drumset },
          { name: "harmonics", customType: InstrumentType.harmonics },
          { name: "pulse width", customType: InstrumentType.pwm },
          { name: "picked string", customType: InstrumentType.pickedString },
          { name: "supersaw", customType: InstrumentType.supersaw },
          { name: "SoundFont", customType: InstrumentType.soundFont },
        ]),
      },
      {
        name: "Retro Presets (Pitch)",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "square wave",
            midiProgram: 80,
            settings: {
              type: "chip",
              transition: "interrupt",
              wave: "square",
            },
          },
          {
            name: "triangle wave",
            midiProgram: 71,
            settings: {
              type: "chip",
              transition: "interrupt",
            },
          },
          {
            name: "square lead",
            midiProgram: 80,
            generalMidi: true,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 0.3536,
                },
              ],
              effects: ["eq filter", "unison"],
              unison: "hum",
              fadeOutTicks: -3,
              wave: "square",
            },
          },
          {
            name: "sawtooth lead 1",
            midiProgram: 81,
            generalMidi: true,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "unison"],
              unison: "shimmer",
              fadeOutTicks: -3,
              wave: "sawtooth",
            },
          },
          {
            name: "sawtooth lead 2",
            midiProgram: 81,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "vibrato", "unison"],
              vibrato: "light",
              unison: "hum",
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              wave: "sawtooth",
            },
          },
          {
            name: "FM twang",
            midiProgram: 32,
            settings: {
              type: "FM",
              fadeOutTicks: -3,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "FM bass",
            midiProgram: 36,
            settings: {
              type: "FM",
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              operators: [
                {
                  frequency: 2,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "FM flute",
            midiProgram: 73,
            settings: {
              type: "FM",
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "FM organ",
            midiProgram: 16,
            settings: {
              type: "FM",
              effects: ["vibrato"],
              vibrato: "delayed",
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 11,
                  wave: "sine",
                },
              ],
            },
          },
          {
            name: "supersaw lead",
            midiProgram: 81,
            settings: {
              type: "supersaw",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 66.99999999999999,
              fadeOutTicks: -6,
              spread: 58,
            },
          },
        ]),
      },
      { name: "Keyboard Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "grand piano",
            midiProgram: 0,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 148.65,
                  linearGain: 0.7071,
                },
                {
                  type: "peak",
                  cutoffHz: 1681.79,
                  linearGain: 4,
                },
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 0.1768,
                },
                {
                  type: "peak",
                  cutoffHz: 3363.59,
                  linearGain: 4,
                },
                {
                  type: "peak",
                  cutoffHz: 2378.41,
                  linearGain: 0.25,
                },
              ],
              effects: ["eq filter", "unison", "note filter", "reverb"],
              unison: "piano",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.3536,
                },
                {
                  type: "high-pass",
                  cutoffHz: 125,
                  linearGain: 0.0884,
                },
              ],
              reverb: 66.99999999999999,
              fadeOutTicks: 48,
              harmonics: [
                100, 100, 86, 86, 86, 71, 71, 71, 0, 71, 71, 71, 71, 57, 57, 71,
                57, 14, 57, 57, 57, 57, 57, 57, 57, 57, 29, 57,
              ],
              stringSustain: 86,
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                  index: 0,
                },
                {
                  target: "noteFilterFreq",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "noteFilterFreq",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "bright piano",
            midiProgram: 1,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1681.79,
                  linearGain: 0.7071,
                },
                {
                  type: "high-pass",
                  cutoffHz: 148.65,
                  linearGain: 0.5,
                },
                {
                  type: "peak",
                  cutoffHz: 3363.59,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "unison", "reverb"],
              unison: "piano",
              reverb: 33,
              fadeOutTicks: 24,
              harmonics: [
                100, 100, 86, 86, 71, 71, 0, 71, 71, 71, 71, 71, 71, 14, 57, 57,
                57, 57, 57, 57, 29, 57, 57, 57, 57, 57, 57, 57,
              ],
              stringSustain: 86,
            },
          },
          {
            name: "electric grand",
            midiProgram: 2,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["unison", "note filter"],
              unison: "shimmer",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              fadeOutTicks: 48,
              wave: "1/8 pulse",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "honky-tonk piano",
            midiProgram: 3,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 0.3536,
                },
              ],
              effects: ["eq filter", "unison", "reverb"],
              unison: "honky tonk",
              reverb: 33,
              fadeOutTicks: 48,
              harmonics: [
                100, 100, 86, 71, 86, 71, 43, 71, 43, 43, 57, 57, 57, 29, 57,
                57, 57, 57, 57, 57, 43, 57, 57, 57, 43, 43, 43, 43,
              ],
            },
          },
          {
            name: "electric piano 1",
            midiProgram: 4,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              fadeOutTicks: -3,
              harmonics: [
                86, 100, 100, 71, 71, 57, 57, 43, 43, 43, 29, 29, 29, 14, 14,
                14, 0, 0, 0, 0, 0, 57, 0, 0, 0, 0, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "electric piano 2",
            midiProgram: 5,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              fadeOutTicks: 48,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 6,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "harpsichord",
            midiProgram: 6,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 250,
                  linearGain: 0.3536,
                },
                {
                  type: "peak",
                  cutoffHz: 11313.71,
                  linearGain: 2.8284,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: 24,
              harmonics: [
                100, 100, 100, 86, 57, 86, 86, 86, 86, 57, 57, 71, 71, 86, 86,
                71, 71, 86, 86, 71, 71, 71, 71, 71, 71, 71, 71, 71,
              ],
              stringSustain: 79,
            },
          },
          {
            name: "clavinet",
            midiProgram: 7,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.3536,
                },
              ],
              fadeOutTicks: -3,
              feedbackType: "3⟲",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 3,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "dulcimer",
            midiProgram: 15,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 0.3536,
                },
              ],
              effects: ["eq filter", "unison", "reverb"],
              unison: "piano",
              reverb: 33,
              fadeOutTicks: 48,
              harmonics: [
                100, 100, 100, 86, 100, 86, 57, 100, 100, 86, 100, 86, 100, 86,
                100, 71, 57, 71, 71, 100, 86, 71, 86, 86, 100, 86, 86, 86,
              ],
              stringSustain: 79,
            },
          },
        ]) },
      { name: "Idiophone Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "celesta",
            midiProgram: 8,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 1,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "glockenspiel",
            midiProgram: 9,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 2,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "music box 1",
            midiProgram: 10,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: 48,
              harmonics: [
                100, 0, 0, 100, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0,
                86, 0, 0, 0, 0, 0, 0, 71, 0,
              ],
              stringSustain: 64,
            },
          },
          {
            name: "music box 2",
            midiProgram: 10,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 0.7071,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: 48,
              harmonics: [
                100, 57, 57, 0, 0, 0, 0, 0, 0, 57, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                43, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
              stringSustain: 29,
            },
          },
          {
            name: "vibraphone",
            midiProgram: 11,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1 2 3 4",
              feedbackType: "1→2→3→4",
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 9,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 9,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "marimba",
            midiProgram: 12,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1 2←(3 4)",
              operators: [
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "kalimba",
            midiProgram: 108,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              operators: [
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "xylophone",
            midiProgram: 13,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 6,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "tubular bell",
            midiProgram: 14,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
                {
                  type: "high-pass",
                  cutoffHz: 105.11,
                  linearGain: 0.3536,
                },
              ],
              effects: ["eq filter", "unison", "reverb"],
              unison: "shimmer",
              reverb: 33,
              fadeOutTicks: 96,
              harmonics: [
                43, 71, 0, 100, 0, 100, 0, 86, 0, 0, 86, 0, 14, 71, 14, 14, 57,
                14, 14, 43, 14, 14, 43, 14, 14, 43, 14, 14,
              ],
              stringSustain: 86,
            },
          },
          {
            name: "bell synth",
            midiProgram: 14,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              operators: [
                {
                  frequency: 2,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 1,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "rain drop",
            midiProgram: 96,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "crystal",
            midiProgram: 98,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["vibrato", "note filter", "reverb"],
              vibrato: "delayed",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "tinkle bell",
            midiProgram: 112,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1 2 3 4",
              feedbackType: "1→2→3→4",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "agogo",
            midiProgram: 113,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1 2 3 4",
              feedbackType: "1→4",
              feedbackAmplitude: 15,
              operators: [
                {
                  frequency: 2,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 11,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]) },
      { name: "Guitar Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "nylon guitar",
            midiProgram: 24,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←2←3←4",
              feedbackType: "3⟲",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 2,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "steel guitar",
            midiProgram: 25,
            generalMidi: true,
            settings: {
              type: "Picked String",
              effects: ["reverb"],
              reverb: 33,
              fadeOutTicks: 48,
              harmonics: [
                100, 100, 86, 71, 71, 71, 86, 86, 71, 57, 43, 43, 43, 57, 57,
                57, 57, 57, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43,
              ],
            },
          },
          {
            name: "jazz guitar",
            midiProgram: 26,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                100, 100, 86, 71, 57, 71, 71, 43, 57, 71, 57, 43, 29, 29, 29,
                29, 29, 29, 29, 29, 14, 14, 14, 14, 14, 14, 14, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "clean guitar",
            midiProgram: 27,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                86, 100, 100, 100, 86, 57, 86, 100, 100, 100, 71, 57, 43, 71,
                86, 71, 57, 57, 71, 71, 71, 71, 57, 57, 57, 57, 57, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "muted guitar",
            midiProgram: 28,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]) },
      {
        name: "Picked Bass Presets",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "acoustic bass",
            midiProgram: 32,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              harmonics: [
                100, 86, 71, 71, 71, 71, 57, 57, 57, 57, 43, 43, 43, 43, 43, 29,
                29, 29, 29, 29, 29, 14, 14, 14, 14, 14, 14, 14,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "fingered bass",
            midiProgram: 33,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              harmonics: [
                100, 86, 71, 57, 71, 43, 57, 29, 29, 29, 29, 29, 29, 14, 14, 14,
                14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "picked bass",
            midiProgram: 34,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←(2 3←4)",
              feedbackType: "3⟲",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 1,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "fretless bass",
            midiProgram: 35,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1189.21,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                100, 100, 86, 71, 71, 57, 57, 71, 71, 71, 57, 57, 57, 57, 57,
                57, 57, 43, 43, 43, 43, 43, 43, 43, 43, 29, 29, 14,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "slap bass 1",
            midiProgram: 36,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 16000,
                  linearGain: 0.3536,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                100, 100, 100, 100, 86, 71, 57, 29, 29, 43, 43, 57, 71, 57, 29,
                29, 43, 57, 57, 57, 43, 43, 43, 57, 71, 71, 71, 71,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "slap bass 2",
            midiProgram: 37,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.3536,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1←2←3←4",
              feedbackType: "3⟲",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 3,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "bass synth 1",
            midiProgram: 38,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "3⟲ 4⟲",
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "bass synth 2",
            midiProgram: 39,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1000,
                  linearGain: 1.4142,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              feedbackType: "1→2",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "bass & lead",
            midiProgram: 87,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "reverb"],
              unison: "shimmer",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 4,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "dubstep yoi yoi",
            midiProgram: 87,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.7071,
                },
              ],
              effects: [
                "eq filter",
                "transition type",
                "note filter",
                "bitcrusher",
              ],
              transition: "slide",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 594.6,
                  linearGain: 11.3137,
                },
              ],
              bitcrusherOctave: 1.5,
              bitcrusherQuantization: 0,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 0,
                },
              ],
            },
          },
        ]),
      },
      {
        name: "Picked String Presets",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "pizzicato strings",
            midiProgram: 45,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1189.21,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "harp",
            midiProgram: 46,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←3 2←4",
              feedbackType: "3⟲",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "sitar",
            midiProgram: 104,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 1.4142,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 9,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 9,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "banjo",
            midiProgram: 105,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←(2 3←4)",
              feedbackType: "2⟲",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 4,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "ukulele",
            midiProgram: 105,
            settings: {
              type: "FM",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 11313.71,
                  linearGain: 0.1768,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←(2 3←4)",
              feedbackType: "3⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 9,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "shamisen",
            midiProgram: 106,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←(2 3←4)",
              feedbackType: "3⟲",
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "koto",
            midiProgram: 107,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]),
      },
      {
        name: "Distortion Presets",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "overdrive guitar",
            midiProgram: 29,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.7071,
                },
                {
                  type: "high-pass",
                  cutoffHz: 210.22,
                  linearGain: 1,
                },
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 1,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "note filter", "distortion"],
              noteFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 297.3,
                  linearGain: 2,
                },
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.7071,
                },
              ],
              distortion: 71,
              fadeOutTicks: 12,
              harmonics: [
                86, 100, 100, 86, 86, 86, 86, 71, 71, 71, 71, 71, 71, 71, 71,
                71, 71, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "distortion guitar",
            midiProgram: 30,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.7071,
                },
                {
                  type: "high-pass",
                  cutoffHz: 210.22,
                  linearGain: 1,
                },
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 1,
                },
                {
                  type: "peak",
                  cutoffHz: 594.6,
                  linearGain: 0.3536,
                },
                {
                  type: "peak",
                  cutoffHz: 1000,
                  linearGain: 0.25,
                },
              ],
              effects: ["eq filter", "note filter", "distortion", "reverb"],
              noteFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 353.55,
                  linearGain: 2,
                },
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1,
                },
              ],
              distortion: 86,
              reverb: 66.99999999999999,
              fadeOutTicks: 12,
              harmonics: [
                86, 100, 100, 86, 86, 86, 86, 71, 71, 71, 71, 71, 71, 71, 71,
                71, 71, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "charango synth",
            midiProgram: 84,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 11313.71,
                  linearGain: 1,
                },
              ],
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackType: "1→2→3→4",
              feedbackAmplitude: 8,
              operators: [
                {
                  frequency: 3,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "guitar harmonics",
            midiProgram: 31,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: -3,
              algorithm: "1←(2 3)←4",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 4,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 2,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "PWM overdrive",
            midiProgram: 29,
            settings: {
              type: "PWM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 1.4142,
                },
              ],
              fadeOutTicks: -3,
              pulseWidth: 17.67767,
              envelopes: [
                {
                  target: "pulseWidth",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "PWM distortion",
            midiProgram: 30,
            settings: {
              type: "PWM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "vibrato"],
              vibrato: "delayed",
              fadeOutTicks: -3,
              envelopes: [
                {
                  target: "pulseWidth",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "FM overdrive",
            midiProgram: 29,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackType: "1→2",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "FM distortion",
            midiProgram: 30,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackType: "1→2",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
        ]),
      },
      { name: "Bellows Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "drawbar organ 1",
            midiProgram: 16,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                86, 86, 0, 86, 0, 0, 0, 86, 0, 0, 0, 0, 0, 0, 0, 86, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "drawbar organ 2",
            midiProgram: 16,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              harmonics: [
                86, 29, 71, 86, 71, 14, 0, 100, 0, 0, 0, 86, 0, 0, 0, 71, 0, 0,
                0, 57, 0, 0, 0, 29, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "percussive organ",
            midiProgram: 17,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "FM",
              effects: ["vibrato", "note filter", "reverb"],
              vibrato: "light",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1 2 3 4",
              feedbackType: "1→3 2→4",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "rock organ",
            midiProgram: 18,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "FM",
              effects: ["vibrato", "note filter", "chorus", "reverb"],
              vibrato: "delayed",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 5,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "pipe organ",
            midiProgram: 19,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
            },
          },
          {
            name: "reed organ",
            midiProgram: 20,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                71, 86, 100, 86, 71, 100, 57, 71, 71, 71, 43, 43, 43, 71, 43,
                71, 57, 57, 57, 57, 57, 57, 57, 29, 43, 29, 29, 14,
              ],
            },
          },
          {
            name: "accordion",
            midiProgram: 21,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "reverb"],
              unison: "honky tonk",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.3536,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              wave: "double saw",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "bandoneon",
            midiProgram: 23,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["unison", "note filter", "reverb"],
              unison: "hum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                86, 86, 86, 57, 71, 86, 57, 71, 71, 71, 57, 43, 57, 43, 71, 43,
                71, 57, 57, 43, 43, 43, 57, 43, 43, 29, 29, 29,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "bagpipe",
            midiProgram: 109,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["unison", "note filter", "reverb"],
              unison: "hum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 1.4142,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              harmonics: [
                71, 86, 86, 100, 100, 86, 57, 100, 86, 71, 71, 71, 57, 57, 57,
                71, 57, 71, 57, 71, 43, 57, 57, 43, 43, 43, 43, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
        ]) },
      { name: "String Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "violin",
            midiProgram: 40,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 1.4142,
                },
                {
                  type: "high-pass",
                  cutoffHz: 105.11,
                  linearGain: 0.3536,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "delayed",
              reverb: 66.99999999999999,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "1→2",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 4,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 5,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "viola",
            midiProgram: 41,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "delayed",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲",
              feedbackAmplitude: 8,
              operators: [
                {
                  frequency: 2,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "cello",
            midiProgram: 42,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.1768,
                },
                {
                  type: "high-pass",
                  cutoffHz: 297.3,
                  linearGain: 0.7071,
                },
                {
                  type: "peak",
                  cutoffHz: 4756.83,
                  linearGain: 5.6569,
                },
              ],
              effects: ["eq filter", "note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 16000,
                  linearGain: 0.0884,
                },
              ],
              reverb: 66.99999999999999,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 12,
              algorithm: "(1 2)←3←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 16,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "contrabass",
            midiProgram: 43,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "delayed",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "(1 2)←3←4",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 16,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "fiddle",
            midiProgram: 110,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "delayed",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "3⟲ 4⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 2,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "tremolo strings",
            midiProgram: 44,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "chorus", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 11313.71,
                  linearGain: 0.1768,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              algorithm: "1 2 3 4",
              feedbackType: "1→2→3→4",
              feedbackAmplitude: 12,
              operators: [
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0.5,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "strings",
            midiProgram: 48,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "chorus", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "4⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 4,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "slow strings",
            midiProgram: 49,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "chorus", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.1768,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "4⟲",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 4,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "strings synth 1",
            midiProgram: 50,
            generalMidi: true,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1414.21,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "vibrato", "unison", "chorus", "reverb"],
              vibrato: "delayed",
              unison: "hum",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              wave: "sawtooth",
            },
          },
          {
            name: "strings synth 2",
            midiProgram: 51,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "chorus", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 12,
              operators: [
                {
                  frequency: 3,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "orchestra hit 1",
            midiProgram: 55,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "FM",
              effects: ["note filter", "chorus", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 14,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 15,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "orchestra hit 2",
            midiProgram: 55,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "FM",
              effects: ["vibrato", "note filter", "chorus", "reverb"],
              vibrato: "delayed",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 14,
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 14,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "supersaw string",
            midiProgram: 41,
            settings: {
              type: "supersaw",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1.4142,
                },
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.1768,
                },
              ],
              effects: ["eq filter", "note filter", "reverb"],
              noteFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 500,
                  linearGain: 0.1768,
                },
              ],
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: 6,
              pulseWidth: 35.35534,
              dynamism: 83,
              spread: 8,
              shape: 50,
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 0,
                },
              ],
            },
          },
        ]) },
      { name: "Vocal Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "choir soprano",
            midiProgram: 94,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 2,
                },
                {
                  type: "peak",
                  cutoffHz: 1189.21,
                  linearGain: 5.6569,
                },
                {
                  type: "high-pass",
                  cutoffHz: 707.11,
                  linearGain: 2.8284,
                },
                {
                  type: "peak",
                  cutoffHz: 2000,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.25,
                },
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "shaky",
              reverb: 33,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 24,
              harmonics: [
                100, 100, 86, 57, 29, 29, 57, 71, 57, 29, 14, 14, 14, 29, 43,
                57, 43, 29, 14, 14, 14, 14, 14, 14, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "choir tenor",
            midiProgram: 52,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 1000,
                  linearGain: 11.3137,
                },
                {
                  type: "peak",
                  cutoffHz: 707.11,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 1681.79,
                  linearGain: 0.0884,
                },
                {
                  type: "high-pass",
                  cutoffHz: 297.3,
                  linearGain: 0.7071,
                },
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "shaky",
              reverb: 66.99999999999999,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 48,
              harmonics: [
                86, 100, 100, 86, 71, 57, 43, 29, 29, 29, 29, 43, 43, 43, 29,
                29, 29, 29, 29, 29, 29, 29, 29, 14, 14, 14, 14, 14,
              ],
            },
          },
          {
            name: "choir bass",
            midiProgram: 52,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 11.3137,
                },
                {
                  type: "peak",
                  cutoffHz: 594.6,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 1681.79,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 707.11,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "shaky",
              reverb: 66.99999999999999,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 48,
              harmonics: [
                71, 86, 100, 100, 86, 86, 57, 43, 29, 29, 29, 29, 29, 29, 43,
                43, 43, 43, 43, 29, 29, 29, 29, 14, 14, 14, 14, 14,
              ],
            },
          },
          {
            name: "solo soprano",
            midiProgram: 85,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 2,
                },
                {
                  type: "peak",
                  cutoffHz: 1189.21,
                  linearGain: 5.6569,
                },
                {
                  type: "high-pass",
                  cutoffHz: 707.11,
                  linearGain: 2.8284,
                },
                {
                  type: "peak",
                  cutoffHz: 2000,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.25,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "shaky",
              reverb: 33,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 12,
              harmonics: [
                86, 100, 86, 43, 14, 14, 57, 71, 57, 14, 14, 14, 14, 14, 43, 57,
                43, 14, 14, 14, 14, 14, 14, 14, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "solo tenor",
            midiProgram: 85,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 1000,
                  linearGain: 11.3137,
                },
                {
                  type: "peak",
                  cutoffHz: 707.11,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 1681.79,
                  linearGain: 0.0884,
                },
                {
                  type: "high-pass",
                  cutoffHz: 297.3,
                  linearGain: 0.7071,
                },
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "shaky",
              reverb: 33,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 12,
              harmonics: [
                86, 100, 100, 86, 71, 57, 43, 29, 29, 29, 29, 43, 43, 43, 29,
                29, 29, 29, 29, 29, 29, 29, 29, 14, 14, 14, 14, 14,
              ],
            },
          },
          {
            name: "solo bass",
            midiProgram: 85,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 594.6,
                  linearGain: 8,
                },
                {
                  type: "peak",
                  cutoffHz: 1681.79,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 707.11,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 8,
                },
                {
                  type: "high-pass",
                  cutoffHz: 210.22,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "shaky",
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: 12,
              harmonics: [
                71, 86, 100, 100, 86, 86, 57, 43, 29, 29, 29, 29, 29, 29, 43,
                43, 43, 43, 43, 29, 29, 29, 29, 14, 14, 14, 14, 14,
              ],
            },
          },
          {
            name: "voice ooh",
            midiProgram: 53,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1414.21,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "vibrato", "reverb"],
              vibrato: "shaky",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                100, 57, 43, 43, 14, 14, 0, 0, 0, 14, 29, 29, 14, 0, 14, 29, 29,
                14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "voice synth",
            midiProgram: 54,
            generalMidi: true,
            settings: {
              type: "chip",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "light",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              wave: "rounded",
            },
          },
          {
            name: "vox synth lead",
            midiProgram: 85,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "light",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "(1 2 3)←4",
              feedbackType: "1→2→3→4",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 2,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 9,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 1,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "tiny robot",
            midiProgram: 85,
            settings: {
              type: "FM",
              effects: ["transition type", "vibrato", "reverb"],
              transition: "slide",
              vibrato: "delayed",
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 2,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "yowie",
            midiProgram: 85,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 4,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "1←2←(3 4)",
              feedbackAmplitude: 12,
              operators: [
                {
                  frequency: 2,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "tremolo",
                  speed: 2,
                  a: 0.5,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "tremolo",
                  speed: 1,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "mouse",
            midiProgram: 85,
            settings: {
              type: "FM",
              effects: ["transition type", "vibrato", "reverb"],
              transition: "slide in pattern",
              vibrato: "light",
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 2,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteVolume",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "gumdrop",
            midiProgram: 85,
            settings: {
              type: "FM",
              effects: ["reverb"],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲",
              operators: [
                {
                  frequency: 2,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "none",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "echo drop",
            midiProgram: 102,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "chorus", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 2,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 2,
                  wave: "sine",
                },
                {
                  frequency: 16,
                  amplitude: 5,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "dark choir",
            midiProgram: 85,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              spectrum: [
                43, 14, 14, 14, 14, 14, 14, 100, 14, 14, 14, 57, 14, 14, 100,
                14, 43, 14, 43, 14, 14, 43, 14, 29, 14, 29, 14, 14, 29, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
        ]) },
      { name: "Brass Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "trumpet",
            midiProgram: 56,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "trombone",
            midiProgram: 57,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackType: "2⟲",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "tuba",
            midiProgram: 58,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackType: "2⟲",
              feedbackAmplitude: 8,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "muted trumpet",
            midiProgram: 59,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 2.8284,
                },
                {
                  type: "peak",
                  cutoffHz: 4000,
                  linearGain: 2.8284,
                },
              ],
              effects: ["eq filter", "note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 1,
                },
              ],
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 9,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "french horn",
            midiProgram: 60,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 1,
                },
                {
                  type: "peak",
                  cutoffHz: 2378.41,
                  linearGain: 2.8284,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "brass section",
            midiProgram: 61,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "brass synth 1",
            midiProgram: 62,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 11,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "brass synth 2",
            midiProgram: 63,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "pulse brass",
            midiProgram: 62,
            settings: {
              type: "PWM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "pulseWidth",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
        ]) },
      { name: "Reed Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "soprano sax",
            midiProgram: 64,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←2←3←4",
              feedbackType: "4⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "alto sax",
            midiProgram: 65,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "tenor sax",
            midiProgram: 66,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←2←3←4",
              feedbackAmplitude: 6,
              operators: [
                {
                  frequency: 2,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "baritone sax",
            midiProgram: 67,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "sax synth",
            midiProgram: 64,
            settings: {
              type: "FM",
              effects: ["vibrato", "reverb"],
              vibrato: "light",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 4,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
            },
          },
          {
            name: "shehnai",
            midiProgram: 111,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["vibrato", "reverb"],
              vibrato: "light",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 4,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
            },
          },
          {
            name: "oboe",
            midiProgram: 68,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "1 2←(3 4)",
              feedbackType: "2⟲",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 2,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "tremolo",
                  speed: 2,
                  a: 0.5,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "english horn",
            midiProgram: 69,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "1 2←(3 4)",
              feedbackType: "2⟲",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 4,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 8,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "bassoon",
            midiProgram: 70,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 707.11,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 2,
              operators: [
                {
                  frequency: 2,
                  amplitude: 11,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "clarinet",
            midiProgram: 71,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1681.79,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                100, 43, 86, 57, 86, 71, 86, 71, 71, 71, 71, 71, 71, 43, 71, 71,
                57, 57, 57, 57, 57, 57, 43, 43, 43, 29, 14, 0,
              ],
            },
          },
          {
            name: "harmonica",
            midiProgram: 22,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 2,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "tremolo",
                  speed: 2,
                  a: 0.5,
                  b: 1,
                },
              ],
            },
          },
        ]) },
      { name: "Flute Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "flute",
            midiProgram: 73,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              feedbackType: "4⟲",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 1,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "decay",
                  speed: 7,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "recorder",
            midiProgram: 74,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                100, 43, 57, 43, 57, 43, 43, 43, 43, 43, 43, 43, 43, 29, 29, 29,
                29, 29, 29, 29, 14, 14, 14, 14, 14, 14, 14, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "whistle",
            midiProgram: 78,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "delayed",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "ocarina",
            midiProgram: 79,
            generalMidi: true,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              harmonics: [
                100, 14, 57, 14, 29, 14, 14, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "piccolo",
            midiProgram: 72,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 1.4142,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←3 2←4",
              feedbackType: "4⟲",
              feedbackAmplitude: 15,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 5,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "shakuhachi",
            midiProgram: 77,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "vibrato", "chorus", "reverb"],
              vibrato: "delayed",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←(2 3←4)",
              feedbackType: "3→4",
              feedbackAmplitude: 15,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 15,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 2,
                },
              ],
            },
          },
          {
            name: "pan flute",
            midiProgram: 75,
            generalMidi: true,
            settings: {
              type: "spectrum",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 5.6569,
                },
              ],
              effects: ["eq filter", "note filter", "reverb"],
              noteFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33,
              fadeInSeconds: 0.0125,
              fadeOutTicks: -3,
              spectrum: [
                100, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 71, 0, 0, 14, 0, 57, 0, 29,
                14, 29, 14, 14, 29, 14, 29, 14, 14, 29, 14,
              ],
              envelopes: [
                {
                  target: "noteFilterFreq",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 0,
                },
                {
                  target: "noteVolume",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "blown bottle",
            midiProgram: 76,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 2.8284,
                },
              ],
              effects: ["eq filter", "chorus", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 2,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 2,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "calliope",
            midiProgram: 82,
            generalMidi: true,
            settings: {
              type: "spectrum",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 6,
              spectrum: [
                100, 0, 0, 0, 0, 0, 0, 86, 0, 0, 0, 71, 0, 0, 57, 0, 43, 0, 29,
                14, 14, 29, 14, 14, 14, 14, 14, 14, 14, 14,
              ],
            },
          },
          {
            name: "chiffer",
            midiProgram: 83,
            generalMidi: true,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: -3,
              spectrum: [
                86, 0, 0, 0, 0, 0, 0, 71, 0, 0, 0, 71, 0, 0, 57, 0, 57, 0, 43,
                14, 14, 43, 14, 29, 14, 29, 29, 29, 29, 14,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "breath noise",
            midiProgram: 121,
            generalMidi: true,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 840.9,
                  linearGain: 0.3536,
                },
                {
                  type: "low-pass",
                  cutoffHz: 16000,
                  linearGain: 0.3536,
                },
              ],
              reverb: 33,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 12,
              spectrum: [
                71, 0, 0, 0, 0, 0, 0, 29, 0, 0, 0, 71, 0, 0, 29, 0, 100, 29, 14,
                29, 100, 29, 100, 14, 14, 71, 0, 29, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]) },
      { name: "Pad Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "new age pad",
            midiProgram: 88,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["chorus"],
              fadeOutTicks: 48,
              algorithm: "1←(2 3←4)",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 6,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 13,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "warm pad",
            midiProgram: 89,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter", "chorus"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 1,
                },
              ],
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              feedbackAmplitude: 7,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "polysynth pad",
            midiProgram: 90,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["vibrato", "unison", "note filter", "chorus"],
              vibrato: "delayed",
              unison: "honky tonk",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1,
                },
              ],
              fadeOutTicks: 48,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "space voice pad",
            midiProgram: 91,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 2828.43,
                  linearGain: 5.6569,
                },
                {
                  type: "peak",
                  cutoffHz: 1414.21,
                  linearGain: 0.1768,
                },
              ],
              effects: ["eq filter", "chorus"],
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              algorithm: "(1 2 3)←4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 8,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 2,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "bowed glass pad",
            midiProgram: 92,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              operators: [
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "metallic pad",
            midiProgram: 93,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              algorithm: "1←3 2←4",
              feedbackType: "1⟲ 2⟲",
              feedbackAmplitude: 13,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 9,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "sweep pad",
            midiProgram: 95,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "chorus"],
              unison: "hum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 4,
                },
              ],
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "atmosphere",
            midiProgram: 99,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              effects: ["eq filter", "chorus", "reverb"],
              reverb: 33,
              fadeOutTicks: 48,
              feedbackType: "3⟲ 4⟲",
              feedbackAmplitude: 3,
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 7,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "brightness",
            midiProgram: 100,
            generalMidi: true,
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "unison", "chorus"],
              unison: "octave",
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              harmonics: [
                100, 86, 86, 86, 43, 57, 43, 71, 43, 43, 43, 57, 43, 43, 57, 71,
                57, 43, 29, 43, 57, 57, 43, 29, 29, 29, 29, 14,
              ],
              stringSustain: 86,
            },
          },
          {
            name: "goblins",
            midiProgram: 101,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 2828.43,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "note filter", "chorus"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1681.79,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              algorithm: "1←2←3←4",
              feedbackAmplitude: 10,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "sci-fi",
            midiProgram: 103,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 9513.66,
                  linearGain: 2.8284,
                },
              ],
              effects: ["eq filter", "note filter", "chorus"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: 48,
              algorithm: "(1 2)←3←4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 8,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 8,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "tremolo",
                  speed: 2,
                  a: 0.5,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "flutter pad",
            midiProgram: 90,
            settings: {
              type: "FM",
              effects: ["vibrato", "note filter", "chorus"],
              vibrato: "delayed",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4000,
                  linearGain: 4,
                },
              ],
              fadeOutTicks: 48,
              algorithm: "(1 2)←(3 4)",
              feedbackType: "1⟲ 2⟲ 3⟲",
              feedbackAmplitude: 9,
              operators: [
                {
                  frequency: 1,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 5,
                  amplitude: 7,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "punch",
                  speed: 10,
                  a: 2,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "feedback pad",
            midiProgram: 89,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 2378.41,
                  linearGain: 8,
                },
              ],
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              algorithm: "1 2 3 4",
              feedbackType: "1⟲ 2⟲ 3⟲ 4⟲",
              feedbackAmplitude: 8,
              operators: [
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 15,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "feedbackAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "supersaw pad",
            midiProgram: 93,
            settings: {
              type: "supersaw",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 0.1768,
                },
              ],
              effects: ["eq filter", "reverb"],
              reverb: 100,
              fadeInSeconds: 0.0263,
              fadeOutTicks: 24,
              spread: 58,
            },
          },
        ]) },
      { name: "Drum Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "standard drumset",
            midiProgram: 116,
            isNoise: true,
            settings: {
              type: "drumset",
              effects: ["reverb"],
              reverb: 33.333333333333336,
              drums: [
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    57, 71, 71, 86, 86, 86, 71, 71, 71, 71, 57, 57, 57, 57, 43,
                    43, 43, 43, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29,
                  ],
                },
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    0, 0, 0, 100, 71, 71, 57, 86, 57, 57, 57, 71, 43, 43, 57,
                    43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43,
                  ],
                },
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    0, 0, 0, 0, 100, 57, 43, 43, 29, 57, 43, 29, 71, 43, 43, 43,
                    43, 57, 43, 43, 43, 43, 43, 43, 43, 43, 29, 43, 43, 43,
                  ],
                },
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    0, 0, 0, 0, 0, 71, 57, 43, 43, 43, 57, 57, 43, 29, 57, 43,
                    43, 43, 29, 43, 57, 43, 43, 43, 43, 43, 43, 29, 43, 43,
                  ],
                },
                {
                  filterEnvelope: "decay",
                  spectrum: [
                    0, 14, 29, 43, 86, 71, 29, 43, 43, 43, 43, 29, 71, 29, 71,
                    29, 43, 43, 43, 43, 57, 43, 43, 57, 43, 43, 43, 57, 57, 57,
                  ],
                },
                {
                  filterEnvelope: "decay",
                  spectrum: [
                    0, 0, 14, 14, 14, 14, 29, 29, 29, 43, 43, 43, 57, 57, 57,
                    71, 71, 71, 71, 71, 71, 71, 71, 57, 57, 57, 57, 43, 43, 43,
                  ],
                },
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    43, 43, 43, 71, 29, 29, 43, 43, 43, 29, 43, 43, 43, 29, 29,
                    43, 43, 29, 29, 29, 57, 14, 57, 43, 43, 57, 43, 43, 57, 57,
                  ],
                },
                {
                  filterEnvelope: "decay",
                  spectrum: [
                    29, 43, 43, 43, 43, 29, 29, 43, 29, 29, 43, 29, 14, 29, 43,
                    29, 43, 29, 57, 29, 43, 57, 43, 71, 43, 71, 57, 57, 71, 71,
                  ],
                },
                {
                  filterEnvelope: "twang",
                  spectrum: [
                    43, 29, 29, 43, 29, 29, 29, 57, 29, 29, 29, 57, 43, 43, 29,
                    29, 57, 43, 43, 43, 71, 43, 43, 71, 57, 71, 71, 71, 71, 71,
                  ],
                },
                {
                  filterEnvelope: "decay",
                  spectrum: [
                    57, 57, 57, 43, 57, 57, 43, 43, 57, 43, 43, 43, 71, 57, 43,
                    57, 86, 71, 57, 86, 71, 57, 86, 100, 71, 86, 86, 86, 86, 86,
                  ],
                },
                {
                  filterEnvelope: "flare",
                  spectrum: [
                    0, 0, 14, 14, 14, 14, 29, 29, 29, 43, 43, 43, 57, 57, 71,
                    71, 86, 86, 100, 100, 100, 100, 100, 100, 100, 100, 86, 57,
                    29, 0,
                  ],
                },
                {
                  filterEnvelope: "decay",
                  spectrum: [
                    14, 14, 14, 14, 29, 14, 14, 29, 14, 43, 14, 43, 57, 86, 57,
                    57, 100, 57, 43, 43, 57, 100, 57, 43, 29, 14, 0, 0, 0, 0,
                  ],
                },
              ],
            },
          },
          {
            name: "steel pan",
            midiProgram: 114,
            generalMidi: true,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 62.5,
                  linearGain: 0.1768,
                },
              ],
              effects: ["eq filter", "note filter", "chorus", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              chorus: 66.99999999999999,
              reverb: 33,
              fadeOutTicks: 24,
              algorithm: "1←(2 3←4)",
              operators: [
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 7,
                  amplitude: 3,
                  wave: "sine",
                },
                {
                  frequency: 3,
                  amplitude: 5,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 4,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 7,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 3,
                },
              ],
            },
          },
          {
            name: "steel pan synth",
            midiProgram: 114,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              fadeOutTicks: -3,
              algorithm: "1 2 3←4",
              feedbackAmplitude: 5,
              operators: [
                {
                  frequency: 1,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 2,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 4,
                  amplitude: 14,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 3,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                  index: 0,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "velocity",
                  speed: 0,
                  a: 1,
                  b: 1,
                  index: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                  index: 2,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "flare",
                  speed: 8,
                  a: 0,
                  b: 1,
                  index: 3,
                },
                {
                  target: "feedbackAmplitude",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "timpani",
            midiProgram: 47,
            generalMidi: true,
            settings: {
              type: "spectrum",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 6727.17,
                  linearGain: 5.6569,
                },
              ],
              effects: ["eq filter", "pitch shift", "note filter", "reverb"],
              pitchShiftSemitones: 15,
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.5,
                },
              ],
              reverb: 33,
              fadeOutTicks: 48,
              spectrum: [
                100, 0, 0, 0, 86, 0, 0, 71, 0, 14, 43, 14, 43, 43, 0, 29, 43,
                29, 29, 29, 43, 29, 43, 29, 43, 43, 43, 43, 43, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
                {
                  target: "pitchShift",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "dark strike",
            midiProgram: 47,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33,
              fadeOutTicks: 48,
              spectrum: [
                0, 0, 14, 14, 14, 29, 29, 43, 43, 86, 43, 43, 43, 29, 86, 29,
                29, 29, 86, 29, 14, 14, 14, 14, 0, 0, 0, 0, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "woodblock",
            midiProgram: 115,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -2.5,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                0, 14, 29, 43, 43, 57, 86, 86, 71, 57, 57, 43, 43, 57, 86, 86,
                43, 43, 71, 57, 57, 57, 57, 57, 86, 86, 71, 71, 71, 71,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "taiko drum",
            midiProgram: 116,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -0.5,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 3363.59,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                71, 100, 100, 43, 43, 71, 71, 43, 43, 43, 43, 43, 43, 57, 29,
                57, 43, 57, 43, 43, 57, 43, 43, 43, 43, 43, 43, 43, 43, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "melodic drum",
            midiProgram: 117,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -1.5,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                100, 71, 71, 57, 57, 43, 43, 71, 43, 43, 43, 57, 43, 43, 57, 43,
                43, 43, 43, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "drum synth",
            midiProgram: 118,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -2,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 4756.83,
                  linearGain: 1,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                100, 86, 71, 57, 43, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29,
                29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "tom-tom",
            midiProgram: 116,
            isNoise: true,
            midiSubharmonicOctaves: -1,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                100, 29, 14, 0, 0, 86, 14, 43, 29, 86, 29, 14, 29, 57, 43, 43,
                43, 43, 57, 43, 43, 43, 29, 57, 43, 43, 43, 43, 43, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "metal pipe",
            midiProgram: 117,
            isNoise: true,
            midiSubharmonicOctaves: -1.5,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                29, 43, 86, 43, 43, 43, 43, 43, 100, 29, 14, 14, 100, 14, 14, 0,
                0, 0, 0, 0, 14, 29, 29, 14, 0, 0, 14, 29, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "synth kick",
            midiProgram: 47,
            settings: {
              type: "FM",
              fadeOutTicks: -6,
              operators: [
                {
                  frequency: 8,
                  amplitude: 15,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "operatorFrequency",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                  index: 0,
                },
                {
                  target: "noteVolume",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]) },
      { name: "Novelty Presets", presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "guitar fret noise",
            midiProgram: 120,
            generalMidi: true,
            settings: {
              type: "spectrum",
              eqFilter: [
                {
                  type: "high-pass",
                  cutoffHz: 1000,
                  linearGain: 0.1768,
                },
              ],
              effects: ["eq filter", "note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 6727.17,
                  linearGain: 5.6569,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: -3,
              spectrum: [
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 29, 14, 0,
                0, 43, 0, 43, 0, 71, 43, 0, 57, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
                {
                  target: "noteVolume",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "fifth saw lead",
            midiProgram: 86,
            generalMidi: true,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "chorus"],
              unison: "fifth",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 1.4142,
                },
              ],
              chorus: 66.99999999999999,
              fadeOutTicks: 48,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "fifth swell",
            midiProgram: 86,
            midiSubharmonicOctaves: 1,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "chorus"],
              unison: "fifth",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 2,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "soundtrack",
            midiProgram: 97,
            generalMidi: true,
            settings: {
              type: "chip",
              effects: ["unison", "note filter", "chorus"],
              unison: "fifth",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              chorus: 66.99999999999999,
              fadeInSeconds: 0.0413,
              fadeOutTicks: 72,
              wave: "sawtooth",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "flare",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "reverse cymbal",
            midiProgram: 119,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -3,
            settings: {
              type: "spectrum",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              spectrum: [
                29, 57, 57, 29, 57, 57, 29, 29, 43, 29, 29, 43, 29, 29, 57, 57,
                14, 57, 14, 57, 71, 71, 57, 86, 57, 100, 86, 86, 86, 86,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "seashore",
            midiProgram: 122,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -3,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.25,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              spectrum: [
                14, 14, 29, 29, 43, 43, 43, 57, 57, 57, 57, 57, 57, 71, 71, 71,
                71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "bird tweet",
            midiProgram: 123,
            generalMidi: true,
            settings: {
              type: "harmonics",
              effects: ["chord type", "vibrato", "unison", "reverb"],
              chord: "strum",
              vibrato: "heavy",
              unison: "hum",
              reverb: 66.99999999999999,
              fadeInSeconds: 0.0575,
              fadeOutTicks: -6,
              harmonics: [
                0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteVolume",
                  envelope: "decay",
                  speed: 10,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "telephone ring",
            midiProgram: 124,
            generalMidi: true,
            settings: {
              type: "FM",
              effects: ["note filter"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 5656.85,
                  linearGain: 1,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: -3,
              operators: [
                {
                  frequency: 2,
                  amplitude: 12,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 4,
                  wave: "sine",
                },
                {
                  frequency: 20,
                  amplitude: 1,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 0,
                  wave: "sine",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0.5,
                  b: 1,
                },
                {
                  target: "operatorAmplitude",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0,
                  b: 1,
                  index: 1,
                },
              ],
            },
          },
          {
            name: "helicopter",
            midiProgram: 125,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -0.5,
            settings: {
              type: "spectrum",
              effects: [
                "transition type",
                "chord type",
                "note filter",
                "reverb",
              ],
              transition: "interrupt",
              chord: "arpeggio",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1681.79,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              spectrum: [
                14, 43, 43, 57, 57, 57, 71, 71, 71, 71, 86, 86, 86, 86, 86, 86,
                86, 86, 86, 86, 86, 71, 71, 71, 71, 71, 71, 71, 57, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "tremolo",
                  speed: 4,
                  a: 0.5,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "applause",
            midiProgram: 126,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -3,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0575,
              fadeOutTicks: 96,
              spectrum: [
                14, 14, 29, 29, 29, 43, 43, 57, 71, 71, 86, 86, 86, 71, 71, 57,
                57, 57, 71, 86, 86, 86, 86, 86, 71, 71, 57, 57, 57, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 2,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "gunshot",
            midiProgram: 127,
            generalMidi: true,
            isNoise: true,
            midiSubharmonicOctaves: -2,
            settings: {
              type: "spectrum",
              effects: ["chord type", "note filter", "reverb"],
              chord: "strum",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1414.21,
                  linearGain: 0.7071,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                14, 29, 43, 43, 57, 57, 57, 71, 71, 71, 86, 86, 86, 86, 86, 86,
                86, 86, 86, 86, 86, 71, 71, 71, 71, 57, 57, 57, 57, 43,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 32,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
          {
            name: "scoot",
            midiProgram: 92,
            settings: {
              type: "chip",
              effects: ["unison", "note filter"],
              unison: "shimmer",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 707.11,
                  linearGain: 4,
                },
              ],
              fadeInSeconds: 0.0125,
              fadeOutTicks: -3,
              wave: "double saw",
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "flare",
                  speed: 32,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "buzz saw",
            midiProgram: 30,
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.5,
                },
              ],
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              algorithm: "1←2←3←4",
              feedbackAmplitude: 4,
              operators: [
                {
                  frequency: 5,
                  amplitude: 13,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 10,
                  wave: "sine",
                },
                {
                  frequency: 1,
                  amplitude: 6,
                  wave: "sine",
                },
                {
                  frequency: 11,
                  amplitude: 12,
                  wave: "sine",
                },
              ],
            },
          },
          {
            name: "mosquito",
            midiProgram: 93,
            settings: {
              type: "PWM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2828.43,
                  linearGain: 2,
                },
              ],
              effects: ["eq filter", "vibrato"],
              vibrato: "shaky",
              fadeInSeconds: 0.0575,
              fadeOutTicks: -6,
              pulseWidth: 4.41942,
              envelopes: [
                {
                  target: "pulseWidth",
                  envelope: "tremolo",
                  speed: 1,
                  a: 0.5,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "breathing",
            midiProgram: 126,
            isNoise: true,
            midiSubharmonicOctaves: -1,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2378.41,
                  linearGain: 0.5,
                },
              ],
              reverb: 33.333333333333336,
              fadeOutTicks: 48,
              spectrum: [
                14, 14, 14, 29, 29, 29, 29, 29, 43, 29, 29, 43, 43, 43, 29, 29,
                71, 43, 86, 86, 57, 100, 86, 86, 86, 86, 71, 86, 71, 57,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "swell",
                  speed: 8,
                  a: 0,
                  b: 1,
                },
              ],
            },
          },
          {
            name: "klaxon synth",
            midiProgram: 125,
            isNoise: true,
            midiSubharmonicOctaves: -1,
            settings: {
              type: "noise",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 2000,
                  linearGain: 4,
                },
              ],
              effects: ["eq filter", "transition type", "reverb"],
              transition: "slide in pattern",
              reverb: 33.333333333333336,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -3,
              wave: "buzz",
            },
          },
          {
            name: "theremin",
            midiProgram: 40,
            settings: {
              type: "harmonics",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 8000,
                  linearGain: 0.7071,
                },
              ],
              effects: ["eq filter", "transition type", "vibrato", "reverb"],
              transition: "slide in pattern",
              vibrato: "heavy",
              reverb: 33,
              fadeInSeconds: 0.0263,
              fadeOutTicks: -6,
              harmonics: [
                100, 71, 57, 43, 29, 29, 14, 14, 14, 14, 14, 14, 14, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          {
            name: "sonar ping",
            midiProgram: 121,
            settings: {
              type: "spectrum",
              effects: ["note filter", "reverb"],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 1681.79,
                  linearGain: 0.5,
                },
              ],
              reverb: 33,
              fadeInSeconds: 0.0125,
              fadeOutTicks: 72,
              spectrum: [
                100, 43, 29, 29, 14, 14, 14, 14, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 8,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]) },
      {
        name: "goop",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: 'C5 "Machina" Voice',
            settings: {
              type: "Picked String",
              eqFilter: [
                {
                  type: "peak",
                  cutoffHz: 2378.41,
                  linearGain: 8,
                },
                {
                  type: "low-pass",
                  cutoffHz: 9513.66,
                  linearGain: 0.7071,
                },
                {
                  type: "high-pass",
                  cutoffHz: 176.78,
                  linearGain: 0.7071,
                },
                {
                  type: "peak",
                  cutoffHz: 1414.21,
                  linearGain: 0.0884,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 11.3137,
                },
              ],
              effects: ["eq filter", "unison", "note filter", "chorus"],
              unison: "honky tonk",
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 11313.71,
                  linearGain: 1.4142,
                },
              ],
              chorus: 66.99999999999999,
              harmonics: [
                0, 0, 29, 0, 0, 86, 86, 0, 0, 86, 0, 14, 0, 0, 0, 0, 100, 71, 0,
                0, 0, 0, 0, 29, 14, 0, 86, 0,
              ],
              stringSustain: 100,
            },
          },
          {
            name: "Chord-proof Dist Guitar",
            settings: {
              type: "FM",
              eqFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 13454.34,
                  linearGain: 0.5,
                },
                {
                  type: "peak",
                  cutoffHz: 5656.85,
                  linearGain: 0.7071,
                },
                {
                  type: "peak",
                  cutoffHz: 840.9,
                  linearGain: 0.5,
                },
              ],
              effects: [
                "eq filter",
                "unison",
                "note filter",
                "distortion",
                "reverb",
              ],
              noteFilter: [
                {
                  type: "low-pass",
                  cutoffHz: 19027.31,
                  linearGain: 0.5,
                },
              ],
              distortion: 28.999999999999996,
              reverb: 33,
              fadeOutTicks: 96,
              algorithm: "1 2 3←4",
              feedbackType: "1→3 2→4",
              feedbackAmplitude: 13,
              operators: [
                {
                  frequency: 2,
                  amplitude: 13,
                  wave: "double saw",
                },
                {
                  frequency: 2,
                  amplitude: 14,
                  wave: "sawtooth",
                },
                {
                  frequency: 1,
                  amplitude: 14,
                  wave: "1/8 pulse",
                },
                {
                  frequency: 4,
                  amplitude: 6,
                  wave: "square",
                },
              ],
              envelopes: [
                {
                  target: "noteFilterAllFreqs",
                  envelope: "twang",
                  speed: 2,
                  a: 1,
                  b: 0,
                },
              ],
            },
          },
        ]),
      },
      {
        name: "Retro Presets (Noise)",
        presets: <DictionaryArray<Preset>>toNameMap([
          {
            name: "chip noise",
            midiProgram: 116,
            isNoise: true,
            settings: {
              type: "noise",
              eqFilter: [
                { type: "low-pass", cutoffHz: 16000, linearGain: 0.3536 },
              ],
              effects: ["eq filter", "chord type"],
              fadeOutTicks: -3,
              wave: "retro",
            },
          },
        ]),
      },
    ]);

  public static valueToPreset(presetValue: number): Preset | null {
    const categoryIndex: number = presetValue >> 6;
    const presetIndex: number = presetValue & 0x3f;
    return EditorConfig.presetCategories[categoryIndex].presets[presetIndex];
  }

  public static midiProgramToPresetValue(program: number): number | null {
    for (
      let categoryIndex: number = 0;
      categoryIndex < EditorConfig.presetCategories.length;
      categoryIndex++
    ) {
      const category: PresetCategory =
        EditorConfig.presetCategories[categoryIndex];
      for (
        let presetIndex: number = 0;
        presetIndex < category.presets.length;
        presetIndex++
      ) {
        const preset: Preset = category.presets[presetIndex];
        if (preset.generalMidi && preset.midiProgram == program)
          return (categoryIndex << 6) + presetIndex;
      }
    }
    return null;
  }

  public static nameToPresetValue(presetName: string): number | null {
    for (
      let categoryIndex: number = 0;
      categoryIndex < EditorConfig.presetCategories.length;
      categoryIndex++
    ) {
      const category: PresetCategory =
        EditorConfig.presetCategories[categoryIndex];
      for (
        let presetIndex: number = 0;
        presetIndex < category.presets.length;
        presetIndex++
      ) {
        const preset: Preset = category.presets[presetIndex];
        if (preset.name == presetName)
          return (categoryIndex << 6) + presetIndex;
      }
    }
    return null;
  }
}
