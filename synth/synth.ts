// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  type Dictionary,
  type DictionaryArray,
  type AssetDefinition,
  FilterType,
  SustainType,
  EnvelopeType,
  InstrumentType,
  EffectType,
  EnvelopeComputeIndex,
  type Transition,
  type Unison,
  type Chord,
  type Vibrato,
  type Envelope,
  type AutomationTarget,
  Config,
  getDrumWave,
  drawNoiseSpectrum,
  getArpeggioPitchIndex,
  parseAssetDefinition,
  performIntegral,
  getPulseWidthRatio,
  effectsIncludeTransition,
  effectsIncludeChord,
  effectsIncludePitchShift,
  effectsIncludeDetune,
  effectsIncludeVibrato,
  effectsIncludeNoteFilter,
  effectsIncludeDistortion,
  effectsIncludeBitcrusher,
  effectsIncludeChorus,
  effectsIncludeEcho,
  effectsIncludeReverb,
  effectsIncludeUnison,
  effectsIncludeEqFilter,
} from "./SynthConfig.js";
import {
  scaleElementsByFactor,
  fastFourierTransform,
  forwardRealFourierTransform,
  inverseRealFourierTransform,
} from "./FFT.js";
import { Deque } from "./Deque.js";
import {
  FilterCoefficients,
  FrequencyResponse,
  DynamicBiquadFilter,
  warpInfinityToNyquist,
} from "./filtering.js";
import {
  getSoundFontZones,
  parseSoundFont,
  type SoundFontBank,
  type SoundFontZone,
} from "./SoundFont.js";
import { decodeSongBinary, encodeSongBinary } from "./SongBinary.js";

const epsilon: number = 1.0e-24; // For detecting and avoiding float denormals, which have poor performance.
const maximumSongAssetCount: number = 64;
const maximumAssetSourceLength: number = 8192;
const maximumSoundFontIdLength: number =
  "asset:".length + maximumAssetSourceLength;
const compactSongValueVersion: number = 1;
const compactInstrumentLowFieldCount: number = 31;
const compactInstrumentFields: ReadonlyArray<string> = [
  "chipWave",
  "chipNoise",
  "fadeIn",
  "fadeOut",
  "transition",
  "pitchShift",
  "detune",
  "vibrato",
  "unison",
  "chord",
  "volume",
  "pan",
  "pulseWidth",
  "supersawDynamism",
  "supersawSpread",
  "supersawShape",
  "soundFontId",
  "soundFontPreset",
  "stringSustain",
  "stringSustainType",
  "distortion",
  "bitcrusherFreq",
  "bitcrusherQuantization",
  "chorus",
  "reverb",
  "echoSustain",
  "echoDelay",
  "algorithm",
  "feedbackType",
  "feedbackAmplitude",
  "eqFilter",
  "noteFilter",
  "envelopes",
  "operators",
  "spectrum",
  "harmonics",
  "drumsetEnvelopes",
  "drumsetEnvelopeSpeeds",
  "drumsetEnvelopeAs",
  "drumsetEnvelopeBs",
  "drumsetSpectra",
];
const compactInstrumentFieldSet: ReadonlySet<string> = new Set(
  compactInstrumentFields,
);

class CompactBitWriter {
  private _bits: number[] = [];
  private _length: number = 0;

  public clear(): void {
    this._length = 0;
  }

  public write(bitCount: number, value: number): void {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      bitCount < 0 ||
      bitCount > 31 ||
      value >= Math.pow(2, bitCount)
    ) {
      throw new RangeError("Compact song bit value is out of range.");
    }
    for (let bit: number = bitCount - 1; bit >= 0; bit--)
      this._bits[this._length++] = Math.floor(value / Math.pow(2, bit)) % 2;
  }

  public writeLongTail(minValue: number, minBits: number, value: number): void {
    if (!Number.isSafeInteger(value) || value < minValue)
      throw new RangeError("Compact song value is out of range.");
    value -= minValue;
    let bitCount: number = minBits;
    while (value >= Math.pow(2, bitCount)) {
      this._bits[this._length++] = 1;
      value -= Math.pow(2, bitCount);
      bitCount++;
      if (bitCount > 30)
        throw new RangeError("Compact song value is too large.");
    }
    this._bits[this._length++] = 0;
    while (bitCount > 0) {
      bitCount--;
      this._bits[this._length++] =
        Math.floor(value / Math.pow(2, bitCount)) % 2;
    }
  }

  public writePartDuration(
    value: number,
    divisor: number,
    minBits: number,
  ): void {
    if (divisor > 1) {
      if (value % divisor == 0) {
        this.write(1, 0);
        this.writeLongTail(1, minBits, value / divisor);
        return;
      }
      this.write(1, 1);
    }
    this.writeLongTail(1, 3, value);
  }

  public writePinCount(value: number): void {
    this.writeLongTail(1, 0, value);
  }

  public writePitchInterval(value: number): void {
    if (!Number.isSafeInteger(value) || value == 0)
      throw new RangeError("Compact song pitch interval is out of range.");
    this.write(1, value < 0 ? 1 : 0);
    this.writeLongTail(1, 1, Math.abs(value));
  }

  public writePitchToken(recentPitchIndex: number): void {
    if (
      !Number.isInteger(recentPitchIndex) ||
      recentPitchIndex < -1 ||
      recentPitchIndex >= 8
    )
      throw new RangeError("Compact song pitch token is out of range.");
    if (recentPitchIndex < 0) {
      this.write(2, 0);
      return;
    }
    if (recentPitchIndex == 0) {
      this.write(2, 1);
      return;
    }
    if (recentPitchIndex <= 2) {
      this.write(3, recentPitchIndex + 3);
      return;
    }
    if (recentPitchIndex <= 5) {
      this.write(4, recentPitchIndex + 9);
      return;
    }
    this.write(5, recentPitchIndex + 24);
  }

  public writeShapeToken(shapeIndex: number): void {
    if (!Number.isInteger(shapeIndex) || shapeIndex < -2 || shapeIndex >= 10)
      throw new RangeError("Compact song shape token is out of range.");
    if (shapeIndex == -2) {
      this.write(1, 0);
      return;
    }
    if (shapeIndex == 0) {
      this.write(2, 2);
      return;
    }
    if (shapeIndex == -1) {
      this.write(4, 12);
      return;
    }
    if (shapeIndex == 1) {
      this.write(4, 13);
      return;
    }
    if (shapeIndex == 2) {
      this.write(4, 14);
      return;
    }
    this.write(4, 15);
    this.write(3, shapeIndex - 3);
  }

  public writeNoteSize(
    value: number,
    commonSize: number | null,
    useHuffman: boolean,
  ): void {
    if (!Number.isFinite(value) || value < 0 || value > Config.noteSizeMax)
      throw new RangeError("Compact song note size is out of range.");
    if (useHuffman) {
      if (Number.isInteger(value)) {
        if (value == 8) {
          this.write(2, 0);
          return;
        }
        if (value == 7) {
          this.write(2, 1);
          return;
        }
        if (value == 9) {
          this.write(3, 4);
          return;
        }
        if (value == 6) {
          this.write(3, 5);
          return;
        }
        if (value == 5) {
          this.write(4, 12);
          return;
        }
        if (value == 10) {
          this.write(4, 13);
          return;
        }
      }
      this.write(3, 7);
    } else if (commonSize != null) {
      if (Number.isInteger(value) && value == commonSize) {
        this.write(1, 0);
        return;
      }
      this.write(1, 1);
    }
    if (Number.isInteger(value) && value <= Config.noteSizeMax && value < 15) {
      this.write(4, value);
      return;
    }
    this.write(4, 15);
    const buffer: ArrayBuffer = new ArrayBuffer(8);
    const view: DataView = new DataView(buffer);
    view.setFloat64(0, value);
    const bytes: Uint8Array = new Uint8Array(buffer);
    for (const byte of bytes) this.write(8, byte);
  }

  public concat(other: CompactBitWriter): void {
    for (let index: number = 0; index < other._length; index++)
      this._bits[this._length++] = other._bits[index];
  }

  public key(): string {
    let result: string = "";
    for (let index: number = 0; index < this._length; index++)
      result += this._bits[index] == 0 ? "0" : "1";
    return result;
  }

  public finish(): Uint8Array {
    const result: Uint8Array = new Uint8Array(Math.ceil(this._length / 8));
    for (let index: number = 0; index < this._length; index++) {
      if (this._bits[index] != 0) result[index >> 3] |= 1 << (7 - (index & 7));
    }
    return result;
  }
}

class CompactBitReader {
  private _index: number = 0;

  public constructor(private readonly _bytes: Uint8Array) {}

  private _readBit(): number {
    if (this._index >= this._bytes.length * 8)
      throw new Error("Truncated compact .goop bit data.");
    const result: number =
      (this._bytes[this._index >> 3] >> (7 - (this._index & 7))) & 1;
    this._index++;
    return result;
  }

  public read(bitCount: number): number {
    if (bitCount < 0 || bitCount > 31)
      throw new RangeError("Invalid compact .goop bit count.");
    let result: number = 0;
    for (let bit: number = 0; bit < bitCount; bit++)
      result = result * 2 + this._readBit();
    return result;
  }

  public readLongTail(minValue: number, minBits: number): number {
    let result: number = minValue;
    let bitCount: number = minBits;
    while (this._readBit() != 0) {
      if (bitCount > 30) throw new Error("Compact .goop value is too large.");
      result += Math.pow(2, bitCount++);
    }
    while (bitCount > 0) {
      bitCount--;
      if (this._readBit() != 0) result += Math.pow(2, bitCount);
    }
    if (!Number.isSafeInteger(result))
      throw new Error("Compact .goop value is too large.");
    return result;
  }

  public readPartDuration(divisor: number, minBits: number): number {
    if (divisor > 1 && this.read(1) == 0)
      return this.readLongTail(1, minBits) * divisor;
    return this.readLongTail(1, 3);
  }

  public readPinCount(): number {
    return this.readLongTail(1, 0);
  }

  public readPitchInterval(minBits: number): number {
    const negative: boolean = this.read(1) != 0;
    const magnitude: number = this.readLongTail(1, minBits);
    return negative ? -magnitude : magnitude;
  }

  public readPitchToken(): number {
    const pair: number = this.read(2);
    if (pair == 0) return -1;
    if (pair == 1) return 0;
    if (pair == 2) return this.read(1) + 1;
    const secondPair: number = this.read(2);
    if (secondPair <= 2) return secondPair + 3;
    return this.read(1) + 6;
  }

  public readShapeToken(): number {
    if (this.read(1) == 0) return -2;
    if (this.read(1) == 0) return 0;
    const pair: number = this.read(2);
    if (pair == 0) return -1;
    if (pair <= 2) return pair;
    const shapeIndex: number = this.read(3) + 3;
    if (shapeIndex >= 10) throw new Error("Invalid compact .goop shape token.");
    return shapeIndex;
  }

  public readNoteSize(commonSize: number | null, useHuffman: boolean): number {
    if (useHuffman) {
      const pair: number = this.read(2);
      if (pair == 0) return 8;
      if (pair == 1) return 7;
      if (pair == 2) return this.read(1) == 0 ? 9 : 6;
      if (this.read(1) == 0) return this.read(1) == 0 ? 5 : 10;
    } else if (commonSize != null && this.read(1) == 0) {
      return commonSize;
    }
    const encoded: number = this.read(4);
    if (encoded <= Config.noteSizeMax) return encoded;
    if (encoded != 15) throw new Error("Invalid compact .goop note size.");
    const buffer: ArrayBuffer = new ArrayBuffer(8);
    const bytes: Uint8Array = new Uint8Array(buffer);
    for (let index: number = 0; index < bytes.length; index++)
      bytes[index] = this.read(8);
    const value: number = new DataView(buffer).getFloat64(0);
    if (!Number.isFinite(value) || value < 0 || value > Config.noteSizeMax)
      throw new Error("Invalid compact .goop note size.");
    return value;
  }

  public assertCanonicalPadding(): void {
    const remaining: number = this._bytes.length * 8 - this._index;
    if (remaining >= 8) throw new Error("Invalid compact .goop bit length.");
    while (this._index < this._bytes.length * 8) {
      if (this._readBit() != 0)
        throw new Error("Invalid compact .goop padding.");
    }
  }
}

// For performance debugging:
//let samplesAccumulated: number = 0;
//let samplePerformance: number = 0;

export function clamp(min: number, max: number, val: number): number {
  max = max - 1;
  if (val <= max) {
    if (val >= min) return val;
    else return min;
  } else {
    return max;
  }
}

function interpolateSetting(
  values: ReadonlyArray<number>,
  setting: number,
): number {
  const lowerIndex: number = Math.max(
    0,
    Math.min(values.length - 2, Math.floor(setting)),
  );
  return (
    values[lowerIndex] +
    (values[lowerIndex + 1] - values[lowerIndex]) * (setting - lowerIndex)
  );
}

export interface NotePin {
  interval: number;
  time: number;
  size: number;
}

export function makeNotePin(
  interval: number,
  time: number,
  size: number,
): NotePin {
  return { interval: interval, time: time, size: size };
}

export class Note {
  public pitches: number[];
  public pins: NotePin[];
  public start: number;
  public end: number;
  public continuesLastPattern: boolean;

  public constructor(
    pitch: number,
    start: number,
    end: number,
    size: number,
    fadeout: boolean = false,
  ) {
    this.pitches = [pitch];
    this.pins = [
      makeNotePin(0, 0, size),
      makeNotePin(0, end - start, fadeout ? 0 : size),
    ];
    this.start = start;
    this.end = end;
    this.continuesLastPattern = false;
  }

  public pickMainInterval(): number {
    let longestFlatIntervalDuration: number = 0;
    let mainInterval: number = 0;
    for (let pinIndex: number = 1; pinIndex < this.pins.length; pinIndex++) {
      const pinA: NotePin = this.pins[pinIndex - 1];
      const pinB: NotePin = this.pins[pinIndex];
      if (pinA.interval == pinB.interval) {
        const duration: number = pinB.time - pinA.time;
        if (longestFlatIntervalDuration < duration) {
          longestFlatIntervalDuration = duration;
          mainInterval = pinA.interval;
        }
      }
    }
    if (longestFlatIntervalDuration == 0) {
      let loudestSize: number = 0;
      for (let pinIndex: number = 0; pinIndex < this.pins.length; pinIndex++) {
        const pin: NotePin = this.pins[pinIndex];
        if (loudestSize < pin.size) {
          loudestSize = pin.size;
          mainInterval = pin.interval;
        }
      }
    }
    return mainInterval;
  }

  public clone(): Note {
    const newNote: Note = new Note(
      -1,
      this.start,
      this.end,
      Config.noteSizeMax,
    );
    newNote.pitches = this.pitches.concat();
    newNote.pins = [];
    for (const pin of this.pins) {
      newNote.pins.push(makeNotePin(pin.interval, pin.time, pin.size));
    }
    newNote.continuesLastPattern = this.continuesLastPattern;
    return newNote;
  }

  public getEndPinIndex(part: number): number {
    let endPinIndex: number;
    for (endPinIndex = 1; endPinIndex < this.pins.length - 1; endPinIndex++) {
      if (this.pins[endPinIndex].time + this.start > part) break;
    }
    return endPinIndex;
  }
}

export class Pattern {
  public notes: Note[] = [];

  public cloneNotes(): Note[] {
    const result: Note[] = [];
    for (const note of this.notes) {
      result.push(note.clone());
    }
    return result;
  }

  public reset(): void {
    this.notes.length = 0;
  }

  public toBinaryObject(): Object {
    return {
      notes: this.notes.map((note: Note): Object => ({
        pitches: note.pitches.concat(),
        pins: note.pins.map((pin: NotePin): Object => ({
          interval: pin.interval,
          time: pin.time,
          size: pin.size,
        })),
        start: note.start,
        continuesLastPattern: note.continuesLastPattern,
      })),
    };
  }

  public fromBinaryObject(
    patternObject: any,
    song: Song,
    isNoiseChannel: boolean,
  ): void {
    if (
      patternObject == null ||
      typeof patternObject != "object" ||
      Array.isArray(patternObject) ||
      !Array.isArray(patternObject.notes)
    ) {
      throw new Error("Invalid .goop pattern.");
    }
    const maximumParts: number = song.beatsPerBar * Config.partsPerBeat;
    if (patternObject.notes.length > maximumParts)
      throw new Error("Invalid .goop note count.");
    const maximumPitch: number = isNoiseChannel
      ? Config.drumCount - 1
      : Config.maxPitch;
    let previousEnd: number = 0;
    for (const noteObject of patternObject.notes) {
      if (
        noteObject == null ||
        typeof noteObject != "object" ||
        Array.isArray(noteObject) ||
        !Array.isArray(noteObject.pitches) ||
        noteObject.pitches.length < 1 ||
        noteObject.pitches.length > Config.maxChordSize ||
        !Array.isArray(noteObject.pins) ||
        noteObject.pins.length < 2 ||
        noteObject.pins.length > maximumParts + 1 ||
        typeof noteObject.start != "number" ||
        !Number.isInteger(noteObject.start) ||
        typeof noteObject.continuesLastPattern != "boolean"
      ) {
        throw new Error("Invalid .goop note.");
      }

      const start: number = noteObject.start;
      if (
        start < previousEnd ||
        start >= maximumParts ||
        (start != 0 && noteObject.continuesLastPattern)
      ) {
        throw new Error("Invalid .goop note timing.");
      }
      const pitches: number[] = [];
      for (const value of noteObject.pitches) {
        if (
          typeof value != "number" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > maximumPitch ||
          pitches.includes(value)
        ) {
          throw new Error("Invalid .goop note pitch.");
        }
        pitches.push(value);
      }

      const pins: NotePin[] = [];
      let previousTime: number = -1;
      for (const pinObject of noteObject.pins) {
        if (
          pinObject == null ||
          typeof pinObject != "object" ||
          Array.isArray(pinObject) ||
          typeof pinObject.interval != "number" ||
          !Number.isInteger(pinObject.interval) ||
          typeof pinObject.time != "number" ||
          !Number.isInteger(pinObject.time) ||
          typeof pinObject.size != "number" ||
          !Number.isFinite(pinObject.size) ||
          pinObject.size < 0 ||
          pinObject.size > Config.noteSizeMax ||
          pinObject.time <= previousTime ||
          (pins.length == 0 && pinObject.time != 0)
        ) {
          throw new Error("Invalid .goop note pin.");
        }
        if (
          (pins.length == 0 && pinObject.interval != 0) ||
          pitches.some(
            (pitch: number): boolean =>
              pitch + pinObject.interval < 0 ||
              pitch + pinObject.interval > maximumPitch,
          )
        ) {
          throw new Error("Invalid .goop note pin interval.");
        }
        pins.push(
          makeNotePin(pinObject.interval, pinObject.time, pinObject.size),
        );
        previousTime = pinObject.time;
      }

      const end: number = start + pins[pins.length - 1].time;
      if (end <= start || end > maximumParts)
        throw new Error("Invalid .goop note timing.");
      const note: Note = new Note(pitches[0], start, end, pins[0].size);
      note.pitches = pitches;
      note.pins = pins;
      note.continuesLastPattern = noteObject.continuesLastPattern;
      this.notes.push(note);
      previousEnd = end;
    }
  }
}

export class Operator {
  public frequency: number = 1;
  public amplitude: number = 0;
  public wave: number = 0;

  constructor(index: number) {
    this.reset(index);
  }

  public reset(index: number): void {
    this.frequency = 1;
    this.amplitude = index <= 1 ? Config.operatorAmplitudeMax : 0;
    this.wave = 0;
  }
}

export class SpectrumWave {
  public spectrum: number[] = [];
  public hash: number = -1;

  constructor(isNoiseChannel: boolean) {
    this.reset(isNoiseChannel);
  }

  public reset(isNoiseChannel: boolean): void {
    for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
      if (isNoiseChannel) {
        this.spectrum[i] = Math.round(
          Config.spectrumMax * (1 / Math.sqrt(1 + i / 3)),
        );
      } else {
        const isHarmonic: boolean =
          i == 0 ||
          i == 7 ||
          i == 11 ||
          i == 14 ||
          i == 16 ||
          i == 18 ||
          i == 21 ||
          i == 23 ||
          i >= 25;
        this.spectrum[i] = isHarmonic
          ? Math.max(0, Math.round(Config.spectrumMax * (1 - i / 30)))
          : 0;
      }
    }
    this.markCustomWaveDirty();
  }

  public markCustomWaveDirty(): void {
    const hashMult: number =
      Synth.fittingPowerOfTwo(Config.spectrumMax + 2) - 1;
    let hash: number = 0;
    for (const point of this.spectrum) hash = (hash * hashMult + point) >>> 0;
    this.hash = hash;
  }
}

class SpectrumWaveState {
  public wave: Float32Array | null = null;
  private _hash: number = -1;

  public getCustomWave(
    settings: SpectrumWave,
    lowestOctave: number,
  ): Float32Array {
    if (this._hash == settings.hash) return this.wave!;
    this._hash = settings.hash;

    const waveLength: number = Config.spectrumNoiseLength;
    if (this.wave == null || this.wave.length != waveLength + 1) {
      this.wave = new Float32Array(waveLength + 1);
    }
    const wave: Float32Array = this.wave;

    for (let i: number = 0; i < waveLength; i++) {
      wave[i] = 0;
    }

    const highestOctave: number = 14;
    const falloffRatio: number = 0.25;
    // Nudge the 2/7 and 4/7 control points so that they form harmonic intervals.
    const pitchTweak: number[] = [
      0,
      1 / 7,
      Math.log2(5 / 4),
      3 / 7,
      Math.log2(3 / 2),
      5 / 7,
      6 / 7,
    ];
    function controlPointToOctave(point: number): number {
      return (
        lowestOctave +
        Math.floor(point / Config.spectrumControlPointsPerOctave) +
        pitchTweak[
          (point + Config.spectrumControlPointsPerOctave) %
            Config.spectrumControlPointsPerOctave
        ]
      );
    }

    let combinedAmplitude: number = 1;
    for (let i: number = 0; i < Config.spectrumControlPoints + 1; i++) {
      const value1: number = i <= 0 ? 0 : settings.spectrum[i - 1];
      const value2: number =
        i >= Config.spectrumControlPoints
          ? settings.spectrum[Config.spectrumControlPoints - 1]
          : settings.spectrum[i];
      const octave1: number = controlPointToOctave(i - 1);
      let octave2: number = controlPointToOctave(i);
      if (i >= Config.spectrumControlPoints)
        octave2 = highestOctave + (octave2 - highestOctave) * falloffRatio;
      if (value1 == 0 && value2 == 0) continue;

      combinedAmplitude +=
        0.02 *
        drawNoiseSpectrum(
          wave,
          waveLength,
          octave1,
          octave2,
          value1 / Config.spectrumMax,
          value2 / Config.spectrumMax,
          -0.5,
        );
    }
    if (settings.spectrum[Config.spectrumControlPoints - 1] > 0) {
      combinedAmplitude +=
        0.02 *
        drawNoiseSpectrum(
          wave,
          waveLength,
          highestOctave +
            (controlPointToOctave(Config.spectrumControlPoints) -
              highestOctave) *
              falloffRatio,
          highestOctave,
          settings.spectrum[Config.spectrumControlPoints - 1] /
            Config.spectrumMax,
          0,
          -0.5,
        );
    }

    inverseRealFourierTransform(wave, waveLength);
    scaleElementsByFactor(
      wave,
      5.0 / (Math.sqrt(waveLength) * Math.pow(combinedAmplitude, 0.75)),
    );

    // Duplicate the first sample at the end for easier wrap-around interpolation.
    wave[waveLength] = wave[0];

    return wave;
  }
}

export class HarmonicsWave {
  public harmonics: number[] = [];
  public hash: number = -1;

  constructor() {
    this.reset();
  }

  public reset(): void {
    for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
      this.harmonics[i] = 0;
    }
    this.harmonics[0] = Config.harmonicsMax;
    this.harmonics[3] = Config.harmonicsMax;
    this.harmonics[6] = Config.harmonicsMax;
    this.markCustomWaveDirty();
  }

  public markCustomWaveDirty(): void {
    const hashMult: number =
      Synth.fittingPowerOfTwo(Config.harmonicsMax + 2) - 1;
    let hash: number = 0;
    for (const point of this.harmonics) hash = (hash * hashMult + point) >>> 0;
    this.hash = hash;
  }
}

class HarmonicsWaveState {
  public wave: Float32Array | null = null;
  private _hash: number = -1;
  private _generatedForType!: InstrumentType;

  public getCustomWave(
    settings: HarmonicsWave,
    instrumentType: InstrumentType,
  ): Float32Array {
    if (this._hash == settings.hash && this._generatedForType == instrumentType)
      return this.wave!;
    this._hash = settings.hash;
    this._generatedForType = instrumentType;

    const harmonicsRendered: number =
      instrumentType == InstrumentType.pickedString
        ? Config.harmonicsRenderedForPickedString
        : Config.harmonicsRendered;

    const waveLength: number = Config.harmonicsWavelength;
    const retroWave: Float32Array = getDrumWave(0, null, null);

    if (this.wave == null || this.wave.length != waveLength + 1) {
      this.wave = new Float32Array(waveLength + 1);
    }
    const wave: Float32Array = this.wave;

    for (let i: number = 0; i < waveLength; i++) {
      wave[i] = 0;
    }

    const overallSlope: number = -0.25;
    let combinedControlPointAmplitude: number = 1;

    for (
      let harmonicIndex: number = 0;
      harmonicIndex < harmonicsRendered;
      harmonicIndex++
    ) {
      const harmonicFreq: number = harmonicIndex + 1;
      let controlValue: number =
        harmonicIndex < Config.harmonicsControlPoints
          ? settings.harmonics[harmonicIndex]
          : settings.harmonics[Config.harmonicsControlPoints - 1];
      if (harmonicIndex >= Config.harmonicsControlPoints) {
        controlValue *=
          1 -
          (harmonicIndex - Config.harmonicsControlPoints) /
            (harmonicsRendered - Config.harmonicsControlPoints);
      }
      const normalizedValue: number = controlValue / Config.harmonicsMax;
      let amplitude: number =
        Math.pow(2, controlValue - Config.harmonicsMax + 1) *
        Math.sqrt(normalizedValue);
      if (harmonicIndex < Config.harmonicsControlPoints) {
        combinedControlPointAmplitude += amplitude;
      }
      amplitude *= Math.pow(harmonicFreq, overallSlope);

      // Multiply all the sine wave amplitudes by 1 or -1 based on the LFSR
      // retro wave (effectively random) to avoid egregiously tall spikes.
      amplitude *= retroWave[harmonicIndex + 589];

      wave[waveLength - harmonicFreq] = amplitude;
    }

    inverseRealFourierTransform(wave, waveLength);

    // Limit the maximum wave amplitude.
    const mult: number = 1 / Math.pow(combinedControlPointAmplitude, 0.7);
    for (let i: number = 0; i < wave.length; i++) wave[i] *= mult;

    performIntegral(wave);

    // The first sample should be zero, and we'll duplicate it at the end for easier interpolation.
    wave[waveLength] = wave[0];

    return wave;
  }
}

export class FilterControlPoint {
  public freq: number = 0;
  public gain: number = Config.filterGainCenter;
  public type: FilterType = FilterType.peak;

  public set(freqSetting: number, gainSetting: number): void {
    this.freq = freqSetting;
    this.gain = gainSetting;
  }

  public getHz(): number {
    return FilterControlPoint.getHzFromSettingValue(this.freq);
  }

  public static getHzFromSettingValue(value: number): number {
    return (
      Config.filterFreqReferenceHz *
      Math.pow(
        2.0,
        (value - Config.filterFreqReferenceSetting) * Config.filterFreqStep,
      )
    );
  }
  public static getSettingValueFromHz(hz: number): number {
    return (
      Math.log2(hz / Config.filterFreqReferenceHz) / Config.filterFreqStep +
      Config.filterFreqReferenceSetting
    );
  }
  public static getRoundedSettingValueFromHz(hz: number): number {
    return Math.max(
      0,
      Math.min(
        Config.filterFreqRange - 1,
        Math.round(FilterControlPoint.getSettingValueFromHz(hz)),
      ),
    );
  }

  public getLinearGain(peakMult: number = 1.0): number {
    const power: number =
      (this.gain - Config.filterGainCenter) * Config.filterGainStep;
    const neutral: number = this.type == FilterType.peak ? 0.0 : -0.5;
    const interpolatedPower: number = neutral + (power - neutral) * peakMult;
    return Math.pow(2.0, interpolatedPower);
  }
  public static getRoundedSettingValueFromLinearGain(
    linearGain: number,
  ): number {
    return Math.max(
      0,
      Math.min(
        Config.filterGainRange - 1,
        Math.round(
          Math.log2(linearGain) / Config.filterGainStep +
            Config.filterGainCenter,
        ),
      ),
    );
  }

  public toCoefficients(
    filter: FilterCoefficients,
    sampleRate: number,
    freqMult: number = 1.0,
    peakMult: number = 1.0,
  ): void {
    const cornerRadiansPerSample: number =
      (2.0 *
        Math.PI *
        Math.max(
          Config.filterFreqMinHz,
          Math.min(Config.filterFreqMaxHz, freqMult * this.getHz()),
        )) /
      sampleRate;
    const linearGain: number = this.getLinearGain(peakMult);
    switch (this.type) {
      case FilterType.lowPass:
        filter.lowPass2ndOrderButterworth(cornerRadiansPerSample, linearGain);
        break;
      case FilterType.highPass:
        filter.highPass2ndOrderButterworth(cornerRadiansPerSample, linearGain);
        break;
      case FilterType.peak:
        filter.peak2ndOrder(cornerRadiansPerSample, linearGain, 1.0);
        break;
      default:
        throw new Error();
    }
  }

  public getVolumeCompensationMult(): number {
    const octave: number =
      (this.freq - Config.filterFreqReferenceSetting) * Config.filterFreqStep;
    const gainPow: number =
      (this.gain - Config.filterGainCenter) * Config.filterGainStep;
    switch (this.type) {
      case FilterType.lowPass:
        const freqRelativeTo8khz: number =
          (Math.pow(2.0, octave) * Config.filterFreqReferenceHz) / 8000.0;
        // Reverse the frequency warping from importing legacy simplified filters to imitate how the legacy filter cutoff setting affected volume.
        const warpedFreq: number =
          (Math.sqrt(1.0 + 4.0 * freqRelativeTo8khz) - 1.0) / 2.0;
        const warpedOctave: number = Math.log2(warpedFreq);
        return Math.pow(
          0.5,
          0.2 * Math.max(0.0, gainPow + 1.0) +
            Math.min(
              0.0,
              Math.max(
                -3.0,
                0.595 * warpedOctave + 0.35 * Math.min(0.0, gainPow + 1.0),
              ),
            ),
        );
      case FilterType.highPass:
        return Math.pow(
          0.5,
          0.125 * Math.max(0.0, gainPow + 1.0) +
            Math.min(
              0.0,
              0.3 *
                (-octave - Math.log2(Config.filterFreqReferenceHz / 125.0)) +
                0.2 * Math.min(0.0, gainPow + 1.0),
            ),
        );
      case FilterType.peak:
        const distanceFromCenter: number =
          octave + Math.log2(Config.filterFreqReferenceHz / 2000.0);
        const freqLoudness: number = Math.pow(
          1.0 / (1.0 + Math.pow(distanceFromCenter / 3.0, 2.0)),
          2.0,
        );
        return Math.pow(
          0.5,
          0.125 * Math.max(0.0, gainPow) +
            0.1 * freqLoudness * Math.min(0.0, gainPow),
        );
      default:
        throw new Error();
    }
  }
}

export class FilterSettings {
  public readonly controlPoints: FilterControlPoint[] = [];
  public controlPointCount: number = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.controlPointCount = 0;
  }

  addPoint(type: FilterType, freqSetting: number, gainSetting: number): void {
    let controlPoint: FilterControlPoint;
    if (this.controlPoints.length <= this.controlPointCount) {
      controlPoint = new FilterControlPoint();
      this.controlPoints[this.controlPointCount] = controlPoint;
    } else {
      controlPoint = this.controlPoints[this.controlPointCount];
    }
    this.controlPointCount++;
    controlPoint.type = type;
    controlPoint.set(freqSetting, gainSetting);
  }

  public toSettingsObject(): Object {
    const filterArray: any[] = [];
    for (let i: number = 0; i < this.controlPointCount; i++) {
      const point: FilterControlPoint = this.controlPoints[i];
      filterArray.push({
        type: Config.filterTypeNames[point.type],
        cutoffHz: Math.round(point.getHz() * 100) / 100,
        linearGain: Math.round(point.getLinearGain() * 10000) / 10000,
      });
    }
    return filterArray;
  }

  public fromSettingsObject(filterObject: any): void {
    this.controlPoints.length = 0;
    if (filterObject) {
      for (const pointObject of filterObject) {
        const point: FilterControlPoint = new FilterControlPoint();
        point.type = Config.filterTypeNames.indexOf(pointObject["type"]);
        if (<any>point.type == -1) point.type = FilterType.peak;
        if (pointObject["cutoffHz"] != undefined) {
          point.freq = FilterControlPoint.getRoundedSettingValueFromHz(
            pointObject["cutoffHz"],
          );
        } else {
          point.freq = 0;
        }
        if (pointObject["linearGain"] != undefined) {
          point.gain = FilterControlPoint.getRoundedSettingValueFromLinearGain(
            pointObject["linearGain"],
          );
        } else {
          point.gain = Config.filterGainCenter;
        }
        this.controlPoints.push(point);
      }
    }
    this.controlPointCount = this.controlPoints.length;
  }
}

export class EnvelopeSettings {
  public target: number = 0;
  public index: number = 0;
  public envelope: number = 0;
  public speed: number = 0;
  public a: number = 1;
  public b: number = 1;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.target = 0;
    this.index = 0;
    this.envelope = 0;
    this.speed = Config.envelopes[0].speed;
    this.a = Config.envelopes[0].a;
    this.b = Config.envelopes[0].b;
  }

  public toSettingsObject(): Object {
    const envelopeObject: any = {
      target: Config.instrumentAutomationTargets[this.target].name,
      envelope: Config.envelopes[this.envelope].name,
      speed: this.speed,
      a: this.a,
      b: this.b,
    };
    if (Config.instrumentAutomationTargets[this.target].maxCount > 1) {
      envelopeObject["index"] = this.index;
    }
    return envelopeObject;
  }

  public fromSettingsObject(envelopeObject: any): void {
    this.reset();

    let target: AutomationTarget =
      Config.instrumentAutomationTargets.dictionary[envelopeObject["target"]];
    if (target == null)
      target = Config.instrumentAutomationTargets.dictionary["noteVolume"];
    this.target = target.index;

    const envelopeValue: any = envelopeObject["envelope"];
    let envelope: Envelope = Config.envelopes.dictionary[envelopeValue];
    if (envelope == null) envelope = Config.envelopes.dictionary["none"];
    this.envelope = envelope.index;
    this.speed = Number.isFinite(Number(envelopeObject["speed"]))
      ? Number(envelopeObject["speed"])
      : envelope.speed;
    this.a = Number.isFinite(Number(envelopeObject["a"]))
      ? Number(envelopeObject["a"])
      : envelope.a;
    this.b = Number.isFinite(Number(envelopeObject["b"]))
      ? Number(envelopeObject["b"])
      : envelope.b;

    if (envelopeObject["index"] != undefined) {
      this.index = clamp(
        0,
        Config.instrumentAutomationTargets[this.target].maxCount,
        envelopeObject["index"] | 0,
      );
    } else {
      this.index = 0;
    }
  }
}

export class Instrument {
  public type: InstrumentType = InstrumentType.chip;
  public preset: number = 0;
  public chipWave: number = 2;
  public chipNoise: number = 1;
  public eqFilter: FilterSettings = new FilterSettings();
  public noteFilter: FilterSettings = new FilterSettings();
  public envelopes: EnvelopeSettings[] = [];
  public envelopeCount: number = 0;
  public fadeIn: number = 0;
  public fadeOut: number = Config.fadeOutNeutral;
  public transition: number = Config.transitions.dictionary["normal"].index;
  public pitchShift: number = 0;
  public detune: number = 0;
  public vibrato: number = 0;
  public unison: number = 0;
  public effects: number = 0;
  public chord: number = 1;
  public volume: number = Config.volumeDefault;
  public pan: number = Config.panCenter;
  public pulseWidth: number = Config.pulseWidthRange - 1;
  public supersawDynamism: number = Config.supersawDynamismMax;
  public supersawSpread: number = Math.ceil(Config.supersawSpreadMax / 2.0);
  public supersawShape: number = 0;
  public soundFontId: string | null = null;
  public soundFontPreset: number = 0;
  public stringSustain: number = 10;
  public stringSustainType: SustainType = SustainType.acoustic;
  public distortion: number = 0;
  public bitcrusherFreq: number = 0;
  public bitcrusherQuantization: number = 0;
  public chorus: number = 0;
  public reverb: number = 0;
  public echoSustain: number = 0;
  public echoDelay: number = 0;
  public algorithm: number = 0;
  public feedbackType: number = 0;
  public feedbackAmplitude: number = 0;
  public readonly operators: Operator[] = [];
  public readonly spectrumWave: SpectrumWave;
  public readonly harmonicsWave: HarmonicsWave = new HarmonicsWave();
  public readonly drumsetEnvelopes: number[] = [];
  public readonly drumsetEnvelopeSpeeds: number[] = [];
  public readonly drumsetEnvelopeAs: number[] = [];
  public readonly drumsetEnvelopeBs: number[] = [];
  public readonly drumsetSpectrumWaves: SpectrumWave[] = [];

  constructor(isNoiseChannel: boolean) {
    this.spectrumWave = new SpectrumWave(isNoiseChannel);
    for (let i: number = 0; i < Config.operatorCount; i++) {
      this.operators[i] = new Operator(i);
    }
    for (let i: number = 0; i < Config.drumCount; i++) {
      this.drumsetEnvelopes[i] = Config.envelopes.dictionary["twang"].index;
      this.drumsetEnvelopeSpeeds[i] =
        Config.envelopes.dictionary["twang"].speed;
      this.drumsetEnvelopeAs[i] = Config.envelopes.dictionary["twang"].a;
      this.drumsetEnvelopeBs[i] = Config.envelopes.dictionary["twang"].b;
      this.drumsetSpectrumWaves[i] = new SpectrumWave(true);
    }
  }

  public setTypeAndReset(type: InstrumentType, isNoiseChannel: boolean): void {
    this.type = type;
    this.preset = type;
    this.volume = Config.volumeDefault;
    this.effects = 0;
    this.chorus = Config.chorusRange - 1;
    this.reverb = 2;
    this.echoSustain = Math.floor((Config.echoSustainRange - 1) * 0.5);
    this.echoDelay = Math.floor((Config.echoDelayRange - 1) * 0.5);
    this.eqFilter.reset();
    this.noteFilter.reset();
    this.distortion = Math.floor((Config.distortionRange - 1) * 0.75);
    this.bitcrusherFreq = Math.floor((Config.bitcrusherFreqRange - 1) * 0.5);
    this.bitcrusherQuantization = Math.floor(
      (Config.bitcrusherQuantizationRange - 1) * 0.5,
    );
    this.pan = Config.panCenter;
    this.pitchShift = Config.pitchShiftCenter;
    this.detune = Config.detuneCenter;
    this.vibrato = 0;
    this.unison = 0;
    this.stringSustain = 10;
    this.stringSustainType = Config.enableAcousticSustain
      ? SustainType.acoustic
      : SustainType.bright;
    this.fadeIn = 0;
    this.fadeOut = Config.fadeOutNeutral;
    this.transition = Config.transitions.dictionary["normal"].index;
    this.envelopeCount = 0;
    this.soundFontId = null;
    this.soundFontPreset = 0;
    switch (type) {
      case InstrumentType.chip:
        this.chipWave = 2;
        // TODO: enable the chord effect?
        this.chord = Config.chords.dictionary["arpeggio"].index;
        break;
      case InstrumentType.fm:
        this.chord = Config.chords.dictionary["custom interval"].index;
        this.algorithm = 0;
        this.feedbackType = 0;
        this.feedbackAmplitude = 0;
        for (let i: number = 0; i < this.operators.length; i++) {
          this.operators[i].reset(i);
        }
        break;
      case InstrumentType.noise:
        this.chipNoise = 1;
        this.chord = Config.chords.dictionary["arpeggio"].index;
        break;
      case InstrumentType.spectrum:
        this.chord = Config.chords.dictionary["simultaneous"].index;
        this.spectrumWave.reset(isNoiseChannel);
        break;
      case InstrumentType.drumset:
        this.chord = Config.chords.dictionary["simultaneous"].index;
        this.fadeOut = Synth.ticksToFadeOutSetting(Config.drumsetFadeOutTicks);
        for (let i: number = 0; i < Config.drumCount; i++) {
          this.drumsetEnvelopes[i] = Config.envelopes.dictionary["twang"].index;
          this.drumsetEnvelopeSpeeds[i] =
            Config.envelopes.dictionary["twang"].speed;
          this.drumsetEnvelopeAs[i] = Config.envelopes.dictionary["twang"].a;
          this.drumsetEnvelopeBs[i] = Config.envelopes.dictionary["twang"].b;
          this.drumsetSpectrumWaves[i].reset(isNoiseChannel);
        }
        break;
      case InstrumentType.harmonics:
        this.chord = Config.chords.dictionary["simultaneous"].index;
        this.harmonicsWave.reset();
        break;
      case InstrumentType.pwm:
        this.chord = Config.chords.dictionary["arpeggio"].index;
        this.pulseWidth = Config.pulseWidthRange - 1;
        break;
      case InstrumentType.pickedString:
        this.chord = Config.chords.dictionary["strum"].index;
        this.harmonicsWave.reset();
        break;
      case InstrumentType.supersaw:
        this.chord = Config.chords.dictionary["arpeggio"].index;
        this.supersawDynamism = Config.supersawDynamismMax;
        this.supersawSpread = Math.ceil(Config.supersawSpreadMax / 2.0);
        this.supersawShape = 0;
        this.pulseWidth = Config.pulseWidthRange - 1;
        break;
      case InstrumentType.soundFont:
        this.chord = Config.chords.dictionary["simultaneous"].index;
        break;
      default:
        throw new Error("Unrecognized instrument type: " + type);
    }
    if (this.chord != Config.chords.dictionary["simultaneous"].index) {
      // Enable chord if it was used.
      this.effects = this.effects | (1 << EffectType.chord);
    }
  }

  public toSettingsObject(): Object {
    const instrumentObject: any = {
      type: Config.instrumentTypeNames[this.type],
      volume: (5 - this.volume) * 20,
      pan: Math.round((100 * (this.pan - Config.panCenter)) / Config.panCenter),
      eqFilter: effectsIncludeEqFilter(this.effects)
        ? this.eqFilter.toSettingsObject()
        : [],
    };

    if (this.preset != this.type) {
      instrumentObject["preset"] = this.preset;
    }

    const effects: string[] = [];
    for (const effect of Config.effectOrder) {
      if (this.effects & (1 << effect)) {
        effects.push(Config.effectNames[effect]);
      }
    }
    instrumentObject["effects"] = effects;

    if (effectsIncludeTransition(this.effects)) {
      instrumentObject["transition"] = Config.transitions[this.transition].name;
    }
    if (effectsIncludeChord(this.effects)) {
      instrumentObject["chord"] = this.getChord().name;
    }
    if (effectsIncludePitchShift(this.effects)) {
      instrumentObject["pitchShiftSemitones"] = this.pitchShift;
    }
    if (effectsIncludeDetune(this.effects)) {
      instrumentObject["detuneCents"] = Synth.detuneToCents(
        this.detune - Config.detuneCenter,
      );
    }
    if (effectsIncludeVibrato(this.effects)) {
      instrumentObject["vibrato"] = Config.vibratos[this.vibrato].name;
    }
    if (effectsIncludeUnison(this.effects)) {
      instrumentObject["unison"] = Config.unisons[this.unison].name;
    }
    if (effectsIncludeNoteFilter(this.effects)) {
      instrumentObject["noteFilter"] = this.noteFilter.toSettingsObject();
    }
    if (effectsIncludeDistortion(this.effects)) {
      instrumentObject["distortion"] =
        (100 * this.distortion) / (Config.distortionRange - 1);
    }
    if (effectsIncludeBitcrusher(this.effects)) {
      instrumentObject["bitcrusherOctave"] =
        (Config.bitcrusherFreqRange - 1 - this.bitcrusherFreq) *
        Config.bitcrusherOctaveStep;
      instrumentObject["bitcrusherQuantization"] =
        (100 * this.bitcrusherQuantization) /
        (Config.bitcrusherQuantizationRange - 1);
    }
    if (effectsIncludeChorus(this.effects)) {
      instrumentObject["chorus"] =
        (100 * this.chorus) / (Config.chorusRange - 1);
    }
    if (effectsIncludeEcho(this.effects)) {
      instrumentObject["echoSustain"] =
        (100 * this.echoSustain) / (Config.echoSustainRange - 1);
      instrumentObject["echoDelayBeats"] =
        ((this.echoDelay + 1) * Config.echoDelayStepTicks) /
        (Config.ticksPerPart * Config.partsPerBeat);
    }
    if (effectsIncludeReverb(this.effects)) {
      instrumentObject["reverb"] =
        (100 * this.reverb) / (Config.reverbRange - 1);
    }

    instrumentObject["fadeInSeconds"] =
      Math.round(10000 * Synth.fadeInSettingToSeconds(this.fadeIn)) / 10000;
    instrumentObject["fadeOutTicks"] = Synth.fadeOutSettingToTicks(
      this.fadeOut,
    );

    if (
      this.type == InstrumentType.harmonics ||
      this.type == InstrumentType.pickedString
    ) {
      instrumentObject["harmonics"] = [];
      for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
        instrumentObject["harmonics"][i] = Math.round(
          (100 * this.harmonicsWave.harmonics[i]) / Config.harmonicsMax,
        );
      }
    }

    if (this.type == InstrumentType.noise) {
      instrumentObject["wave"] = Config.chipNoises[this.chipNoise].name;
    } else if (this.type == InstrumentType.spectrum) {
      instrumentObject["spectrum"] = [];
      for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
        instrumentObject["spectrum"][i] = Math.round(
          (100 * this.spectrumWave.spectrum[i]) / Config.spectrumMax,
        );
      }
    } else if (this.type == InstrumentType.drumset) {
      instrumentObject["drums"] = [];
      for (let j: number = 0; j < Config.drumCount; j++) {
        const spectrum: number[] = [];
        for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
          spectrum[i] = Math.round(
            (100 * this.drumsetSpectrumWaves[j].spectrum[i]) /
              Config.spectrumMax,
          );
        }
        instrumentObject["drums"][j] = {
          filterEnvelope: this.getDrumsetEnvelope(j).name,
          filterEnvelopeSpeed: this.drumsetEnvelopeSpeeds[j],
          filterEnvelopeA: this.drumsetEnvelopeAs[j],
          filterEnvelopeB: this.drumsetEnvelopeBs[j],
          spectrum: spectrum,
        };
      }
    } else if (this.type == InstrumentType.chip) {
      const chipWave = Config.chipWaves[this.chipWave];
      instrumentObject["wave"] = chipWave.name;
      if (chipWave.sampleId != undefined)
        instrumentObject["sampleId"] = chipWave.sampleId;
    } else if (this.type == InstrumentType.pwm) {
      instrumentObject["pulseWidth"] =
        Math.round(getPulseWidthRatio(this.pulseWidth) * 100 * 100000) / 100000;
    } else if (this.type == InstrumentType.supersaw) {
      instrumentObject["pulseWidth"] =
        Math.round(getPulseWidthRatio(this.pulseWidth) * 100 * 100000) / 100000;
      instrumentObject["dynamism"] = Math.round(
        (100 * this.supersawDynamism) / Config.supersawDynamismMax,
      );
      instrumentObject["spread"] = Math.round(
        (100 * this.supersawSpread) / Config.supersawSpreadMax,
      );
      instrumentObject["shape"] = Math.round(
        (100 * this.supersawShape) / Config.supersawShapeMax,
      );
    } else if (this.type == InstrumentType.soundFont) {
      instrumentObject["soundFontId"] = this.soundFontId;
      instrumentObject["soundFontPreset"] = this.soundFontPreset;
    } else if (this.type == InstrumentType.pickedString) {
      instrumentObject["stringSustain"] = Math.round(
        (100 * this.stringSustain) / (Config.stringSustainRange - 1),
      );
      if (Config.enableAcousticSustain) {
        instrumentObject["stringSustainType"] =
          Config.sustainTypeNames[this.stringSustainType];
      }
    } else if (this.type == InstrumentType.harmonics) {
    } else if (this.type == InstrumentType.fm) {
      const operatorArray: Object[] = [];
      for (const operator of this.operators) {
        const chipWave =
          operator.wave == 0 ? undefined : Config.chipWaves[operator.wave - 1];
        operatorArray.push({
          frequency: operator.frequency,
          amplitude: operator.amplitude,
          wave: operator.wave == 0 ? "sine" : chipWave!.name,
          ...(chipWave?.sampleId == undefined
            ? {}
            : { sampleId: chipWave.sampleId }),
        });
      }
      instrumentObject["algorithm"] = Config.algorithms[this.algorithm].name;
      instrumentObject["feedbackType"] =
        Config.feedbacks[this.feedbackType].name;
      instrumentObject["feedbackAmplitude"] = this.feedbackAmplitude;
      instrumentObject["operators"] = operatorArray;
    } else {
      throw new Error("Unrecognized instrument type");
    }

    const envelopes: any[] = [];
    for (let i = 0; i < this.envelopeCount; i++) {
      envelopes.push(this.envelopes[i].toSettingsObject());
    }
    instrumentObject["envelopes"] = envelopes;

    return instrumentObject;
  }

  public fromSettingsObject(
    instrumentObject: any,
    isNoiseChannel: boolean,
  ): void {
    if (instrumentObject == undefined) instrumentObject = {};

    let type: InstrumentType = Config.instrumentTypeNames.indexOf(
      instrumentObject["type"],
    );
    if (<any>type == -1)
      type = isNoiseChannel ? InstrumentType.noise : InstrumentType.chip;
    this.setTypeAndReset(type, isNoiseChannel);

    if (instrumentObject["preset"] != undefined) {
      this.preset = instrumentObject["preset"] >>> 0;
    }

    if (instrumentObject["volume"] != undefined) {
      this.volume = clamp(
        0,
        Config.volumeRange,
        Math.round(5 - (instrumentObject["volume"] | 0) / 20),
      );
    } else {
      this.volume = Config.volumeDefault;
    }

    let effects: number = 0;
    for (const effect of instrumentObject["effects"] ?? []) {
      const effectIndex: number = Config.effectNames.indexOf(effect);
      if (effectIndex != -1) effects |= 1 << effectIndex;
    }
    this.effects = effects;

    this.transition = Config.transitions.dictionary["normal"].index; // default value.
    const transitionProperty: any = instrumentObject["transition"];
    if (transitionProperty != undefined) {
      const transition: Transition | undefined =
        Config.transitions.dictionary[transitionProperty];
      if (transition != undefined) this.transition = transition.index;

      if (this.transition != Config.transitions.dictionary["normal"].index) {
        // Enable transition if it was used.
        this.effects = this.effects | (1 << EffectType.transition);
      }
    }

    if (instrumentObject["fadeInSeconds"] != undefined) {
      this.fadeIn = Synth.secondsToFadeInSetting(
        +instrumentObject["fadeInSeconds"],
      );
    }
    if (instrumentObject["fadeOutTicks"] != undefined) {
      this.fadeOut = Synth.ticksToFadeOutSetting(
        +instrumentObject["fadeOutTicks"],
      );
    }

    {
      // Note that the chord setting may be overridden by instrumentObject["chorus"] below.
      const chordProperty: any = instrumentObject["chord"];
      const chord: Chord | undefined = Config.chords.dictionary[chordProperty];
      if (chord != undefined) {
        this.chord = chord.index;
      } else {
        // Different instruments have different default chord types based on historical behaviour.
        if (this.type == InstrumentType.noise) {
          this.chord = Config.chords.dictionary["arpeggio"].index;
        } else if (this.type == InstrumentType.pickedString) {
          this.chord = Config.chords.dictionary["strum"].index;
        } else if (this.type == InstrumentType.chip) {
          this.chord = Config.chords.dictionary["arpeggio"].index;
        } else if (this.type == InstrumentType.fm) {
          this.chord = Config.chords.dictionary["custom interval"].index;
        } else {
          this.chord = Config.chords.dictionary["simultaneous"].index;
        }
      }
    }

    this.unison = Config.unisons.dictionary["none"].index; // default value.
    const unisonProperty: any = instrumentObject["unison"];
    if (unisonProperty != undefined) {
      const unison: Unison | undefined =
        Config.unisons.dictionary[unisonProperty];
      if (unison != undefined) this.unison = unison.index;
    }

    if (instrumentObject["pitchShiftSemitones"] != undefined) {
      this.pitchShift = +instrumentObject["pitchShiftSemitones"];
    }
    if (instrumentObject["detuneCents"] != undefined) {
      this.detune =
        Config.detuneCenter +
        Synth.centsToDetune(+instrumentObject["detuneCents"]);
    }

    this.vibrato = Config.vibratos.dictionary["none"].index; // default value.
    const vibratoProperty: any = instrumentObject["vibrato"];
    if (vibratoProperty != undefined) {
      const vibrato: Vibrato | undefined =
        Config.vibratos.dictionary[vibratoProperty];
      if (vibrato != undefined) this.vibrato = vibrato.index;
    }

    if (instrumentObject["pan"] != undefined) {
      this.pan = clamp(
        0,
        Config.panMax + 1,
        Math.round(
          Config.panCenter +
            ((instrumentObject["pan"] | 0) * Config.panCenter) / 100,
        ),
      );
    } else {
      this.pan = Config.panCenter;
    }

    if (instrumentObject["distortion"] != undefined) {
      this.distortion =
        ((Config.distortionRange - 1) * +instrumentObject["distortion"]) / 100;
    }

    if (instrumentObject["bitcrusherOctave"] != undefined) {
      this.bitcrusherFreq =
        Config.bitcrusherFreqRange -
        1 -
        +instrumentObject["bitcrusherOctave"] / Config.bitcrusherOctaveStep;
    }
    if (instrumentObject["bitcrusherQuantization"] != undefined) {
      this.bitcrusherQuantization =
        ((Config.bitcrusherQuantizationRange - 1) *
          +instrumentObject["bitcrusherQuantization"]) /
        100;
    }

    if (instrumentObject["echoSustain"] != undefined) {
      this.echoSustain =
        ((Config.echoSustainRange - 1) * +instrumentObject["echoSustain"]) /
        100;
    }
    if (instrumentObject["echoDelayBeats"] != undefined) {
      this.echoDelay =
        (+instrumentObject["echoDelayBeats"] *
          (Config.ticksPerPart * Config.partsPerBeat)) /
          Config.echoDelayStepTicks -
        1.0;
    }

    if (!isNaN(instrumentObject["chorus"])) {
      this.chorus =
        ((Config.chorusRange - 1) * +instrumentObject["chorus"]) / 100;
    }

    if (instrumentObject["reverb"] != undefined) {
      this.reverb =
        ((Config.reverbRange - 1) * +instrumentObject["reverb"]) / 100;
    }

    if (instrumentObject["pulseWidth"] != undefined) {
      this.pulseWidth = clamp(
        0,
        Config.pulseWidthRange,
        Math.round(
          Math.log2(+instrumentObject["pulseWidth"] / 50) / 0.5 - 1 + 8,
        ),
      );
    } else {
      this.pulseWidth = Config.pulseWidthRange - 1;
    }

    if (instrumentObject["dynamism"] != undefined) {
      this.supersawDynamism = clamp(
        0,
        Config.supersawDynamismMax + 1,
        Math.round(
          (Config.supersawDynamismMax * (instrumentObject["dynamism"] | 0)) /
            100,
        ),
      );
    } else {
      this.supersawDynamism = Config.supersawDynamismMax;
    }
    if (instrumentObject["spread"] != undefined) {
      this.supersawSpread = clamp(
        0,
        Config.supersawSpreadMax + 1,
        Math.round(
          (Config.supersawSpreadMax * (instrumentObject["spread"] | 0)) / 100,
        ),
      );
    } else {
      this.supersawSpread = Math.ceil(Config.supersawSpreadMax / 2.0);
    }
    if (instrumentObject["shape"] != undefined) {
      this.supersawShape = clamp(
        0,
        Config.supersawShapeMax + 1,
        Math.round(
          (Config.supersawShapeMax * (instrumentObject["shape"] | 0)) / 100,
        ),
      );
    } else {
      this.supersawShape = 0;
    }

    if (instrumentObject["harmonics"] != undefined) {
      for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
        this.harmonicsWave.harmonics[i] = Math.max(
          0,
          Math.min(
            Config.harmonicsMax,
            Math.round(
              (Config.harmonicsMax * +instrumentObject["harmonics"][i]) / 100,
            ),
          ),
        );
      }
      this.harmonicsWave.markCustomWaveDirty();
    } else {
      this.harmonicsWave.reset();
    }

    if (instrumentObject["spectrum"] != undefined) {
      for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
        this.spectrumWave.spectrum[i] = Math.max(
          0,
          Math.min(
            Config.spectrumMax,
            Math.round(
              (Config.spectrumMax * +instrumentObject["spectrum"][i]) / 100,
            ),
          ),
        );
      }
      this.spectrumWave.markCustomWaveDirty();
    } else {
      this.spectrumWave.reset(isNoiseChannel);
    }

    if (instrumentObject["stringSustain"] != undefined) {
      this.stringSustain = clamp(
        0,
        Config.stringSustainRange,
        Math.round(
          ((Config.stringSustainRange - 1) *
            (instrumentObject["stringSustain"] | 0)) /
            100,
        ),
      );
    } else {
      this.stringSustain = 10;
    }
    this.stringSustainType = Config.enableAcousticSustain
      ? Config.sustainTypeNames.indexOf(instrumentObject["stringSustainType"])
      : SustainType.bright;
    if (<any>this.stringSustainType == -1)
      this.stringSustainType = SustainType.bright;

    if (this.type == InstrumentType.noise) {
      this.chipNoise = Config.chipNoises.findIndex(
        (wave) => wave.name == instrumentObject["wave"],
      );
      if (this.chipNoise == -1) this.chipNoise = 1;
    }

    if (this.type == InstrumentType.drumset) {
      if (instrumentObject["drums"] != undefined) {
        for (let j: number = 0; j < Config.drumCount; j++) {
          const drum: any = instrumentObject["drums"][j];
          if (drum == undefined) continue;

          this.drumsetEnvelopes[j] = Config.envelopes.dictionary["twang"].index; // default value.
          if (drum["filterEnvelope"] != undefined) {
            const envelope: Envelope | undefined =
              Config.envelopes.dictionary[drum["filterEnvelope"]];
            if (envelope != undefined) {
              this.drumsetEnvelopes[j] = envelope.index;
              this.drumsetEnvelopeSpeeds[j] = Number.isFinite(
                Number(drum["filterEnvelopeSpeed"]),
              )
                ? Number(drum["filterEnvelopeSpeed"])
                : envelope.speed;
              this.drumsetEnvelopeAs[j] = Number.isFinite(
                Number(drum["filterEnvelopeA"]),
              )
                ? Number(drum["filterEnvelopeA"])
                : envelope.a;
              this.drumsetEnvelopeBs[j] = Number.isFinite(
                Number(drum["filterEnvelopeB"]),
              )
                ? Number(drum["filterEnvelopeB"])
                : envelope.b;
            }
          }
          if (drum["spectrum"] != undefined) {
            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
              this.drumsetSpectrumWaves[j].spectrum[i] = Math.max(
                0,
                Math.min(
                  Config.spectrumMax,
                  Math.round((Config.spectrumMax * +drum["spectrum"][i]) / 100),
                ),
              );
            }
          }
          this.drumsetSpectrumWaves[j].markCustomWaveDirty();
        }
      }
    }

    if (this.type == InstrumentType.chip) {
      const sampleId: unknown = instrumentObject["sampleId"];
      this.chipWave =
        typeof sampleId == "string"
          ? Config.chipWaves.findIndex((wave) => wave.sampleId == sampleId)
          : Config.chipWaves.findIndex(
              (wave) => wave.name == instrumentObject["wave"],
            );
      if (this.chipWave == -1) this.chipWave = 1;
    }

    if (this.type == InstrumentType.fm) {
      this.algorithm = Config.algorithms.findIndex(
        (algorithm) => algorithm.name == instrumentObject["algorithm"],
      );
      if (this.algorithm == -1) this.algorithm = 0;
      this.feedbackType = Config.feedbacks.findIndex(
        (feedback) => feedback.name == instrumentObject["feedbackType"],
      );
      if (this.feedbackType == -1) this.feedbackType = 0;
      if (instrumentObject["feedbackAmplitude"] != undefined) {
        this.feedbackAmplitude = clamp(
          0,
          Config.operatorAmplitudeMax + 1,
          instrumentObject["feedbackAmplitude"] | 0,
        );
      } else {
        this.feedbackAmplitude = 0;
      }

      for (let j: number = 0; j < Config.operatorCount; j++) {
        const operator: Operator = this.operators[j];
        let operatorObject: any = undefined;
        if (instrumentObject["operators"] != undefined)
          operatorObject = instrumentObject["operators"][j];
        if (operatorObject == undefined) operatorObject = {};

        const serializedFrequency: unknown = operatorObject["frequency"];
        const frequency: number =
          typeof serializedFrequency == "number"
            ? serializedFrequency
            : typeof serializedFrequency == "string"
              ? parseFloat(serializedFrequency.replace("~", ""))
              : 1;
        operator.frequency = Number.isFinite(frequency)
          ? Math.max(0, Math.min(Config.operatorFrequencyMax, frequency))
          : 1;
        if (operatorObject["amplitude"] != undefined) {
          operator.amplitude = clamp(
            0,
            Config.operatorAmplitudeMax + 1,
            operatorObject["amplitude"] | 0,
          );
        } else {
          operator.amplitude = 0;
        }
        const sampleId: unknown = operatorObject["sampleId"];
        const chipWave: number =
          typeof sampleId == "string"
            ? Config.chipWaves.findIndex((wave) => wave.sampleId == sampleId)
            : Config.chipWaves.findIndex(
                (wave) => wave.name == operatorObject["wave"],
              );
        operator.wave = chipWave == -1 ? 0 : chipWave + 1;
      }
    }

    if (this.type == InstrumentType.soundFont) {
      this.soundFontId =
        typeof instrumentObject["soundFontId"] == "string"
          ? instrumentObject["soundFontId"]
          : null;
      this.soundFontPreset = Math.max(
        0,
        Math.min(0x3ffff, instrumentObject["soundFontPreset"] | 0),
      );
    }

    if (instrumentObject["noteFilter"] != undefined) {
      this.noteFilter.fromSettingsObject(instrumentObject["noteFilter"]);
    } else {
      this.noteFilter.reset();
    }
    if (Array.isArray(instrumentObject["eqFilter"])) {
      this.eqFilter.fromSettingsObject(instrumentObject["eqFilter"]);
      if (this.eqFilter.controlPointCount > 0)
        this.effects |= 1 << EffectType.eqFilter;
    } else {
      this.eqFilter.reset();
    }

    if (Array.isArray(instrumentObject["envelopes"])) {
      const envelopeArray: any[] = instrumentObject["envelopes"];
      for (let i = 0; i < envelopeArray.length; i++) {
        if (this.envelopeCount >= Config.maxEnvelopeCount) break;
        const tempEnvelope: EnvelopeSettings = new EnvelopeSettings();
        tempEnvelope.fromSettingsObject(envelopeArray[i]);
        this.addEnvelope(
          tempEnvelope.target,
          tempEnvelope.index,
          tempEnvelope.envelope,
          tempEnvelope.speed,
          tempEnvelope.a,
          tempEnvelope.b,
        );
      }
    }
  }

  public static frequencyFromPitch(pitch: number): number {
    return 440.0 * Math.pow(2.0, (pitch - 69.0) / 12.0);
  }

  public addEnvelope(
    target: number,
    index: number,
    envelope: number,
    speed: number = Config.envelopes[envelope].speed,
    a: number = Config.envelopes[envelope].a,
    b: number = Config.envelopes[envelope].b,
  ): void {
    if (!this.supportsEnvelopeTarget(target, index)) throw new Error();
    if (this.envelopeCount >= Config.maxEnvelopeCount) throw new Error();
    while (this.envelopes.length <= this.envelopeCount)
      this.envelopes[this.envelopes.length] = new EnvelopeSettings();
    const envelopeSettings: EnvelopeSettings =
      this.envelopes[this.envelopeCount];
    envelopeSettings.target = target;
    envelopeSettings.index = index;
    envelopeSettings.envelope = envelope;
    envelopeSettings.speed = speed;
    envelopeSettings.a = a;
    envelopeSettings.b = b;
    this.envelopeCount++;
  }

  public supportsEnvelopeTarget(target: number, index: number): boolean {
    const automationTarget: AutomationTarget =
      Config.instrumentAutomationTargets[target];
    if (
      automationTarget.computeIndex == null &&
      automationTarget.name != "none"
    ) {
      return false;
    }
    if (index >= automationTarget.maxCount) {
      return false;
    }
    if (
      automationTarget.compatibleInstruments != null &&
      automationTarget.compatibleInstruments.indexOf(this.type) == -1
    ) {
      return false;
    }
    if (
      automationTarget.effect != null &&
      (this.effects & (1 << automationTarget.effect)) == 0
    ) {
      return false;
    }
    if (automationTarget.isFilter) {
      //if (automationTarget.perNote) {
      if (index >= this.noteFilter.controlPointCount) return false;
      //} else {
      //	if (index >= this.eqFilter.controlPointCount)   return false;
      //}
    }
    return true;
  }

  public clearInvalidEnvelopeTargets(): void {
    for (
      let envelopeIndex: number = 0;
      envelopeIndex < this.envelopeCount;
      envelopeIndex++
    ) {
      const target: number = this.envelopes[envelopeIndex].target;
      const index: number = this.envelopes[envelopeIndex].index;
      if (!this.supportsEnvelopeTarget(target, index)) {
        this.envelopes[envelopeIndex].target =
          Config.instrumentAutomationTargets.dictionary["none"].index;
        this.envelopes[envelopeIndex].index = 0;
      }
    }
  }

  public toBinaryState(): Object {
    const filterState = (filter: FilterSettings): Object[] => {
      const points: Object[] = [];
      for (let i: number = 0; i < filter.controlPointCount; i++) {
        const point: FilterControlPoint = filter.controlPoints[i];
        points.push({ type: point.type, freq: point.freq, gain: point.gain });
      }
      return points;
    };
    return {
      type: this.type,
      preset: this.preset,
      chipWave: this.chipWave,
      chipNoise: this.chipNoise,
      fadeIn: this.fadeIn,
      fadeOut: this.fadeOut,
      transition: this.transition,
      pitchShift: this.pitchShift,
      detune: this.detune,
      vibrato: this.vibrato,
      unison: this.unison,
      effects: this.effects,
      chord: this.chord,
      volume: this.volume,
      pan: this.pan,
      pulseWidth: this.pulseWidth,
      supersawDynamism: this.supersawDynamism,
      supersawSpread: this.supersawSpread,
      supersawShape: this.supersawShape,
      soundFontId: this.soundFontId,
      soundFontPreset: this.soundFontPreset,
      stringSustain: this.stringSustain,
      stringSustainType: this.stringSustainType,
      distortion: this.distortion,
      bitcrusherFreq: this.bitcrusherFreq,
      bitcrusherQuantization: this.bitcrusherQuantization,
      chorus: this.chorus,
      reverb: this.reverb,
      echoSustain: this.echoSustain,
      echoDelay: this.echoDelay,
      algorithm: this.algorithm,
      feedbackType: this.feedbackType,
      feedbackAmplitude: this.feedbackAmplitude,
      eqFilter: filterState(this.eqFilter),
      noteFilter: filterState(this.noteFilter),
      envelopes: this.envelopes
        .slice(0, this.envelopeCount)
        .map((envelope: EnvelopeSettings): Object => ({
          target: envelope.target,
          index: envelope.index,
          envelope: envelope.envelope,
          speed: envelope.speed,
          a: envelope.a,
          b: envelope.b,
        })),
      operators: this.operators.map((operator: Operator): Object => ({
        frequency: operator.frequency,
        amplitude: operator.amplitude,
        wave: operator.wave,
      })),
      spectrum: this.spectrumWave.spectrum.concat(),
      harmonics: this.harmonicsWave.harmonics.concat(),
      drumsetEnvelopes: this.drumsetEnvelopes.concat(),
      drumsetEnvelopeSpeeds: this.drumsetEnvelopeSpeeds.concat(),
      drumsetEnvelopeAs: this.drumsetEnvelopeAs.concat(),
      drumsetEnvelopeBs: this.drumsetEnvelopeBs.concat(),
      drumsetSpectra: this.drumsetSpectrumWaves.map(
        (wave: SpectrumWave): number[] => wave.spectrum.concat(),
      ),
    };
  }

  public fromBinaryState(binaryState: any): void {
    if (
      binaryState == null ||
      typeof binaryState != "object" ||
      Array.isArray(binaryState) ||
      binaryState.type !== this.type
    ) {
      throw new Error("Invalid .goop instrument state.");
    }
    const numberValue = (value: unknown): number => {
      if (typeof value != "number" || !Number.isFinite(value))
        throw new Error("Invalid .goop instrument number.");
      return value;
    };
    const integerValue = (value: unknown): number => {
      const result: number = numberValue(value);
      if (!Number.isInteger(result))
        throw new Error("Invalid .goop instrument integer.");
      return result;
    };
    const indexValue = (value: unknown, length: number): number => {
      const result: number = integerValue(value);
      if (result < 0 || result >= length)
        throw new Error("Invalid .goop instrument index.");
      return result;
    };
    const rangeValue = (value: unknown, min: number, max: number): number => {
      const result: number = numberValue(value);
      if (result < min || result > max)
        throw new Error("Invalid .goop instrument value.");
      return result;
    };
    const numberArray = (value: unknown, expectedLength: number): number[] => {
      if (!Array.isArray(value) || value.length != expectedLength)
        throw new Error("Invalid .goop instrument array.");
      return value.map(numberValue);
    };
    const boundedNumberArray = (
      value: unknown,
      expectedLength: number,
      min: number,
      max: number,
    ): number[] => {
      return numberArray(value, expectedLength).map((item: number): number =>
        rangeValue(item, min, max),
      );
    };
    const scalarNames: string[] = [
      "preset",
      "chipWave",
      "chipNoise",
      "fadeIn",
      "fadeOut",
      "transition",
      "pitchShift",
      "detune",
      "vibrato",
      "unison",
      "effects",
      "chord",
      "volume",
      "pan",
      "pulseWidth",
      "supersawDynamism",
      "supersawSpread",
      "supersawShape",
      "soundFontPreset",
      "stringSustain",
      "stringSustainType",
      "distortion",
      "bitcrusherFreq",
      "bitcrusherQuantization",
      "chorus",
      "reverb",
      "echoSustain",
      "echoDelay",
      "algorithm",
      "feedbackType",
      "feedbackAmplitude",
    ];
    const scalarValues: { [name: string]: number } = {};
    for (const name of scalarNames)
      scalarValues[name] = numberValue(binaryState[name]);

    // These settings index fixed configuration arrays, even when their instrument
    // type or effect is currently disabled. Validate dormant settings too so a
    // later type/effect toggle cannot expose a corrupt index to the synthesizer.
    if (integerValue(scalarValues["preset"]) != this.preset)
      throw new Error("Invalid .goop instrument preset.");
    indexValue(scalarValues["chipWave"], Config.chipWaves.length);
    indexValue(scalarValues["chipNoise"], Config.chipNoises.length);
    indexValue(scalarValues["fadeIn"], Config.fadeInRange);
    indexValue(scalarValues["fadeOut"], Config.fadeOutTicks.length);
    indexValue(scalarValues["transition"], Config.transitions.length);
    indexValue(scalarValues["vibrato"], Config.vibratos.length);
    indexValue(scalarValues["unison"], Config.unisons.length);
    indexValue(scalarValues["chord"], Config.chords.length);
    indexValue(
      scalarValues["stringSustainType"],
      Config.sustainTypeNames.length,
    );
    indexValue(scalarValues["algorithm"], Config.algorithms.length);
    indexValue(scalarValues["feedbackType"], Config.feedbacks.length);
    const effects: number = integerValue(scalarValues["effects"]);
    if (
      effects != this.effects ||
      effects < 0 ||
      effects >= Math.pow(2, Config.effectNames.length)
    )
      throw new Error("Invalid .goop instrument effects.");
    const soundFontPreset: number = integerValue(
      scalarValues["soundFontPreset"],
    );
    if (soundFontPreset < 0 || soundFontPreset > 0x3ffff)
      throw new Error("Invalid .goop SoundFont preset.");
    if (
      binaryState.soundFontId !== null &&
      (typeof binaryState.soundFontId != "string" ||
        binaryState.soundFontId.length > maximumSoundFontIdLength)
    ) {
      throw new Error("Invalid .goop SoundFont.");
    }

    rangeValue(scalarValues["volume"], 0, Config.volumeRange - 1);
    rangeValue(scalarValues["pan"], 0, Config.panMax);
    rangeValue(scalarValues["pulseWidth"], 0, Config.pulseWidthRange - 1);
    rangeValue(scalarValues["supersawDynamism"], 0, Config.supersawDynamismMax);
    rangeValue(scalarValues["supersawSpread"], 0, Config.supersawSpreadMax);
    rangeValue(scalarValues["supersawShape"], 0, Config.supersawShapeMax);
    rangeValue(scalarValues["stringSustain"], 0, Config.stringSustainRange - 1);
    rangeValue(
      scalarValues["feedbackAmplitude"],
      0,
      Config.operatorAmplitudeMax,
    );

    interface BinaryFilterPoint {
      type: FilterType;
      freq: number;
      gain: number;
    }
    const filterState = (value: unknown): BinaryFilterPoint[] => {
      if (!Array.isArray(value) || value.length > Config.filterMaxPoints)
        throw new Error("Invalid .goop instrument filter.");
      const points: BinaryFilterPoint[] = [];
      for (const candidate of value) {
        if (
          candidate == null ||
          typeof candidate != "object" ||
          Array.isArray(candidate)
        )
          throw new Error("Invalid .goop instrument filter point.");
        const point: any = candidate;
        const type: FilterType = indexValue(
          point.type,
          Config.filterTypeNames.length,
        );
        points.push({
          type: type,
          freq: rangeValue(point.freq, 0, Config.filterFreqRange - 1),
          gain: rangeValue(point.gain, 0, Config.filterGainRange - 1),
        });
      }
      return points;
    };
    const eqFilterState: BinaryFilterPoint[] = filterState(
      binaryState.eqFilter,
    );
    const noteFilterState: BinaryFilterPoint[] = filterState(
      binaryState.noteFilter,
    );

    if (
      !Array.isArray(binaryState.envelopes) ||
      binaryState.envelopes.length > Config.maxEnvelopeCount
    )
      throw new Error("Invalid .goop instrument envelopes.");
    interface BinaryEnvelope {
      target: number;
      index: number;
      envelope: number;
      speed: number;
      a: number;
      b: number;
    }
    const envelopeStates: BinaryEnvelope[] = [];
    for (const candidate of binaryState.envelopes) {
      if (
        candidate == null ||
        typeof candidate != "object" ||
        Array.isArray(candidate)
      )
        throw new Error("Invalid .goop instrument envelope.");
      const envelope: any = candidate;
      const target: number = indexValue(
        envelope.target,
        Config.instrumentAutomationTargets.length,
      );
      const index: number = integerValue(envelope.index);
      const automationTarget: AutomationTarget =
        Config.instrumentAutomationTargets[target];
      if (
        index < 0 ||
        index >= automationTarget.maxCount ||
        (automationTarget.computeIndex == null &&
          automationTarget.name != "none") ||
        (automationTarget.compatibleInstruments != null &&
          automationTarget.compatibleInstruments.indexOf(this.type) == -1) ||
        (automationTarget.effect != null &&
          (effects & (1 << automationTarget.effect)) == 0) ||
        (automationTarget.isFilter && index >= noteFilterState.length)
      ) {
        throw new Error("Invalid .goop instrument envelope target.");
      }
      // SoundFont filter envelopes can legitimately span a much wider multiplier
      // range than editor-authored amplitude envelopes. Filter coefficients clamp
      // the resulting frequency, whereas allowing those magnitudes for volume or
      // oscillator targets could overflow the audio pipeline.
      const parameterLimit: number = automationTarget.isFilter
        ? Math.pow(2, 28)
        : 4;
      envelopeStates.push({
        target: target,
        index: index,
        envelope: indexValue(envelope.envelope, Config.envelopes.length),
        speed: rangeValue(envelope.speed, 0, 64),
        a: rangeValue(envelope.a, -parameterLimit, parameterLimit),
        b: rangeValue(envelope.b, -parameterLimit, parameterLimit),
      });
    }

    if (
      !Array.isArray(binaryState.operators) ||
      binaryState.operators.length != this.operators.length
    )
      throw new Error("Invalid .goop instrument operators.");
    const operatorStates: Array<{
      frequency: number;
      amplitude: number;
      wave: number;
    }> = [];
    for (let i: number = 0; i < this.operators.length; i++) {
      const candidate: any = binaryState.operators[i];
      if (
        candidate == null ||
        typeof candidate != "object" ||
        Array.isArray(candidate)
      )
        throw new Error("Invalid .goop instrument operator.");
      operatorStates.push({
        frequency: rangeValue(
          candidate.frequency,
          0,
          Config.operatorFrequencyMax,
        ),
        amplitude: rangeValue(
          candidate.amplitude,
          0,
          Config.operatorAmplitudeMax,
        ),
        wave: indexValue(candidate.wave, Config.chipWaves.length + 1),
      });
    }

    const spectrumState: number[] = boundedNumberArray(
      binaryState.spectrum,
      Config.spectrumControlPoints,
      0,
      Config.spectrumMax,
    );
    const harmonicsState: number[] = boundedNumberArray(
      binaryState.harmonics,
      Config.harmonicsControlPoints,
      0,
      Config.harmonicsMax,
    );
    const drumsetEnvelopesState: number[] = numberArray(
      binaryState.drumsetEnvelopes,
      Config.drumCount,
    ).map((value: number): number =>
      indexValue(value, Config.envelopes.length),
    );
    const drumsetEnvelopeSpeedsState: number[] = boundedNumberArray(
      binaryState.drumsetEnvelopeSpeeds,
      Config.drumCount,
      0,
      64,
    );
    // Drum envelope multipliers only drive a frequency which is clamped when
    // coefficients are generated, so retain the wider SoundFont-safe domain.
    const filterEnvelopeParameterLimit: number = Math.pow(2, 28);
    const drumsetEnvelopeAsState: number[] = boundedNumberArray(
      binaryState.drumsetEnvelopeAs,
      Config.drumCount,
      -filterEnvelopeParameterLimit,
      filterEnvelopeParameterLimit,
    );
    const drumsetEnvelopeBsState: number[] = boundedNumberArray(
      binaryState.drumsetEnvelopeBs,
      Config.drumCount,
      -filterEnvelopeParameterLimit,
      filterEnvelopeParameterLimit,
    );
    if (
      !Array.isArray(binaryState.drumsetSpectra) ||
      binaryState.drumsetSpectra.length != Config.drumCount
    )
      throw new Error("Invalid .goop drum spectra.");
    const drumsetSpectraState: number[][] = binaryState.drumsetSpectra.map(
      (spectrum: unknown): number[] =>
        boundedNumberArray(
          spectrum,
          Config.spectrumControlPoints,
          0,
          Config.spectrumMax,
        ),
    );

    // All validation is complete. Apply the state only after every nested field
    // has been checked so direct callers cannot observe a half-restored instrument.
    for (const name of scalarNames) (<any>this)[name] = scalarValues[name];
    this.soundFontId = binaryState.soundFontId;
    const restoreFilter = (
      filter: FilterSettings,
      points: BinaryFilterPoint[],
    ): void => {
      filter.reset();
      for (const point of points)
        filter.addPoint(point.type, point.freq, point.gain);
    };
    restoreFilter(this.eqFilter, eqFilterState);
    restoreFilter(this.noteFilter, noteFilterState);
    while (this.envelopes.length < envelopeStates.length)
      this.envelopes.push(new EnvelopeSettings());
    this.envelopeCount = envelopeStates.length;
    for (let i: number = 0; i < envelopeStates.length; i++) {
      const source: BinaryEnvelope = envelopeStates[i];
      const destination: EnvelopeSettings = this.envelopes[i];
      destination.target = source.target;
      destination.index = source.index;
      destination.envelope = source.envelope;
      destination.speed = source.speed;
      destination.a = source.a;
      destination.b = source.b;
    }
    for (let i: number = 0; i < this.operators.length; i++) {
      this.operators[i].frequency = operatorStates[i].frequency;
      this.operators[i].amplitude = operatorStates[i].amplitude;
      this.operators[i].wave = operatorStates[i].wave;
    }
    this.spectrumWave.spectrum = spectrumState;
    this.spectrumWave.markCustomWaveDirty();
    this.harmonicsWave.harmonics = harmonicsState;
    this.harmonicsWave.markCustomWaveDirty();
    this.drumsetEnvelopes.splice(
      0,
      this.drumsetEnvelopes.length,
      ...drumsetEnvelopesState,
    );
    this.drumsetEnvelopeSpeeds.splice(
      0,
      this.drumsetEnvelopeSpeeds.length,
      ...drumsetEnvelopeSpeedsState,
    );
    this.drumsetEnvelopeAs.splice(
      0,
      this.drumsetEnvelopeAs.length,
      ...drumsetEnvelopeAsState,
    );
    this.drumsetEnvelopeBs.splice(
      0,
      this.drumsetEnvelopeBs.length,
      ...drumsetEnvelopeBsState,
    );
    for (let i: number = 0; i < Config.drumCount; i++) {
      this.drumsetSpectrumWaves[i].spectrum = drumsetSpectraState[i];
      this.drumsetSpectrumWaves[i].markCustomWaveDirty();
    }
  }

  public getTransition(): Transition {
    return effectsIncludeTransition(this.effects)
      ? Config.transitions[this.transition]
      : Config.transitions.dictionary["normal"];
  }

  public getFadeInSeconds(): number {
    return Synth.fadeInSettingToSeconds(this.fadeIn);
  }

  public getFadeOutTicks(): number {
    return Synth.fadeOutSettingToTicks(this.fadeOut);
  }

  public getChord(): Chord {
    return effectsIncludeChord(this.effects)
      ? Config.chords[this.chord]
      : Config.chords.dictionary["simultaneous"];
  }

  public getUnison(): Unison {
    return effectsIncludeUnison(this.effects)
      ? Config.unisons[this.unison]
      : Config.unisons.dictionary["none"];
  }

  public getDrumsetEnvelope(pitch: number): Envelope {
    if (this.type != InstrumentType.drumset)
      throw new Error("Can't getDrumsetEnvelope() for non-drumset.");
    return Config.envelopes[this.drumsetEnvelopes[pitch]];
  }
}

export class Channel {
  public octave: number = 0;
  public readonly instruments: Instrument[] = [];
  public readonly patterns: Pattern[] = [];
  public readonly bars: number[] = [];
  public muted: boolean = false;
}

export class Song {
  public scale!: number;
  public key!: number;
  // The key used for notation and composition. Unlike key, this does not affect playback.
  public composingKey!: number;
  public tempo!: number;
  public beatsPerBar!: number;
  public barCount!: number;
  public patternsPerChannel!: number;
  public rhythm!: number;
  public loopStart!: number;
  public loopLength!: number;
  public pitchChannelCount!: number;
  public noiseChannelCount!: number;
  public readonly channels: Channel[] = [];
  public readonly assets: AssetDefinition[] = [];

  constructor(data?: Uint8Array) {
    if (data != undefined) {
      this.fromBinary(data);
    } else {
      this.initToDefault(true);
    }
  }

  public getChannelCount(): number {
    return this.pitchChannelCount + this.noiseChannelCount;
  }

  public getMaxInstrumentsPerChannel(): number {
    return Config.instrumentCountMax;
  }

  public getChannelIsNoise(channelIndex: number): boolean {
    return channelIndex >= this.pitchChannelCount;
  }

  public initToDefault(andResetChannels: boolean = true): void {
    this.assets.length = 0;
    Config.configureAssets(this.assets);
    this.scale = 0;
    this.key = 0;
    this.composingKey = 0;
    this.loopStart = 0;
    this.loopLength = 4;
    this.tempo = 150;
    this.beatsPerBar = 4;
    this.barCount = 16;
    this.patternsPerChannel = 8;
    this.rhythm = 1;

    if (andResetChannels) {
      this.pitchChannelCount = 3;
      this.noiseChannelCount = 1;
      for (
        let channelIndex: number = 0;
        channelIndex < this.getChannelCount();
        channelIndex++
      ) {
        const isNoiseChannel: boolean = channelIndex >= this.pitchChannelCount;
        if (this.channels.length <= channelIndex) {
          this.channels[channelIndex] = new Channel();
        }
        const channel: Channel = this.channels[channelIndex];
        channel.octave = isNoiseChannel ? 0 : 4 - channelIndex; // [4, 3, 2, 0]: Descending octaves with drums at zero in last channel.

        for (
          let pattern: number = 0;
          pattern < this.patternsPerChannel;
          pattern++
        ) {
          if (channel.patterns.length <= pattern) {
            channel.patterns[pattern] = new Pattern();
          } else {
            channel.patterns[pattern].reset();
          }
        }
        channel.patterns.length = this.patternsPerChannel;

        for (
          let instrument: number = 0;
          instrument < Config.instrumentCountMin;
          instrument++
        ) {
          if (channel.instruments.length <= instrument) {
            channel.instruments[instrument] = new Instrument(isNoiseChannel);
          }
          channel.instruments[instrument].setTypeAndReset(
            isNoiseChannel ? InstrumentType.noise : InstrumentType.chip,
            isNoiseChannel,
          );
        }
        channel.instruments.length = Config.instrumentCountMin;

        for (let bar: number = 0; bar < this.barCount; bar++) {
          channel.bars[bar] = 0;
        }
        channel.bars.length = this.barCount;
      }
      this.channels.length = this.getChannelCount();
    }
  }

  private _configureAssets(sources: readonly string[]): void {
    this.assets.length = 0;
    const maximumAssets: number = Math.max(0, 64 - Config.assetChipWaveStart);
    let sampleCount: number = 0;
    for (const source of sources) {
      const sample: AssetDefinition | null = parseAssetDefinition(source);
      if (sample == null) continue;
      if (sample.type == "sample") {
        if (sampleCount >= maximumAssets) continue;
        sampleCount++;
      }
      this.assets.push(sample);
    }
    Config.configureAssets(this.assets);
  }

  public toBinary(): Uint8Array {
    return encodeSongBinary(this._toCompactBinaryValue());
  }

  public toBinaryObject(): Object {
    const channelArray: Object[] = [];
    for (
      let channelIndex: number = 0;
      channelIndex < this.getChannelCount();
      channelIndex++
    ) {
      const channel: Channel = this.channels[channelIndex];
      const instrumentArray: Object[] = channel.instruments.map(
        (instrument: Instrument): Object => instrument.toBinaryState(),
      );
      const patternArray: Object[] = [];
      for (const pattern of channel.patterns)
        patternArray.push(pattern.toBinaryObject());
      channelArray.push({
        octave: channel.octave,
        instruments: instrumentArray,
        patterns: patternArray,
        bars: channel.bars.concat(),
      });
    }

    return {
      scale: this.scale,
      key: this.key,
      composingKey: this.composingKey,
      tempo: this.tempo,
      beatsPerBar: this.beatsPerBar,
      barCount: this.barCount,
      patternsPerChannel: this.patternsPerChannel,
      rhythm: this.rhythm,
      loopStart: this.loopStart,
      loopLength: this.loopLength,
      pitchChannelCount: this.pitchChannelCount,
      noiseChannelCount: this.noiseChannelCount,
      assets: this.assets.map((asset: AssetDefinition): string => asset.source),
      channels: channelArray,
    };
  }

  private static _binaryValuesEqual(left: any, right: any): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || left.length != right.length) return false;
      for (let i: number = 0; i < left.length; i++) {
        if (!Song._binaryValuesEqual(left[i], right[i])) return false;
      }
      return true;
    }
    if (
      left != null &&
      right != null &&
      typeof left == "object" &&
      typeof right == "object"
    ) {
      const leftKeys: string[] = Object.keys(left);
      const rightKeys: string[] = Object.keys(right);
      if (leftKeys.length != rightKeys.length) return false;
      for (const key of leftKeys) {
        if (
          !Object.prototype.hasOwnProperty.call(right, key) ||
          !Song._binaryValuesEqual(left[key], right[key])
        )
          return false;
      }
      return true;
    }
    return false;
  }

  // BeepBox keeps links short by bit-packing the repetitive pattern data instead of
  // serializing each note field independently. Keep instrument state positional too,
  // then let SongBinary apply the shared DEFLATE layer used by files and URLs.
  private _toCompactBinaryValue(): unknown[] {
    const defaultInstrumentStates: Map<string, any> = new Map();
    const assetSources: string[] = this.assets.map(
      (asset: AssetDefinition): string => asset.source,
    );
    const channels: unknown[] = [];
    const barBits: CompactBitWriter = new CompactBitWriter();
    const patternBits: CompactBitWriter = new CompactBitWriter();
    const shapeBits: CompactBitWriter = new CompactBitWriter();
    const barBitCount: number = Song.getNeededBits(this.patternsPerChannel);
    const noteSizeCounts: number[] = Array(Config.noteSizeMax + 1).fill(0);
    let integerNoteSizeCount: number = 0;
    let fractionalNoteSizeCount: number = 0;
    const durationDivisors: readonly number[] = [1, 2, 3, 4, 6, 8, 12];
    const durationCounts: Map<number, number> = new Map();
    for (const channel of this.channels) {
      const recentShapeKeys: string[] = [];
      for (const pattern of channel.patterns) {
        let currentPart: number = 0;
        for (const note of pattern.notes) {
          if (note.start > currentPart)
            durationCounts.set(
              note.start - currentPart,
              (durationCounts.get(note.start - currentPart) || 0) + 1,
            );
          const shapeValues: unknown[] = [
            note.pitches.length,
            note.pins.length - 1,
            note.pins[0].size,
          ];
          const shapeDurations: number[] = [];
          let pinTime: number = 0;
          let currentPitch: number = note.pitches[0];
          for (
            let pinIndex: number = 1;
            pinIndex < note.pins.length;
            pinIndex++
          ) {
            const pin: NotePin = note.pins[pinIndex];
            const nextPitch: number = note.pitches[0] + pin.interval;
            const duration: number = pin.time - pinTime;
            shapeValues.push(
              currentPitch == nextPitch ? 0 : 1,
              duration,
              pin.size,
            );
            shapeDurations.push(duration);
            currentPitch = nextPitch;
            pinTime = pin.time;
          }
          const shapeKey: string = JSON.stringify(shapeValues);
          const shapeIndex: number = recentShapeKeys.indexOf(shapeKey);
          if (shapeIndex == -1) {
            for (const duration of shapeDurations)
              durationCounts.set(
                duration,
                (durationCounts.get(duration) || 0) + 1,
              );
            for (const pin of note.pins) {
              if (Number.isInteger(pin.size)) {
                noteSizeCounts[pin.size]++;
                integerNoteSizeCount++;
              } else {
                fractionalNoteSizeCount++;
              }
            }
          } else {
            recentShapeKeys.splice(shapeIndex, 1);
          }
          recentShapeKeys.unshift(shapeKey);
          if (recentShapeKeys.length > 10) recentShapeKeys.pop();
          currentPart = note.end;
        }
        const partsPerBar: number = this.beatsPerBar * Config.partsPerBeat;
        if (currentPart < partsPerBar && pattern.notes.length > 0)
          durationCounts.set(
            partsPerBar - currentPart,
            (durationCounts.get(partsPerBar - currentPart) || 0) + 1,
          );
      }
    }
    let commonNoteSize: number = 0;
    for (let size: number = 1; size < noteSizeCounts.length; size++)
      if (noteSizeCounts[size] > noteSizeCounts[commonNoteSize])
        commonNoteSize = size;
    const commonCount: number = noteSizeCounts[commonNoteSize];
    const fixedSizeBits: number =
      1 + integerNoteSizeCount * 4 + fractionalNoteSizeCount * 68;
    const commonSizeBits: number =
      5 +
      commonCount +
      (integerNoteSizeCount - commonCount) * 5 +
      fractionalNoteSizeCount * 69;
    const useCommonNoteSize: boolean =
      integerNoteSizeCount > 0 && commonSizeBits < fixedSizeBits;
    let huffmanNoteSizeBits: number = fractionalNoteSizeCount * 71;
    for (let size: number = 0; size < noteSizeCounts.length; size++) {
      const bitCount: number =
        size == 8 || size == 7
          ? 2
          : size == 9 || size == 6
            ? 3
            : size == 5 || size == 10
              ? 4
              : 7;
      huffmanNoteSizeBits += noteSizeCounts[size] * bitCount;
    }
    const useHuffmanNoteSize: boolean =
      huffmanNoteSizeBits <
      (useCommonNoteSize ? commonSizeBits : fixedSizeBits);

    const longTailBitCount = (
      minimum: number,
      minBits: number,
      value: number,
    ): number => {
      value -= minimum;
      let bitCount: number = minBits;
      let result: number = 1 + bitCount;
      while (value >= Math.pow(2, bitCount)) {
        value -= Math.pow(2, bitCount++);
        result += 2;
      }
      return result;
    };
    let durationDivisorIndex: number = 0;
    let durationMinBits: number = 0;
    let bestDurationBits: number = Number.POSITIVE_INFINITY;
    for (
      let divisorIndex: number = 0;
      divisorIndex < durationDivisors.length;
      divisorIndex++
    ) {
      const divisor: number = durationDivisors[divisorIndex];
      for (let minBits: number = 0; minBits <= 4; minBits++) {
        let bits: number = 0;
        for (const [duration, count] of durationCounts) {
          const encodedBits: number =
            divisor > 1 && duration % divisor == 0
              ? 1 + longTailBitCount(1, minBits, duration / divisor)
              : (divisor > 1 ? 1 : 0) + longTailBitCount(1, 3, duration);
          bits += encodedBits * count;
        }
        if (bits < bestDurationBits) {
          bestDurationBits = bits;
          durationDivisorIndex = divisorIndex;
          durationMinBits = minBits;
        }
      }
    }
    const durationDivisor: number = durationDivisors[durationDivisorIndex];
    patternBits.write(3, durationDivisorIndex);
    patternBits.write(3, durationMinBits);
    patternBits.write(1, useHuffmanNoteSize ? 1 : 0);
    if (!useHuffmanNoteSize) {
      patternBits.write(1, useCommonNoteSize ? 1 : 0);
      if (useCommonNoteSize) patternBits.write(4, commonNoteSize);
    }

    for (
      let channelIndex: number = 0;
      channelIndex < this.getChannelCount();
      channelIndex++
    ) {
      const channel: Channel = this.channels[channelIndex];
      const isNoiseChannel: boolean = this.getChannelIsNoise(channelIndex);
      const instruments: unknown[] = [];
      for (const instrument of channel.instruments) {
        const state: any = instrument.toBinaryState();
        for (const key of Object.keys(state)) {
          if (key == "type" || key == "preset" || key == "effects") continue;
          if (!compactInstrumentFieldSet.has(key))
            throw new Error(
              `Compact song codec is missing instrument field: ${key}.`,
            );
        }

        const defaultsKey: string = `${isNoiseChannel ? 1 : 0}:${instrument.type}`;
        let defaultState: any = defaultInstrumentStates.get(defaultsKey);
        if (defaultState == undefined) {
          const defaultInstrument: Instrument = new Instrument(isNoiseChannel);
          defaultInstrument.setTypeAndReset(instrument.type, isNoiseChannel);
          defaultState = defaultInstrument.toBinaryState();
          defaultInstrumentStates.set(defaultsKey, defaultState);
        }

        let lowMask: number = 0;
        let highMask: number = 0;
        const values: unknown[] = [];
        for (
          let fieldIndex: number = 0;
          fieldIndex < compactInstrumentFields.length;
          fieldIndex++
        ) {
          const field: string = compactInstrumentFields[fieldIndex];
          if (Song._binaryValuesEqual(state[field], defaultState[field]))
            continue;
          if (fieldIndex < compactInstrumentLowFieldCount) {
            lowMask += Math.pow(2, fieldIndex);
          } else {
            highMask += Math.pow(
              2,
              fieldIndex - compactInstrumentLowFieldCount,
            );
          }
          const fieldValue: unknown = state[field];
          if (
            field == "soundFontId" &&
            typeof fieldValue == "string" &&
            fieldValue.startsWith("asset:")
          ) {
            const assetIndex: number = assetSources.indexOf(
              fieldValue.slice("asset:".length),
            );
            values.push(assetIndex >= 0 ? assetIndex : fieldValue);
          } else {
            values.push(fieldValue);
          }
        }
        const compactInstrument: unknown[] = [
          state.type,
          state.preset,
          state.effects,
          lowMask,
          highMask,
          ...values,
        ];
        instruments.push(compactInstrument);
      }
      channels.push([channel.octave, instruments]);

      for (const bar of channel.bars) barBits.write(barBitCount, bar);

      const octaveOffset: number = isNoiseChannel
        ? 0
        : channel.octave * Config.pitchesPerOctave;
      let lastPitch: number = isNoiseChannel ? 4 : octaveOffset;
      const recentPitches: number[] = isNoiseChannel
        ? [4, 6, 7, 2, 3, 8, 0, 10]
        : [0, 7, 12, 19, 24, -5, -12];
      const recentShapes: string[] = [];
      for (let index: number = 0; index < recentPitches.length; index++)
        recentPitches[index] += octaveOffset;

      for (const pattern of channel.patterns) {
        if (pattern.notes.length == 0) {
          patternBits.write(1, 0);
          continue;
        }
        patternBits.write(1, 1);
        let currentPart: number = 0;
        for (const note of pattern.notes) {
          if (note.start > currentPart) {
            patternBits.writeShapeToken(-2); // rest
            patternBits.writePartDuration(
              note.start - currentPart,
              durationDivisor,
              durationMinBits,
            );
          }

          shapeBits.clear();
          for (
            let pitchIndex: number = 1;
            pitchIndex < note.pitches.length;
            pitchIndex++
          )
            shapeBits.write(1, 1);
          shapeBits.write(1, 0);
          shapeBits.writePinCount(note.pins.length - 1);
          shapeBits.writeNoteSize(
            note.pins[0].size,
            useCommonNoteSize ? commonNoteSize : null,
            useHuffmanNoteSize,
          );

          let shapePart: number = 0;
          const startPitch: number = note.pitches[0];
          let currentPitch: number = startPitch;
          const pitchBends: number[] = [];
          for (
            let pinIndex: number = 1;
            pinIndex < note.pins.length;
            pinIndex++
          ) {
            const pin: NotePin = note.pins[pinIndex];
            const nextPitch: number = startPitch + pin.interval;
            if (currentPitch != nextPitch) {
              shapeBits.write(1, 1);
              pitchBends.push(nextPitch);
              currentPitch = nextPitch;
            } else {
              shapeBits.write(1, 0);
            }
            shapeBits.writePartDuration(
              pin.time - shapePart,
              durationDivisor,
              durationMinBits,
            );
            shapePart = pin.time;
            shapeBits.writeNoteSize(
              pin.size,
              useCommonNoteSize ? commonNoteSize : null,
              useHuffmanNoteSize,
            );
          }

          const shapeKey: string = shapeBits.key();
          const shapeIndex: number = recentShapes.indexOf(shapeKey);
          patternBits.writeShapeToken(shapeIndex);
          if (shapeIndex == -1) {
            patternBits.concat(shapeBits);
          } else {
            recentShapes.splice(shapeIndex, 1);
          }
          recentShapes.unshift(shapeKey);
          if (recentShapes.length > 10) recentShapes.pop();

          const allPitches: number[] = note.pitches.concat(pitchBends);
          for (
            let pitchIndex: number = 0;
            pitchIndex < allPitches.length;
            pitchIndex++
          ) {
            const pitch: number = allPitches[pitchIndex];
            const recentPitchIndex: number = recentPitches.indexOf(pitch);
            patternBits.writePitchToken(recentPitchIndex);
            if (recentPitchIndex == -1) {
              let interval: number = 0;
              let pitchIterator: number = lastPitch;
              if (pitchIterator < pitch) {
                while (pitchIterator != pitch) {
                  pitchIterator++;
                  if (recentPitches.indexOf(pitchIterator) == -1) interval++;
                }
              } else {
                while (pitchIterator != pitch) {
                  pitchIterator--;
                  if (recentPitches.indexOf(pitchIterator) == -1) interval--;
                }
              }
              patternBits.writePitchInterval(interval);
            } else {
              recentPitches.splice(recentPitchIndex, 1);
            }
            recentPitches.unshift(pitch);
            if (recentPitches.length > 8) recentPitches.pop();
            lastPitch =
              pitchIndex == note.pitches.length - 1 ? note.pitches[0] : pitch;
          }

          if (note.start == 0)
            patternBits.write(1, note.continuesLastPattern ? 1 : 0);
          currentPart = note.end;
        }
        const partsPerBar: number = this.beatsPerBar * Config.partsPerBeat;
        if (currentPart < partsPerBar) {
          patternBits.writeShapeToken(-2);
          patternBits.writePartDuration(
            partsPerBar - currentPart,
            durationDivisor,
            durationMinBits,
          );
        }
      }
    }

    return [
      compactSongValueVersion,
      this.scale,
      this.key,
      this.composingKey,
      this.tempo,
      this.beatsPerBar,
      this.barCount,
      this.patternsPerChannel,
      this.rhythm,
      this.loopStart,
      this.loopLength,
      this.pitchChannelCount,
      this.noiseChannelCount,
      assetSources,
      channels,
      barBits.finish(),
      patternBits.finish(),
    ];
  }

  private static _expandCompactInstruments(
    compactInstruments: unknown,
    assets: unknown,
  ): Object[] {
    if (!Array.isArray(compactInstruments))
      throw new Error("Invalid compact .goop instrument data.");
    const highFieldCount: number =
      compactInstrumentFields.length - compactInstrumentLowFieldCount;
    const maximumLowMask: number =
      Math.pow(2, compactInstrumentLowFieldCount) - 1;
    const maximumHighMask: number = Math.pow(2, highFieldCount) - 1;
    return compactInstruments.map((compactInstrument: unknown): Object => {
      if (!Array.isArray(compactInstrument) || compactInstrument.length < 5)
        throw new Error("Invalid compact .goop instrument data.");
      const lowMask: unknown = compactInstrument[3];
      const highMask: unknown = compactInstrument[4];
      if (
        typeof lowMask != "number" ||
        !Number.isSafeInteger(lowMask) ||
        lowMask < 0 ||
        lowMask > maximumLowMask ||
        typeof highMask != "number" ||
        !Number.isSafeInteger(highMask) ||
        highMask < 0 ||
        highMask > maximumHighMask
      ) {
        throw new Error("Invalid compact .goop instrument mask.");
      }
      const state: any = {
        type: compactInstrument[0],
        preset: compactInstrument[1],
        effects: compactInstrument[2],
      };
      let valueIndex: number = 5;
      for (
        let fieldIndex: number = 0;
        fieldIndex < compactInstrumentFields.length;
        fieldIndex++
      ) {
        const mask: number =
          fieldIndex < compactInstrumentLowFieldCount ? lowMask : highMask;
        const bitIndex: number =
          fieldIndex < compactInstrumentLowFieldCount
            ? fieldIndex
            : fieldIndex - compactInstrumentLowFieldCount;
        if (Math.floor(mask / Math.pow(2, bitIndex)) % 2 == 0) continue;
        if (valueIndex >= compactInstrument.length)
          throw new Error("Truncated compact .goop instrument data.");
        const field: string = compactInstrumentFields[fieldIndex];
        const fieldValue: unknown = compactInstrument[valueIndex++];
        if (field == "soundFontId" && typeof fieldValue == "number") {
          if (
            !Number.isInteger(fieldValue) ||
            fieldValue < 0 ||
            !Array.isArray(assets) ||
            fieldValue >= assets.length ||
            typeof assets[fieldValue] != "string"
          ) {
            throw new Error("Invalid compact .goop SoundFont asset reference.");
          }
          state[field] = `asset:${assets[fieldValue]}`;
        } else {
          state[field] = fieldValue;
        }
      }
      if (valueIndex != compactInstrument.length)
        throw new Error("Invalid compact .goop instrument length.");
      return state;
    });
  }

  private static _decodeCompactBars(
    bytes: Uint8Array,
    channelCount: number,
    barCount: number,
    patternsPerChannel: number,
  ): number[][] {
    const reader: CompactBitReader = new CompactBitReader(bytes);
    const bitCount: number = Song.getNeededBits(patternsPerChannel);
    const channels: number[][] = [];
    for (
      let channelIndex: number = 0;
      channelIndex < channelCount;
      channelIndex++
    ) {
      const bars: number[] = [];
      for (let bar: number = 0; bar < barCount; bar++) {
        const pattern: number = reader.read(bitCount);
        if (pattern > patternsPerChannel)
          throw new Error("Invalid compact .goop bar pattern.");
        bars.push(pattern);
      }
      channels.push(bars);
    }
    reader.assertCanonicalPadding();
    return channels;
  }

  private static _decodeCompactPatterns(
    bytes: Uint8Array,
    compactChannels: unknown[],
    pitchChannelCount: number,
    beatsPerBar: number,
    patternsPerChannel: number,
  ): Object[][] {
    const reader: CompactBitReader = new CompactBitReader(bytes);
    const decodedChannels: Object[][] = [];
    const partsPerBar: number = beatsPerBar * Config.partsPerBeat;
    const durationDivisors: readonly number[] = [1, 2, 3, 4, 6, 8, 12];
    const durationDivisorIndex: number = reader.read(3);
    if (durationDivisorIndex >= durationDivisors.length)
      throw new Error("Invalid compact .goop duration divisor.");
    const durationDivisor: number = durationDivisors[durationDivisorIndex];
    const durationMinBits: number = reader.read(3);
    if (durationMinBits > 4)
      throw new Error("Invalid compact .goop duration bit count.");
    const useHuffmanNoteSize: boolean = reader.read(1) != 0;
    const commonNoteSize: number | null = useHuffmanNoteSize
      ? null
      : reader.read(1) != 0
        ? reader.read(4)
        : null;
    if (commonNoteSize != null && commonNoteSize > Config.noteSizeMax)
      throw new Error("Invalid compact .goop common note size.");
    for (
      let channelIndex: number = 0;
      channelIndex < compactChannels.length;
      channelIndex++
    ) {
      const compactChannel: unknown = compactChannels[channelIndex];
      if (!Array.isArray(compactChannel) || compactChannel.length != 2)
        throw new Error("Invalid compact .goop channel data.");
      const octave: unknown = compactChannel[0];
      if (
        typeof octave != "number" ||
        !Number.isInteger(octave) ||
        octave < 0 ||
        octave >= Config.pitchOctaves
      )
        throw new Error("Invalid compact .goop channel octave.");
      const isNoiseChannel: boolean = channelIndex >= pitchChannelCount;
      const octaveOffset: number = isNoiseChannel
        ? 0
        : octave * Config.pitchesPerOctave;
      const maximumPitch: number = isNoiseChannel
        ? Config.drumCount - 1
        : Config.maxPitch;
      let lastPitch: number = isNoiseChannel ? 4 : octaveOffset;
      const recentPitches: number[] = isNoiseChannel
        ? [4, 6, 7, 2, 3, 8, 0, 10]
        : [0, 7, 12, 19, 24, -5, -12];
      const recentShapes: any[] = [];
      for (let index: number = 0; index < recentPitches.length; index++)
        recentPitches[index] += octaveOffset;
      const patterns: Object[] = [];

      for (
        let patternIndex: number = 0;
        patternIndex < patternsPerChannel;
        patternIndex++
      ) {
        const notes: Object[] = [];
        if (reader.read(1) == 0) {
          patterns.push({ notes: notes });
          continue;
        }
        let currentPart: number = 0;
        while (currentPart < partsPerBar) {
          const shapeToken: number = reader.readShapeToken();
          let shape: any = null;
          if (shapeToken >= 0) {
            if (shapeToken >= recentShapes.length)
              throw new Error("Invalid compact .goop note shape.");
            shape = recentShapes[shapeToken];
            recentShapes.splice(shapeToken, 1);
          } else if (shapeToken == -2) {
            currentPart += reader.readPartDuration(
              durationDivisor,
              durationMinBits,
            );
            if (currentPart > partsPerBar)
              throw new Error("Invalid compact .goop note timing.");
            continue;
          } else {
            shape = {
              pitchCount: 1,
              pinCount: 0,
              initialSize: 0,
              pins: [],
              length: 0,
              bendCount: 0,
            };
            while (reader.read(1) != 0) {
              shape.pitchCount++;
              if (shape.pitchCount > Config.maxChordSize)
                throw new Error("Invalid compact .goop chord size.");
            }
            shape.pinCount = reader.readPinCount();
            if (shape.pinCount > partsPerBar)
              throw new Error("Invalid compact .goop pin count.");
            shape.initialSize = reader.readNoteSize(
              commonNoteSize,
              useHuffmanNoteSize,
            );
            for (
              let pinIndex: number = 0;
              pinIndex < shape.pinCount;
              pinIndex++
            ) {
              const pitchBend: boolean = reader.read(1) != 0;
              if (pitchBend) shape.bendCount++;
              shape.length += reader.readPartDuration(
                durationDivisor,
                durationMinBits,
              );
              if (shape.length > partsPerBar)
                throw new Error("Invalid compact .goop note timing.");
              shape.pins.push({
                pitchBend: pitchBend,
                time: shape.length,
                size: reader.readNoteSize(commonNoteSize, useHuffmanNoteSize),
              });
            }
          }

          recentShapes.unshift(shape);
          if (recentShapes.length > 10) recentShapes.pop();
          const pitches: number[] = [];
          const pitchBends: number[] = [];
          const totalPitchCount: number = shape.pitchCount + shape.bendCount;
          if (totalPitchCount > Config.maxChordSize + partsPerBar)
            throw new Error("Invalid compact .goop pitch count.");
          for (
            let pitchIndex: number = 0;
            pitchIndex < totalPitchCount;
            pitchIndex++
          ) {
            let pitch: number;
            const recentPitchIndex: number = reader.readPitchToken();
            if (recentPitchIndex < 0) {
              const interval: number = reader.readPitchInterval(1);
              if (Math.abs(interval) > maximumPitch + recentPitches.length + 1)
                throw new Error("Invalid compact .goop pitch interval.");
              pitch = lastPitch;
              let intervalIterator: number = interval;
              while (intervalIterator > 0) {
                pitch++;
                while (recentPitches.indexOf(pitch) != -1) pitch++;
                intervalIterator--;
              }
              while (intervalIterator < 0) {
                pitch--;
                while (recentPitches.indexOf(pitch) != -1) pitch--;
                intervalIterator++;
              }
            } else {
              if (recentPitchIndex >= recentPitches.length)
                throw new Error("Invalid compact .goop recent pitch.");
              pitch = recentPitches[recentPitchIndex];
              recentPitches.splice(recentPitchIndex, 1);
            }
            recentPitches.unshift(pitch);
            if (recentPitches.length > 8) recentPitches.pop();
            if (pitchIndex < shape.pitchCount) pitches.push(pitch);
            else pitchBends.push(pitch);
            lastPitch = pitchIndex == shape.pitchCount - 1 ? pitches[0] : pitch;
          }
          if (pitches.length == 0)
            throw new Error("Invalid compact .goop note pitch.");
          pitchBends.unshift(pitches[0]);
          const pins: Object[] = [
            { interval: 0, time: 0, size: shape.initialSize },
          ];
          for (const shapePin of shape.pins) {
            if (shapePin.pitchBend) pitchBends.shift();
            if (pitchBends.length == 0)
              throw new Error("Invalid compact .goop pitch bend.");
            pins.push({
              interval: pitchBends[0] - pitches[0],
              time: shapePin.time,
              size: shapePin.size,
            });
          }
          const continuesLastPattern: boolean =
            currentPart == 0 ? reader.read(1) != 0 : false;
          notes.push({
            pitches: pitches,
            pins: pins,
            start: currentPart,
            continuesLastPattern: continuesLastPattern,
          });
          currentPart += shape.length;
          if (currentPart > partsPerBar)
            throw new Error("Invalid compact .goop note timing.");
        }
        patterns.push({ notes: notes });
      }
      decodedChannels.push(patterns);
    }
    reader.assertCanonicalPadding();
    return decodedChannels;
  }

  private static _expandCompactBinaryValue(value: unknown): Object {
    if (
      !Array.isArray(value) ||
      value.length != 17 ||
      value[0] != compactSongValueVersion
    )
      throw new Error("Invalid compact .goop song data.");
    const compactChannels: unknown = value[14];
    const barData: unknown = value[15];
    const patternData: unknown = value[16];
    if (
      !Array.isArray(compactChannels) ||
      !(barData instanceof Uint8Array) ||
      !(patternData instanceof Uint8Array)
    )
      throw new Error("Invalid compact .goop channel data.");
    const compactInteger = (
      candidate: unknown,
      minimum: number,
      maximum: number,
      name: string,
    ): number => {
      if (
        typeof candidate != "number" ||
        !Number.isInteger(candidate) ||
        candidate < minimum ||
        candidate > maximum
      )
        throw new Error(`Invalid compact .goop ${name}.`);
      return candidate;
    };
    const beatsPerBar: number = compactInteger(
      value[5],
      Config.beatsPerBarMin,
      Config.beatsPerBarMax,
      "beats per bar",
    );
    const barCount: number = compactInteger(
      value[6],
      Config.barCountMin,
      Config.barCountMax,
      "bar count",
    );
    const patternsPerChannel: number = compactInteger(
      value[7],
      1,
      Config.barCountMax,
      "pattern count",
    );
    const pitchChannelCount: number = compactInteger(
      value[11],
      Config.pitchChannelCountMin,
      Config.pitchChannelCountMax,
      "pitch channel count",
    );
    const noiseChannelCount: number = compactInteger(
      value[12],
      Config.noiseChannelCountMin,
      Config.noiseChannelCountMax,
      "noise channel count",
    );
    const channelCount: number = pitchChannelCount + noiseChannelCount;
    if (compactChannels.length != channelCount)
      throw new Error("Invalid compact .goop channel count.");
    const bars: number[][] = Song._decodeCompactBars(
      barData,
      channelCount,
      barCount,
      patternsPerChannel,
    );
    const patterns: Object[][] = Song._decodeCompactPatterns(
      patternData,
      compactChannels,
      pitchChannelCount,
      beatsPerBar,
      patternsPerChannel,
    );
    const channels: Object[] = compactChannels.map(
      (compactChannel: unknown, channelIndex: number): Object => {
        if (!Array.isArray(compactChannel) || compactChannel.length != 2)
          throw new Error("Invalid compact .goop channel data.");
        return {
          octave: compactChannel[0],
          instruments: Song._expandCompactInstruments(
            compactChannel[1],
            value[13],
          ),
          patterns: patterns[channelIndex],
          bars: bars[channelIndex],
        };
      },
    );
    return {
      scale: value[1],
      key: value[2],
      composingKey: value[3],
      tempo: value[4],
      beatsPerBar: beatsPerBar,
      barCount: barCount,
      patternsPerChannel: patternsPerChannel,
      rhythm: value[8],
      loopStart: value[9],
      loopLength: value[10],
      pitchChannelCount: pitchChannelCount,
      noiseChannelCount: noiseChannelCount,
      assets: value[13],
      channels: channels,
    };
  }

  public fromBinary(data: Uint8Array): void {
    // Parse into a disposable song so a late error cannot leave the currently
    // open song half reset and half imported.
    const previousChipWaves = Config.chipWaves;
    try {
      const decodedSong: unknown = decodeSongBinary(data);
      const songObject: unknown = Array.isArray(decodedSong)
        ? Song._expandCompactBinaryValue(decodedSong)
        : decodedSong;
      if (
        songObject == null ||
        typeof songObject != "object" ||
        Array.isArray(songObject)
      )
        throw new Error("Invalid .goop song data.");
      const parsedSong: Song = new Song();
      parsedSong._parseBinaryObject(songObject);
      this._replaceWith(parsedSong);
    } catch (error) {
      // Config's asset-backed chip waves are global. Creating and parsing the
      // temporary song updates them, so restore the prior configuration too.
      Config.chipWaves = previousChipWaves;
      throw error;
    }
  }

  private _replaceWith(song: Song): void {
    this.scale = song.scale;
    this.key = song.key;
    this.composingKey = song.composingKey;
    this.tempo = song.tempo;
    this.beatsPerBar = song.beatsPerBar;
    this.barCount = song.barCount;
    this.patternsPerChannel = song.patternsPerChannel;
    this.rhythm = song.rhythm;
    this.loopStart = song.loopStart;
    this.loopLength = song.loopLength;
    this.pitchChannelCount = song.pitchChannelCount;
    this.noiseChannelCount = song.noiseChannelCount;
    this.assets.splice(0, this.assets.length, ...song.assets);
    this.channels.splice(0, this.channels.length, ...song.channels);
  }

  private _parseBinaryObject(songObject: any): void {
    const integer = (
      name: string,
      minimum: number,
      maximum: number,
    ): number => {
      const value: unknown = songObject[name];
      if (
        typeof value != "number" ||
        !Number.isInteger(value) ||
        value < minimum ||
        value > maximum
      ) {
        throw new Error(`Invalid .goop ${name}.`);
      }
      return value;
    };
    if (
      !Array.isArray(songObject.assets) ||
      songObject.assets.length > maximumSongAssetCount ||
      !songObject.assets.every(
        (source: unknown): source is string =>
          typeof source == "string" &&
          source.length <= maximumAssetSourceLength,
      )
    ) {
      throw new Error("Invalid .goop assets.");
    }
    const maximumSamples: number = Math.max(0, 64 - Config.assetChipWaveStart);
    let sampleCount: number = 0;
    for (const source of songObject.assets) {
      const asset: AssetDefinition | null = parseAssetDefinition(source);
      if (
        asset == null ||
        asset.source != source ||
        (asset.type == "sample" && ++sampleCount > maximumSamples)
      ) {
        throw new Error("Invalid .goop assets.");
      }
    }

    this.scale = integer("scale", 0, Config.scales.length - 1);
    this.key = integer("key", 0, Config.keys.length - 1);
    this.composingKey = integer("composingKey", 0, Config.keys.length - 1);
    this.tempo = integer("tempo", Config.tempoMin, Config.tempoMax);
    this.beatsPerBar = integer(
      "beatsPerBar",
      Config.beatsPerBarMin,
      Config.beatsPerBarMax,
    );
    this.barCount = integer("barCount", Config.barCountMin, Config.barCountMax);
    this.patternsPerChannel = integer(
      "patternsPerChannel",
      1,
      Config.barCountMax,
    );
    this.rhythm = integer("rhythm", 0, Config.rhythms.length - 1);
    this.loopStart = integer("loopStart", 0, this.barCount - 1);
    this.loopLength = integer("loopLength", 1, this.barCount - this.loopStart);
    this.pitchChannelCount = integer(
      "pitchChannelCount",
      Config.pitchChannelCountMin,
      Config.pitchChannelCountMax,
    );
    this.noiseChannelCount = integer(
      "noiseChannelCount",
      Config.noiseChannelCountMin,
      Config.noiseChannelCountMax,
    );
    if (
      !Array.isArray(songObject.channels) ||
      songObject.channels.length != this.getChannelCount()
    ) {
      throw new Error("Invalid .goop channel or instrument structure.");
    }

    this._configureAssets(songObject.assets);
    this.channels.length = 0;
    for (
      let channelIndex: number = 0;
      channelIndex < songObject.channels.length;
      channelIndex++
    ) {
      const channelObject: any = songObject.channels[channelIndex];
      if (
        channelObject == null ||
        typeof channelObject != "object" ||
        Array.isArray(channelObject) ||
        !Array.isArray(channelObject.instruments) ||
        channelObject.instruments.length < Config.instrumentCountMin ||
        channelObject.instruments.length > Config.instrumentCountMax ||
        !Array.isArray(channelObject.patterns) ||
        channelObject.patterns.length != this.patternsPerChannel ||
        !Array.isArray(channelObject.bars) ||
        channelObject.bars.length != this.barCount
      ) {
        throw new Error("Invalid .goop channel or instrument structure.");
      }
      const isNoiseChannel: boolean = channelIndex >= this.pitchChannelCount;
      const octave: unknown = channelObject.octave;
      if (
        typeof octave != "number" ||
        !Number.isInteger(octave) ||
        octave < 0 ||
        octave >= Config.pitchOctaves ||
        (isNoiseChannel && octave != 0)
      ) {
        throw new Error("Invalid .goop channel octave.");
      }

      const channel: Channel = new Channel();
      channel.octave = octave;
      for (const instrumentState of channelObject.instruments) {
        if (
          instrumentState == null ||
          typeof instrumentState != "object" ||
          Array.isArray(instrumentState) ||
          typeof instrumentState.type != "number" ||
          !Number.isInteger(instrumentState.type) ||
          instrumentState.type < 0 ||
          instrumentState.type >= Config.instrumentTypeNames.length ||
          typeof instrumentState.preset != "number" ||
          !Number.isInteger(instrumentState.preset) ||
          instrumentState.preset < 0 ||
          instrumentState.preset > 0xffffffff ||
          typeof instrumentState.effects != "number" ||
          !Number.isInteger(instrumentState.effects)
        ) {
          throw new Error("Invalid .goop instrument.");
        }
        const instrument: Instrument = new Instrument(isNoiseChannel);
        instrument.setTypeAndReset(instrumentState.type, isNoiseChannel);
        instrument.preset = instrumentState.preset;
        instrument.effects = instrumentState.effects;
        const expandedState: any = instrument.toBinaryState();
        for (const key of Object.keys(instrumentState))
          expandedState[key] = instrumentState[key];
        instrument.fromBinaryState(expandedState);
        channel.instruments.push(instrument);
      }
      for (const patternObject of channelObject.patterns) {
        const pattern: Pattern = new Pattern();
        pattern.fromBinaryObject(patternObject, this, isNoiseChannel);
        channel.patterns.push(pattern);
      }
      for (const bar of channelObject.bars) {
        if (
          typeof bar != "number" ||
          !Number.isInteger(bar) ||
          bar < 0 ||
          bar > this.patternsPerChannel
        ) {
          throw new Error("Invalid .goop bar pattern.");
        }
        channel.bars.push(bar);
      }
      this.channels.push(channel);
    }
  }

  public getPattern(channelIndex: number, bar: number): Pattern | null {
    if (bar < 0 || bar >= this.barCount) return null;
    const patternIndex: number = this.channels[channelIndex].bars[bar];
    if (patternIndex == 0) return null;
    return this.channels[channelIndex].patterns[patternIndex - 1];
  }

  public getBeatsPerMinute(): number {
    return this.tempo;
  }

  public static getNeededBits(maxValue: number): number {
    return 32 - Math.clz32(Math.ceil(maxValue + 1) - 1);
  }
}

class PickedString {
  public delayLine: Float32Array | null = null;
  public delayIndex!: number;
  public allPassSample!: number;
  public allPassPrevInput!: number;
  public sustainFilterSample!: number;
  public sustainFilterPrevOutput2!: number;
  public sustainFilterPrevInput1!: number;
  public sustainFilterPrevInput2!: number;
  public fractionalDelaySample!: number;
  public prevDelayLength!: number;
  public delayLengthDelta!: number;
  public delayResetOffset!: number;

  public allPassG: number = 0.0;
  public allPassGDelta: number = 0.0;
  public sustainFilterA1: number = 0.0;
  public sustainFilterA1Delta: number = 0.0;
  public sustainFilterA2: number = 0.0;
  public sustainFilterA2Delta: number = 0.0;
  public sustainFilterB0: number = 0.0;
  public sustainFilterB0Delta: number = 0.0;
  public sustainFilterB1: number = 0.0;
  public sustainFilterB1Delta: number = 0.0;
  public sustainFilterB2: number = 0.0;
  public sustainFilterB2Delta: number = 0.0;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.delayIndex = -1;
    this.allPassSample = 0.0;
    this.allPassPrevInput = 0.0;
    this.sustainFilterSample = 0.0;
    this.sustainFilterPrevOutput2 = 0.0;
    this.sustainFilterPrevInput1 = 0.0;
    this.sustainFilterPrevInput2 = 0.0;
    this.fractionalDelaySample = 0.0;
    this.prevDelayLength = -1.0;
    this.delayResetOffset = 0;
  }

  public update(
    synth: Synth,
    instrumentState: InstrumentState,
    tone: Tone,
    stringIndex: number,
    roundedSamplesPerTick: number,
    stringDecayStart: number,
    stringDecayEnd: number,
    sustainType: SustainType,
  ): void {
    const allPassCenter: number =
      (2.0 * Math.PI * Config.pickedStringDispersionCenterFreq) /
      synth.samplesPerSecond;

    const prevDelayLength: number = this.prevDelayLength;

    const phaseDeltaStart: number = tone.phaseDeltas[stringIndex];
    const phaseDeltaScale: number = tone.phaseDeltaScales[stringIndex];
    const phaseDeltaEnd: number =
      phaseDeltaStart * Math.pow(phaseDeltaScale, roundedSamplesPerTick);

    const radiansPerSampleStart: number = Math.PI * 2.0 * phaseDeltaStart;
    const radiansPerSampleEnd: number = Math.PI * 2.0 * phaseDeltaEnd;

    const centerHarmonicStart: number = radiansPerSampleStart * 2.0;
    const centerHarmonicEnd: number = radiansPerSampleEnd * 2.0;

    const allPassRadiansStart: number = Math.min(
      Math.PI,
      radiansPerSampleStart *
        Config.pickedStringDispersionFreqMult *
        Math.pow(
          allPassCenter / radiansPerSampleStart,
          Config.pickedStringDispersionFreqScale,
        ),
    );
    const allPassRadiansEnd: number = Math.min(
      Math.PI,
      radiansPerSampleEnd *
        Config.pickedStringDispersionFreqMult *
        Math.pow(
          allPassCenter / radiansPerSampleEnd,
          Config.pickedStringDispersionFreqScale,
        ),
    );

    const shelfRadians: number =
      (2.0 * Math.PI * Config.pickedStringShelfHz) / synth.samplesPerSecond;
    const decayCurveStart: number =
      (Math.pow(100.0, stringDecayStart) - 1.0) / 99.0;
    const decayCurveEnd: number =
      (Math.pow(100.0, stringDecayEnd) - 1.0) / 99.0;
    const register: number = sustainType == SustainType.acoustic ? 0.25 : 0.0;
    const registerShelfCenter: number = 15.6;
    const registerLowpassCenter: number =
      (3.0 * synth.samplesPerSecond) / 48000;
    //const decayRateStart: number = Math.pow(0.5, decayCurveStart * shelfRadians / radiansPerSampleStart);
    //const decayRateEnd: number   = Math.pow(0.5, decayCurveEnd   * shelfRadians / radiansPerSampleEnd);
    const decayRateStart: number = Math.pow(
      0.5,
      decayCurveStart *
        Math.pow(
          shelfRadians / (radiansPerSampleStart * registerShelfCenter),
          1.0 + 2.0 * register,
        ) *
        registerShelfCenter,
    );
    const decayRateEnd: number = Math.pow(
      0.5,
      decayCurveEnd *
        Math.pow(
          shelfRadians / (radiansPerSampleEnd * registerShelfCenter),
          1.0 + 2.0 * register,
        ) *
        registerShelfCenter,
    );

    const expressionDecayStart: number = Math.pow(decayRateStart, 0.002);
    const expressionDecayEnd: number = Math.pow(decayRateEnd, 0.002);

    Synth.tempFilterStartCoefficients.allPass1stOrderInvertPhaseAbove(
      allPassRadiansStart,
    );
    synth.tempFrequencyResponse.analyze(
      Synth.tempFilterStartCoefficients,
      centerHarmonicStart,
    );
    const allPassGStart: number =
      Synth.tempFilterStartCoefficients.b[0]; /* same as a[1] */
    const allPassPhaseDelayStart: number =
      -synth.tempFrequencyResponse.angle() / centerHarmonicStart;

    Synth.tempFilterEndCoefficients.allPass1stOrderInvertPhaseAbove(
      allPassRadiansEnd,
    );
    synth.tempFrequencyResponse.analyze(
      Synth.tempFilterEndCoefficients,
      centerHarmonicEnd,
    );
    const allPassGEnd: number =
      Synth.tempFilterEndCoefficients.b[0]; /* same as a[1] */
    const allPassPhaseDelayEnd: number =
      -synth.tempFrequencyResponse.angle() / centerHarmonicEnd;

    // 1st order shelf filters and 2nd order lowpass filters have differently shaped frequency
    // responses, as well as adjustable shapes. I originally picked a 1st order shelf filter,
    // but I kinda prefer 2nd order lowpass filters now and I designed a couple settings:
    const enum PickedStringBrightnessType {
      bright, // 1st order shelf
      normal, // 2nd order lowpass, rounded corner
      resonant, // 3rd order lowpass, harder corner
    }
    const brightnessType: PickedStringBrightnessType =
      <any>sustainType == SustainType.bright
        ? PickedStringBrightnessType.bright
        : PickedStringBrightnessType.normal;
    if (brightnessType == PickedStringBrightnessType.bright) {
      const shelfGainStart: number = Math.pow(
        decayRateStart,
        Config.stringDecayRate,
      );
      const shelfGainEnd: number = Math.pow(
        decayRateEnd,
        Config.stringDecayRate,
      );
      Synth.tempFilterStartCoefficients.highShelf2ndOrder(
        shelfRadians,
        shelfGainStart,
        0.5,
      );
      Synth.tempFilterEndCoefficients.highShelf2ndOrder(
        shelfRadians,
        shelfGainEnd,
        0.5,
      );
    } else {
      const cornerHardness: number = Math.pow(
        brightnessType == PickedStringBrightnessType.normal ? 0.0 : 1.0,
        0.25,
      );
      const lowpass1stOrderCutoffRadiansStart: number =
        Math.pow(
          (registerLowpassCenter *
            registerLowpassCenter *
            radiansPerSampleStart *
            3.3 *
            48000) /
            synth.samplesPerSecond,
          0.5 + register,
        ) /
        registerLowpassCenter /
        Math.pow(decayCurveStart, 0.5);
      const lowpass1stOrderCutoffRadiansEnd: number =
        Math.pow(
          (registerLowpassCenter *
            registerLowpassCenter *
            radiansPerSampleEnd *
            3.3 *
            48000) /
            synth.samplesPerSecond,
          0.5 + register,
        ) /
        registerLowpassCenter /
        Math.pow(decayCurveEnd, 0.5);
      const lowpass2ndOrderCutoffRadiansStart: number =
        lowpass1stOrderCutoffRadiansStart *
        Math.pow(
          2.0,
          0.5 - 1.75 * (1.0 - Math.pow(1.0 - cornerHardness, 0.85)),
        );
      const lowpass2ndOrderCutoffRadiansEnd: number =
        lowpass1stOrderCutoffRadiansEnd *
        Math.pow(
          2.0,
          0.5 - 1.75 * (1.0 - Math.pow(1.0 - cornerHardness, 0.85)),
        );
      const lowpass2ndOrderGainStart: number = Math.pow(
        2.0,
        -Math.pow(2.0, -Math.pow(cornerHardness, 0.9)),
      );
      const lowpass2ndOrderGainEnd: number = Math.pow(
        2.0,
        -Math.pow(2.0, -Math.pow(cornerHardness, 0.9)),
      );
      Synth.tempFilterStartCoefficients.lowPass2ndOrderButterworth(
        warpInfinityToNyquist(lowpass2ndOrderCutoffRadiansStart),
        lowpass2ndOrderGainStart,
      );
      Synth.tempFilterEndCoefficients.lowPass2ndOrderButterworth(
        warpInfinityToNyquist(lowpass2ndOrderCutoffRadiansEnd),
        lowpass2ndOrderGainEnd,
      );
    }

    synth.tempFrequencyResponse.analyze(
      Synth.tempFilterStartCoefficients,
      centerHarmonicStart,
    );
    const sustainFilterA1Start: number = Synth.tempFilterStartCoefficients.a[1];
    const sustainFilterA2Start: number = Synth.tempFilterStartCoefficients.a[2];
    const sustainFilterB0Start: number =
      Synth.tempFilterStartCoefficients.b[0] * expressionDecayStart;
    const sustainFilterB1Start: number =
      Synth.tempFilterStartCoefficients.b[1] * expressionDecayStart;
    const sustainFilterB2Start: number =
      Synth.tempFilterStartCoefficients.b[2] * expressionDecayStart;
    const sustainFilterPhaseDelayStart: number =
      -synth.tempFrequencyResponse.angle() / centerHarmonicStart;

    synth.tempFrequencyResponse.analyze(
      Synth.tempFilterEndCoefficients,
      centerHarmonicEnd,
    );
    const sustainFilterA1End: number = Synth.tempFilterEndCoefficients.a[1];
    const sustainFilterA2End: number = Synth.tempFilterEndCoefficients.a[2];
    const sustainFilterB0End: number =
      Synth.tempFilterEndCoefficients.b[0] * expressionDecayEnd;
    const sustainFilterB1End: number =
      Synth.tempFilterEndCoefficients.b[1] * expressionDecayEnd;
    const sustainFilterB2End: number =
      Synth.tempFilterEndCoefficients.b[2] * expressionDecayEnd;
    const sustainFilterPhaseDelayEnd: number =
      -synth.tempFrequencyResponse.angle() / centerHarmonicEnd;

    const periodLengthStart: number = 1.0 / phaseDeltaStart;
    const periodLengthEnd: number = 1.0 / phaseDeltaEnd;
    const minBufferLength: number = Math.ceil(
      Math.max(periodLengthStart, periodLengthEnd) * 2,
    );
    const delayLength: number =
      periodLengthStart - allPassPhaseDelayStart - sustainFilterPhaseDelayStart;
    const delayLengthEnd: number =
      periodLengthEnd - allPassPhaseDelayEnd - sustainFilterPhaseDelayEnd;

    this.prevDelayLength = delayLength;
    this.delayLengthDelta =
      (delayLengthEnd - delayLength) / roundedSamplesPerTick;
    this.allPassG = allPassGStart;
    this.sustainFilterA1 = sustainFilterA1Start;
    this.sustainFilterA2 = sustainFilterA2Start;
    this.sustainFilterB0 = sustainFilterB0Start;
    this.sustainFilterB1 = sustainFilterB1Start;
    this.sustainFilterB2 = sustainFilterB2Start;
    this.allPassGDelta = (allPassGEnd - allPassGStart) / roundedSamplesPerTick;
    this.sustainFilterA1Delta =
      (sustainFilterA1End - sustainFilterA1Start) / roundedSamplesPerTick;
    this.sustainFilterA2Delta =
      (sustainFilterA2End - sustainFilterA2Start) / roundedSamplesPerTick;
    this.sustainFilterB0Delta =
      (sustainFilterB0End - sustainFilterB0Start) / roundedSamplesPerTick;
    this.sustainFilterB1Delta =
      (sustainFilterB1End - sustainFilterB1Start) / roundedSamplesPerTick;
    this.sustainFilterB2Delta =
      (sustainFilterB2End - sustainFilterB2Start) / roundedSamplesPerTick;

    const pitchChanged: boolean =
      Math.abs(Math.log2(delayLength / prevDelayLength)) > 0.01;

    const reinitializeImpulse: boolean = this.delayIndex == -1 || pitchChanged;
    if (this.delayLine == null || this.delayLine.length <= minBufferLength) {
      // The delay line buffer will get reused for other tones so might as well
      // start off with a buffer size that is big enough for most notes.
      const likelyMaximumLength: number = Math.ceil(
        (2 * synth.samplesPerSecond) / Instrument.frequencyFromPitch(12),
      );
      const newDelayLine: Float32Array = new Float32Array(
        Synth.fittingPowerOfTwo(Math.max(likelyMaximumLength, minBufferLength)),
      );
      if (!reinitializeImpulse && this.delayLine != null) {
        // If the tone has already started but the buffer needs to be reallocated,
        // transfer the old data to the new buffer.
        const oldDelayBufferMask: number = (this.delayLine.length - 1) >> 0;
        const startCopyingFromIndex: number =
          this.delayIndex + this.delayResetOffset;
        this.delayIndex = this.delayLine.length - this.delayResetOffset;
        for (let i: number = 0; i < this.delayLine.length; i++) {
          newDelayLine[i] =
            this.delayLine[(startCopyingFromIndex + i) & oldDelayBufferMask];
        }
      }
      this.delayLine = newDelayLine;
    }
    const delayLine: Float32Array = this.delayLine;
    const delayBufferMask: number = (delayLine.length - 1) >> 0;

    if (reinitializeImpulse) {
      // -1 delay index means the tone was reset.
      // Also, if the pitch changed suddenly (e.g. from seamless or arpeggio) then reset the wave.

      this.delayIndex = 0;
      this.allPassSample = 0.0;
      this.allPassPrevInput = 0.0;
      this.sustainFilterSample = 0.0;
      this.sustainFilterPrevOutput2 = 0.0;
      this.sustainFilterPrevInput1 = 0.0;
      this.sustainFilterPrevInput2 = 0.0;
      this.fractionalDelaySample = 0.0;

      // Clear away a region of the delay buffer for the new impulse.
      const startImpulseFrom: number = -delayLength;
      const startZerosFrom: number = Math.floor(
        startImpulseFrom - periodLengthStart / 2,
      );
      const stopZerosAt: number = Math.ceil(
        startZerosFrom + periodLengthStart * 2,
      );
      this.delayResetOffset = stopZerosAt; // And continue clearing the area in front of the delay line.
      for (let i: number = startZerosFrom; i <= stopZerosAt; i++) {
        delayLine[i & delayBufferMask] = 0.0;
      }

      const impulseWave: Float32Array = instrumentState.wave!;
      const impulseWaveLength: number = impulseWave.length - 1; // The first sample is duplicated at the end, don't double-count it.
      const impulsePhaseDelta: number = impulseWaveLength / periodLengthStart;

      const fadeDuration: number = Math.min(
        periodLengthStart * 0.2,
        synth.samplesPerSecond * 0.003,
      );
      const startImpulseFromSample: number = Math.ceil(startImpulseFrom);
      const stopImpulseAt: number =
        startImpulseFrom + periodLengthStart + fadeDuration;
      const stopImpulseAtSample: number = stopImpulseAt;
      let impulsePhase: number =
        (startImpulseFromSample - startImpulseFrom) * impulsePhaseDelta;
      let prevWaveIntegral: number = 0.0;
      for (
        let i: number = startImpulseFromSample;
        i <= stopImpulseAtSample;
        i++
      ) {
        const impulsePhaseInt: number = impulsePhase | 0;
        const index: number = impulsePhaseInt % impulseWaveLength;
        let nextWaveIntegral: number = impulseWave[index];
        const phaseRatio: number = impulsePhase - impulsePhaseInt;
        nextWaveIntegral +=
          (impulseWave[index + 1] - nextWaveIntegral) * phaseRatio;
        const sample: number =
          (nextWaveIntegral - prevWaveIntegral) / impulsePhaseDelta;
        const fadeIn: number = Math.min(
          1.0,
          (i - startImpulseFrom) / fadeDuration,
        );
        const fadeOut: number = Math.min(
          1.0,
          (stopImpulseAt - i) / fadeDuration,
        );
        const combinedFade: number = fadeIn * fadeOut;
        const curvedFade: number =
          combinedFade * combinedFade * (3.0 - 2.0 * combinedFade); // A cubic sigmoid from 0 to 1.
        delayLine[i & delayBufferMask] += sample * curvedFade;
        prevWaveIntegral = nextWaveIntegral;
        impulsePhase += impulsePhaseDelta;
      }
    }
  }
}

export class EnvelopeComputer {
  public noteSecondsStart: number = 0.0;
  public noteSecondsEnd: number = 0.0;
  public noteTicksStart: number = 0.0;
  public noteTicksEnd: number = 0.0;
  public noteSizeStart: number = Config.noteSizeMax;
  public noteSizeEnd: number = Config.noteSizeMax;
  public prevNoteSize: number = Config.noteSizeMax;
  public nextNoteSize: number = Config.noteSizeMax;
  private _noteSizeFinal: number = Config.noteSizeMax;
  public prevNoteSecondsStart: number = 0.0;
  public prevNoteSecondsEnd: number = 0.0;
  public prevNoteTicksStart: number = 0.0;
  public prevNoteTicksEnd: number = 0.0;
  private _prevNoteSizeFinal: number = Config.noteSizeMax;

  public prevSlideStart: boolean = false;
  public prevSlideEnd: boolean = false;
  public nextSlideStart: boolean = false;
  public nextSlideEnd: boolean = false;
  public prevSlideRatioStart: number = 0.0;
  public prevSlideRatioEnd: number = 0.0;
  public nextSlideRatioStart: number = 0.0;
  public nextSlideRatioEnd: number = 0.0;

  public readonly envelopeStarts: number[] = [];
  public readonly envelopeEnds: number[] = [];
  private readonly _modifiedEnvelopeIndices: number[] = [];
  private _modifiedEnvelopeCount: number = 0;
  public lowpassCutoffDecayVolumeCompensation: number = 1.0;

  constructor(/*private _perNote: boolean*/) {
    //const length: number = this._perNote ? EnvelopeComputeIndex.length : InstrumentAutomationIndex.length;
    const length: number = EnvelopeComputeIndex.length;
    for (let i: number = 0; i < length; i++) {
      this.envelopeStarts[i] = 1.0;
      this.envelopeEnds[i] = 1.0;
    }

    this.reset();
  }

  public reset(): void {
    this.noteSecondsEnd = 0.0;
    this.noteTicksEnd = 0.0;
    this._noteSizeFinal = Config.noteSizeMax;
    this.prevNoteSecondsEnd = 0.0;
    this.prevNoteTicksEnd = 0.0;
    this._prevNoteSizeFinal = Config.noteSizeMax;
    this._modifiedEnvelopeCount = 0;
  }

  public computeEnvelopes(
    instrument: Instrument,
    currentPart: number,
    tickTimeStart: number,
    secondsPerTick: number,
    tone: Tone | null,
  ): void {
    const transition: Transition = instrument.getTransition();
    if (
      tone != null &&
      tone.atNoteStart &&
      !transition.continues &&
      !tone.forceContinueAtStart
    ) {
      this.prevNoteSecondsEnd = this.noteSecondsEnd;
      this.prevNoteTicksEnd = this.noteTicksEnd;
      this._prevNoteSizeFinal = this._noteSizeFinal;
      this.noteSecondsEnd = 0.0;
      this.noteTicksEnd = 0.0;
    }
    if (tone != null) {
      if (tone.note != null) {
        this._noteSizeFinal = tone.note.pins[tone.note.pins.length - 1].size;
      } else {
        this._noteSizeFinal = Config.noteSizeMax;
      }
    }

    const tickTimeEnd: number = tickTimeStart + 1.0;
    const noteSecondsStart: number = this.noteSecondsEnd;
    const noteSecondsEnd: number = noteSecondsStart + secondsPerTick;
    const noteTicksStart: number = this.noteTicksEnd;
    const noteTicksEnd: number = noteTicksStart + 1.0;
    const prevNoteSecondsStart: number = this.prevNoteSecondsEnd;
    const prevNoteSecondsEnd: number = prevNoteSecondsStart + secondsPerTick;
    const prevNoteTicksStart: number = this.prevNoteTicksEnd;
    const prevNoteTicksEnd: number = prevNoteTicksStart + 1.0;

    const beatsPerTick: number =
      1.0 / (Config.ticksPerPart * Config.partsPerBeat);
    const beatTimeStart: number = beatsPerTick * tickTimeStart;
    const beatTimeEnd: number = beatsPerTick * tickTimeEnd;

    let noteSizeStart: number = this._noteSizeFinal;
    let noteSizeEnd: number = this._noteSizeFinal;
    let prevNoteSize: number = this._prevNoteSizeFinal;
    let nextNoteSize: number = 0;
    let prevSlideStart: boolean = false;
    let prevSlideEnd: boolean = false;
    let nextSlideStart: boolean = false;
    let nextSlideEnd: boolean = false;
    let prevSlideRatioStart: number = 0.0;
    let prevSlideRatioEnd: number = 0.0;
    let nextSlideRatioStart: number = 0.0;
    let nextSlideRatioEnd: number = 0.0;
    if (tone != null && tone.note != null && !tone.passedEndOfNote) {
      const endPinIndex: number = tone.note.getEndPinIndex(currentPart);
      const startPin: NotePin = tone.note.pins[endPinIndex - 1];
      const endPin: NotePin = tone.note.pins[endPinIndex];
      const startPinTick: number =
        (tone.note.start + startPin.time) * Config.ticksPerPart;
      const endPinTick: number =
        (tone.note.start + endPin.time) * Config.ticksPerPart;
      const ratioStart: number =
        (tickTimeStart - startPinTick) / (endPinTick - startPinTick);
      const ratioEnd: number =
        (tickTimeEnd - startPinTick) / (endPinTick - startPinTick);
      noteSizeStart =
        startPin.size + (endPin.size - startPin.size) * ratioStart;
      noteSizeEnd = startPin.size + (endPin.size - startPin.size) * ratioEnd;

      if (transition.slides) {
        const noteStartTick: number = tone.noteStartPart * Config.ticksPerPart;
        const noteEndTick: number = tone.noteEndPart * Config.ticksPerPart;
        const noteLengthTicks: number = noteEndTick - noteStartTick;
        const maximumSlideTicks: number = noteLengthTicks * 0.5;
        const slideTicks: number = Math.min(
          maximumSlideTicks,
          transition.slideTicks,
        );
        if (tone.prevNote != null && !tone.forceContinueAtStart) {
          if (tickTimeStart - noteStartTick < slideTicks) {
            prevSlideStart = true;
            prevSlideRatioStart =
              0.5 * (1.0 - (tickTimeStart - noteStartTick) / slideTicks);
          }
          if (tickTimeEnd - noteStartTick < slideTicks) {
            prevSlideEnd = true;
            prevSlideRatioEnd =
              0.5 * (1.0 - (tickTimeEnd - noteStartTick) / slideTicks);
          }
        }
        if (tone.nextNote != null && !tone.forceContinueAtEnd) {
          nextNoteSize = tone.nextNote.pins[0].size;
          if (noteEndTick - tickTimeStart < slideTicks) {
            nextSlideStart = true;
            nextSlideRatioStart =
              0.5 * (1.0 - (noteEndTick - tickTimeStart) / slideTicks);
          }
          if (noteEndTick - tickTimeEnd < slideTicks) {
            nextSlideEnd = true;
            nextSlideRatioEnd =
              0.5 * (1.0 - (noteEndTick - tickTimeEnd) / slideTicks);
          }
        }
      }
    }

    let lowpassCutoffDecayVolumeCompensation: number = 1.0;
    let usedNoteSize: boolean = false;
    for (
      let envelopeIndex: number = 0;
      envelopeIndex <= instrument.envelopeCount;
      envelopeIndex++
    ) {
      let automationTarget: AutomationTarget;
      let targetIndex: number;
      let envelope: Envelope;
      let speed: number;
      let a: number;
      let b: number;
      if (envelopeIndex == instrument.envelopeCount) {
        if (usedNoteSize /*|| !this._perNote*/) break;
        // Special case: if no other envelopes used note size, default to applying it to note volume.
        automationTarget =
          Config.instrumentAutomationTargets.dictionary["noteVolume"];
        targetIndex = 0;
        envelope = Config.envelopes.dictionary["velocity"];
        speed = envelope.speed;
        a = envelope.a;
        b = envelope.b;
      } else {
        let envelopeSettings: EnvelopeSettings =
          instrument.envelopes[envelopeIndex];
        automationTarget =
          Config.instrumentAutomationTargets[envelopeSettings.target];
        targetIndex = envelopeSettings.index;
        envelope = Config.envelopes[envelopeSettings.envelope];
        speed = envelopeSettings.speed;
        a = envelopeSettings.a;
        b = envelopeSettings.b;
        if (envelope.type == EnvelopeType.noteSize) usedNoteSize = true;
      }
      if (
        /*automationTarget.perNote == this._perNote &&*/ automationTarget.computeIndex !=
        null
      ) {
        const computeIndex: number =
          automationTarget.computeIndex + targetIndex;
        let envelopeStart: number = EnvelopeComputer.computeEnvelope(
          envelope,
          noteSecondsStart,
          beatTimeStart,
          noteSizeStart,
          speed,
          a,
          b,
        );
        let envelopeEnd: number = EnvelopeComputer.computeEnvelope(
          envelope,
          noteSecondsEnd,
          beatTimeEnd,
          noteSizeEnd,
          speed,
          a,
          b,
        );

        if (prevSlideStart) {
          const other: number = EnvelopeComputer.computeEnvelope(
            envelope,
            prevNoteSecondsStart,
            beatTimeStart,
            prevNoteSize,
            speed,
            a,
            b,
          );
          envelopeStart += (other - envelopeStart) * prevSlideRatioStart;
        }
        if (prevSlideEnd) {
          const other: number = EnvelopeComputer.computeEnvelope(
            envelope,
            prevNoteSecondsEnd,
            beatTimeEnd,
            prevNoteSize,
            speed,
            a,
            b,
          );
          envelopeEnd += (other - envelopeEnd) * prevSlideRatioEnd;
        }
        if (nextSlideStart) {
          const other: number = EnvelopeComputer.computeEnvelope(
            envelope,
            0.0,
            beatTimeStart,
            nextNoteSize,
            speed,
            a,
            b,
          );
          envelopeStart += (other - envelopeStart) * nextSlideRatioStart;
        }
        if (nextSlideEnd) {
          const other: number = EnvelopeComputer.computeEnvelope(
            envelope,
            0.0,
            beatTimeEnd,
            nextNoteSize,
            speed,
            a,
            b,
          );
          envelopeEnd += (other - envelopeEnd) * nextSlideRatioEnd;
        }

        this.envelopeStarts[computeIndex] *= envelopeStart;
        this.envelopeEnds[computeIndex] *= envelopeEnd;
        this._modifiedEnvelopeIndices[this._modifiedEnvelopeCount++] =
          computeIndex;

        if (automationTarget.isFilter) {
          const filterSettings: FilterSettings =
            /*this._perNote ?*/ instrument.noteFilter; /*: instrument.eqFilter*/
          if (
            filterSettings.controlPointCount > targetIndex &&
            filterSettings.controlPoints[targetIndex].type == FilterType.lowPass
          ) {
            lowpassCutoffDecayVolumeCompensation = Math.max(
              lowpassCutoffDecayVolumeCompensation,
              EnvelopeComputer.getLowpassCutoffDecayVolumeCompensation(
                envelope,
                speed,
              ),
            );
          }
        }
      }
    }

    this.noteSecondsStart = noteSecondsStart;
    this.noteSecondsEnd = noteSecondsEnd;
    this.noteTicksStart = noteTicksStart;
    this.noteTicksEnd = noteTicksEnd;
    this.prevNoteSecondsStart = prevNoteSecondsStart;
    this.prevNoteSecondsEnd = prevNoteSecondsEnd;
    this.prevNoteTicksStart = prevNoteTicksStart;
    this.prevNoteTicksEnd = prevNoteTicksEnd;
    this.prevNoteSize = prevNoteSize;
    this.nextNoteSize = nextNoteSize;
    this.noteSizeStart = noteSizeStart;
    this.noteSizeEnd = noteSizeEnd;
    this.prevSlideStart = prevSlideStart;
    this.prevSlideEnd = prevSlideEnd;
    this.nextSlideStart = nextSlideStart;
    this.nextSlideEnd = nextSlideEnd;
    this.prevSlideRatioStart = prevSlideRatioStart;
    this.prevSlideRatioEnd = prevSlideRatioEnd;
    this.nextSlideRatioStart = nextSlideRatioStart;
    this.nextSlideRatioEnd = nextSlideRatioEnd;
    this.lowpassCutoffDecayVolumeCompensation =
      lowpassCutoffDecayVolumeCompensation;
  }

  public clearEnvelopes(): void {
    for (
      let envelopeIndex: number = 0;
      envelopeIndex < this._modifiedEnvelopeCount;
      envelopeIndex++
    ) {
      const computeIndex: number = this._modifiedEnvelopeIndices[envelopeIndex];
      this.envelopeStarts[computeIndex] = 1.0;
      this.envelopeEnds[computeIndex] = 1.0;
    }
    this._modifiedEnvelopeCount = 0;
  }

  public static computeEnvelope(
    envelope: Envelope,
    time: number,
    beats: number,
    noteSize: number,
    speed: number = envelope.speed,
    a: number = envelope.a,
    b: number = envelope.b,
  ): number {
    switch (envelope.type) {
      case EnvelopeType.noteSize:
        return b + ((a - b) * noteSize) / Config.noteSizeMax;
      case EnvelopeType.none:
        return a;
      case EnvelopeType.twang:
        return b + (a - b) / (1.0 + time * speed);
      case EnvelopeType.swell:
        return a + (b - a) * (1.0 - 1.0 / (1.0 + time * speed));
      case EnvelopeType.tremolo:
        return (
          a + (b - a) * (0.5 - Math.cos(beats * 2.0 * Math.PI * speed) * 0.5)
        );
      case EnvelopeType.punch:
        return Math.max(b, a - time * speed * (a - b));
      case EnvelopeType.flare:
        const attack: number = 0.25 / Math.sqrt(speed);
        const flare: number =
          time < attack ? time / attack : 1.0 / (1.0 + (time - attack) * speed);
        return a + (b - a) * flare;
      case EnvelopeType.decay:
        return b + (a - b) * Math.pow(2, -speed * time);
      default:
        throw new Error("Unrecognized operator envelope type.");
    }
  }

  public static getLowpassCutoffDecayVolumeCompensation(
    envelope: Envelope,
    speed: number = envelope.speed,
  ): number {
    // This is a little hokey in the details, but I designed it a while ago and keep it
    // around for compatibility. This decides how much to increase the volume (or
    // expression) to compensate for a decaying lowpass cutoff to maintain perceived
    // volume overall.
    if (envelope.type == EnvelopeType.decay) return 1.25 + 0.025 * speed;
    if (envelope.type == EnvelopeType.twang) return 1.0 + 0.02 * speed;
    return 1.0;
  }
}

class Tone {
  public instrumentIndex!: number;
  public readonly pitches: number[] = Array(Config.maxChordSize).fill(0);
  public pitchCount: number = 0;
  public chordSize: number = 0;
  public drumsetPitch: number | null = null;
  public note: Note | null = null;
  public prevNote: Note | null = null;
  public nextNote: Note | null = null;
  public prevNotePitchIndex: number = 0;
  public nextNotePitchIndex: number = 0;
  public freshlyAllocated: boolean = true;
  public atNoteStart: boolean = false;
  public isOnLastTick: boolean = false; // Whether the tone is finished fading out and ready to be freed.
  public passedEndOfNote: boolean = false;
  public forceContinueAtStart: boolean = false;
  public forceContinueAtEnd: boolean = false;
  public noteStartPart: number = 0;
  public noteEndPart: number = 0;
  public ticksSinceReleased: number = 0;
  public released: boolean = false;
  public liveInputSamplesHeld: number = 0;
  public lastInterval: number = 0;
  public noiseSample: number = 0.0;
  public noiseSampleB: number = 0.0;
  public readonly phases: number[] = [];
  public readonly phaseDeltas: number[] = [];
  public readonly phaseDeltaScales: number[] = [];
  public expression: number = 0.0;
  public expressionDelta: number = 0.0;
  public readonly operatorExpressions: number[] = [];
  public readonly operatorExpressionDeltas: number[] = [];
  public readonly prevPitchExpressions: Array<number | null> = Array(
    Config.maxPitchOrOperatorCount,
  ).fill(null);
  public prevVibrato: number | null = null;
  public prevStringDecay: number | null = null;
  public pulseWidth: number = 0.0;
  public pulseWidthDelta: number = 0.0;
  public supersawDynamism: number = 0.0;
  public supersawDynamismDelta: number = 0.0;
  public supersawUnisonDetunes: number[] = []; // These can change over time, but slowly enough that I'm not including corresponding delta values within a tick run.
  public supersawShape: number = 0.0;
  public supersawShapeDelta: number = 0.0;
  public supersawDelayLength: number = 0.0;
  public supersawDelayLengthDelta: number = 0.0;
  public supersawDelayLine: Float32Array | null = null;
  public supersawDelayIndex: number = -1;
  public supersawPrevPhaseDelta: number | null = null;
  public readonly pickedStrings: PickedString[] = [];
  public soundFontBank: SoundFontBank | null = null;
  public soundFontBankId: string | null = null;
  public soundFontPresetIndex: number = -1;
  public soundFontKey: number = 60;
  public soundFontInitialized: boolean = false;
  public readonly soundFontVoices: SoundFontToneVoice[] = [];

  public readonly noteFilters: DynamicBiquadFilter[] = [];
  public noteFilterCount: number = 0;
  public initialNoteFilterInput1: number = 0.0;
  public initialNoteFilterInput2: number = 0.0;

  public specialIntervalExpressionMult: number = 1.0;
  public readonly feedbackOutputs: number[] = [];
  public feedbackMult: number = 0.0;
  public feedbackDelta: number = 0.0;

  public readonly envelopeComputer: EnvelopeComputer = new EnvelopeComputer(
    /*true*/
  );

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.noiseSample = 0.0;
    this.noiseSampleB = 0.0;
    for (
      let i: number = 0;
      i <
      Math.max(
        Config.maxPitchOrOperatorCount,
        Config.operatorCount * 2,
        Config.supersawVoiceCount * 2,
      );
      i++
    ) {
      this.phases[i] = 0.0;
      if (i < Config.operatorCount * 2) this.feedbackOutputs[i] = 0.0;
      if (i < Config.maxPitchOrOperatorCount)
        this.prevPitchExpressions[i] = null;
    }
    for (let i: number = 0; i < this.noteFilterCount; i++) {
      this.noteFilters[i].resetOutput();
    }
    this.noteFilterCount = 0;
    this.initialNoteFilterInput1 = 0.0;
    this.initialNoteFilterInput2 = 0.0;
    this.liveInputSamplesHeld = 0;
    this.released = false;
    this.supersawDelayIndex = -1;
    for (const pickedString of this.pickedStrings) {
      pickedString.reset();
    }
    this.envelopeComputer.reset();
    this.prevVibrato = null;
    this.prevStringDecay = null;
    this.supersawPrevPhaseDelta = null;
    this.drumsetPitch = null;
    this.soundFontBank = null;
    this.soundFontBankId = null;
    this.soundFontPresetIndex = -1;
    this.soundFontKey = 60;
    this.soundFontInitialized = false;
    this.soundFontVoices.length = 0;
  }
}

interface SoundFontToneVoice {
  readonly zone: SoundFontZone;
  phaseA: number;
  phaseB: number;
  phaseDeltaA: number;
  phaseDeltaB: number;
  phaseDeltaScaleA: number;
  phaseDeltaScaleB: number;
  endedA: boolean;
  endedB: boolean;
}

class InstrumentState {
  public awake: boolean = false; // Whether the instrument's effects-processing loop should continue.
  public computed: boolean = false; // Whether the effects-processing parameters are up-to-date for the current synth run.
  public tonesAddedInThisTick: boolean = false; // Whether any instrument tones are currently active.
  public flushingDelayLines: boolean = false; // If no tones were active recently, enter a mode where the delay lines are filled with zeros to reset them for later use.
  public deactivateAfterThisTick: boolean = false; // Whether the instrument is ready to be deactivated because the delay lines, if any, are fully zeroed.
  public attentuationProgress: number = 0.0; // How long since an active tone introduced an input signal to the delay lines, normalized from 0 to 1 based on how long to wait until the delay lines signal will have audibly dissapated.
  public flushedSamples: number = 0; // How many delay line samples have been flushed to zero.
  public readonly activeTones: Deque<Tone> = new Deque<Tone>();
  public readonly releasedTones: Deque<Tone> = new Deque<Tone>(); // Tones that are in the process of fading out after the corresponding notes ended.
  public readonly liveInputTones: Deque<Tone> = new Deque<Tone>(); // Tones that are initiated by a source external to the loaded song data.

  public type: InstrumentType = InstrumentType.chip;
  public synthesizer: Function | null = null;
  public wave: Float32Array | null = null;
  public assetId: string | null = null;
  public assetRootKey: number = 60;
  public noisePitchFilterMult: number = 1.0;
  public unison: Unison | null = null;
  public usesUnison: boolean = false;
  public chord: Chord | null = null;
  public effects: number = 0;
  public soundFontBankId: string | null = null;
  public soundFontPresetIndex: number = -1;

  public eqFilterVolume: number = 1.0;
  public eqFilterVolumeDelta: number = 0.0;
  public mixVolume: number = 1.0;
  public mixVolumeDelta: number = 0.0;
  public delayInputMult: number = 0.0;
  public delayInputMultDelta: number = 0.0;

  public distortion: number = 0.0;
  public distortionDelta: number = 0.0;
  public distortionDrive: number = 0.0;
  public distortionDriveDelta: number = 0.0;
  public distortionFractionalInput1: number = 0.0;
  public distortionFractionalInput2: number = 0.0;
  public distortionFractionalInput3: number = 0.0;
  public distortionPrevInput: number = 0.0;
  public distortionNextOutput: number = 0.0;

  public bitcrusherPrevInput: number = 0.0;
  public bitcrusherCurrentOutput: number = 0.0;
  public bitcrusherPhase: number = 1.0;
  public bitcrusherPhaseDelta: number = 0.0;
  public bitcrusherPhaseDeltaScale: number = 1.0;
  public bitcrusherScale: number = 1.0;
  public bitcrusherScaleScale: number = 1.0;
  public bitcrusherFoldLevel: number = 1.0;
  public bitcrusherFoldLevelScale: number = 1.0;

  public readonly eqFilters: DynamicBiquadFilter[] = [];
  public eqFilterCount: number = 0;
  public initialEqFilterInput1: number = 0.0;
  public initialEqFilterInput2: number = 0.0;

  public panningDelayLine: Float32Array | null = null;
  public panningDelayPos: number = 0;
  public panningVolumeL: number = 0.0;
  public panningVolumeR: number = 0.0;
  public panningOffsetL: number = 0.0;
  public panningOffsetR: number = 0.0;

  public chorusDelayLineL: Float32Array | null = null;
  public chorusDelayLineR: Float32Array | null = null;
  public chorusDelayLineDirty: boolean = false;
  public chorusDelayPos: number = 0;
  public chorusPhase: number = 0;
  public chorusVoiceMult: number = 0;
  public chorusVoiceMultDelta: number = 0;
  public chorusCombinedMult: number = 0;
  public chorusCombinedMultDelta: number = 0;

  public echoDelayLineL: Float32Array | null = null;
  public echoDelayLineR: Float32Array | null = null;
  public echoDelayLineDirty: boolean = false;
  public echoDelayPos: number = 0;
  public echoDelayOffsetStart: number = 0;
  public echoDelayOffsetEnd: number | null = null;
  public echoDelayOffsetRatio: number = 0.0;
  public echoDelayOffsetRatioDelta: number = 0.0;
  public echoMult: number = 0.0;
  public echoMultDelta: number = 0.0;
  public echoShelfA1: number = 0.0;
  public echoShelfB0: number = 0.0;
  public echoShelfB1: number = 0.0;
  public echoShelfSampleL: number = 0.0;
  public echoShelfSampleR: number = 0.0;
  public echoShelfPrevInputL: number = 0.0;
  public echoShelfPrevInputR: number = 0.0;

  public reverbDelayLine: Float32Array | null = null;
  public reverbDelayLineDirty: boolean = false;
  public reverbDelayPos: number = 0;
  public reverbMult: number = 0.0;
  public reverbMultDelta: number = 0.0;
  public reverbShelfA1: number = 0.0;
  public reverbShelfB0: number = 0.0;
  public reverbShelfB1: number = 0.0;
  public reverbShelfSample0: number = 0.0;
  public reverbShelfSample1: number = 0.0;
  public reverbShelfSample2: number = 0.0;
  public reverbShelfSample3: number = 0.0;
  public reverbShelfPrevInput0: number = 0.0;
  public reverbShelfPrevInput1: number = 0.0;
  public reverbShelfPrevInput2: number = 0.0;
  public reverbShelfPrevInput3: number = 0.0;

  //public readonly envelopeComputer: EnvelopeComputer = new EnvelopeComputer(false);

  public readonly spectrumWave: SpectrumWaveState = new SpectrumWaveState();
  public readonly harmonicsWave: HarmonicsWaveState = new HarmonicsWaveState();
  public readonly drumsetSpectrumWaves: SpectrumWaveState[] = [];

  constructor() {
    for (let i: number = 0; i < Config.drumCount; i++) {
      this.drumsetSpectrumWaves[i] = new SpectrumWaveState();
    }
  }

  public allocateNecessaryBuffers(
    synth: Synth,
    instrument: Instrument,
    samplesPerTick: number,
  ): void {
    if (
      this.panningDelayLine == null ||
      this.panningDelayLine.length < synth.panningDelayBufferSize
    ) {
      this.panningDelayLine = new Float32Array(synth.panningDelayBufferSize);
    }
    if (effectsIncludeChorus(instrument.effects)) {
      if (
        this.chorusDelayLineL == null ||
        this.chorusDelayLineL.length < synth.chorusDelayBufferSize
      ) {
        this.chorusDelayLineL = new Float32Array(synth.chorusDelayBufferSize);
      }
      if (
        this.chorusDelayLineR == null ||
        this.chorusDelayLineR.length < synth.chorusDelayBufferSize
      ) {
        this.chorusDelayLineR = new Float32Array(synth.chorusDelayBufferSize);
      }
    }
    if (effectsIncludeEcho(instrument.effects)) {
      // account for tempo and delay automation changing delay length during a tick?
      const safeEchoDelaySteps: number = Math.max(
        Config.echoDelayRange >> 1,
        instrument.echoDelay + 1,
      ); // The delay may be very short now, but if it increases later make sure we have enough sample history.
      const baseEchoDelayBufferSize: number = Synth.fittingPowerOfTwo(
        safeEchoDelaySteps * Config.echoDelayStepTicks * samplesPerTick,
      );
      const safeEchoDelayBufferSize: number = baseEchoDelayBufferSize * 2; // If the tempo or delay changes and we suddenly need a longer delay, make sure that we have enough sample history to accomodate the longer delay.

      if (this.echoDelayLineL == null || this.echoDelayLineR == null) {
        this.echoDelayLineL = new Float32Array(safeEchoDelayBufferSize);
        this.echoDelayLineR = new Float32Array(safeEchoDelayBufferSize);
      } else if (
        this.echoDelayLineL.length < safeEchoDelayBufferSize ||
        this.echoDelayLineR.length < safeEchoDelayBufferSize
      ) {
        // The echo delay length may change whlie the song is playing if tempo changes,
        // so buffers may need to be reallocated, but we don't want to lose any echoes
        // so we need to copy the contents of the old buffer to the new one.
        const newDelayLineL: Float32Array = new Float32Array(
          safeEchoDelayBufferSize,
        );
        const newDelayLineR: Float32Array = new Float32Array(
          safeEchoDelayBufferSize,
        );
        const oldMask: number = this.echoDelayLineL.length - 1;

        for (let i = 0; i < this.echoDelayLineL.length; i++) {
          newDelayLineL[i] =
            this.echoDelayLineL[(this.echoDelayPos + i) & oldMask];
          newDelayLineR[i] =
            this.echoDelayLineL[(this.echoDelayPos + i) & oldMask];
        }

        this.echoDelayPos = this.echoDelayLineL.length;
        this.echoDelayLineL = newDelayLineL;
        this.echoDelayLineR = newDelayLineR;
      }
    }
    if (effectsIncludeReverb(instrument.effects)) {
      // TODO: Make reverb delay line sample rate agnostic. Maybe just double buffer size for 96KHz? Adjust attenuation and shelf cutoff appropriately?
      if (this.reverbDelayLine == null) {
        this.reverbDelayLine = new Float32Array(Config.reverbDelayBufferSize);
      }
    }
  }

  public deactivate(): void {
    this.bitcrusherPrevInput = 0.0;
    this.bitcrusherCurrentOutput = 0.0;
    this.bitcrusherPhase = 1.0;
    for (let i: number = 0; i < this.eqFilterCount; i++) {
      this.eqFilters[i].resetOutput();
    }
    this.eqFilterCount = 0;
    this.initialEqFilterInput1 = 0.0;
    this.initialEqFilterInput2 = 0.0;
    this.distortionFractionalInput1 = 0.0;
    this.distortionFractionalInput2 = 0.0;
    this.distortionFractionalInput3 = 0.0;
    this.distortionPrevInput = 0.0;
    this.distortionNextOutput = 0.0;
    this.panningDelayPos = 0;
    if (this.panningDelayLine != null)
      for (let i: number = 0; i < this.panningDelayLine.length; i++)
        this.panningDelayLine[i] = 0.0;
    this.echoDelayOffsetEnd = null;
    this.echoShelfSampleL = 0.0;
    this.echoShelfSampleR = 0.0;
    this.echoShelfPrevInputL = 0.0;
    this.echoShelfPrevInputR = 0.0;
    this.reverbShelfSample0 = 0.0;
    this.reverbShelfSample1 = 0.0;
    this.reverbShelfSample2 = 0.0;
    this.reverbShelfSample3 = 0.0;
    this.reverbShelfPrevInput0 = 0.0;
    this.reverbShelfPrevInput1 = 0.0;
    this.reverbShelfPrevInput2 = 0.0;
    this.reverbShelfPrevInput3 = 0.0;

    this.awake = false;
    this.flushingDelayLines = false;
    this.deactivateAfterThisTick = false;
    this.attentuationProgress = 0.0;
    this.flushedSamples = 0;
  }

  public resetAllEffects(): void {
    this.deactivate();

    if (this.chorusDelayLineDirty) {
      for (let i: number = 0; i < this.chorusDelayLineL!.length; i++)
        this.chorusDelayLineL![i] = 0.0;
      for (let i: number = 0; i < this.chorusDelayLineR!.length; i++)
        this.chorusDelayLineR![i] = 0.0;
    }
    if (this.echoDelayLineDirty) {
      for (let i: number = 0; i < this.echoDelayLineL!.length; i++)
        this.echoDelayLineL![i] = 0.0;
      for (let i: number = 0; i < this.echoDelayLineR!.length; i++)
        this.echoDelayLineR![i] = 0.0;
    }
    if (this.reverbDelayLineDirty) {
      for (let i: number = 0; i < this.reverbDelayLine!.length; i++)
        this.reverbDelayLine![i] = 0.0;
    }

    this.chorusPhase = 0.0;
  }

  public compute(
    synth: Synth,
    instrument: Instrument,
    samplesPerTick: number,
    roundedSamplesPerTick: number,
    _tone: Tone | null,
  ): void {
    this.computed = true;
    this.type = instrument.type;
    this.synthesizer = Synth.getInstrumentSynthFunction(instrument);
    this.unison = instrument.getUnison();
    this.usesUnison =
      effectsIncludeUnison(instrument.effects) ||
      instrument.type == InstrumentType.chip ||
      instrument.type == InstrumentType.harmonics ||
      instrument.type == InstrumentType.pickedString ||
      instrument.type == InstrumentType.soundFont;
    this.chord = instrument.getChord();
    this.soundFontBankId = instrument.soundFontId;
    this.soundFontPresetIndex = instrument.soundFontPreset;
    this.noisePitchFilterMult =
      Config.chipNoises[instrument.chipNoise].pitchFilterMult;

    // Force effects to be disabled if the corresponding slider is at zero (and automation isn't involved).
    let effects: number = instrument.effects;
    if (instrument.distortion == 0) effects &= ~(1 << EffectType.distortion);
    if (instrument.chorus == 0) effects &= ~(1 << EffectType.chorus);
    if (instrument.echoSustain == 0) effects &= ~(1 << EffectType.echo);
    if (instrument.reverb == 0) effects &= ~(1 << EffectType.reverb);
    this.effects = effects;

    this.allocateNecessaryBuffers(synth, instrument, samplesPerTick);

    const samplesPerSecond: number = synth.samplesPerSecond;

    this.updateWaves(instrument, samplesPerSecond);

    //const ticksIntoBar: number = synth.getTicksIntoBar();
    //const tickTimeStart: number = ticksIntoBar;
    //const tickTimeEnd:   number = ticksIntoBar + 1.0;
    //const secondsPerTick: number = samplesPerTick / synth.samplesPerSecond;
    //const currentPart: number = synth.getCurrentPart();
    //this.envelopeComputer.computeEnvelopes(instrument, currentPart, tickTimeStart, secondsPerTick, tone);
    //const envelopeStarts: number[] = this.envelopeComputer.envelopeStarts;
    //const envelopeEnds: number[] = this.envelopeComputer.envelopeEnds;

    const usesDistortion: boolean = effectsIncludeDistortion(effects);
    const usesBitcrusher: boolean = effectsIncludeBitcrusher(effects);
    const usesChorus: boolean = effectsIncludeChorus(effects);
    const usesEcho: boolean = effectsIncludeEcho(effects);
    const usesReverb: boolean = effectsIncludeReverb(effects);

    if (usesDistortion) {
      const distortionSliderStart: number = Math.max(
        0.0,
        Math.min(
          1.0,
          /*envelopeStarts[InstrumentAutomationIndex.distortion] **/ instrument.distortion /
            (Config.distortionRange - 1),
        ),
      );
      const distortionSliderEnd: number = Math.max(
        0.0,
        Math.min(
          1.0,
          /*envelopeEnds[  InstrumentAutomationIndex.distortion] **/ instrument.distortion /
            (Config.distortionRange - 1),
        ),
      );
      const distortionStart: number = Math.pow(
        1.0 - (0.895 * (Math.pow(20.0, distortionSliderStart) - 1.0)) / 19.0,
        2.0,
      );
      const distortionEnd: number = Math.pow(
        1.0 - (0.895 * (Math.pow(20.0, distortionSliderEnd) - 1.0)) / 19.0,
        2.0,
      );
      const distortionDriveStart: number =
        (1.0 + 2.0 * distortionSliderStart) / Config.distortionBaseVolume;
      const distortionDriveEnd: number =
        (1.0 + 2.0 * distortionSliderEnd) / Config.distortionBaseVolume;
      this.distortion = distortionStart;
      this.distortionDelta =
        (distortionEnd - distortionStart) / roundedSamplesPerTick;
      this.distortionDrive = distortionDriveStart;
      this.distortionDriveDelta =
        (distortionDriveEnd - distortionDriveStart) / roundedSamplesPerTick;
    }

    if (usesBitcrusher) {
      const freqSettingStart: number =
        instrument.bitcrusherFreq; /** Math.sqrt(envelopeStarts[InstrumentAutomationIndex.bitcrusherFrequency])*/
      const freqSettingEnd: number =
        instrument.bitcrusherFreq; /** Math.sqrt(envelopeEnds[  InstrumentAutomationIndex.bitcrusherFrequency])*/
      const quantizationSettingStart: number =
        instrument.bitcrusherQuantization; /** Math.sqrt(envelopeStarts[InstrumentAutomationIndex.bitcrusherQuantization])*/
      const quantizationSettingEnd: number =
        instrument.bitcrusherQuantization; /** Math.sqrt(envelopeEnds[  InstrumentAutomationIndex.bitcrusherQuantization])*/

      const basePitch: number = Config.keys[synth.song!.key].basePitch; // TODO: What if there's a key change mid-song?
      const freqStart: number =
        Instrument.frequencyFromPitch(basePitch + 60) *
        Math.pow(
          2.0,
          (Config.bitcrusherFreqRange - 1 - freqSettingStart) *
            Config.bitcrusherOctaveStep,
        );
      const freqEnd: number =
        Instrument.frequencyFromPitch(basePitch + 60) *
        Math.pow(
          2.0,
          (Config.bitcrusherFreqRange - 1 - freqSettingEnd) *
            Config.bitcrusherOctaveStep,
        );
      const phaseDeltaStart: number = Math.min(
        1.0,
        freqStart / samplesPerSecond,
      );
      const phaseDeltaEnd: number = Math.min(1.0, freqEnd / samplesPerSecond);
      this.bitcrusherPhaseDelta = phaseDeltaStart;
      this.bitcrusherPhaseDeltaScale = Math.pow(
        phaseDeltaEnd / phaseDeltaStart,
        1.0 / roundedSamplesPerTick,
      );

      const scaleStart: number =
        2.0 *
        Config.bitcrusherBaseVolume *
        Math.pow(
          2.0,
          1.0 -
            Math.pow(
              2.0,
              (Config.bitcrusherQuantizationRange -
                1 -
                quantizationSettingStart) *
                0.5,
            ),
        );
      const scaleEnd: number =
        2.0 *
        Config.bitcrusherBaseVolume *
        Math.pow(
          2.0,
          1.0 -
            Math.pow(
              2.0,
              (Config.bitcrusherQuantizationRange -
                1 -
                quantizationSettingEnd) *
                0.5,
            ),
        );
      this.bitcrusherScale = scaleStart;
      this.bitcrusherScaleScale = Math.pow(
        scaleEnd / scaleStart,
        1.0 / roundedSamplesPerTick,
      );

      const foldLevelStart: number =
        2.0 *
        Config.bitcrusherBaseVolume *
        Math.pow(
          1.5,
          Config.bitcrusherQuantizationRange - 1 - quantizationSettingStart,
        );
      const foldLevelEnd: number =
        2.0 *
        Config.bitcrusherBaseVolume *
        Math.pow(
          1.5,
          Config.bitcrusherQuantizationRange - 1 - quantizationSettingEnd,
        );
      this.bitcrusherFoldLevel = foldLevelStart;
      this.bitcrusherFoldLevelScale = Math.pow(
        foldLevelEnd / foldLevelStart,
        1.0 / roundedSamplesPerTick,
      );
    }

    let eqFilterVolume: number = 1.0; //this.envelopeComputer.lowpassCutoffDecayVolumeCompensation;
    const eqFilterSettings: FilterSettings = instrument.eqFilter;
    //const eqAllFreqsEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.eqFilterAllFreqs];
    //const eqAllFreqsEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.eqFilterAllFreqs];
    const eqFilterCount: number = effectsIncludeEqFilter(effects)
      ? eqFilterSettings.controlPointCount
      : 0;
    for (let i: number = 0; i < eqFilterCount; i++) {
      //const eqFreqEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.eqFilterFreq0 + i];
      //const eqFreqEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.eqFilterFreq0 + i];
      //const eqPeakEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.eqFilterGain0 + i];
      //const eqPeakEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.eqFilterGain0 + i];
      const point: FilterControlPoint = eqFilterSettings.controlPoints[i];
      point.toCoefficients(
        Synth.tempFilterStartCoefficients,
        samplesPerSecond,
        /*eqAllFreqsEnvelopeStart * eqFreqEnvelopeStart*/ 1.0,
        /*eqPeakEnvelopeStart*/ 1.0,
      );
      point.toCoefficients(
        Synth.tempFilterEndCoefficients,
        samplesPerSecond,
        /*eqAllFreqsEnvelopeEnd   * eqFreqEnvelopeEnd*/ 1.0,
        /*eqPeakEnvelopeEnd*/ 1.0,
      );
      if (this.eqFilters.length <= i)
        this.eqFilters[i] = new DynamicBiquadFilter();
      this.eqFilters[i].loadCoefficientsWithGradient(
        Synth.tempFilterStartCoefficients,
        Synth.tempFilterEndCoefficients,
        1.0 / roundedSamplesPerTick,
        point.type == FilterType.lowPass,
      );
      eqFilterVolume *= point.getVolumeCompensationMult();
    }
    this.eqFilterCount = eqFilterCount;
    eqFilterVolume = Math.min(3.0, eqFilterVolume);

    const mainInstrumentVolume: number = Synth.instrumentVolumeToVolumeMult(
      instrument.volume,
    );
    this.mixVolume =
      mainInstrumentVolume; /** envelopeStarts[InstrumentAutomationIndex.mixVolume]*/
    const mixVolumeEnd =
      mainInstrumentVolume; /** envelopeEnds[  InstrumentAutomationIndex.mixVolume]*/
    this.mixVolumeDelta =
      (mixVolumeEnd - this.mixVolume) / roundedSamplesPerTick;

    let eqFilterVolumeStart: number = eqFilterVolume;
    let eqFilterVolumeEnd: number = eqFilterVolume;
    let delayInputMultStart: number = 1.0;
    let delayInputMultEnd: number = 1.0;

    const pan: number = (instrument.pan - Config.panCenter) / Config.panCenter;
    const panningVolumeL: number = Math.cos((1 + pan) * Math.PI * 0.25) * 1.414;
    const panningVolumeR: number = Math.cos((1 - pan) * Math.PI * 0.25) * 1.414;
    const panningDelay: number =
      pan * samplesPerSecond * Config.panDelaySecondsMax;
    this.panningVolumeL = panningVolumeL;
    this.panningVolumeR = panningVolumeR;
    this.panningOffsetL =
      this.panningDelayPos -
      Math.max(0.0, panningDelay) +
      synth.panningDelayBufferSize;
    this.panningOffsetR =
      this.panningDelayPos -
      Math.max(0.0, -panningDelay) +
      synth.panningDelayBufferSize;

    if (usesChorus) {
      //const chorusEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.chorus];
      //const chorusEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.chorus];
      let chorusStart: number = Math.max(
        0.0,
        Math.min(
          1.0,
          /*chorusEnvelopeStart **/ instrument.chorus /
            (Config.chorusRange - 1),
        ),
      );
      let chorusEnd: number = Math.max(
        0.0,
        Math.min(
          1.0,
          /*chorusEnvelopeEnd   **/ instrument.chorus /
            (Config.chorusRange - 1),
        ),
      );
      chorusStart = chorusStart * 0.6 + Math.pow(chorusStart, 6.0) * 0.4;
      chorusEnd = chorusEnd * 0.6 + Math.pow(chorusEnd, 6.0) * 0.4;
      const chorusCombinedMultStart =
        1.0 / Math.sqrt(3.0 * chorusStart * chorusStart + 1.0);
      const chorusCombinedMultEnd =
        1.0 / Math.sqrt(3.0 * chorusEnd * chorusEnd + 1.0);
      this.chorusVoiceMult = chorusStart;
      this.chorusVoiceMultDelta =
        (chorusEnd - chorusStart) / roundedSamplesPerTick;
      this.chorusCombinedMult = chorusCombinedMultStart;
      this.chorusCombinedMultDelta =
        (chorusCombinedMultEnd - chorusCombinedMultStart) /
        roundedSamplesPerTick;
    }

    let maxEchoMult = 0.0;
    let averageEchoDelaySeconds: number = 0.0;
    if (usesEcho) {
      //const echoSustainEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.echoSustain];
      //const echoSustainEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.echoSustain];
      const echoMultStart: number = Synth.echoSustainToVolumeMult(
        /*echoSustainEnvelopeStart **/ instrument.echoSustain,
      );
      const echoMultEnd: number = Synth.echoSustainToVolumeMult(
        /*echoSustainEnvelopeEnd   **/ instrument.echoSustain,
      );
      this.echoMult = echoMultStart;
      this.echoMultDelta =
        (echoMultEnd - echoMultStart) / roundedSamplesPerTick;
      maxEchoMult = Math.max(echoMultStart, echoMultEnd);

      // TODO: After computing a tick's settings once for multiple run lengths (which is
      // good for audio worklet threads), compute the echo delay envelopes at tick (or
      // part) boundaries to interpolate between two delay taps.
      //const echoDelayEnvelopeStart:   number = envelopeStarts[InstrumentAutomationIndex.echoDelay];
      //const echoDelayEnvelopeEnd:     number = envelopeEnds[  InstrumentAutomationIndex.echoDelay];
      const echoDelayOffset: number = Math.max(
        1,
        Math.round(
          (instrument.echoDelay + 1) *
            Config.echoDelayStepTicks *
            samplesPerTick,
        ),
      );
      if (this.echoDelayOffsetEnd != null) {
        this.echoDelayOffsetStart = this.echoDelayOffsetEnd;
      } else {
        this.echoDelayOffsetStart = echoDelayOffset;
      }
      this.echoDelayOffsetEnd = echoDelayOffset;
      averageEchoDelaySeconds =
        ((this.echoDelayOffsetStart + this.echoDelayOffsetEnd) * 0.5) /
        samplesPerSecond;

      this.echoDelayOffsetRatio = 0.0;
      this.echoDelayOffsetRatioDelta = 1.0 / roundedSamplesPerTick;

      if (maxEchoMult >= 1.0) {
        this.echoShelfA1 = 0.0;
        this.echoShelfB0 = 1.0;
        this.echoShelfB1 = 0.0;
      } else {
        const shelfRadians: number =
          (2.0 * Math.PI * Config.echoShelfHz) / synth.samplesPerSecond;
        Synth.tempFilterStartCoefficients.highShelf1stOrder(
          shelfRadians,
          Config.echoShelfGain,
        );
        this.echoShelfA1 = Synth.tempFilterStartCoefficients.a[1];
        this.echoShelfB0 = Synth.tempFilterStartCoefficients.b[0];
        this.echoShelfB1 = Synth.tempFilterStartCoefficients.b[1];
      }
    }

    let maxReverbMult = 0.0;
    if (usesReverb) {
      //const reverbEnvelopeStart: number = envelopeStarts[InstrumentAutomationIndex.reverb];
      //const reverbEnvelopeEnd:   number = envelopeEnds[  InstrumentAutomationIndex.reverb];
      const reverbStart: number =
        Math.pow(
          Math.max(
            0.0,
            Math.min(
              1.0,
              /*reverbEnvelopeStart **/ instrument.reverb / Config.reverbRange,
            ),
          ),
          0.667,
        ) * 0.425;
      const reverbEnd: number =
        Math.pow(
          Math.max(
            0.0,
            Math.min(
              1.0,
              /*reverbEnvelopeEnd   **/ instrument.reverb / Config.reverbRange,
            ),
          ),
          0.667,
        ) * 0.425;
      this.reverbMult = reverbStart;
      this.reverbMultDelta = (reverbEnd - reverbStart) / roundedSamplesPerTick;
      maxReverbMult = Math.max(reverbStart, reverbEnd);

      const shelfRadians: number =
        (2.0 * Math.PI * Config.reverbShelfHz) / synth.samplesPerSecond;
      Synth.tempFilterStartCoefficients.highShelf1stOrder(
        shelfRadians,
        Config.reverbShelfGain,
      );
      this.reverbShelfA1 = Synth.tempFilterStartCoefficients.a[1];
      this.reverbShelfB0 = Synth.tempFilterStartCoefficients.b[0];
      this.reverbShelfB1 = Synth.tempFilterStartCoefficients.b[1];
    }

    if (this.tonesAddedInThisTick) {
      this.attentuationProgress = 0.0;
      this.flushedSamples = 0;
      this.flushingDelayLines = false;
    } else if (!this.flushingDelayLines) {
      // If this instrument isn't playing tones anymore, the volume can fade out by the
      // end of the first tick. It's possible for filters and the panning delay line to
      // continue past the end of the tone but they should have mostly dissipated by the
      // end of the tick anyway.
      if (this.attentuationProgress == 0.0) {
        eqFilterVolumeEnd = 0.0;
      } else {
        eqFilterVolumeStart = 0.0;
        eqFilterVolumeEnd = 0.0;
      }

      const attenuationThreshold: number = 1.0 / 256.0; // when the delay line signal has attenuated this much, it should be inaudible and should be flushed to zero.
      const halfLifeMult: number = -Math.log2(attenuationThreshold);
      let delayDuration: number = 0.0;

      if (usesChorus) {
        delayDuration += Config.chorusMaxDelay;
      }

      if (usesEcho) {
        if (maxEchoMult >= 1.0) {
          delayDuration = Infinity;
        } else {
          const attenuationPerSecond: number = Math.pow(
            maxEchoMult,
            1.0 / averageEchoDelaySeconds,
          );
          const halfLife: number = -1.0 / Math.log2(attenuationPerSecond);
          const echoDuration: number = halfLife * halfLifeMult;
          delayDuration += echoDuration;
        }
      }

      if (usesReverb) {
        const averageMult: number = maxReverbMult * 2.0;
        const averageReverbDelaySeconds: number =
          Config.reverbDelayBufferSize / 4.0 / samplesPerSecond;
        const attenuationPerSecond: number = Math.pow(
          averageMult,
          1.0 / averageReverbDelaySeconds,
        );
        const halfLife: number = -1.0 / Math.log2(attenuationPerSecond);
        const reverbDuration: number = halfLife * halfLifeMult;
        delayDuration += reverbDuration;
      }

      const secondsInTick: number = samplesPerTick / samplesPerSecond;
      const progressInTick: number = secondsInTick / delayDuration;
      const progressAtEndOfTick: number =
        this.attentuationProgress + progressInTick;
      if (progressAtEndOfTick >= 1.0) {
        delayInputMultEnd = 0.0;
      }
      this.attentuationProgress = progressAtEndOfTick;
      if (this.attentuationProgress >= 1.0) {
        this.flushingDelayLines = true;
      }
    } else {
      // Flushing delay lines to zero since the signal has mostly dissipated.
      eqFilterVolumeStart = 0.0;
      eqFilterVolumeEnd = 0.0;
      delayInputMultStart = 0.0;
      delayInputMultEnd = 0.0;

      let totalDelaySamples: number = 0;
      if (usesChorus) totalDelaySamples += synth.chorusDelayBufferSize;
      if (usesEcho) totalDelaySamples += this.echoDelayLineL!.length;
      if (usesReverb) totalDelaySamples += Config.reverbDelayBufferSize;

      this.flushedSamples += roundedSamplesPerTick;
      if (this.flushedSamples >= totalDelaySamples) {
        this.deactivateAfterThisTick = true;
      }
    }

    this.eqFilterVolume = eqFilterVolumeStart;
    this.eqFilterVolumeDelta =
      (eqFilterVolumeEnd - eqFilterVolumeStart) / roundedSamplesPerTick;
    this.delayInputMult = delayInputMultStart;
    this.delayInputMultDelta =
      (delayInputMultEnd - delayInputMultStart) / roundedSamplesPerTick;
  }

  public updateWaves(instrument: Instrument, _samplesPerSecond: number): void {
    if (instrument.type == InstrumentType.chip) {
      const chipWave = Config.chipWaves[instrument.chipWave];
      this.assetId = chipWave.sampleId ?? null;
      this.assetRootKey = chipWave.sampleRootKey ?? 60;
      this.wave = this.assetId == null ? chipWave.samples : null;
    } else if (instrument.type == InstrumentType.noise) {
      this.assetId = null;
      this.wave = getDrumWave(
        instrument.chipNoise,
        inverseRealFourierTransform,
        scaleElementsByFactor,
      );
    } else if (instrument.type == InstrumentType.harmonics) {
      this.assetId = null;
      this.wave = this.harmonicsWave.getCustomWave(
        instrument.harmonicsWave,
        instrument.type,
      );
    } else if (instrument.type == InstrumentType.pickedString) {
      this.assetId = null;
      this.wave = this.harmonicsWave.getCustomWave(
        instrument.harmonicsWave,
        instrument.type,
      );
    } else if (instrument.type == InstrumentType.spectrum) {
      this.assetId = null;
      this.wave = this.spectrumWave.getCustomWave(instrument.spectrumWave, 8);
    } else if (instrument.type == InstrumentType.drumset) {
      this.assetId = null;
      for (let i: number = 0; i < Config.drumCount; i++) {
        this.drumsetSpectrumWaves[i].getCustomWave(
          instrument.drumsetSpectrumWaves[i],
          InstrumentState._drumsetIndexToSpectrumOctave(i),
        );
      }
      this.wave = null;
    } else {
      this.assetId = null;
      this.wave = null;
    }
  }

  public getDrumsetWave(pitch: number): Float32Array {
    if (this.type == InstrumentType.drumset) {
      return this.drumsetSpectrumWaves[pitch].wave!;
    } else {
      throw new Error("Unhandled instrument type in getDrumsetWave");
    }
  }

  public static drumsetIndexReferenceDelta(index: number): number {
    return (
      Instrument.frequencyFromPitch(Config.spectrumBasePitch + index * 6) /
      44100
    );
  }

  private static _drumsetIndexToSpectrumOctave(index: number): number {
    return 15 + Math.log2(InstrumentState.drumsetIndexReferenceDelta(index));
  }
}

class ChannelState {
  public readonly instruments: InstrumentState[] = [];
  public muted: boolean = false;
}

interface AssetData {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export class Synth {
  private syncSongState(): void {
    const channelCount: number = this.song!.getChannelCount();
    for (let i: number = this.channels.length; i < channelCount; i++) {
      this.channels[i] = new ChannelState();
    }
    this.channels.length = channelCount;
    for (let i: number = 0; i < channelCount; i++) {
      const channel: Channel = this.song!.channels[i];
      const channelState: ChannelState = this.channels[i];
      for (
        let j: number = channelState.instruments.length;
        j < channel.instruments.length;
        j++
      ) {
        channelState.instruments[j] = new InstrumentState();
      }
      channelState.instruments.length = channel.instruments.length;

      if (channelState.muted != channel.muted) {
        channelState.muted = channel.muted;
        if (channelState.muted) {
          for (const instrumentState of channelState.instruments) {
            instrumentState.resetAllEffects();
          }
        }
      }
    }
  }

  private warmUpSynthesizer(song: Song | null): void {
    if (song != null) {
      this.syncSongState();
      const samplesPerTick: number = this.getSamplesPerTick();
      for (let j: number = 0; j < song.getChannelCount(); j++) {
        for (let i: number = 0; i < song.channels[j].instruments.length; i++) {
          const instrument: Instrument = song.channels[j].instruments[i];
          const instrumentState: InstrumentState =
            this.channels[j].instruments[i];
          Synth.getInstrumentSynthFunction(instrument);
          instrumentState.updateWaves(instrument, this.samplesPerSecond);
          instrumentState.allocateNecessaryBuffers(
            this,
            instrument,
            samplesPerTick,
          );
        }
      }
    }
    /*
		// JummBox needed to run synth functions for at least one sample (for JIT purposes)
		// before starting audio callbacks to avoid skipping the initial output.
		var dummyArray = new Float32Array(1);
		this.synthesize(dummyArray, dummyArray, 1, true);
		*/
  }

  private static operatorAmplitudeCurve(amplitude: number): number {
    return (Math.pow(16.0, amplitude / 15.0) - 1.0) / 15.0;
  }

  public samplesPerSecond: number = 44100;
  public panningDelayBufferSize!: number;
  public panningDelayBufferMask!: number;
  public chorusDelayBufferSize!: number;
  public chorusDelayBufferMask!: number;
  // TODO: reverb

  public song: Song | null = null;
  public preferLowerLatency: boolean = false; // enable when recording performances from keyboard or MIDI. Takes effect next time you activate audio.
  public anticipatePoorPerformance: boolean = false; // enable on mobile devices to reduce audio stutter glitches. Takes effect next time you activate audio.
  public liveInputDuration: number = 0;
  public liveInputStarted: boolean = false;
  public liveInputPitches: number[] = [];
  public liveInputChannel: number = 0;
  public liveInputInstruments: number[] = [];
  public loopRepeatCount: number = -1;
  public enableMetronome: boolean = false;
  public countInMetronome: boolean = false;

  private playheadInternal: number = 0.0;
  private bar: number = 0;
  private prevBar: number | null = null;
  private nextBar: number | null = null;
  private beat: number = 0;
  private part: number = 0;
  private tick: number = 0;
  public isAtStartOfTick: boolean = true;
  public tickSampleCountdown: number = 0;
  private isPlayingSong: boolean = false;
  private isRecording: boolean = false;

  public static readonly tempFilterStartCoefficients: FilterCoefficients =
    new FilterCoefficients();
  public static readonly tempFilterEndCoefficients: FilterCoefficients =
    new FilterCoefficients();
  private tempDrumSetControlPoint: FilterControlPoint =
    new FilterControlPoint();
  public tempFrequencyResponse: FrequencyResponse = new FrequencyResponse();

  private static readonly fmSynthFunctionCache: Dictionary<Function> = {};
  private static readonly effectsFunctionCache: Function[] = Array(1 << 7).fill(
    undefined,
  ); // keep in sync with the number of post-process effects.
  private static readonly pickedStringFunctionCache: Function[] =
    Array(3).fill(undefined); // keep in sync with the number of unison voices.

  private readonly channels: ChannelState[] = [];
  private readonly tonePool: Deque<Tone> = new Deque<Tone>();
  private readonly tempMatchedPitchTones: Array<Tone | null> = Array(
    Config.maxChordSize,
  ).fill(null);
  private readonly assetData: Map<string, AssetData> = new Map();

  private startedMetronome: boolean = false;
  private metronomeSamplesRemaining: number = -1;
  private metronomeAmplitude: number = 0.0;
  private metronomePrevAmplitude: number = 0.0;
  private metronomeFilter: number = 0.0;
  private limit: number = 0.0;

  private tempMonoInstrumentSampleBuffer: Float32Array | null = null;
  private readonly soundFontBanks: Map<string, SoundFontBank> = new Map();

  public get playing(): boolean {
    return this.isPlayingSong;
  }

  public get recording(): boolean {
    return this.isRecording;
  }

  public get playhead(): number {
    return this.playheadInternal;
  }

  public set playhead(value: number) {
    if (this.song != null) {
      this.playheadInternal = Math.max(0, Math.min(this.song.barCount, value));
      let remainder: number = this.playheadInternal;
      this.bar = Math.floor(remainder);
      remainder = this.song.beatsPerBar * (remainder - this.bar);
      this.beat = Math.floor(remainder);
      remainder = Config.partsPerBeat * (remainder - this.beat);
      this.part = Math.floor(remainder);
      remainder = Config.ticksPerPart * (remainder - this.part);
      this.tick = Math.floor(remainder);
      this.tickSampleCountdown = 0;
      this.isAtStartOfTick = true;
      this.prevBar = null;
    }
  }

  public getSamplesPerBar(): number {
    if (this.song == null) throw new Error();
    return (
      this.getSamplesPerTick() *
      Config.ticksPerPart *
      Config.partsPerBeat *
      this.song.beatsPerBar
    );
  }

  public getTicksIntoBar(): number {
    return (
      (this.beat * Config.partsPerBeat + this.part) * Config.ticksPerPart +
      this.tick
    );
  }
  public getCurrentPart(): number {
    return this.beat * Config.partsPerBeat + this.part;
  }

  public getTotalBars(enableIntro: boolean, enableOutro: boolean): number {
    if (this.song == null) throw new Error();
    let bars: number = this.song.loopLength * (this.loopRepeatCount + 1);
    if (enableIntro) bars += this.song.loopStart;
    if (enableOutro)
      bars += this.song.barCount - (this.song.loopStart + this.song.loopLength);
    return bars;
  }

  constructor(song: Song | Uint8Array | null = null) {
    this.computeDelayBufferSizes();
    if (song != null) this.setSong(song);
  }

  public setSong(song: Song | Uint8Array): void {
    if (song instanceof Uint8Array) {
      this.song = new Song(song);
    } else if (song instanceof Song) {
      this.song = song;
    }
    const activeSampleIds: Set<string> = new Set(
      this.song?.assets.map((sample: AssetDefinition): string => sample.id) ??
        [],
    );
    for (const sampleId of this.assetData.keys()) {
      if (!activeSampleIds.has(sampleId)) this.assetData.delete(sampleId);
    }
    for (const soundFontId of this.soundFontBanks.keys()) {
      if (!activeSampleIds.has(soundFontId))
        this.soundFontBanks.delete(soundFontId);
    }
    this.prevBar = null;
  }

  public setAsset(
    sampleId: string,
    samples: Float32Array,
    sampleRate: number,
  ): void {
    if (samples.length == 0 || !Number.isFinite(sampleRate) || sampleRate <= 0)
      return;
    this.assetData.set(sampleId, { samples, sampleRate });
  }

  public setSoundFont(soundFontId: string, data: ArrayBuffer): void {
    this.soundFontBanks.set(soundFontId, parseSoundFont(data));
  }

  public setSampleRate(sampleRate: number): void {
    this.samplesPerSecond = sampleRate;
    this.computeDelayBufferSizes();
  }

  private computeDelayBufferSizes(): void {
    this.panningDelayBufferSize = Synth.fittingPowerOfTwo(
      this.samplesPerSecond * Config.panDelaySecondsMax,
    );
    this.panningDelayBufferMask = this.panningDelayBufferSize - 1;
    this.chorusDelayBufferSize = Synth.fittingPowerOfTwo(
      this.samplesPerSecond * Config.chorusMaxDelay,
    );
    this.chorusDelayBufferMask = this.chorusDelayBufferSize - 1;
  }

  public maintainLiveInput(): void {
    // Browser lifecycle is managed by SynthController. This remains a no-op for
    // browser-independent rendering clients that use the engine directly.
  }

  public play(): void {
    if (this.isPlayingSong) return;
    this.isPlayingSong = true;
    this.warmUpSynthesizer(this.song);
  }

  public pause(): void {
    if (!this.isPlayingSong) return;
    this.isPlayingSong = false;
    this.isRecording = false;
  }

  public startRecording(): void {
    this.preferLowerLatency = true;
    this.isRecording = true;
    this.play();
  }

  public snapToStart(): void {
    this.bar = 0;
    this.snapToBar();
  }

  public goToBar(bar: number): void {
    this.bar = bar;
    this.playheadInternal = this.bar;
    this.prevBar = null;
  }

  public snapToBar(): void {
    this.playheadInternal = this.bar;
    this.beat = 0;
    this.part = 0;
    this.tick = 0;
    this.tickSampleCountdown = 0;
    this.isAtStartOfTick = true;
    this.prevBar = null;
  }

  public resetEffects(): void {
    this.limit = 0.0;
    this.freeAllTones();
    if (this.song != null) {
      for (const channelState of this.channels) {
        for (const instrumentState of channelState.instruments) {
          instrumentState.resetAllEffects();
        }
      }
    }
  }

  public jumpIntoLoop(): void {
    if (!this.song) return;
    if (
      this.bar < this.song.loopStart ||
      this.bar >= this.song.loopStart + this.song.loopLength
    ) {
      const oldBar: number = this.bar;
      this.bar = this.song.loopStart;
      this.playheadInternal += this.bar - oldBar;
      this.prevBar = null;
    }
  }

  public goToNextBar(): void {
    if (!this.song) return;
    this.prevBar = this.bar;
    const oldBar: number = this.bar;
    this.bar++;
    if (this.bar >= this.song.barCount) {
      this.bar = 0;
    }
    this.playheadInternal += this.bar - oldBar;
  }

  public goToPrevBar(): void {
    if (!this.song) return;
    this.prevBar = null;
    const oldBar: number = this.bar;
    this.bar--;
    if (this.bar < 0 || this.bar >= this.song.barCount) {
      this.bar = this.song.barCount - 1;
    }
    this.playheadInternal += this.bar - oldBar;
  }

  private getNextBar(): number {
    let nextBar: number = this.bar + 1;
    if (this.isRecording) {
      if (nextBar >= this.song!.barCount) {
        nextBar = this.song!.barCount - 1;
      }
    } else if (
      this.loopRepeatCount != 0 &&
      nextBar == this.song!.loopStart + this.song!.loopLength
    ) {
      nextBar = this.song!.loopStart;
    }
    return nextBar;
  }

  public synthesize(
    outputDataL: Float32Array,
    outputDataR: Float32Array,
    outputBufferLength: number,
    playSong: boolean = true,
  ): void {
    if (this.song == null) {
      for (let i: number = 0; i < outputBufferLength; i++) {
        outputDataL[i] = 0.0;
        outputDataR[i] = 0.0;
      }
      return;
    }

    const song: Song = this.song;
    const samplesPerTick: number = this.getSamplesPerTick();
    let ended: boolean = false;

    // Check the bounds of the playhead:
    if (
      this.tickSampleCountdown <= 0 ||
      this.tickSampleCountdown > samplesPerTick
    ) {
      this.tickSampleCountdown = samplesPerTick;
      this.isAtStartOfTick = true;
    }
    if (playSong) {
      if (this.beat >= song.beatsPerBar) {
        this.beat = 0;
        this.part = 0;
        this.tick = 0;
        this.tickSampleCountdown = samplesPerTick;
        this.isAtStartOfTick = true;

        this.prevBar = this.bar;
        this.bar = this.getNextBar();
        if (this.bar <= this.prevBar && this.loopRepeatCount > 0)
          this.loopRepeatCount--;
      }
      if (this.bar >= song.barCount) {
        if (this.loopRepeatCount != -1) {
          this.bar = song.barCount - 1;
          ended = true;
          this.pause();
        } else {
          this.bar = 0;
        }
      }
    }

    //const synthStartTime: number = performance.now();

    this.syncSongState();

    if (
      this.tempMonoInstrumentSampleBuffer == null ||
      this.tempMonoInstrumentSampleBuffer.length < outputBufferLength
    ) {
      this.tempMonoInstrumentSampleBuffer = new Float32Array(
        outputBufferLength,
      );
    }

    // Post processing parameters:
    const limitDecay: number = 1.0 - Math.pow(0.5, 4.0 / this.samplesPerSecond);
    const limitRise: number =
      1.0 - Math.pow(0.5, 4000.0 / this.samplesPerSecond);
    let limit: number = +this.limit;

    let bufferIndex: number = 0;
    while (bufferIndex < outputBufferLength && !ended) {
      this.nextBar = this.getNextBar();
      if (this.nextBar >= song.barCount) this.nextBar = null;

      const samplesLeftInBuffer: number = outputBufferLength - bufferIndex;
      const samplesLeftInTick: number = Math.ceil(this.tickSampleCountdown);
      const runLength: number = Math.min(
        samplesLeftInTick,
        samplesLeftInBuffer,
      );
      const runEnd: number = bufferIndex + runLength;
      for (
        let channelIndex: number = 0;
        channelIndex < song.getChannelCount();
        channelIndex++
      ) {
        const channel: Channel = song.channels[channelIndex];
        const channelState: ChannelState = this.channels[channelIndex];

        if (this.isAtStartOfTick) {
          this.determineCurrentActiveTones(
            song,
            channelIndex,
            samplesPerTick,
            playSong && !this.countInMetronome,
          );
          this.determineLiveInputTones(song, channelIndex, samplesPerTick);
        }

        for (
          let instrumentIndex: number = 0;
          instrumentIndex < channel.instruments.length;
          instrumentIndex++
        ) {
          const instrument: Instrument = channel.instruments[instrumentIndex];
          const instrumentState: InstrumentState =
            channelState.instruments[instrumentIndex];

          if (this.isAtStartOfTick) {
            let tonesPlayedInThisInstrument: number =
              instrumentState.activeTones.count() +
              instrumentState.liveInputTones.count();
            for (
              let i: number = 0;
              i < instrumentState.releasedTones.count();
              i++
            ) {
              const tone: Tone = instrumentState.releasedTones.get(i);
              if (
                tone.ticksSinceReleased >=
                Math.abs(instrument.getFadeOutTicks())
              ) {
                this.freeReleasedTone(instrumentState, i);
                i--;
                continue;
              }
              const shouldFadeOutFast: boolean =
                tonesPlayedInThisInstrument >= Config.maximumTonesPerChannel;
              this.computeTone(
                song,
                channelIndex,
                samplesPerTick,
                tone,
                true,
                shouldFadeOutFast,
              );
              tonesPlayedInThisInstrument++;
            }

            if (instrumentState.awake) {
              if (!instrumentState.computed) {
                instrumentState.compute(
                  this,
                  instrument,
                  samplesPerTick,
                  Math.ceil(samplesPerTick),
                  null,
                );
              }
              instrumentState.computed = false;
              //instrumentState.envelopeComputer.clearEnvelopes();
            }
          }

          for (
            let i: number = 0;
            i < instrumentState.activeTones.count();
            i++
          ) {
            const tone: Tone = instrumentState.activeTones.get(i);
            this.playTone(channelIndex, bufferIndex, runLength, tone);
          }

          for (
            let i: number = 0;
            i < instrumentState.liveInputTones.count();
            i++
          ) {
            const tone: Tone = instrumentState.liveInputTones.get(i);
            this.playTone(channelIndex, bufferIndex, runLength, tone);
          }

          for (
            let i: number = 0;
            i < instrumentState.releasedTones.count();
            i++
          ) {
            const tone: Tone = instrumentState.releasedTones.get(i);
            this.playTone(channelIndex, bufferIndex, runLength, tone);
          }

          if (instrumentState.awake) {
            Synth.effectsSynth(
              this,
              outputDataL,
              outputDataR,
              bufferIndex,
              runLength,
              instrumentState,
            );
          }
        }
      }

      if (this.enableMetronome || this.countInMetronome) {
        if (this.part == 0) {
          if (!this.startedMetronome) {
            const midBeat: boolean =
              song.beatsPerBar > 4 &&
              song.beatsPerBar % 2 == 0 &&
              this.beat == song.beatsPerBar / 2;
            const periods: number = this.beat == 0 ? 8 : midBeat ? 6 : 4;
            const hz: number = this.beat == 0 ? 1600 : midBeat ? 1200 : 800;
            const amplitude: number =
              this.beat == 0 ? 0.06 : midBeat ? 0.05 : 0.04;
            const samplesPerPeriod: number = this.samplesPerSecond / hz;
            const radiansPerSample: number = (Math.PI * 2.0) / samplesPerPeriod;
            this.metronomeSamplesRemaining = Math.floor(
              samplesPerPeriod * periods,
            );
            this.metronomeFilter = 2.0 * Math.cos(radiansPerSample);
            this.metronomeAmplitude = amplitude * Math.sin(radiansPerSample);
            this.metronomePrevAmplitude = 0.0;

            this.startedMetronome = true;
          }
          if (this.metronomeSamplesRemaining > 0) {
            const stopIndex: number = Math.min(
              runEnd,
              bufferIndex + this.metronomeSamplesRemaining,
            );
            this.metronomeSamplesRemaining -= stopIndex - bufferIndex;
            for (let i: number = bufferIndex; i < stopIndex; i++) {
              outputDataL[i] += this.metronomeAmplitude;
              outputDataR[i] += this.metronomeAmplitude;
              const tempAmplitude: number =
                this.metronomeFilter * this.metronomeAmplitude -
                this.metronomePrevAmplitude;
              this.metronomePrevAmplitude = this.metronomeAmplitude;
              this.metronomeAmplitude = tempAmplitude;
            }
          }
        } else {
          this.startedMetronome = false;
        }
      }

      // Post processing:
      for (let i: number = bufferIndex; i < runEnd; i++) {
        // A compressor/limiter.
        const sampleL = outputDataL[i];
        const sampleR = outputDataR[i];
        const abs: number = Math.max(Math.abs(sampleL), Math.abs(sampleR));
        limit +=
          (abs - limit) *
          (limit < abs ? limitRise : limitDecay * (1.0 + limit));
        const limitedVolume =
          1.0 / (limit >= 1 ? limit * 1.05 : limit * 0.8 + 0.25);
        outputDataL[i] = sampleL * limitedVolume;
        outputDataR[i] = sampleR * limitedVolume;
      }

      bufferIndex += runLength;

      this.isAtStartOfTick = false;
      this.tickSampleCountdown -= runLength;
      if (this.tickSampleCountdown <= 0) {
        this.isAtStartOfTick = true;

        // Track how long tones have been released, and free ones that are marked as ending.
        // Also reset awake InstrumentStates that didn't have any Tones during this tick.
        for (const channelState of this.channels) {
          for (const instrumentState of channelState.instruments) {
            for (
              let i: number = 0;
              i < instrumentState.releasedTones.count();
              i++
            ) {
              const tone: Tone = instrumentState.releasedTones.get(i);
              if (tone.isOnLastTick) {
                this.freeReleasedTone(instrumentState, i);
                i--;
              } else {
                tone.ticksSinceReleased++;
              }
            }
            if (instrumentState.deactivateAfterThisTick) {
              instrumentState.deactivate();
            }
            instrumentState.tonesAddedInThisTick = false;
          }
        }

        this.tick++;
        this.tickSampleCountdown += samplesPerTick;
        if (this.tick == Config.ticksPerPart) {
          this.tick = 0;
          this.part++;
          this.liveInputDuration--;

          if (this.part == Config.partsPerBeat) {
            this.part = 0;

            if (playSong) {
              this.beat++;
              if (this.beat == song.beatsPerBar) {
                // bar changed, reset for next bar:
                this.beat = 0;

                if (this.countInMetronome) {
                  this.countInMetronome = false;
                } else {
                  this.prevBar = this.bar;
                  this.bar = this.getNextBar();
                  if (this.bar <= this.prevBar && this.loopRepeatCount > 0)
                    this.loopRepeatCount--;

                  if (this.bar >= song.barCount) {
                    if (this.loopRepeatCount != -1) {
                      this.bar = song.barCount - 1;
                      ended = true;
                      this.resetEffects();
                      this.pause();
                    } else {
                      this.bar = 0;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Avoid persistent denormal or NaN values.
    if (!Number.isFinite(limit) || Math.abs(limit) < epsilon) limit = 0.0;
    this.limit = limit;

    if (playSong && !this.countInMetronome) {
      this.playheadInternal =
        (((this.tick + 1.0 - this.tickSampleCountdown / samplesPerTick) / 2.0 +
          this.part) /
          Config.partsPerBeat +
          this.beat) /
          song.beatsPerBar +
        this.bar;
    }

    /*
		const synthDuration: number = performance.now() - synthStartTime;
		// Performance measurements:
		samplesAccumulated += outputBufferLength;
		samplePerformance += synthDuration;

		if (samplesAccumulated >= 44100 * 4) {
			const secondsGenerated = samplesAccumulated / 44100;
			const secondsRequired = samplePerformance / 1000;
			const ratio = secondsRequired / secondsGenerated;
			console.log(ratio);
			samplePerformance = 0;
			samplesAccumulated = 0;
		}
		*/
  }

  private freeTone(tone: Tone): void {
    this.tonePool.pushBack(tone);
  }

  private newTone(): Tone {
    const tone: Tone =
      this.tonePool.count() > 0 ? this.tonePool.popBack() : new Tone();
    tone.freshlyAllocated = true;
    return tone;
  }

  private releaseTone(instrumentState: InstrumentState, tone: Tone): void {
    instrumentState.releasedTones.pushFront(tone);
    tone.atNoteStart = false;
    tone.passedEndOfNote = true;
    tone.released = true;
  }

  private freeReleasedTone(
    instrumentState: InstrumentState,
    toneIndex: number,
  ): void {
    this.freeTone(instrumentState.releasedTones.get(toneIndex));
    instrumentState.releasedTones.remove(toneIndex);
  }

  public freeAllTones(): void {
    for (const channelState of this.channels) {
      for (const instrumentState of channelState.instruments) {
        while (instrumentState.activeTones.count() > 0)
          this.freeTone(instrumentState.activeTones.popBack());
        while (instrumentState.releasedTones.count() > 0)
          this.freeTone(instrumentState.releasedTones.popBack());
        while (instrumentState.liveInputTones.count() > 0)
          this.freeTone(instrumentState.liveInputTones.popBack());
      }
    }
  }

  private determineLiveInputTones(
    song: Song,
    channelIndex: number,
    samplesPerTick: number,
  ): void {
    const channel: Channel = song.channels[channelIndex];
    const channelState: ChannelState = this.channels[channelIndex];
    const pitches: number[] = this.liveInputPitches;

    for (
      let instrumentIndex: number = 0;
      instrumentIndex < channel.instruments.length;
      instrumentIndex++
    ) {
      const instrumentState: InstrumentState =
        channelState.instruments[instrumentIndex];
      const toneList: Deque<Tone> = instrumentState.liveInputTones;
      let toneCount: number = 0;
      if (
        this.liveInputDuration > 0 &&
        channelIndex == this.liveInputChannel &&
        pitches.length > 0 &&
        this.liveInputInstruments.indexOf(instrumentIndex) != -1
      ) {
        const instrument: Instrument = channel.instruments[instrumentIndex];

        if (instrument.getChord().singleTone) {
          let tone: Tone;
          if (toneList.count() <= toneCount) {
            tone = this.newTone();
            toneList.pushBack(tone);
          } else if (
            !instrument.getTransition().isSeamless &&
            this.liveInputStarted
          ) {
            this.releaseTone(instrumentState, toneList.get(toneCount));
            tone = this.newTone();
            toneList.set(toneCount, tone);
          } else {
            tone = toneList.get(toneCount);
          }
          toneCount++;

          for (let i: number = 0; i < pitches.length; i++) {
            tone.pitches[i] = pitches[i];
          }
          tone.pitchCount = pitches.length;
          tone.chordSize = 1;
          tone.instrumentIndex = instrumentIndex;
          tone.note = tone.prevNote = tone.nextNote = null;
          tone.atNoteStart = this.liveInputStarted;
          tone.forceContinueAtStart = false;
          tone.forceContinueAtEnd = false;
          this.computeTone(
            song,
            channelIndex,
            samplesPerTick,
            tone,
            false,
            false,
          );
        } else {
          //const transition: Transition = instrument.getTransition();

          this.moveTonesIntoOrderedTempMatchedList(toneList, pitches);

          for (let i: number = 0; i < pitches.length; i++) {
            //const strumOffsetParts: number = i * instrument.getChord().strumParts;

            let tone: Tone;
            if (this.tempMatchedPitchTones[toneCount] != null) {
              tone = this.tempMatchedPitchTones[toneCount]!;
              this.tempMatchedPitchTones[toneCount] = null;
              if (tone.pitchCount != 1 || tone.pitches[0] != pitches[i]) {
                this.releaseTone(instrumentState, tone);
                tone = this.newTone();
              }
              toneList.pushBack(tone);
            } else {
              tone = this.newTone();
              toneList.pushBack(tone);
            }
            toneCount++;

            tone.pitches[0] = pitches[i];
            tone.pitchCount = 1;
            tone.chordSize = pitches.length;
            tone.instrumentIndex = instrumentIndex;
            tone.note = tone.prevNote = tone.nextNote = null;
            tone.atNoteStart = this.liveInputStarted;
            tone.forceContinueAtStart = false;
            tone.forceContinueAtEnd = false;
            this.computeTone(
              song,
              channelIndex,
              samplesPerTick,
              tone,
              false,
              false,
            );
          }
        }
      }

      while (toneList.count() > toneCount) {
        this.releaseTone(instrumentState, toneList.popBack());
      }

      this.clearTempMatchedPitchTones(toneCount, instrumentState);
    }

    this.liveInputStarted = false;
  }

  // Returns the chord type of the instrument in the adjacent pattern if it is compatible for a
  // seamless transition across patterns, otherwise returns null.
  private adjacentPatternHasCompatibleInstrumentTransition(
    transition: Transition,
    chord: Chord,
    forceContinue: boolean,
  ): Chord | null {
    return forceContinue || transition.includeAdjacentPatterns ? chord : null;
  }

  public static adjacentNotesHaveMatchingPitches(
    firstNote: Note,
    secondNote: Note,
  ): boolean {
    if (firstNote.pitches.length != secondNote.pitches.length) return false;
    const firstNoteInterval: number =
      firstNote.pins[firstNote.pins.length - 1].interval;
    for (const pitch of firstNote.pitches) {
      if (secondNote.pitches.indexOf(pitch + firstNoteInterval) == -1)
        return false;
    }
    return true;
  }

  private moveTonesIntoOrderedTempMatchedList(
    toneList: Deque<Tone>,
    notePitches: number[],
  ): void {
    // The tones are about to seamlessly transition to a new note. The pitches
    // from the old note may or may not match any of the pitches in the new
    // note, and not necessarily in order, but if any do match, they'll sound
    // better if those tones continue to have the same pitch. Attempt to find
    // the right spot for each old tone in the new chord if possible.

    for (let i: number = 0; i < toneList.count(); i++) {
      const tone: Tone = toneList.get(i);
      const pitch: number = tone.pitches[0] + tone.lastInterval;
      for (let j: number = 0; j < notePitches.length; j++) {
        if (notePitches[j] == pitch) {
          this.tempMatchedPitchTones[j] = tone;
          toneList.remove(i);
          i--;
          break;
        }
      }
    }

    // Any tones that didn't get matched should just fill in the gaps.
    while (toneList.count() > 0) {
      const tone: Tone = toneList.popFront();
      for (let j: number = 0; j < this.tempMatchedPitchTones.length; j++) {
        if (this.tempMatchedPitchTones[j] == null) {
          this.tempMatchedPitchTones[j] = tone;
          break;
        }
      }
    }
  }

  private determineCurrentActiveTones(
    song: Song,
    channelIndex: number,
    samplesPerTick: number,
    playSong: boolean,
  ): void {
    const channel: Channel = song.channels[channelIndex];
    const channelState: ChannelState = this.channels[channelIndex];
    const pattern: Pattern | null = song.getPattern(channelIndex, this.bar);
    const currentPart: number = this.getCurrentPart();
    const currentTick: number = this.tick + Config.ticksPerPart * currentPart;
    let note: Note | null = null;
    let prevNote: Note | null = null;
    let nextNote: Note | null = null;

    if (
      playSong &&
      pattern != null &&
      !channel.muted &&
      (!this.isRecording || this.liveInputChannel != channelIndex)
    ) {
      for (let i: number = 0; i < pattern.notes.length; i++) {
        if (pattern.notes[i].end <= currentPart) {
          prevNote = pattern.notes[i];
        } else if (
          pattern.notes[i].start <= currentPart &&
          pattern.notes[i].end > currentPart
        ) {
          note = pattern.notes[i];
        } else if (pattern.notes[i].start > currentPart) {
          nextNote = pattern.notes[i];
          break;
        }
      }

      if (note != null) {
        if (prevNote != null && prevNote.end != note.start) prevNote = null;
        if (nextNote != null && nextNote.start != note.end) nextNote = null;
      }
    }

    for (
      let instrumentIndex: number = 0;
      instrumentIndex < channel.instruments.length;
      instrumentIndex++
    ) {
      const instrumentState: InstrumentState =
        channelState.instruments[instrumentIndex];
      const toneList: Deque<Tone> = instrumentState.activeTones;
      let toneCount: number = 0;
      if (note != null) {
        const instrument: Instrument = channel.instruments[instrumentIndex];
        let prevNoteForThisInstrument: Note | null = prevNote;
        let nextNoteForThisInstrument: Note | null = nextNote;

        const partsPerBar: Number = Config.partsPerBeat * song.beatsPerBar;
        const transition: Transition = instrument.getTransition();
        const chord: Chord = instrument.getChord();
        let forceContinueAtStart: boolean = false;
        let forceContinueAtEnd: boolean = false;
        let tonesInPrevNote: number = 0;
        let tonesInNextNote: number = 0;
        if (note.start == 0) {
          // If the beginning of the note coincides with the beginning of the pattern,
          // look for an adjacent note at the end of the previous pattern.
          let prevPattern: Pattern | null =
            this.prevBar == null
              ? null
              : song.getPattern(channelIndex, this.prevBar);
          if (prevPattern != null) {
            const lastNote: Note | null =
              prevPattern.notes.length <= 0
                ? null
                : prevPattern.notes[prevPattern.notes.length - 1];
            if (lastNote != null && lastNote.end == partsPerBar) {
              const patternForcesContinueAtStart: boolean =
                note.continuesLastPattern &&
                Synth.adjacentNotesHaveMatchingPitches(lastNote, note);
              const chordOfCompatibleInstrument: Chord | null =
                this.adjacentPatternHasCompatibleInstrumentTransition(
                  transition,
                  chord,
                  patternForcesContinueAtStart,
                );
              if (chordOfCompatibleInstrument != null) {
                prevNoteForThisInstrument = lastNote;
                tonesInPrevNote = chordOfCompatibleInstrument.singleTone
                  ? 1
                  : prevNoteForThisInstrument.pitches.length;
                forceContinueAtStart = patternForcesContinueAtStart;
              }
            }
          }
        } else if (prevNoteForThisInstrument != null) {
          tonesInPrevNote = chord.singleTone
            ? 1
            : prevNoteForThisInstrument.pitches.length;
        }
        if (note.end == partsPerBar) {
          // If the end of the note coincides with the end of the pattern, look for an
          // adjacent note at the beginning of the next pattern.
          let nextPattern: Pattern | null =
            this.nextBar == null
              ? null
              : song.getPattern(channelIndex, this.nextBar);
          if (nextPattern != null) {
            const firstNote: Note | null =
              nextPattern.notes.length <= 0 ? null : nextPattern.notes[0];
            if (firstNote != null && firstNote.start == 0) {
              const nextPatternForcesContinueAtStart: boolean =
                firstNote.continuesLastPattern &&
                Synth.adjacentNotesHaveMatchingPitches(note, firstNote);
              const chordOfCompatibleInstrument: Chord | null =
                this.adjacentPatternHasCompatibleInstrumentTransition(
                  transition,
                  chord,
                  nextPatternForcesContinueAtStart,
                );
              if (chordOfCompatibleInstrument != null) {
                nextNoteForThisInstrument = firstNote;
                tonesInNextNote = chordOfCompatibleInstrument.singleTone
                  ? 1
                  : nextNoteForThisInstrument.pitches.length;
                forceContinueAtEnd = nextPatternForcesContinueAtStart;
              }
            }
          }
        } else if (nextNoteForThisInstrument != null) {
          tonesInNextNote = chord.singleTone
            ? 1
            : nextNoteForThisInstrument.pitches.length;
        }

        if (chord.singleTone) {
          const atNoteStart: boolean =
            Config.ticksPerPart * note.start == currentTick;
          let tone: Tone;
          if (toneList.count() <= toneCount) {
            tone = this.newTone();
            toneList.pushBack(tone);
          } else if (
            atNoteStart &&
            ((!transition.isSeamless && !forceContinueAtStart) ||
              prevNoteForThisInstrument == null)
          ) {
            const oldTone: Tone = toneList.get(toneCount);
            if (oldTone.isOnLastTick) {
              this.freeTone(oldTone);
            } else {
              this.releaseTone(instrumentState, oldTone);
            }
            tone = this.newTone();
            toneList.set(toneCount, tone);
          } else {
            tone = toneList.get(toneCount);
          }
          toneCount++;

          for (let i: number = 0; i < note.pitches.length; i++) {
            tone.pitches[i] = note.pitches[i];
          }
          tone.pitchCount = note.pitches.length;
          tone.chordSize = 1;
          tone.instrumentIndex = instrumentIndex;
          tone.note = note;
          tone.noteStartPart = note.start;
          tone.noteEndPart = note.end;
          tone.prevNote = prevNoteForThisInstrument;
          tone.nextNote = nextNoteForThisInstrument;
          tone.prevNotePitchIndex = 0;
          tone.nextNotePitchIndex = 0;
          tone.atNoteStart = atNoteStart;
          tone.passedEndOfNote = false;
          tone.forceContinueAtStart = forceContinueAtStart;
          tone.forceContinueAtEnd = forceContinueAtEnd;
          this.computeTone(
            song,
            channelIndex,
            samplesPerTick,
            tone,
            false,
            false,
          );
        } else {
          const transition: Transition = instrument.getTransition();

          if (
            ((transition.isSeamless &&
              !transition.slides &&
              chord.strumParts == 0) ||
              forceContinueAtStart) &&
            Config.ticksPerPart * note.start == currentTick &&
            prevNoteForThisInstrument != null
          ) {
            this.moveTonesIntoOrderedTempMatchedList(toneList, note.pitches);
          }

          let strumOffsetParts: number = 0;
          for (let i: number = 0; i < note.pitches.length; i++) {
            let prevNoteForThisTone: Note | null =
              tonesInPrevNote > i ? prevNoteForThisInstrument : null;
            let noteForThisTone: Note = note;
            let nextNoteForThisTone: Note | null =
              tonesInNextNote > i ? nextNoteForThisInstrument : null;
            let noteStartPart: number =
              noteForThisTone.start + strumOffsetParts;
            let passedEndOfNote: boolean = false;

            // Strumming may mean that a note's actual start time may be after the
            // note's displayed start time. If the note start hasn't been reached yet,
            // carry over the previous tone if available and seamless, otherwise skip
            // the new tone until it is ready to start.
            if (noteStartPart > currentPart) {
              if (
                toneList.count() > i &&
                (transition.isSeamless || forceContinueAtStart) &&
                prevNoteForThisTone != null
              ) {
                // Continue the previous note's chord until the current one takes over.
                nextNoteForThisTone = noteForThisTone;
                noteForThisTone = prevNoteForThisTone;
                prevNoteForThisTone = null;
                noteStartPart = noteForThisTone.start + strumOffsetParts;
                passedEndOfNote = true;
              } else {
                // This and the rest of the tones in the chord shouldn't start yet.
                break;
              }
            }

            let noteEndPart: number = noteForThisTone.end;
            if (
              (transition.isSeamless || forceContinueAtStart) &&
              nextNoteForThisTone != null
            ) {
              noteEndPart = Math.min(
                Config.partsPerBeat * this.song!.beatsPerBar,
                noteEndPart + strumOffsetParts,
              );
            }
            if (
              (!transition.continues && !forceContinueAtStart) ||
              prevNoteForThisTone == null
            ) {
              strumOffsetParts += chord.strumParts;
            }

            const atNoteStart: boolean =
              Config.ticksPerPart * noteStartPart == currentTick;
            let tone: Tone;
            if (this.tempMatchedPitchTones[toneCount] != null) {
              tone = this.tempMatchedPitchTones[toneCount]!;
              this.tempMatchedPitchTones[toneCount] = null;
              toneList.pushBack(tone);
            } else if (toneList.count() <= toneCount) {
              tone = this.newTone();
              toneList.pushBack(tone);
            } else if (
              atNoteStart &&
              ((!transition.isSeamless && !forceContinueAtStart) ||
                prevNoteForThisTone == null)
            ) {
              const oldTone: Tone = toneList.get(toneCount);
              if (oldTone.isOnLastTick) {
                this.freeTone(oldTone);
              } else {
                this.releaseTone(instrumentState, oldTone);
              }
              tone = this.newTone();
              toneList.set(toneCount, tone);
            } else {
              tone = toneList.get(toneCount);
            }
            toneCount++;

            tone.pitches[0] = noteForThisTone.pitches[i];
            tone.pitchCount = 1;
            tone.chordSize = noteForThisTone.pitches.length;
            tone.instrumentIndex = instrumentIndex;
            tone.note = noteForThisTone;
            tone.noteStartPart = noteStartPart;
            tone.noteEndPart = noteEndPart;
            tone.prevNote = prevNoteForThisTone;
            tone.nextNote = nextNoteForThisTone;
            tone.prevNotePitchIndex = i;
            tone.nextNotePitchIndex = i;
            tone.atNoteStart = atNoteStart;
            tone.passedEndOfNote = passedEndOfNote;
            tone.forceContinueAtStart =
              forceContinueAtStart && prevNoteForThisTone != null;
            tone.forceContinueAtEnd =
              forceContinueAtEnd && nextNoteForThisTone != null;
            this.computeTone(
              song,
              channelIndex,
              samplesPerTick,
              tone,
              false,
              false,
            );
          }
        }
      }

      // Automatically free or release seamless tones if there's no new note to take over.
      while (toneList.count() > toneCount) {
        const tone: Tone = toneList.popBack();
        const channel: Channel = song.channels[channelIndex];
        if (
          tone.instrumentIndex < channel.instruments.length &&
          !tone.isOnLastTick
        ) {
          const instrumentState: InstrumentState =
            channelState.instruments[tone.instrumentIndex];
          this.releaseTone(instrumentState, tone);
        } else {
          this.freeTone(tone);
        }
      }

      this.clearTempMatchedPitchTones(toneCount, instrumentState);
    }
  }

  private clearTempMatchedPitchTones(
    toneCount: number,
    instrumentState: InstrumentState,
  ): void {
    for (
      let i: number = toneCount;
      i < this.tempMatchedPitchTones.length;
      i++
    ) {
      const oldTone: Tone | null = this.tempMatchedPitchTones[i];
      if (oldTone != null) {
        if (oldTone.isOnLastTick) {
          this.freeTone(oldTone);
        } else {
          this.releaseTone(instrumentState, oldTone);
        }
        this.tempMatchedPitchTones[i] = null;
      }
    }
  }

  private playTone(
    channelIndex: number,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
  ): void {
    const channelState: ChannelState = this.channels[channelIndex];
    const instrumentState: InstrumentState =
      channelState.instruments[tone.instrumentIndex];

    instrumentState.synthesizer!(
      this,
      bufferIndex,
      runLength,
      tone,
      instrumentState,
    );
    tone.envelopeComputer.clearEnvelopes();
  }

  private static computeChordExpression(chordSize: number): number {
    return 1.0 / ((chordSize - 1) * 0.25 + 1.0);
  }

  private computeTone(
    song: Song,
    channelIndex: number,
    samplesPerTick: number,
    tone: Tone,
    released: boolean,
    shouldFadeOutFast: boolean,
  ): void {
    const roundedSamplesPerTick: number = Math.ceil(samplesPerTick);
    const channel: Channel = song.channels[channelIndex];
    const channelState: ChannelState = this.channels[channelIndex];
    const instrument: Instrument = channel.instruments[tone.instrumentIndex];
    const instrumentState: InstrumentState =
      channelState.instruments[tone.instrumentIndex];
    instrumentState.awake = true;
    instrumentState.tonesAddedInThisTick = true;
    if (!instrumentState.computed) {
      instrumentState.compute(
        this,
        instrument,
        samplesPerTick,
        roundedSamplesPerTick,
        tone,
      );
    }
    const isNoiseChannel: boolean = song.getChannelIsNoise(channelIndex);
    const transition: Transition = instrument.getTransition();
    const chord: Chord = instrument.getChord();
    const chordExpression: number = chord.singleTone
      ? 1.0
      : Synth.computeChordExpression(tone.chordSize);
    const intervalScale: number = isNoiseChannel ? Config.noiseInterval : 1;
    const secondsPerPart: number =
      (Config.ticksPerPart * samplesPerTick) / this.samplesPerSecond;
    const sampleTime: number = 1.0 / this.samplesPerSecond;
    const beatsPerPart: number = 1.0 / Config.partsPerBeat;
    const ticksIntoBar: number = this.getTicksIntoBar();
    const partTimeStart: number = ticksIntoBar / Config.ticksPerPart;
    const partTimeEnd: number = (ticksIntoBar + 1.0) / Config.ticksPerPart;
    const currentPart: number = this.getCurrentPart();

    let specialIntervalMult: number = 1.0;
    tone.specialIntervalExpressionMult = 1.0;

    let toneIsOnLastTick: boolean = shouldFadeOutFast;
    let intervalStart: number = 0.0;
    let intervalEnd: number = 0.0;
    let fadeExpressionStart: number = 1.0;
    let fadeExpressionEnd: number = 1.0;
    let chordExpressionStart: number = chordExpression;
    let chordExpressionEnd: number = chordExpression;

    let expressionReferencePitch: number = 16; // A low "E" as a MIDI pitch.
    let basePitch: number = Config.keys[song.key].basePitch;
    let baseExpression: number = 1.0;
    let pitchDamping: number = 48;
    if (instrument.type == InstrumentType.spectrum) {
      baseExpression = Config.spectrumBaseExpression;
      if (isNoiseChannel) {
        basePitch = Config.spectrumBasePitch;
        baseExpression *= 2.0; // Note: spectrum is louder for drum channels than pitch channels!
      }
      expressionReferencePitch = Config.spectrumBasePitch;
      pitchDamping = 28;
    } else if (instrument.type == InstrumentType.drumset) {
      basePitch = Config.spectrumBasePitch;
      baseExpression = Config.drumsetBaseExpression;
      expressionReferencePitch = basePitch;
    } else if (instrument.type == InstrumentType.noise) {
      basePitch = Config.chipNoises[instrument.chipNoise].basePitch;
      baseExpression = Config.noiseBaseExpression;
      expressionReferencePitch = basePitch;
      pitchDamping = Config.chipNoises[instrument.chipNoise].isSoft
        ? 24.0
        : 60.0;
    } else if (instrument.type == InstrumentType.fm) {
      baseExpression = Config.fmBaseExpression;
    } else if (instrument.type == InstrumentType.chip) {
      baseExpression = Config.chipBaseExpression;
    } else if (instrument.type == InstrumentType.harmonics) {
      baseExpression = Config.harmonicsBaseExpression;
    } else if (instrument.type == InstrumentType.pwm) {
      baseExpression = Config.pwmBaseExpression;
    } else if (instrument.type == InstrumentType.supersaw) {
      baseExpression = Config.supersawBaseExpression;
    } else if (instrument.type == InstrumentType.pickedString) {
      baseExpression = Config.pickedStringBaseExpression;
    } else if (instrument.type == InstrumentType.soundFont) {
      baseExpression = Config.chipBaseExpression;
    } else {
      throw new Error("Unknown instrument type in computeTone.");
    }

    if (
      (tone.atNoteStart &&
        !transition.isSeamless &&
        !tone.forceContinueAtStart) ||
      tone.freshlyAllocated
    ) {
      tone.reset();
    }
    tone.freshlyAllocated = false;

    for (let i: number = 0; i < Config.maxPitchOrOperatorCount; i++) {
      tone.phaseDeltas[i] = 0.0;
      tone.phaseDeltaScales[i] = 0.0;
      tone.operatorExpressions[i] = 0.0;
      tone.operatorExpressionDeltas[i] = 0.0;
    }
    tone.expression = 0.0;
    tone.expressionDelta = 0.0;

    if (released) {
      const startTicksSinceReleased: number = tone.ticksSinceReleased;
      const endTicksSinceReleased: number = tone.ticksSinceReleased + 1.0;
      intervalStart = intervalEnd = tone.lastInterval;
      const fadeOutTicks: number = Math.abs(instrument.getFadeOutTicks());
      fadeExpressionStart = Synth.noteSizeToVolumeMult(
        (1.0 - startTicksSinceReleased / fadeOutTicks) * Config.noteSizeMax,
      );
      fadeExpressionEnd = Synth.noteSizeToVolumeMult(
        (1.0 - endTicksSinceReleased / fadeOutTicks) * Config.noteSizeMax,
      );

      if (shouldFadeOutFast) {
        fadeExpressionEnd = 0.0;
      }

      if (tone.ticksSinceReleased + 1 >= fadeOutTicks) toneIsOnLastTick = true;
    } else if (tone.note == null) {
      fadeExpressionStart = fadeExpressionEnd = 1.0;
      tone.lastInterval = 0;
      tone.ticksSinceReleased = 0;
      tone.liveInputSamplesHeld += roundedSamplesPerTick;
    } else {
      const note: Note = tone.note;
      const nextNote: Note | null = tone.nextNote;

      const noteStartPart: number = tone.noteStartPart;
      const noteEndPart: number = tone.noteEndPart;

      const endPinIndex: number = note.getEndPinIndex(currentPart);
      const startPin: NotePin = note.pins[endPinIndex - 1];
      const endPin: NotePin = note.pins[endPinIndex];
      const noteStartTick: number = noteStartPart * Config.ticksPerPart;
      const noteEndTick: number = noteEndPart * Config.ticksPerPart;
      const pinStart: number =
        (note.start + startPin.time) * Config.ticksPerPart;
      const pinEnd: number = (note.start + endPin.time) * Config.ticksPerPart;

      tone.ticksSinceReleased = 0;

      const tickTimeStart: number =
        currentPart * Config.ticksPerPart + this.tick;
      const tickTimeEnd: number = tickTimeStart + 1.0;
      const noteTicksPassedTickStart: number = tickTimeStart - noteStartTick;
      const noteTicksPassedTickEnd: number = tickTimeEnd - noteStartTick;
      const pinRatioStart: number = Math.min(
        1.0,
        (tickTimeStart - pinStart) / (pinEnd - pinStart),
      );
      const pinRatioEnd: number = Math.min(
        1.0,
        (tickTimeEnd - pinStart) / (pinEnd - pinStart),
      );
      fadeExpressionStart = 1.0;
      fadeExpressionEnd = 1.0;
      intervalStart =
        startPin.interval +
        (endPin.interval - startPin.interval) * pinRatioStart;
      intervalEnd =
        startPin.interval + (endPin.interval - startPin.interval) * pinRatioEnd;
      tone.lastInterval = intervalEnd;

      if (
        (!transition.isSeamless && !tone.forceContinueAtEnd) ||
        nextNote == null
      ) {
        const fadeOutTicks: number = -instrument.getFadeOutTicks();
        if (fadeOutTicks > 0.0) {
          // If the tone should fade out before the end of the note, do so here.
          const noteLengthTicks: number = noteEndTick - noteStartTick;
          fadeExpressionStart *= Math.min(
            1.0,
            (noteLengthTicks - noteTicksPassedTickStart) / fadeOutTicks,
          );
          fadeExpressionEnd *= Math.min(
            1.0,
            (noteLengthTicks - noteTicksPassedTickEnd) / fadeOutTicks,
          );
          if (tickTimeEnd >= noteStartTick + noteLengthTicks)
            toneIsOnLastTick = true;
        }
      }
    }

    tone.isOnLastTick = toneIsOnLastTick;

    // Compute envelopes *after* resetting the tone, otherwise the envelope computer gets reset too!
    const envelopeComputer: EnvelopeComputer = tone.envelopeComputer;
    envelopeComputer.computeEnvelopes(
      instrument,
      currentPart,
      Config.ticksPerPart * partTimeStart,
      samplesPerTick / this.samplesPerSecond,
      tone,
    );
    const envelopeStarts: number[] = tone.envelopeComputer.envelopeStarts;
    const envelopeEnds: number[] = tone.envelopeComputer.envelopeEnds;

    if (tone.note != null && transition.slides) {
      // Slide interval and chordExpression at the start and/or end of the note if necessary.
      const prevNote: Note | null = tone.prevNote;
      const nextNote: Note | null = tone.nextNote;
      if (prevNote != null) {
        const intervalDiff: number =
          prevNote.pitches[tone.prevNotePitchIndex] +
          prevNote.pins[prevNote.pins.length - 1].interval -
          tone.pitches[0];
        if (envelopeComputer.prevSlideStart)
          intervalStart += intervalDiff * envelopeComputer.prevSlideRatioStart;
        if (envelopeComputer.prevSlideEnd)
          intervalEnd += intervalDiff * envelopeComputer.prevSlideRatioEnd;
        if (!chord.singleTone) {
          const chordSizeDiff: number =
            prevNote.pitches.length - tone.chordSize;
          if (envelopeComputer.prevSlideStart)
            chordExpressionStart = Synth.computeChordExpression(
              tone.chordSize +
                chordSizeDiff * envelopeComputer.prevSlideRatioStart,
            );
          if (envelopeComputer.prevSlideEnd)
            chordExpressionEnd = Synth.computeChordExpression(
              tone.chordSize +
                chordSizeDiff * envelopeComputer.prevSlideRatioEnd,
            );
        }
      }
      if (nextNote != null) {
        const intervalDiff: number =
          nextNote.pitches[tone.nextNotePitchIndex] -
          (tone.pitches[0] +
            tone.note.pins[tone.note.pins.length - 1].interval);
        if (envelopeComputer.nextSlideStart)
          intervalStart += intervalDiff * envelopeComputer.nextSlideRatioStart;
        if (envelopeComputer.nextSlideEnd)
          intervalEnd += intervalDiff * envelopeComputer.nextSlideRatioEnd;
        if (!chord.singleTone) {
          const chordSizeDiff: number =
            nextNote.pitches.length - tone.chordSize;
          if (envelopeComputer.nextSlideStart)
            chordExpressionStart = Synth.computeChordExpression(
              tone.chordSize +
                chordSizeDiff * envelopeComputer.nextSlideRatioStart,
            );
          if (envelopeComputer.nextSlideEnd)
            chordExpressionEnd = Synth.computeChordExpression(
              tone.chordSize +
                chordSizeDiff * envelopeComputer.nextSlideRatioEnd,
            );
        }
      }
    }

    if (effectsIncludePitchShift(instrument.effects)) {
      const pitchShift: number =
        interpolateSetting(
          Config.justIntonationSemitones,
          instrument.pitchShift,
        ) / intervalScale;
      const envelopeStart: number =
        envelopeStarts[EnvelopeComputeIndex.pitchShift];
      const envelopeEnd: number = envelopeEnds[EnvelopeComputeIndex.pitchShift];
      intervalStart += pitchShift * envelopeStart;
      intervalEnd += pitchShift * envelopeEnd;
    }
    if (effectsIncludeDetune(instrument.effects)) {
      const envelopeStart: number = envelopeStarts[EnvelopeComputeIndex.detune];
      const envelopeEnd: number = envelopeEnds[EnvelopeComputeIndex.detune];
      intervalStart +=
        (Synth.detuneToCents(
          (instrument.detune - Config.detuneCenter) * envelopeStart,
        ) *
          Config.pitchesPerOctave) /
        (12.0 * 100.0);
      intervalEnd +=
        (Synth.detuneToCents(
          (instrument.detune - Config.detuneCenter) * envelopeEnd,
        ) *
          Config.pitchesPerOctave) /
        (12.0 * 100.0);
    }

    if (effectsIncludeVibrato(instrument.effects)) {
      const delayTicks: number = Config.vibratos[instrument.vibrato].delayTicks;
      const vibratoAmplitude: number =
        Config.vibratos[instrument.vibrato].amplitude;

      // To maintain pitch continuity, (mostly for picked string which retriggers impulse
      // otherwise) remember the vibrato at the end of this run and reuse it at the start
      // of the next run if available.
      let vibratoStart: number;
      if (tone.prevVibrato != null) {
        vibratoStart = tone.prevVibrato;
      } else {
        let lfoStart: number = Synth.getLFOAmplitude(
          instrument,
          secondsPerPart * partTimeStart,
        );
        const vibratoDepthEnvelopeStart: number =
          envelopeStarts[EnvelopeComputeIndex.vibratoDepth];
        vibratoStart = vibratoAmplitude * lfoStart * vibratoDepthEnvelopeStart;
        if (delayTicks > 0.0) {
          const ticksUntilVibratoStart: number =
            delayTicks - envelopeComputer.noteTicksStart;
          vibratoStart *= Math.max(
            0.0,
            Math.min(1.0, 1.0 - ticksUntilVibratoStart / 2.0),
          );
        }
      }

      let lfoEnd: number = Synth.getLFOAmplitude(
        instrument,
        secondsPerPart * partTimeEnd,
      );
      const vibratoDepthEnvelopeEnd: number =
        envelopeEnds[EnvelopeComputeIndex.vibratoDepth];
      let vibratoEnd: number =
        vibratoAmplitude * lfoEnd * vibratoDepthEnvelopeEnd;
      if (delayTicks > 0.0) {
        const ticksUntilVibratoEnd: number =
          delayTicks - envelopeComputer.noteTicksEnd;
        vibratoEnd *= Math.max(
          0.0,
          Math.min(1.0, 1.0 - ticksUntilVibratoEnd / 2.0),
        );
      }
      tone.prevVibrato = vibratoEnd;

      intervalStart += vibratoStart;
      intervalEnd += vibratoEnd;
    }

    if (
      (!transition.isSeamless && !tone.forceContinueAtStart) ||
      tone.prevNote == null
    ) {
      // Fade in the beginning of the note.
      const fadeInSeconds: number = instrument.getFadeInSeconds();
      if (fadeInSeconds > 0.0) {
        fadeExpressionStart *= Math.min(
          1.0,
          envelopeComputer.noteSecondsStart / fadeInSeconds,
        );
        fadeExpressionEnd *= Math.min(
          1.0,
          envelopeComputer.noteSecondsEnd / fadeInSeconds,
        );
      }
    }

    if (
      instrument.type == InstrumentType.drumset &&
      tone.drumsetPitch == null
    ) {
      // It's possible that the note will change while the user is editing it,
      // but the tone's pitches don't get updated because the tone has already
      // ended and is fading out. To avoid an array index out of bounds error, clamp the pitch.
      tone.drumsetPitch = tone.pitches[0];
      if (tone.note != null) tone.drumsetPitch += tone.note.pickMainInterval();
      tone.drumsetPitch = Math.max(
        0,
        Math.min(Config.drumCount - 1, tone.drumsetPitch),
      );
    }

    let noteFilterExpression: number =
      envelopeComputer.lowpassCutoffDecayVolumeCompensation;
    if (!effectsIncludeNoteFilter(instrument.effects)) {
      tone.noteFilterCount = 0;
    } else {
      const noteFilterSettings: FilterSettings = instrument.noteFilter;

      const noteAllFreqsEnvelopeStart: number =
        envelopeStarts[EnvelopeComputeIndex.noteFilterAllFreqs];
      const noteAllFreqsEnvelopeEnd: number =
        envelopeEnds[EnvelopeComputeIndex.noteFilterAllFreqs];
      for (let i: number = 0; i < noteFilterSettings.controlPointCount; i++) {
        const noteFreqEnvelopeStart: number =
          envelopeStarts[EnvelopeComputeIndex.noteFilterFreq0 + i];
        const noteFreqEnvelopeEnd: number =
          envelopeEnds[EnvelopeComputeIndex.noteFilterFreq0 + i];
        const notePeakEnvelopeStart: number =
          envelopeStarts[EnvelopeComputeIndex.noteFilterGain0 + i];
        const notePeakEnvelopeEnd: number =
          envelopeEnds[EnvelopeComputeIndex.noteFilterGain0 + i];
        const point: FilterControlPoint = noteFilterSettings.controlPoints[i];
        point.toCoefficients(
          Synth.tempFilterStartCoefficients,
          this.samplesPerSecond,
          noteAllFreqsEnvelopeStart * noteFreqEnvelopeStart,
          notePeakEnvelopeStart,
        );
        point.toCoefficients(
          Synth.tempFilterEndCoefficients,
          this.samplesPerSecond,
          noteAllFreqsEnvelopeEnd * noteFreqEnvelopeEnd,
          notePeakEnvelopeEnd,
        );
        if (tone.noteFilters.length <= i)
          tone.noteFilters[i] = new DynamicBiquadFilter();
        tone.noteFilters[i].loadCoefficientsWithGradient(
          Synth.tempFilterStartCoefficients,
          Synth.tempFilterEndCoefficients,
          1.0 / roundedSamplesPerTick,
          point.type == FilterType.lowPass,
        );
        noteFilterExpression *= point.getVolumeCompensationMult();
      }
      tone.noteFilterCount = noteFilterSettings.controlPointCount;
    }

    if (instrument.type == InstrumentType.drumset) {
      const drumsetFilterEnvelope: Envelope = instrument.getDrumsetEnvelope(
        tone.drumsetPitch!,
      );
      const drumIndex: number = tone.drumsetPitch!;
      const speed: number = instrument.drumsetEnvelopeSpeeds[drumIndex];
      const a: number = instrument.drumsetEnvelopeAs[drumIndex];
      const b: number = instrument.drumsetEnvelopeBs[drumIndex];
      // If the drumset lowpass cutoff decays, compensate by increasing expression.
      noteFilterExpression *=
        EnvelopeComputer.getLowpassCutoffDecayVolumeCompensation(
          drumsetFilterEnvelope,
          speed,
        );

      // Drumset filters use the same envelope timing as the rest of the envelopes, but do not include support for slide transitions.
      let drumsetFilterEnvelopeStart: number = EnvelopeComputer.computeEnvelope(
        drumsetFilterEnvelope,
        envelopeComputer.noteSecondsStart,
        beatsPerPart * partTimeStart,
        envelopeComputer.noteSizeStart,
        speed,
        a,
        b,
      );
      let drumsetFilterEnvelopeEnd: number = EnvelopeComputer.computeEnvelope(
        drumsetFilterEnvelope,
        envelopeComputer.noteSecondsEnd,
        beatsPerPart * partTimeEnd,
        envelopeComputer.noteSizeEnd,
        speed,
        a,
        b,
      );

      // Apply slide interpolation to drumset envelope.
      if (envelopeComputer.prevSlideStart) {
        const other: number = EnvelopeComputer.computeEnvelope(
          drumsetFilterEnvelope,
          envelopeComputer.prevNoteSecondsStart,
          beatsPerPart * partTimeStart,
          envelopeComputer.prevNoteSize,
          speed,
          a,
          b,
        );
        drumsetFilterEnvelopeStart +=
          (other - drumsetFilterEnvelopeStart) *
          envelopeComputer.prevSlideRatioStart;
      }
      if (envelopeComputer.prevSlideEnd) {
        const other: number = EnvelopeComputer.computeEnvelope(
          drumsetFilterEnvelope,
          envelopeComputer.prevNoteSecondsEnd,
          beatsPerPart * partTimeEnd,
          envelopeComputer.prevNoteSize,
          speed,
          a,
          b,
        );
        drumsetFilterEnvelopeEnd +=
          (other - drumsetFilterEnvelopeEnd) *
          envelopeComputer.prevSlideRatioEnd;
      }
      if (envelopeComputer.nextSlideStart) {
        const other: number = EnvelopeComputer.computeEnvelope(
          drumsetFilterEnvelope,
          0.0,
          beatsPerPart * partTimeStart,
          envelopeComputer.nextNoteSize,
          speed,
          a,
          b,
        );
        drumsetFilterEnvelopeStart +=
          (other - drumsetFilterEnvelopeStart) *
          envelopeComputer.nextSlideRatioStart;
      }
      if (envelopeComputer.nextSlideEnd) {
        const other: number = EnvelopeComputer.computeEnvelope(
          drumsetFilterEnvelope,
          0.0,
          beatsPerPart * partTimeEnd,
          envelopeComputer.nextNoteSize,
          speed,
          a,
          b,
        );
        drumsetFilterEnvelopeEnd +=
          (other - drumsetFilterEnvelopeEnd) *
          envelopeComputer.nextSlideRatioEnd;
      }

      const point: FilterControlPoint = this.tempDrumSetControlPoint;
      point.type = FilterType.lowPass;
      point.gain = FilterControlPoint.getRoundedSettingValueFromLinearGain(0.5);
      point.freq = FilterControlPoint.getRoundedSettingValueFromHz(8000.0);
      // Drumset envelopes are warped to better imitate the legacy simplified 2nd order lowpass at ~48000Hz that I used to use.
      point.toCoefficients(
        Synth.tempFilterStartCoefficients,
        this.samplesPerSecond,
        drumsetFilterEnvelopeStart * (1.0 + drumsetFilterEnvelopeStart),
        1.0,
      );
      point.toCoefficients(
        Synth.tempFilterEndCoefficients,
        this.samplesPerSecond,
        drumsetFilterEnvelopeEnd * (1.0 + drumsetFilterEnvelopeEnd),
        1.0,
      );
      if (tone.noteFilters.length == tone.noteFilterCount)
        tone.noteFilters[tone.noteFilterCount] = new DynamicBiquadFilter();
      tone.noteFilters[tone.noteFilterCount].loadCoefficientsWithGradient(
        Synth.tempFilterStartCoefficients,
        Synth.tempFilterEndCoefficients,
        1.0 / roundedSamplesPerTick,
        true,
      );
      tone.noteFilterCount++;
    }

    noteFilterExpression = Math.min(3.0, noteFilterExpression);

    if (instrument.type == InstrumentType.fm) {
      // phase modulation!
      const usesUnison: boolean = effectsIncludeUnison(instrument.effects);
      const unison: Unison = instrument.getUnison();
      const unisonEnvelopeStart: number =
        envelopeStarts[EnvelopeComputeIndex.unison];
      const unisonEnvelopeEnd: number =
        envelopeEnds[EnvelopeComputeIndex.unison];
      const unisonAStart: number = Math.pow(
        2.0,
        ((unison.offset + unison.spread) * unisonEnvelopeStart) / 12.0,
      );
      const unisonAEnd: number = Math.pow(
        2.0,
        ((unison.offset + unison.spread) * unisonEnvelopeEnd) / 12.0,
      );
      const unisonBStart: number = Math.pow(
        2.0,
        ((unison.offset - unison.spread) * unisonEnvelopeStart) / 12.0,
      );
      const unisonBEnd: number = Math.pow(
        2.0,
        ((unison.offset - unison.spread) * unisonEnvelopeEnd) / 12.0,
      );

      let sineExpressionBoost: number = 1.0;
      let totalCarrierExpression: number = 0.0;

      let arpeggioInterval: number = 0;
      const arpeggiates: boolean = chord.arpeggiates;
      if (tone.pitchCount > 1 && arpeggiates) {
        const arpeggio: number = Math.floor(
          (this.tick + this.part * Config.ticksPerPart) /
            Config.rhythms[song.rhythm].ticksPerArpeggio,
        );
        arpeggioInterval =
          tone.pitches[
            getArpeggioPitchIndex(tone.pitchCount, song.rhythm, arpeggio)
          ] - tone.pitches[0];
      }

      const carrierCount: number =
        Config.algorithms[instrument.algorithm].carrierCount;
      for (let i: number = 0; i < Config.operatorCount; i++) {
        const associatedCarrierIndex: number =
          Config.algorithms[instrument.algorithm].associatedCarrier[i] - 1;
        const pitch: number =
          tone.pitches[
            arpeggiates
              ? 0
              : i < tone.pitchCount
                ? i
                : associatedCarrierIndex < tone.pitchCount
                  ? associatedCarrierIndex
                  : 0
          ];
        const freqMult = instrument.operators[i].frequency;
        const interval =
          Config.operatorCarrierInterval[associatedCarrierIndex] +
          arpeggioInterval;
        const pitchStart: number =
          basePitch + (pitch + intervalStart) * intervalScale + interval;
        const pitchEnd: number =
          basePitch + (pitch + intervalEnd) * intervalScale + interval;
        const baseFreqStart: number = Instrument.frequencyFromPitch(pitchStart);
        const baseFreqEnd: number = Instrument.frequencyFromPitch(pitchEnd);
        const targetFreqStart: number = freqMult * baseFreqStart;
        const targetFreqEnd: number = freqMult * baseFreqEnd;

        const freqEnvelopeStart: number =
          envelopeStarts[EnvelopeComputeIndex.operatorFrequency0 + i];
        const freqEnvelopeEnd: number =
          envelopeEnds[EnvelopeComputeIndex.operatorFrequency0 + i];
        let freqStart: number;
        let freqEnd: number;
        if (freqMult == 0) {
          freqStart = 0;
          freqEnd = 0;
        } else if (freqEnvelopeStart != 1.0 || freqEnvelopeEnd != 1.0) {
          freqStart =
            Math.pow(
              2.0,
              Math.log2(targetFreqStart / baseFreqStart) * freqEnvelopeStart,
            ) * baseFreqStart;
          freqEnd =
            Math.pow(
              2.0,
              Math.log2(targetFreqEnd / baseFreqEnd) * freqEnvelopeEnd,
            ) * baseFreqEnd;
        } else {
          freqStart = targetFreqStart;
          freqEnd = targetFreqEnd;
        }
        const phaseDelta: number = freqStart * sampleTime;
        const phaseDeltaScale: number =
          freqStart == 0
            ? 1
            : Math.pow(freqEnd / freqStart, 1.0 / roundedSamplesPerTick);
        if (usesUnison) {
          tone.phaseDeltas[i] = phaseDelta * unisonAStart;
          tone.phaseDeltaScales[i] =
            phaseDeltaScale *
            Math.pow(unisonAEnd / unisonAStart, 1.0 / roundedSamplesPerTick);
          tone.phaseDeltas[Config.operatorCount + i] =
            phaseDelta * unisonBStart;
          tone.phaseDeltaScales[Config.operatorCount + i] =
            phaseDeltaScale *
            Math.pow(unisonBEnd / unisonBStart, 1.0 / roundedSamplesPerTick);
        } else {
          tone.phaseDeltas[i] = phaseDelta;
          tone.phaseDeltaScales[i] = phaseDeltaScale;
        }

        const amplitudeCurve: number = Synth.operatorAmplitudeCurve(
          instrument.operators[i].amplitude,
        );
        const amplitudeMult: number = amplitudeCurve;
        let expressionStart: number = amplitudeMult;
        let expressionEnd: number = amplitudeMult;
        if (i < carrierCount) {
          // carrier
          let pitchExpressionStart: number;
          if (tone.prevPitchExpressions[i] != null) {
            pitchExpressionStart = tone.prevPitchExpressions[i]!;
          } else {
            pitchExpressionStart = Math.pow(
              2.0,
              -(pitchStart - expressionReferencePitch) / pitchDamping,
            );
          }
          const pitchExpressionEnd: number = Math.pow(
            2.0,
            -(pitchEnd - expressionReferencePitch) / pitchDamping,
          );
          tone.prevPitchExpressions[i] = pitchExpressionEnd;
          expressionStart *= pitchExpressionStart;
          expressionEnd *= pitchExpressionEnd;

          totalCarrierExpression += amplitudeCurve;
        } else {
          // modulator
          expressionStart *= Config.sineWaveLength * 1.5;
          expressionEnd *= Config.sineWaveLength * 1.5;

          sineExpressionBoost *=
            1.0 - Math.min(1.0, instrument.operators[i].amplitude / 15);
        }

        expressionStart *=
          envelopeStarts[EnvelopeComputeIndex.operatorAmplitude0 + i];
        expressionEnd *=
          envelopeEnds[EnvelopeComputeIndex.operatorAmplitude0 + i];

        tone.operatorExpressions[i] = expressionStart;
        tone.operatorExpressionDeltas[i] =
          (expressionEnd - expressionStart) / roundedSamplesPerTick;
      }

      sineExpressionBoost *=
        (Math.pow(2.0, 2.0 - (1.4 * instrument.feedbackAmplitude) / 15.0) -
          1.0) /
        3.0;
      sineExpressionBoost *=
        1.0 - Math.min(1.0, Math.max(0.0, totalCarrierExpression - 1) / 2.0);
      sineExpressionBoost = 1.0 + sineExpressionBoost * 3.0;
      const unisonExpression: number = usesUnison
        ? (unison.expression * unison.voices) / 2.0
        : 1.0;
      const expressionStart: number =
        baseExpression *
        sineExpressionBoost *
        noteFilterExpression *
        fadeExpressionStart *
        chordExpressionStart *
        envelopeStarts[EnvelopeComputeIndex.noteVolume] *
        unisonExpression;
      const expressionEnd: number =
        baseExpression *
        sineExpressionBoost *
        noteFilterExpression *
        fadeExpressionEnd *
        chordExpressionEnd *
        envelopeEnds[EnvelopeComputeIndex.noteVolume] *
        unisonExpression;
      tone.expression = expressionStart;
      tone.expressionDelta =
        (expressionEnd - expressionStart) / roundedSamplesPerTick;

      const feedbackAmplitude: number =
        (Config.sineWaveLength * 0.3 * instrument.feedbackAmplitude) / 15.0;
      let feedbackStart: number =
        feedbackAmplitude *
        envelopeStarts[EnvelopeComputeIndex.feedbackAmplitude];
      let feedbackEnd: number =
        feedbackAmplitude *
        envelopeEnds[EnvelopeComputeIndex.feedbackAmplitude];
      tone.feedbackMult = feedbackStart;
      tone.feedbackDelta =
        (feedbackEnd - feedbackStart) / roundedSamplesPerTick;
    } else {
      const freqEndRatio: number = Math.pow(
        2.0,
        ((intervalEnd - intervalStart) * intervalScale) / 12.0,
      );
      const basePhaseDeltaScale: number = Math.pow(
        freqEndRatio,
        1.0 / roundedSamplesPerTick,
      );

      let pitch: number = tone.pitches[0];
      if (tone.pitchCount > 1 && (chord.arpeggiates || chord.customInterval)) {
        const arpeggio: number = Math.floor(
          (this.tick + this.part * Config.ticksPerPart) /
            Config.rhythms[song.rhythm].ticksPerArpeggio,
        );
        if (chord.customInterval) {
          const intervalOffset: number =
            tone.pitches[
              1 +
                getArpeggioPitchIndex(
                  tone.pitchCount - 1,
                  song.rhythm,
                  arpeggio,
                )
            ] - tone.pitches[0];
          specialIntervalMult = Math.pow(2.0, intervalOffset / 12.0);
          tone.specialIntervalExpressionMult = Math.pow(
            2.0,
            -intervalOffset / pitchDamping,
          );
        } else {
          pitch =
            tone.pitches[
              getArpeggioPitchIndex(tone.pitchCount, song.rhythm, arpeggio)
            ];
        }
      }
      if (instrument.type == InstrumentType.soundFont)
        tone.soundFontKey = Math.max(
          0,
          Math.min(127, Math.round(basePitch + pitch * intervalScale)),
        );

      const startPitch: number =
        basePitch + (pitch + intervalStart) * intervalScale;
      const endPitch: number =
        basePitch + (pitch + intervalEnd) * intervalScale;
      let pitchExpressionStart: number;
      // TODO: use the second element of prevPitchExpressions for the unison voice, compute a separate expression delta for it.
      if (tone.prevPitchExpressions[0] != null) {
        pitchExpressionStart = tone.prevPitchExpressions[0]!;
      } else {
        pitchExpressionStart = Math.pow(
          2.0,
          -(startPitch - expressionReferencePitch) / pitchDamping,
        );
      }
      const pitchExpressionEnd: number = Math.pow(
        2.0,
        -(endPitch - expressionReferencePitch) / pitchDamping,
      );
      tone.prevPitchExpressions[0] = pitchExpressionEnd;
      let settingsExpressionMult: number =
        baseExpression * noteFilterExpression;

      if (instrument.type == InstrumentType.noise) {
        settingsExpressionMult *=
          Config.chipNoises[instrument.chipNoise].expression;
      }
      if (instrument.type == InstrumentType.chip) {
        settingsExpressionMult *=
          Config.chipWaves[instrument.chipWave].expression;
      }
      if (instrument.type == InstrumentType.pwm) {
        const basePulseWidth: number = getPulseWidthRatio(
          instrument.pulseWidth,
        );
        const pulseWidthStart: number =
          basePulseWidth * envelopeStarts[EnvelopeComputeIndex.pulseWidth];
        const pulseWidthEnd: number =
          basePulseWidth * envelopeEnds[EnvelopeComputeIndex.pulseWidth];
        tone.pulseWidth = pulseWidthStart;
        tone.pulseWidthDelta =
          (pulseWidthEnd - pulseWidthStart) / roundedSamplesPerTick;
      }

      if (instrument.type == InstrumentType.pickedString) {
        // Increase expression to compensate for string decay.
        settingsExpressionMult *= Math.pow(
          2.0,
          0.7 *
            (1.0 - instrument.stringSustain / (Config.stringSustainRange - 1)),
        );
      }

      const startFreq: number = Instrument.frequencyFromPitch(startPitch);
      if (
        effectsIncludeUnison(instrument.effects) ||
        instrument.type == InstrumentType.chip ||
        instrument.type == InstrumentType.harmonics ||
        instrument.type == InstrumentType.pickedString ||
        instrument.type == InstrumentType.soundFont
      ) {
        // Unison creates two copies of the instrument at independently detuned frequencies.
        const unison: Unison = instrument.getUnison();
        const voiceCountExpression: number =
          instrument.type == InstrumentType.pickedString
            ? 1
            : unison.voices / 2.0;
        settingsExpressionMult *= unison.expression * voiceCountExpression;
        const unisonEnvelopeStart = envelopeStarts[EnvelopeComputeIndex.unison];
        const unisonEnvelopeEnd = envelopeEnds[EnvelopeComputeIndex.unison];
        const unisonAStart: number = Math.pow(
          2.0,
          ((unison.offset + unison.spread) * unisonEnvelopeStart) / 12.0,
        );
        const unisonAEnd: number = Math.pow(
          2.0,
          ((unison.offset + unison.spread) * unisonEnvelopeEnd) / 12.0,
        );
        const unisonBStart: number =
          Math.pow(
            2.0,
            ((unison.offset - unison.spread) * unisonEnvelopeStart) / 12.0,
          ) * specialIntervalMult;
        const unisonBEnd: number =
          Math.pow(
            2.0,
            ((unison.offset - unison.spread) * unisonEnvelopeEnd) / 12.0,
          ) * specialIntervalMult;
        tone.phaseDeltas[0] = startFreq * sampleTime * unisonAStart;
        tone.phaseDeltas[1] = startFreq * sampleTime * unisonBStart;
        tone.phaseDeltaScales[0] =
          basePhaseDeltaScale *
          Math.pow(unisonAEnd / unisonAStart, 1.0 / roundedSamplesPerTick);
        tone.phaseDeltaScales[1] =
          basePhaseDeltaScale *
          Math.pow(unisonBEnd / unisonBStart, 1.0 / roundedSamplesPerTick);
      } else {
        tone.phaseDeltas[0] = startFreq * sampleTime;
        tone.phaseDeltas[1] = tone.phaseDeltas[0];
        tone.phaseDeltaScales[0] = basePhaseDeltaScale;
        tone.phaseDeltaScales[1] = basePhaseDeltaScale;
      }

      // TODO: make expressionStart and expressionEnd variables earlier and modify those
      // instead of these supersawExpression variables.
      let supersawExpressionStart: number = 1.0;
      let supersawExpressionEnd: number = 1.0;
      if (instrument.type == InstrumentType.supersaw) {
        const minFirstVoiceAmplitude: number =
          1.0 / Math.sqrt(Config.supersawVoiceCount);
        const baseDynamismSlider: number =
          instrument.supersawDynamism / Config.supersawDynamismMax;
        const curvedDynamismStart: number =
          1.0 -
          Math.pow(
            Math.max(
              0.0,
              1.0 -
                baseDynamismSlider *
                  envelopeStarts[EnvelopeComputeIndex.supersawDynamism],
            ),
            0.2,
          );
        const curvedDynamismEnd: number =
          1.0 -
          Math.pow(
            Math.max(
              0.0,
              1.0 -
                baseDynamismSlider *
                  envelopeEnds[EnvelopeComputeIndex.supersawDynamism],
            ),
            0.2,
          );
        const firstVoiceAmplitudeStart: number = Math.pow(
          2.0,
          Math.log2(minFirstVoiceAmplitude) * curvedDynamismStart,
        );
        const firstVoiceAmplitudeEnd: number = Math.pow(
          2.0,
          Math.log2(minFirstVoiceAmplitude) * curvedDynamismEnd,
        );
        // TODO: automation
        const dynamismStart: number = Math.sqrt(
          (1.0 / Math.pow(firstVoiceAmplitudeStart, 2.0) - 1.0) /
            (Config.supersawVoiceCount - 1.0),
        );
        const dynamismEnd: number = Math.sqrt(
          (1.0 / Math.pow(firstVoiceAmplitudeEnd, 2.0) - 1.0) /
            (Config.supersawVoiceCount - 1.0),
        );
        tone.supersawDynamism = dynamismStart;
        tone.supersawDynamismDelta =
          (dynamismEnd - dynamismStart) / roundedSamplesPerTick;

        const initializeSupersaw: boolean = tone.supersawDelayIndex == -1;
        if (initializeSupersaw) {
          // Goal: generate sawtooth phases such that the combined initial amplitude
          // cancel out to minimize pop. Algorithm: generate sorted phases, iterate over
          // their sawtooth drop points to find a combined zero crossing, then offset the
          // phases so they start there.

          // Generate random phases in ascending order by adding positive randomly
          // sized gaps between adjacent phases. For a proper distribution of random
          // events, the gaps sizes should be an "exponential distribution", which is
          // just: -Math.log(Math.random()). At the end, normalize the phases to a 0-1
          // range by dividing by the final value of the accumulator.
          let accumulator: number = 0.0;
          for (let i: number = 0; i < Config.supersawVoiceCount; i++) {
            tone.phases[i] = accumulator;
            accumulator += -Math.log(Math.random());
          }

          const amplitudeSum: number =
            1.0 + (Config.supersawVoiceCount - 1.0) * dynamismStart;
          const slope: number = amplitudeSum;

          // Find the initial amplitude of the sum of sawtooths with the normalized
          // set of phases.
          let sample: number = 0.0;
          for (let i: number = 0; i < Config.supersawVoiceCount; i++) {
            const amplitude: number = i == 0 ? 1.0 : dynamismStart;
            const normalizedPhase: number = tone.phases[i] / accumulator;
            tone.phases[i] = normalizedPhase;
            sample += (normalizedPhase - 0.5) * amplitude;
          }

          // Find the phase of the zero crossing of the sum of the sawtooths. You can
          // use a constant slope and the distance between sawtooth drops to determine if
          // the zero crossing occurs between them. Note that a small phase means that
          // the corresponding drop for that wave is far away, and a big phase means the
          // drop is nearby, so to iterate forward through the drops we iterate backward
          // through the phases.
          let zeroCrossingPhase: number = 1.0;
          let prevDrop: number = 0.0;
          for (let i: number = Config.supersawVoiceCount - 1; i >= 0; i--) {
            const nextDrop: number = 1.0 - tone.phases[i];
            const phaseDelta: number = nextDrop - prevDrop;
            if (sample < 0.0) {
              const distanceToZeroCrossing: number = -sample / slope;
              if (distanceToZeroCrossing < phaseDelta) {
                zeroCrossingPhase = prevDrop + distanceToZeroCrossing;
                break;
              }
            }
            const amplitude: number = i == 0 ? 1.0 : dynamismStart;
            sample += phaseDelta * slope - amplitude;
            prevDrop = nextDrop;
          }
          for (let i: number = 0; i < Config.supersawVoiceCount; i++) {
            tone.phases[i] += zeroCrossingPhase;
          }

          // Randomize the (initially sorted) order of the phases (aside from the
          // first one) so that they don't correlate to the detunes that are also
          // based on index.
          for (let i: number = 1; i < Config.supersawVoiceCount - 1; i++) {
            const swappedIndex: number =
              i + Math.floor(Math.random() * (Config.supersawVoiceCount - i));
            const temp: number = tone.phases[i];
            tone.phases[i] = tone.phases[swappedIndex];
            tone.phases[swappedIndex] = temp;
          }
          for (let i: number = 0; i < Config.supersawVoiceCount; i++) {
            tone.phases[Config.supersawVoiceCount + i] = tone.phases[i];
          }
        }

        const baseSpreadSlider: number =
          instrument.supersawSpread / Config.supersawSpreadMax;
        // TODO: automation
        const spreadSliderStart: number =
          baseSpreadSlider *
          envelopeStarts[EnvelopeComputeIndex.supersawSpread];
        const spreadSliderEnd: number =
          baseSpreadSlider * envelopeEnds[EnvelopeComputeIndex.supersawSpread];
        // Just use the average detune for the current tick in the below loop.
        const averageSpreadSlider: number =
          (spreadSliderStart + spreadSliderEnd) * 0.5;
        const curvedSpread: number = Math.pow(
          1.0 - Math.sqrt(Math.max(0.0, 1.0 - averageSpreadSlider)),
          1.75,
        );
        for (let i = 0; i < Config.supersawVoiceCount; i++) {
          // Spread out the detunes around the center;
          const offset: number =
            i == 0
              ? 0.0
              : Math.pow(
                  (((i + 1) >> 1) - 0.5 + 0.025 * ((i & 2) - 1)) /
                    (Config.supersawVoiceCount >> 1),
                  1.1,
                ) *
                ((i & 1) * 2 - 1);
          tone.supersawUnisonDetunes[i] = Math.pow(
            2.0,
            (curvedSpread * offset) / 12.0,
          );
        }

        const baseShape: number =
          instrument.supersawShape / Config.supersawShapeMax;
        // TODO: automation
        const shapeStart: number =
          baseShape * envelopeStarts[EnvelopeComputeIndex.supersawShape];
        const shapeEnd: number =
          baseShape * envelopeEnds[EnvelopeComputeIndex.supersawShape];
        tone.supersawShape = shapeStart;
        tone.supersawShapeDelta =
          (shapeEnd - shapeStart) / roundedSamplesPerTick;

        const basePulseWidth: number = getPulseWidthRatio(
          instrument.pulseWidth,
        );
        // TODO: automation
        const pulseWidthStart: number =
          basePulseWidth * envelopeStarts[EnvelopeComputeIndex.pulseWidth];
        const pulseWidthEnd: number =
          basePulseWidth * envelopeEnds[EnvelopeComputeIndex.pulseWidth];
        const phaseDeltaStart: number =
          tone.supersawPrevPhaseDelta != null
            ? tone.supersawPrevPhaseDelta
            : startFreq * sampleTime;
        const phaseDeltaEnd: number = startFreq * sampleTime * freqEndRatio;
        tone.supersawPrevPhaseDelta = phaseDeltaEnd;
        const delayLengthStart = pulseWidthStart / phaseDeltaStart;
        const delayLengthEnd = pulseWidthEnd / phaseDeltaEnd;
        tone.supersawDelayLength = delayLengthStart;
        tone.supersawDelayLengthDelta =
          (delayLengthEnd - delayLengthStart) / roundedSamplesPerTick;
        const minBufferLength: number =
          Math.ceil(Math.max(delayLengthStart, delayLengthEnd)) + 2;

        if (
          tone.supersawDelayLine == null ||
          tone.supersawDelayLine.length <= minBufferLength
        ) {
          // The delay line buffer will get reused for other tones so might as well
          // start off with a buffer size that is big enough for most notes.
          const likelyMaximumLength: number = Math.ceil(
            (0.5 * this.samplesPerSecond) / Instrument.frequencyFromPitch(24),
          );
          const newDelayLine: Float32Array = new Float32Array(
            Synth.fittingPowerOfTwo(
              Math.max(likelyMaximumLength, minBufferLength),
            ),
          );
          if (!initializeSupersaw && tone.supersawDelayLine != null) {
            // If the tone has already started but the buffer needs to be reallocated,
            // transfer the old data to the new buffer.
            const oldDelayBufferMask: number =
              (tone.supersawDelayLine.length - 1) >> 0;
            const startCopyingFromIndex: number = tone.supersawDelayIndex;
            for (let i: number = 0; i < tone.supersawDelayLine.length; i++) {
              newDelayLine[i] =
                tone.supersawDelayLine[
                  (startCopyingFromIndex + i) & oldDelayBufferMask
                ];
            }
          }
          tone.supersawDelayLine = newDelayLine;
          tone.supersawDelayIndex = tone.supersawDelayLine.length;
        } else if (initializeSupersaw) {
          tone.supersawDelayLine.fill(0.0);
          tone.supersawDelayIndex = tone.supersawDelayLine.length;
        }

        const pulseExpressionRatio: number =
          Config.pwmBaseExpression / Config.supersawBaseExpression;
        supersawExpressionStart *=
          (1.0 + (pulseExpressionRatio - 1.0) * shapeStart) /
          Math.sqrt(
            1.0 +
              (Config.supersawVoiceCount - 1.0) * dynamismStart * dynamismStart,
          );
        supersawExpressionEnd *=
          (1.0 + (pulseExpressionRatio - 1.0) * shapeEnd) /
          Math.sqrt(
            1.0 + (Config.supersawVoiceCount - 1.0) * dynamismEnd * dynamismEnd,
          );
      }

      const expressionStart: number =
        settingsExpressionMult *
        fadeExpressionStart *
        chordExpressionStart *
        pitchExpressionStart *
        envelopeStarts[EnvelopeComputeIndex.noteVolume] *
        supersawExpressionStart;
      const expressionEnd: number =
        settingsExpressionMult *
        fadeExpressionEnd *
        chordExpressionEnd *
        pitchExpressionEnd *
        envelopeEnds[EnvelopeComputeIndex.noteVolume] *
        supersawExpressionEnd;
      tone.expression = expressionStart;
      tone.expressionDelta =
        (expressionEnd - expressionStart) / roundedSamplesPerTick;

      if (instrument.type == InstrumentType.pickedString) {
        let stringDecayStart: number;
        if (tone.prevStringDecay != null) {
          stringDecayStart = tone.prevStringDecay;
        } else {
          const sustainEnvelopeStart: number =
            tone.envelopeComputer.envelopeStarts[
              EnvelopeComputeIndex.stringSustain
            ];
          stringDecayStart =
            1.0 -
            Math.min(
              1.0,
              (sustainEnvelopeStart * instrument.stringSustain) /
                (Config.stringSustainRange - 1),
            );
        }
        const sustainEnvelopeEnd: number =
          tone.envelopeComputer.envelopeEnds[
            EnvelopeComputeIndex.stringSustain
          ];
        let stringDecayEnd: number =
          1.0 -
          Math.min(
            1.0,
            (sustainEnvelopeEnd * instrument.stringSustain) /
              (Config.stringSustainRange - 1),
          );
        tone.prevStringDecay = stringDecayEnd;

        const unison: Unison = instrument.getUnison();
        for (
          let i: number = tone.pickedStrings.length;
          i < unison.voices;
          i++
        ) {
          tone.pickedStrings[i] = new PickedString();
        }

        if (
          tone.atNoteStart &&
          !transition.continues &&
          !tone.forceContinueAtStart
        ) {
          for (const pickedString of tone.pickedStrings) {
            // Force the picked string to retrigger the attack impulse at the start of the note.
            pickedString.delayIndex = -1;
          }
        }

        for (let i: number = 0; i < unison.voices; i++) {
          tone.pickedStrings[i].update(
            this,
            instrumentState,
            tone,
            i,
            roundedSamplesPerTick,
            stringDecayStart,
            stringDecayEnd,
            instrument.stringSustainType,
          );
        }
      }
    }
  }

  public static getLFOAmplitude(
    instrument: Instrument,
    secondsIntoBar: number,
  ): number {
    let effect: number = 0.0;
    for (const vibratoPeriodSeconds of Config.vibratos[instrument.vibrato]
      .periodsSeconds) {
      effect += Math.sin(
        (Math.PI * 2.0 * secondsIntoBar) / vibratoPeriodSeconds,
      );
    }
    return effect;
  }

  public static getInstrumentSynthFunction(instrument: Instrument): Function {
    if (instrument.type == InstrumentType.fm) {
      const usesUnison: boolean = effectsIncludeUnison(instrument.effects);
      const fingerprint: string =
        instrument.algorithm +
        "_" +
        instrument.feedbackType +
        "_waves_" +
        instrument.operators
          .map((operator) => {
            const wave =
              operator.wave == 0
                ? undefined
                : Config.chipWaves[operator.wave - 1];
            return (
              operator.wave +
              (wave?.sampleId == undefined ? "" : ":" + wave.sampleId)
            );
          })
          .join("_") +
        (usesUnison ? "_unison" : "");
      if (Synth.fmSynthFunctionCache[fingerprint] == undefined) {
        const synthSource: string[] = [];

        for (const line of Synth.fmSourceTemplate) {
          if (line.indexOf("// CARRIER OUTPUTS") != -1) {
            for (const voice of usesUnison ? ["A", "B"] : [""]) {
              const outputs: string[] = [];
              for (
                let j: number = 0;
                j < Config.algorithms[instrument.algorithm].carrierCount;
                j++
              )
                outputs.push("operator" + voice + j + "Scaled");
              synthSource.push(
                line
                  .replace("fmOutput", "fmOutput" + voice)
                  .replace("/*operator#Scaled*/", outputs.join(" + ")),
              );
            }
          } else if (
            line.indexOf("// INSERT OPERATOR COMPUTATION HERE") != -1
          ) {
            for (const voice of usesUnison ? ["A", "B"] : [""]) {
              for (let j: number = Config.operatorCount - 1; j >= 0; j--) {
                const operatorWave = instrument.operators[j].wave;
                const asset =
                  operatorWave != 0 &&
                  Config.chipWaves[operatorWave - 1]?.sampleId != undefined;
                for (const operatorLine of asset
                  ? Synth.sampleOperatorSourceTemplate
                  : Synth.operatorSourceTemplate) {
                  if (operatorLine.indexOf("/* + operator@Scaled*/") != -1) {
                    let modulators = "";
                    for (const modulatorNumber of Config.algorithms[
                      instrument.algorithm
                    ].modulatedBy[j])
                      modulators +=
                        " + operator" +
                        voice +
                        (modulatorNumber - 1) +
                        "Scaled";

                    const feedbackIndices: ReadonlyArray<number> =
                      Config.feedbacks[instrument.feedbackType].indices[j];
                    if (feedbackIndices.length > 0) {
                      modulators += " + feedbackMult * (";
                      const feedbacks: string[] = [];
                      for (const modulatorNumber of feedbackIndices)
                        feedbacks.push(
                          "operator" + voice + (modulatorNumber - 1) + "Output",
                        );
                      modulators += feedbacks.join(" + ") + ")";
                    }
                    if (asset && modulators != "")
                      modulators =
                        " + (" +
                        modulators.substring(3) +
                        ") * operator" +
                        voice +
                        j +
                        "PhaseModScale";
                    synthSource.push(
                      operatorLine
                        .replace(/operator#/g, "operator" + voice + j)
                        .replace("/* + operator@Scaled*/", modulators),
                    );
                  } else {
                    synthSource.push(
                      operatorLine.replace(
                        /operator#/g,
                        "operator" + voice + j,
                      ),
                    );
                  }
                }
              }
            }
          } else if (line.indexOf("#") != -1) {
            for (const voice of usesUnison ? ["A", "B"] : [""]) {
              for (let j: number = 0; j < Config.operatorCount; j++) {
                const stateIndex: number =
                  j + (voice == "B" ? Config.operatorCount : 0);
                let voiceLine: string = line.replace(
                  /tone\.(phases|phaseDeltas|phaseDeltaScales|feedbackOutputs)\[#\]/g,
                  (_match, arrayName) =>
                    "tone." + arrayName + "[" + stateIndex + "]",
                );
                voiceLine = voiceLine.replace(
                  /tone\.(operatorExpressions|operatorExpressionDeltas)\[#\]/g,
                  (_match, arrayName) => "tone." + arrayName + "[" + j + "]",
                );
                const operatorWaveIndex = instrument.operators[j].wave;
                const chipWave =
                  operatorWaveIndex == 0
                    ? undefined
                    : Config.chipWaves[operatorWaveIndex - 1];
                if (chipWave?.sampleId != undefined) {
                  if (line.indexOf("Config.getFmWave") != -1) {
                    voiceLine =
                      "\t\tconst operator#SampleData = synth.assetData.get(" +
                      JSON.stringify(chipWave.sampleId) +
                      ");\n" +
                      "\t\tconst operator#Wave = operator#SampleData?.samples ?? sineWave;\n" +
                      "\t\tconst operator#WaveLength = operator#Wave.length;\n" +
                      "\t\tconst operator#SampleGain = operator#SampleData == undefined ? 0.0 : 1.0;\n" +
                      "\t\tconst operator#PhaseScale = operator#SampleData == undefined ? " +
                      Config.sineWaveLength +
                      " : operator#SampleData.sampleRate / " +
                      Instrument.frequencyFromPitch(
                        chipWave.sampleRootKey ?? 60,
                      ) +
                      ";\n" +
                      "\t\tconst operator#PhaseModScale = operator#PhaseScale / " +
                      Config.sineWaveLength +
                      ";";
                  } else if (line.indexOf("let operator#Phase       =") != -1) {
                    voiceLine =
                      "\t\tlet operator#Phase = +((tone.phases[" +
                      stateIndex +
                      "] % 1) + 1000) * operator#WaveLength;";
                  } else if (line.indexOf("let operator#PhaseDelta  =") != -1) {
                    voiceLine =
                      "\t\tlet operator#PhaseDelta = +tone.phaseDeltas[" +
                      stateIndex +
                      "] * operator#PhaseScale;";
                  } else if (line.indexOf("tone.phases[#] =") != -1) {
                    voiceLine =
                      "\t\ttone.phases[" +
                      stateIndex +
                      "] = operator#Phase / operator#WaveLength;";
                  } else if (line.indexOf("tone.phaseDeltas[#] =") != -1) {
                    voiceLine =
                      "\t\ttone.phaseDeltas[" +
                      stateIndex +
                      "] = operator#PhaseDelta / operator#PhaseScale;";
                  }
                }
                voiceLine = voiceLine.replace(
                  "/*operatorWave*/",
                  String(operatorWaveIndex),
                );
                voiceLine = voiceLine.replace(
                  /operator#/g,
                  "operator" + voice + j,
                );
                synthSource.push(voiceLine);
              }
            }
          } else if (
            usesUnison &&
            line.indexOf("const inputSample = fmOutput;") != -1
          ) {
            synthSource.push(
              line.replace("fmOutput", "fmOutputA + fmOutputB * unisonSign"),
            );
          } else {
            synthSource.push(line);
            if (usesUnison && line.indexOf("const sineWave") != -1)
              synthSource.push(
                "\t\tconst unisonSign = tone.specialIntervalExpressionMult * instrument.unison.sign;",
              );
          }
        }

        //console.log(synthSource.join("\n"));

        const wrappedFmSynth: string =
          "return (synth, bufferIndex, runLength, tone, instrument) => {" +
          synthSource.join("\n") +
          "}";

        Synth.fmSynthFunctionCache[fingerprint] = new Function(
          "Config",
          "Synth",
          wrappedFmSynth,
        )(Config, Synth);
      }
      return Synth.fmSynthFunctionCache[fingerprint];
    } else if (instrument.type == InstrumentType.chip) {
      return Config.chipWaves[instrument.chipWave].sampleId == undefined
        ? Synth.chipSynth
        : Synth.assetSynth;
    } else if (instrument.type == InstrumentType.harmonics) {
      return Synth.harmonicsSynth;
    } else if (instrument.type == InstrumentType.pwm) {
      return Synth.pulseWidthSynth;
    } else if (instrument.type == InstrumentType.supersaw) {
      return Synth.supersawSynth;
    } else if (instrument.type == InstrumentType.pickedString) {
      return Synth.pickedStringSynth;
    } else if (instrument.type == InstrumentType.noise) {
      return Synth.noiseSynth;
    } else if (instrument.type == InstrumentType.spectrum) {
      return Synth.spectrumSynth;
    } else if (instrument.type == InstrumentType.drumset) {
      return Synth.drumsetSynth;
    } else if (instrument.type == InstrumentType.soundFont) {
      return Synth.soundFontSynth;
    } else {
      throw new Error("Unrecognized instrument type: " + instrument.type);
    }
  }

  private static soundFontSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const bankId: string | null = instrumentState.soundFontBankId;
    const bank: SoundFontBank | undefined =
      bankId == null ? undefined : synth.soundFontBanks.get(bankId);
    const preset = bank?.presets[instrumentState.soundFontPresetIndex];
    if (bankId == null || bank == undefined || preset == undefined) return;

    if (
      tone.soundFontBank !== bank ||
      tone.soundFontBankId != bankId ||
      tone.soundFontPresetIndex != instrumentState.soundFontPresetIndex
    ) {
      tone.soundFontBank = bank;
      tone.soundFontBankId = bankId;
      tone.soundFontPresetIndex = instrumentState.soundFontPresetIndex;
      tone.soundFontInitialized = false;
      tone.soundFontVoices.length = 0;
    }

    const frequencyA: number = tone.phaseDeltas[0] * synth.samplesPerSecond;
    if (!(frequencyA > 0) || !Number.isFinite(frequencyA)) return;
    if (!tone.soundFontInitialized) {
      const velocity: number = Math.max(
        1,
        Math.min(
          127,
          Math.round(
            (127 * tone.envelopeComputer.noteSizeStart) / Config.noteSizeMax,
          ),
        ),
      );
      for (const zone of getSoundFontZones(
        preset,
        tone.soundFontKey,
        velocity,
      )) {
        if (zone.end > zone.start)
          tone.soundFontVoices.push({
            zone,
            phaseA: zone.start,
            phaseB: zone.start,
            phaseDeltaA: 0,
            phaseDeltaB: 0,
            phaseDeltaScaleA: 1,
            phaseDeltaScaleB: 1,
            endedA: false,
            endedB: false,
          });
      }
      tone.soundFontInitialized = true;
    }
    if (tone.soundFontVoices.length == 0) return;

    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const unisonSign: number =
      tone.specialIntervalExpressionMult * instrumentState.unison!.sign;
    const copyFirstVoice: boolean =
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval;
    const frequencyB: number = tone.phaseDeltas[1] * synth.samplesPerSecond;
    const midiPitchA: number = 69 + 12 * Math.log2(frequencyA / 440);
    const midiPitchB: number =
      frequencyB > 0 && Number.isFinite(frequencyB)
        ? 69 + 12 * Math.log2(frequencyB / 440)
        : midiPitchA;
    for (let i: number = 0; i < tone.soundFontVoices.length; i++) {
      const voice: SoundFontToneVoice = tone.soundFontVoices[i];
      const zone: SoundFontZone = voice.zone;
      if (copyFirstVoice) {
        voice.phaseB = voice.phaseA;
        voice.endedB = voice.endedA;
      }
      const scale: number = zone.scaleTuning / 100;
      const effectiveKey: number = zone.fixedKey ?? tone.soundFontKey;
      const trackedPitch: number =
        (effectiveKey - zone.rootKey) * scale + zone.tuneCents / 100;
      voice.phaseDeltaA =
        (zone.sample.sampleRate / synth.samplesPerSecond) *
        Math.pow(2, (trackedPitch + midiPitchA - tone.soundFontKey) / 12);
      voice.phaseDeltaB =
        (zone.sample.sampleRate / synth.samplesPerSecond) *
        Math.pow(2, (trackedPitch + midiPitchB - tone.soundFontKey) / 12);
      voice.phaseDeltaScaleA = tone.phaseDeltaScales[0];
      voice.phaseDeltaScaleB = tone.phaseDeltaScales[1];
    }

    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      let inputSample: number = 0.0;
      for (
        let voiceIndex: number = 0;
        voiceIndex < tone.soundFontVoices.length;
        voiceIndex++
      ) {
        const voice: SoundFontToneVoice = tone.soundFontVoices[voiceIndex];
        const zone: SoundFontZone = voice.zone;
        const loop: boolean =
          zone.loopMode == 1 || (zone.loopMode == 3 && !tone.released);
        let waveA: number = 0.0;
        let waveB: number = 0.0;
        if (!voice.endedA) {
          voice.phaseA = Synth.normalizeSoundFontPhase(
            voice.phaseA,
            zone,
            loop,
          );
          waveA = Synth.interpolateSoundFontSample(voice.phaseA, zone, loop);
          voice.phaseA += voice.phaseDeltaA;
          voice.phaseDeltaA *= voice.phaseDeltaScaleA;
          if (!loop && voice.phaseA >= zone.end) voice.endedA = true;
        }
        if (!voice.endedB) {
          voice.phaseB = Synth.normalizeSoundFontPhase(
            voice.phaseB,
            zone,
            loop,
          );
          waveB = Synth.interpolateSoundFontSample(voice.phaseB, zone, loop);
          voice.phaseB += voice.phaseDeltaB;
          voice.phaseDeltaB *= voice.phaseDeltaScaleB;
          if (!loop && voice.phaseB >= zone.end) voice.endedB = true;
        }
        inputSample += waveA + waveB * unisonSign;
      }
      const filteredSample: number = Synth.applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;
      data[sampleIndex] += filteredSample * expression;
      expression += expressionDelta;
    }

    tone.phaseDeltas[0] *= Math.pow(tone.phaseDeltaScales[0], runLength);
    tone.phaseDeltas[1] *= Math.pow(tone.phaseDeltaScales[1], runLength);
    tone.expression = expression;
    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static normalizeSoundFontPhase(
    phase: number,
    zone: SoundFontZone,
    loop: boolean,
  ): number {
    if (loop && zone.loopEnd - zone.loopStart >= 2 && phase >= zone.loopEnd)
      return (
        zone.loopStart +
        ((phase - zone.loopEnd) % (zone.loopEnd - zone.loopStart))
      );
    return phase;
  }

  private static interpolateSoundFontSample(
    phase: number,
    zone: SoundFontZone,
    loop: boolean,
  ): number {
    if (phase < zone.start || phase >= zone.end) return 0.0;
    const index: number = Math.floor(phase);
    let nextIndex: number = index + 1;
    if (loop && zone.loopEnd - zone.loopStart >= 2 && nextIndex >= zone.loopEnd)
      nextIndex = zone.loopStart;
    if (nextIndex >= zone.end) nextIndex = index;
    const wave: Int16Array = zone.sample.data;
    const sample: number =
      wave[index] + (wave[nextIndex] - wave[index]) * (phase - index);
    return sample / 32768.0;
  }

  private static chipSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const wave: Float32Array = instrumentState.wave!;
    const waveLength: number = wave.length - 1; // The first sample is duplicated at the end, don't double-count it.

    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    if (
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval
    )
      tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0] * waveLength;
    let phaseDeltaB: number = tone.phaseDeltas[1] * waveLength;
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phaseA: number = (tone.phases[0] % 1) * waveLength;
    let phaseB: number = (tone.phases[1] % 1) * waveLength;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    const phaseAInt: number = phaseA | 0;
    const phaseBInt: number = phaseB | 0;
    const indexA: number = phaseAInt % waveLength;
    const indexB: number = phaseBInt % waveLength;
    const phaseRatioA: number = phaseA - phaseAInt;
    const phaseRatioB: number = phaseB - phaseBInt;
    let prevWaveIntegralA: number = +wave[indexA];
    let prevWaveIntegralB: number = +wave[indexB];
    prevWaveIntegralA += (wave[indexA + 1] - prevWaveIntegralA) * phaseRatioA;
    prevWaveIntegralB += (wave[indexB + 1] - prevWaveIntegralB) * phaseRatioB;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;

      const phaseAInt: number = phaseA | 0;
      const phaseBInt: number = phaseB | 0;
      const indexA: number = phaseAInt % waveLength;
      const indexB: number = phaseBInt % waveLength;
      let nextWaveIntegralA: number = wave[indexA];
      let nextWaveIntegralB: number = wave[indexB];
      const phaseRatioA: number = phaseA - phaseAInt;
      const phaseRatioB: number = phaseB - phaseBInt;
      nextWaveIntegralA += (wave[indexA + 1] - nextWaveIntegralA) * phaseRatioA;
      nextWaveIntegralB += (wave[indexB + 1] - nextWaveIntegralB) * phaseRatioB;
      const waveA: number =
        (nextWaveIntegralA - prevWaveIntegralA) / phaseDeltaA;
      const waveB: number =
        (nextWaveIntegralB - prevWaveIntegralB) / phaseDeltaB;
      prevWaveIntegralA = nextWaveIntegralA;
      prevWaveIntegralB = nextWaveIntegralB;

      const inputSample: number = waveA + waveB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA / waveLength;
    tone.phases[1] = phaseB / waveLength;
    tone.phaseDeltas[0] = phaseDeltaA / waveLength;
    tone.phaseDeltas[1] = phaseDeltaB / waveLength;
    tone.expression = expression;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static assetSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const sampleId: string | null = instrumentState.assetId;
    if (sampleId == null) return;
    const sampleData: AssetData | undefined = synth.assetData.get(sampleId);
    if (sampleData == undefined || sampleData.samples.length == 0) return;

    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const wave: Float32Array = sampleData.samples;
    const waveLength: number = wave.length;
    const rootFrequency: number = Instrument.frequencyFromPitch(
      instrumentState.assetRootKey,
    );
    const samplePhaseScale: number = sampleData.sampleRate / rootFrequency;

    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    if (
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval
    )
      tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0] * samplePhaseScale;
    let phaseDeltaB: number = tone.phaseDeltas[1] * samplePhaseScale;
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phaseA: number = (((tone.phases[0] % 1.0) + 1.0) % 1.0) * waveLength;
    let phaseB: number = (((tone.phases[1] % 1.0) + 1.0) % 1.0) * waveLength;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      const phaseAInt: number = Math.floor(phaseA);
      const phaseBInt: number = Math.floor(phaseB);
      const indexA: number =
        ((phaseAInt % waveLength) + waveLength) % waveLength;
      const indexB: number =
        ((phaseBInt % waveLength) + waveLength) % waveLength;
      const nextIndexA: number = (indexA + 1) % waveLength;
      const nextIndexB: number = (indexB + 1) % waveLength;
      const phaseRatioA: number = phaseA - phaseAInt;
      const phaseRatioB: number = phaseB - phaseBInt;
      const waveA: number =
        wave[indexA] + (wave[nextIndexA] - wave[indexA]) * phaseRatioA;
      const waveB: number =
        wave[indexB] + (wave[nextIndexB] - wave[indexB]) * phaseRatioB;

      const inputSample: number = waveA + waveB * unisonSign;
      const filteredSample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      const output: number = filteredSample * expression;
      expression += expressionDelta;
      data[sampleIndex] += output;

      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;
      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;
    }

    tone.phases[0] = (phaseA / waveLength) % 1.0;
    tone.phases[1] = (phaseB / waveLength) % 1.0;
    tone.phaseDeltas[0] = phaseDeltaA / samplePhaseScale;
    tone.phaseDeltas[1] = phaseDeltaB / samplePhaseScale;
    tone.expression = expression;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static harmonicsSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const wave: Float32Array = instrumentState.wave!;
    const waveLength: number = wave.length - 1; // The first sample is duplicated at the end, don't double-count it.

    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    if (
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval
    )
      tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0] * waveLength;
    let phaseDeltaB: number = tone.phaseDeltas[1] * waveLength;
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phaseA: number = (tone.phases[0] % 1) * waveLength;
    let phaseB: number = (tone.phases[1] % 1) * waveLength;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    const phaseAInt: number = phaseA | 0;
    const phaseBInt: number = phaseB | 0;
    const indexA: number = phaseAInt % waveLength;
    const indexB: number = phaseBInt % waveLength;
    const phaseRatioA: number = phaseA - phaseAInt;
    const phaseRatioB: number = phaseB - phaseBInt;
    let prevWaveIntegralA: number = +wave[indexA];
    let prevWaveIntegralB: number = +wave[indexB];
    prevWaveIntegralA += (wave[indexA + 1] - prevWaveIntegralA) * phaseRatioA;
    prevWaveIntegralB += (wave[indexB + 1] - prevWaveIntegralB) * phaseRatioB;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;

      const phaseAInt: number = phaseA | 0;
      const phaseBInt: number = phaseB | 0;
      const indexA: number = phaseAInt % waveLength;
      const indexB: number = phaseBInt % waveLength;
      let nextWaveIntegralA: number = wave[indexA];
      let nextWaveIntegralB: number = wave[indexB];
      const phaseRatioA: number = phaseA - phaseAInt;
      const phaseRatioB: number = phaseB - phaseBInt;
      nextWaveIntegralA += (wave[indexA + 1] - nextWaveIntegralA) * phaseRatioA;
      nextWaveIntegralB += (wave[indexB + 1] - nextWaveIntegralB) * phaseRatioB;
      const waveA: number =
        (nextWaveIntegralA - prevWaveIntegralA) / phaseDeltaA;
      const waveB: number =
        (nextWaveIntegralB - prevWaveIntegralB) / phaseDeltaB;
      prevWaveIntegralA = nextWaveIntegralA;
      prevWaveIntegralB = nextWaveIntegralB;

      const inputSample: number = waveA + waveB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA / waveLength;
    tone.phases[1] = phaseB / waveLength;
    tone.phaseDeltas[0] = phaseDeltaA / waveLength;
    tone.phaseDeltas[1] = phaseDeltaB / waveLength;
    tone.expression = expression;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static pickedStringSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    // This algorithm is similar to the Karpluss-Strong algorithm in principle, but with an
    // all-pass filter for dispersion and with more control over the impulse harmonics.
    // The source code is processed as a string before being compiled, in order to
    // handle the unison feature. If unison is disabled or set to none, then only one
    // string voice is required, otherwise two string voices are required. We only want
    // to compute the minimum possible number of string voices, so omit the code for
    // processing extra ones if possible. Any line containing a "#" is duplicated for
    // each required voice, replacing the "#" with the voice index.

    const voiceCount: number = instrumentState.unison!.voices;
    let pickedStringFunction: Function =
      Synth.pickedStringFunctionCache[voiceCount];
    if (pickedStringFunction == undefined) {
      let pickedStringSource: string =
        "return (synth, bufferIndex, runLength, tone, instrumentState) => {";

      pickedStringSource += `
				const data = synth.tempMonoInstrumentSampleBuffer;

				let pickedString# = tone.pickedStrings[#];
				let allPassSample# = +pickedString#.allPassSample;
				let allPassPrevInput# = +pickedString#.allPassPrevInput;
				let sustainFilterSample# = +pickedString#.sustainFilterSample;
				let sustainFilterPrevOutput2# = +pickedString#.sustainFilterPrevOutput2;
				let sustainFilterPrevInput1# = +pickedString#.sustainFilterPrevInput1;
				let sustainFilterPrevInput2# = +pickedString#.sustainFilterPrevInput2;
				let fractionalDelaySample# = +pickedString#.fractionalDelaySample;
				const delayLine# = pickedString#.delayLine;
				const delayBufferMask# = (delayLine#.length - 1) >> 0;
				let delayIndex# = pickedString#.delayIndex|0;
				delayIndex# = (delayIndex# & delayBufferMask#) + delayLine#.length;
				let delayLength# = +pickedString#.prevDelayLength;
				const delayLengthDelta# = +pickedString#.delayLengthDelta;
				let allPassG# = +pickedString#.allPassG;
				let sustainFilterA1# = +pickedString#.sustainFilterA1;
				let sustainFilterA2# = +pickedString#.sustainFilterA2;
				let sustainFilterB0# = +pickedString#.sustainFilterB0;
				let sustainFilterB1# = +pickedString#.sustainFilterB1;
				let sustainFilterB2# = +pickedString#.sustainFilterB2;
				const allPassGDelta# = +pickedString#.allPassGDelta;
				const sustainFilterA1Delta# = +pickedString#.sustainFilterA1Delta;
				const sustainFilterA2Delta# = +pickedString#.sustainFilterA2Delta;
				const sustainFilterB0Delta# = +pickedString#.sustainFilterB0Delta;
				const sustainFilterB1Delta# = +pickedString#.sustainFilterB1Delta;
				const sustainFilterB2Delta# = +pickedString#.sustainFilterB2Delta;

				let expression = +tone.expression;
				const expressionDelta = +tone.expressionDelta;

				const unisonSign = tone.specialIntervalExpressionMult * instrumentState.unison.sign;
				const delayResetOffset# = pickedString#.delayResetOffset|0;

				const filters = tone.noteFilters;
				const filterCount = tone.noteFilterCount|0;
				let initialFilterInput1 = +tone.initialNoteFilterInput1;
				let initialFilterInput2 = +tone.initialNoteFilterInput2;
				const applyFilters = Synth.applyFilters;

				const stopIndex = bufferIndex + runLength;
				for (let sampleIndex = bufferIndex; sampleIndex < stopIndex; sampleIndex++) {
					const targetSampleTime# = delayIndex# - delayLength#;
					const lowerIndex# = (targetSampleTime# + 0.125) | 0; // Offset to improve stability of all-pass filter.
					const upperIndex# = lowerIndex# + 1;
					const fractionalDelay# = upperIndex# - targetSampleTime#;
					const fractionalDelayG# = (1.0 - fractionalDelay#) / (1.0 + fractionalDelay#); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
					const prevInput# = delayLine#[lowerIndex# & delayBufferMask#];
					const input# = delayLine#[upperIndex# & delayBufferMask#];
					fractionalDelaySample# = fractionalDelayG# * input# + prevInput# - fractionalDelayG# * fractionalDelaySample#;

					allPassSample# = fractionalDelaySample# * allPassG# + allPassPrevInput# - allPassG# * allPassSample#;
					allPassPrevInput# = fractionalDelaySample#;

					const sustainFilterPrevOutput1# = sustainFilterSample#;
					sustainFilterSample# = sustainFilterB0# * allPassSample# + sustainFilterB1# * sustainFilterPrevInput1# + sustainFilterB2# * sustainFilterPrevInput2# - sustainFilterA1# * sustainFilterSample# - sustainFilterA2# * sustainFilterPrevOutput2#;
					sustainFilterPrevOutput2# = sustainFilterPrevOutput1#;
					sustainFilterPrevInput2# = sustainFilterPrevInput1#;
					sustainFilterPrevInput1# = allPassSample#;

					delayLine#[delayIndex# & delayBufferMask#] += sustainFilterSample#;
					delayLine#[(delayIndex# + delayResetOffset#) & delayBufferMask#] = 0.0;
					delayIndex#++;

					const inputSample = (`;

      const sampleList: string[] = [];
      for (let voice: number = 0; voice < voiceCount; voice++) {
        sampleList.push(
          "fractionalDelaySample" + voice + (voice == 1 ? " * unisonSign" : ""),
        );
      }

      pickedStringSource += sampleList.join(" + ");

      pickedStringSource += `) * expression;
					const sample = applyFilters(inputSample, initialFilterInput1, initialFilterInput2, filterCount, filters);
					initialFilterInput2 = initialFilterInput1;
					initialFilterInput1 = inputSample;
					data[sampleIndex] += sample;

					expression += expressionDelta;
					delayLength# += delayLengthDelta#;
					allPassG# += allPassGDelta#;
					sustainFilterA1# += sustainFilterA1Delta#;
					sustainFilterA2# += sustainFilterA2Delta#;
					sustainFilterB0# += sustainFilterB0Delta#;
					sustainFilterB1# += sustainFilterB1Delta#;
					sustainFilterB2# += sustainFilterB2Delta#;
				}

				// Avoid persistent denormal or NaN values in the delay buffers and filter history.
				const epsilon = (1.0e-24);
				if (!Number.isFinite(allPassSample#) || Math.abs(allPassSample#) < epsilon) allPassSample# = 0.0;
				if (!Number.isFinite(allPassPrevInput#) || Math.abs(allPassPrevInput#) < epsilon) allPassPrevInput# = 0.0;
				if (!Number.isFinite(sustainFilterSample#) || Math.abs(sustainFilterSample#) < epsilon) sustainFilterSample# = 0.0;
				if (!Number.isFinite(sustainFilterPrevOutput2#) || Math.abs(sustainFilterPrevOutput2#) < epsilon) sustainFilterPrevOutput2# = 0.0;
				if (!Number.isFinite(sustainFilterPrevInput1#) || Math.abs(sustainFilterPrevInput1#) < epsilon) sustainFilterPrevInput1# = 0.0;
				if (!Number.isFinite(sustainFilterPrevInput2#) || Math.abs(sustainFilterPrevInput2#) < epsilon) sustainFilterPrevInput2# = 0.0;
				if (!Number.isFinite(fractionalDelaySample#) || Math.abs(fractionalDelaySample#) < epsilon) fractionalDelaySample# = 0.0;
				pickedString#.allPassSample = allPassSample#;
				pickedString#.allPassPrevInput = allPassPrevInput#;
				pickedString#.sustainFilterSample = sustainFilterSample#;
				pickedString#.sustainFilterPrevOutput2 = sustainFilterPrevOutput2#;
				pickedString#.sustainFilterPrevInput1 = sustainFilterPrevInput1#;
				pickedString#.sustainFilterPrevInput2 = sustainFilterPrevInput2#;
				pickedString#.fractionalDelaySample = fractionalDelaySample#;
				pickedString#.delayIndex = delayIndex#;
				pickedString#.prevDelayLength = delayLength#;
				pickedString#.allPassG = allPassG#;
				pickedString#.sustainFilterA1 = sustainFilterA1#;
				pickedString#.sustainFilterA2 = sustainFilterA2#;
				pickedString#.sustainFilterB0 = sustainFilterB0#;
				pickedString#.sustainFilterB1 = sustainFilterB1#;
				pickedString#.sustainFilterB2 = sustainFilterB2#;

				tone.expression = expression;

				synth.sanitizeFilters(filters);
				tone.initialNoteFilterInput1 = initialFilterInput1;
				tone.initialNoteFilterInput2 = initialFilterInput2;
			}`;

      // Duplicate lines containing "#" for each voice and replace the "#" with the voice index.
      pickedStringSource = pickedStringSource.replace(/^.*\#.*$/gm, (line) => {
        const lines = [];
        for (let voice: number = 0; voice < voiceCount; voice++) {
          lines.push(line.replace(/\#/g, String(voice)));
        }
        return lines.join("\n");
      });

      //console.log(pickedStringSource);
      pickedStringFunction = new Function(
        "Config",
        "Synth",
        pickedStringSource,
      )(Config, Synth);
      Synth.pickedStringFunctionCache[voiceCount] = pickedStringFunction;
    }

    pickedStringFunction(synth, bufferIndex, runLength, tone, instrumentState);
  }

  private static effectsSynth(
    synth: Synth,
    outputDataL: Float32Array,
    outputDataR: Float32Array,
    bufferIndex: number,
    runLength: number,
    instrumentState: InstrumentState,
  ): void {
    // TODO: If automation is involved, don't assume sliders will stay at zero.
    const usesDistortion: boolean = effectsIncludeDistortion(
      instrumentState.effects,
    );
    const usesBitcrusher: boolean = effectsIncludeBitcrusher(
      instrumentState.effects,
    );
    const usesEqFilter: boolean = instrumentState.eqFilterCount > 0;
    const usesChorus: boolean = effectsIncludeChorus(instrumentState.effects);
    const usesEcho: boolean = effectsIncludeEcho(instrumentState.effects);
    const usesReverb: boolean = effectsIncludeReverb(instrumentState.effects);
    let signature: number = 0;
    if (usesDistortion) signature = signature | 1;
    signature = signature << 1;
    if (usesBitcrusher) signature = signature | 1;
    signature = signature << 1;
    if (usesEqFilter) signature = signature | 1;
    signature = signature << 1;
    if (usesChorus) signature = signature | 1;
    signature = signature << 1;
    if (usesEcho) signature = signature | 1;
    signature = signature << 1;
    if (usesReverb) signature = signature | 1;

    let effectsFunction: Function = Synth.effectsFunctionCache[signature];
    if (effectsFunction == undefined) {
      let effectsSource: string =
        "return (synth, outputDataL, outputDataR, bufferIndex, runLength, instrumentState) => {";

      const usesDelays: boolean = usesChorus || usesReverb || usesEcho;

      effectsSource += `
				const tempMonoInstrumentSampleBuffer = synth.tempMonoInstrumentSampleBuffer;

				let mixVolume = +instrumentState.mixVolume;
				const mixVolumeDelta = +instrumentState.mixVolumeDelta;`;

      if (usesDelays) {
        effectsSource += `

				let delayInputMult = +instrumentState.delayInputMult;
				const delayInputMultDelta = +instrumentState.delayInputMultDelta;`;
      }

      if (usesDistortion) {
        // Distortion can sometimes create noticeable aliasing.
        // It seems the established industry best practice for distortion antialiasing
        // is to upsample the inputs ("zero stuffing" followed by a brick wall lowpass
        // at the original nyquist frequency), perform the distortion, then downsample
        // (the lowpass again followed by dropping in-between samples). This is
        // "mathematically correct" in that it preserves only the intended frequencies,
        // but it has several unfortunate tradeoffs depending on the choice of filter,
        // introducing latency and/or time smearing, since no true brick wall filter
        // exists. For the time being, I've opted to instead generate in-between input
        // samples using fractional delay all-pass filters, and after distorting them,
        // I "downsample" these with a simple weighted sum.

        effectsSource += `

				const distortionBaseVolume = +Config.distortionBaseVolume;
				let distortion = instrumentState.distortion;
				const distortionDelta = instrumentState.distortionDelta;
				let distortionDrive = instrumentState.distortionDrive;
				const distortionDriveDelta = instrumentState.distortionDriveDelta;
				const distortionFractionalResolution = 4.0;
				const distortionOversampleCompensation = distortionBaseVolume / distortionFractionalResolution;
				const distortionFractionalDelay1 = 1.0 / distortionFractionalResolution;
				const distortionFractionalDelay2 = 2.0 / distortionFractionalResolution;
				const distortionFractionalDelay3 = 3.0 / distortionFractionalResolution;
				const distortionFractionalDelayG1 = (1.0 - distortionFractionalDelay1) / (1.0 + distortionFractionalDelay1); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionFractionalDelayG2 = (1.0 - distortionFractionalDelay2) / (1.0 + distortionFractionalDelay2); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionFractionalDelayG3 = (1.0 - distortionFractionalDelay3) / (1.0 + distortionFractionalDelay3); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionNextOutputWeight1 = Math.cos(Math.PI * distortionFractionalDelay1) * 0.5 + 0.5;
				const distortionNextOutputWeight2 = Math.cos(Math.PI * distortionFractionalDelay2) * 0.5 + 0.5;
				const distortionNextOutputWeight3 = Math.cos(Math.PI * distortionFractionalDelay3) * 0.5 + 0.5;
				const distortionPrevOutputWeight1 = 1.0 - distortionNextOutputWeight1;
				const distortionPrevOutputWeight2 = 1.0 - distortionNextOutputWeight2;
				const distortionPrevOutputWeight3 = 1.0 - distortionNextOutputWeight3;

				let distortionFractionalInput1 = +instrumentState.distortionFractionalInput1;
				let distortionFractionalInput2 = +instrumentState.distortionFractionalInput2;
				let distortionFractionalInput3 = +instrumentState.distortionFractionalInput3;
				let distortionPrevInput = +instrumentState.distortionPrevInput;
				let distortionNextOutput = +instrumentState.distortionNextOutput;`;
      }

      if (usesBitcrusher) {
        effectsSource += `

				let bitcrusherPrevInput = +instrumentState.bitcrusherPrevInput;
				let bitcrusherCurrentOutput = +instrumentState.bitcrusherCurrentOutput;
				let bitcrusherPhase = +instrumentState.bitcrusherPhase;
				let bitcrusherPhaseDelta = +instrumentState.bitcrusherPhaseDelta;
				const bitcrusherPhaseDeltaScale = +instrumentState.bitcrusherPhaseDeltaScale;
				let bitcrusherScale = +instrumentState.bitcrusherScale;
				const bitcrusherScaleScale = +instrumentState.bitcrusherScaleScale;
				let bitcrusherFoldLevel = +instrumentState.bitcrusherFoldLevel;
				const bitcrusherFoldLevelScale = +instrumentState.bitcrusherFoldLevelScale;`;
      }

      if (usesEqFilter) {
        effectsSource += `

				let filters = instrumentState.eqFilters;
				const filterCount = instrumentState.eqFilterCount|0;
				let initialFilterInput1 = +instrumentState.initialEqFilterInput1;
				let initialFilterInput2 = +instrumentState.initialEqFilterInput2;
				const applyFilters = Synth.applyFilters;`;
      }

      // The eq filter volume is also used to fade out the instrument state, so always include it.
      effectsSource += `

				let eqFilterVolume = +instrumentState.eqFilterVolume;
				const eqFilterVolumeDelta = +instrumentState.eqFilterVolumeDelta;`;

      effectsSource += `

				const panningMask = synth.panningDelayBufferMask >>> 0;
				const panningDelayLine = instrumentState.panningDelayLine;
				let panningDelayPos = instrumentState.panningDelayPos & panningMask;
				const panningVolumeL      = +instrumentState.panningVolumeL;
				const panningVolumeR      = +instrumentState.panningVolumeR;
				let   panningOffsetL      = +instrumentState.panningOffsetL;
				let   panningOffsetR      = +instrumentState.panningOffsetR;`;

      if (usesChorus) {
        effectsSource += `

				const chorusMask = synth.chorusDelayBufferMask >>> 0;
				const chorusDelayLineL = instrumentState.chorusDelayLineL;
				const chorusDelayLineR = instrumentState.chorusDelayLineR;
				instrumentState.chorusDelayLineDirty = true;
				let chorusDelayPos = instrumentState.chorusDelayPos & chorusMask;

				let chorusVoiceMult = +instrumentState.chorusVoiceMult;
				const chorusVoiceMultDelta = +instrumentState.chorusVoiceMultDelta;
				let chorusCombinedMult = +instrumentState.chorusCombinedMult;
				const chorusCombinedMultDelta = +instrumentState.chorusCombinedMultDelta;

				const chorusDuration = +Config.chorusPeriodSeconds;
				const chorusAngle = Math.PI * 2.0 / (chorusDuration * synth.samplesPerSecond);
				const chorusRange = synth.samplesPerSecond * Config.chorusDelayRange;
				const chorusOffset0 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][0] * chorusRange;
				const chorusOffset1 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][1] * chorusRange;
				const chorusOffset2 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][2] * chorusRange;
				const chorusOffset3 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][0] * chorusRange;
				const chorusOffset4 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][1] * chorusRange;
				const chorusOffset5 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][2] * chorusRange;
				let chorusPhase = instrumentState.chorusPhase % (Math.PI * 2.0);
				let chorusTap0Index = chorusDelayPos + chorusOffset0 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][0]);
				let chorusTap1Index = chorusDelayPos + chorusOffset1 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][1]);
				let chorusTap2Index = chorusDelayPos + chorusOffset2 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][2]);
				let chorusTap3Index = chorusDelayPos + chorusOffset3 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][0]);
				let chorusTap4Index = chorusDelayPos + chorusOffset4 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][1]);
				let chorusTap5Index = chorusDelayPos + chorusOffset5 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][2]);
				chorusPhase += chorusAngle * runLength;
				const chorusTap0End = chorusDelayPos + chorusOffset0 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][0]) + runLength;
				const chorusTap1End = chorusDelayPos + chorusOffset1 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][1]) + runLength;
				const chorusTap2End = chorusDelayPos + chorusOffset2 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][2]) + runLength;
				const chorusTap3End = chorusDelayPos + chorusOffset3 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][0]) + runLength;
				const chorusTap4End = chorusDelayPos + chorusOffset4 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][1]) + runLength;
				const chorusTap5End = chorusDelayPos + chorusOffset5 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][2]) + runLength;
				const chorusTap0Delta = (chorusTap0End - chorusTap0Index) / runLength;
				const chorusTap1Delta = (chorusTap1End - chorusTap1Index) / runLength;
				const chorusTap2Delta = (chorusTap2End - chorusTap2Index) / runLength;
				const chorusTap3Delta = (chorusTap3End - chorusTap3Index) / runLength;
				const chorusTap4Delta = (chorusTap4End - chorusTap4Index) / runLength;
				const chorusTap5Delta = (chorusTap5End - chorusTap5Index) / runLength;`;
      }

      if (usesEcho) {
        effectsSource += `

				let echoMult = +instrumentState.echoMult;
				const echoMultDelta = +instrumentState.echoMultDelta;

				const echoDelayLineL = instrumentState.echoDelayLineL;
				const echoDelayLineR = instrumentState.echoDelayLineR;
				const echoMask = (echoDelayLineL.length - 1) >>> 0;
				instrumentState.echoDelayLineDirty = true;

				let echoDelayPos = instrumentState.echoDelayPos & echoMask;
				const echoDelayOffsetStart = (echoDelayLineL.length - instrumentState.echoDelayOffsetStart) & echoMask;
				const echoDelayOffsetEnd   = (echoDelayLineL.length - instrumentState.echoDelayOffsetEnd) & echoMask;
				let echoDelayOffsetRatio = +instrumentState.echoDelayOffsetRatio;
				const echoDelayOffsetRatioDelta = +instrumentState.echoDelayOffsetRatioDelta;

				const echoShelfA1 = +instrumentState.echoShelfA1;
				const echoShelfB0 = +instrumentState.echoShelfB0;
				const echoShelfB1 = +instrumentState.echoShelfB1;
				let echoShelfSampleL = +instrumentState.echoShelfSampleL;
				let echoShelfSampleR = +instrumentState.echoShelfSampleR;
				let echoShelfPrevInputL = +instrumentState.echoShelfPrevInputL;
				let echoShelfPrevInputR = +instrumentState.echoShelfPrevInputR;`;
      }

      if (usesReverb) {
        effectsSource += `

				const reverbMask = Config.reverbDelayBufferMask >>> 0; //TODO: Dynamic reverb buffer size.
				const reverbDelayLine = instrumentState.reverbDelayLine;
				instrumentState.reverbDelayLineDirty = true;
				let reverbDelayPos = instrumentState.reverbDelayPos & reverbMask;

				let reverb = +instrumentState.reverbMult;
				const reverbDelta = +instrumentState.reverbMultDelta;

				const reverbShelfA1 = +instrumentState.reverbShelfA1;
				const reverbShelfB0 = +instrumentState.reverbShelfB0;
				const reverbShelfB1 = +instrumentState.reverbShelfB1;
				let reverbShelfSample0 = +instrumentState.reverbShelfSample0;
				let reverbShelfSample1 = +instrumentState.reverbShelfSample1;
				let reverbShelfSample2 = +instrumentState.reverbShelfSample2;
				let reverbShelfSample3 = +instrumentState.reverbShelfSample3;
				let reverbShelfPrevInput0 = +instrumentState.reverbShelfPrevInput0;
				let reverbShelfPrevInput1 = +instrumentState.reverbShelfPrevInput1;
				let reverbShelfPrevInput2 = +instrumentState.reverbShelfPrevInput2;
				let reverbShelfPrevInput3 = +instrumentState.reverbShelfPrevInput3;`;
      }

      effectsSource += `

				const stopIndex = bufferIndex + runLength;
				for (let sampleIndex = bufferIndex; sampleIndex < stopIndex; sampleIndex++) {
					let sample = tempMonoInstrumentSampleBuffer[sampleIndex];
					tempMonoInstrumentSampleBuffer[sampleIndex] = 0.0;`;

      if (usesDistortion) {
        effectsSource += `

					const distortionReverse = 1.0 - distortion;
					const distortionNextInput = sample * distortionDrive;
					sample = distortionNextOutput;
					distortionNextOutput = distortionNextInput / (distortionReverse * Math.abs(distortionNextInput) + distortion);
					distortionFractionalInput1 = distortionFractionalDelayG1 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG1 * distortionFractionalInput1;
					distortionFractionalInput2 = distortionFractionalDelayG2 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG2 * distortionFractionalInput2;
					distortionFractionalInput3 = distortionFractionalDelayG3 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG3 * distortionFractionalInput3;
					const distortionOutput1 = distortionFractionalInput1 / (distortionReverse * Math.abs(distortionFractionalInput1) + distortion);
					const distortionOutput2 = distortionFractionalInput2 / (distortionReverse * Math.abs(distortionFractionalInput2) + distortion);
					const distortionOutput3 = distortionFractionalInput3 / (distortionReverse * Math.abs(distortionFractionalInput3) + distortion);
					distortionNextOutput += distortionOutput1 * distortionNextOutputWeight1 + distortionOutput2 * distortionNextOutputWeight2 + distortionOutput3 * distortionNextOutputWeight3;
					sample += distortionOutput1 * distortionPrevOutputWeight1 + distortionOutput2 * distortionPrevOutputWeight2 + distortionOutput3 * distortionPrevOutputWeight3;
					sample *= distortionOversampleCompensation;
					distortionPrevInput = distortionNextInput;
					distortion += distortionDelta;
					distortionDrive += distortionDriveDelta;`;
      }

      if (usesBitcrusher) {
        effectsSource += `

					bitcrusherPhase += bitcrusherPhaseDelta;
					if (bitcrusherPhase < 1.0) {
						bitcrusherPrevInput = sample;
						sample = bitcrusherCurrentOutput;
					} else {
						bitcrusherPhase = bitcrusherPhase % 1.0;
						const ratio = bitcrusherPhase / bitcrusherPhaseDelta;

						const lerpedInput = sample + (bitcrusherPrevInput - sample) * ratio;
						bitcrusherPrevInput = sample;

						const bitcrusherWrapLevel = bitcrusherFoldLevel * 4.0;
						const wrappedSample = (((lerpedInput + bitcrusherFoldLevel) % bitcrusherWrapLevel) + bitcrusherWrapLevel) % bitcrusherWrapLevel;
						const foldedSample = bitcrusherFoldLevel - Math.abs(bitcrusherFoldLevel * 2.0 - wrappedSample);
						const scaledSample = foldedSample / bitcrusherScale;
						const oldValue = bitcrusherCurrentOutput;
						const newValue = (((scaledSample > 0 ? scaledSample + 1 : scaledSample)|0)-.5) * bitcrusherScale;

						sample = oldValue + (newValue - oldValue) * ratio;
						bitcrusherCurrentOutput = newValue;
					}
					bitcrusherPhaseDelta *= bitcrusherPhaseDeltaScale;
					bitcrusherScale *= bitcrusherScaleScale;
					bitcrusherFoldLevel *= bitcrusherFoldLevelScale;`;
      }

      if (usesEqFilter) {
        effectsSource += `

					const inputSample = sample;
					sample = applyFilters(inputSample, initialFilterInput1, initialFilterInput2, filterCount, filters);
					initialFilterInput2 = initialFilterInput1;
					initialFilterInput1 = inputSample;`;
      }

      // The eq filter volume is also used to fade out the instrument state, so always include it.
      effectsSource += `

					sample *= eqFilterVolume;
					eqFilterVolume += eqFilterVolumeDelta;`;

      effectsSource += `

					panningDelayLine[panningDelayPos] = sample;
					const panningRatioL  = panningOffsetL % 1;
					const panningRatioR  = panningOffsetR % 1;
					const panningTapLA   = panningDelayLine[(panningOffsetL) & panningMask];
					const panningTapLB   = panningDelayLine[(panningOffsetL + 1) & panningMask];
					const panningTapRA   = panningDelayLine[(panningOffsetR) & panningMask];
					const panningTapRB   = panningDelayLine[(panningOffsetR + 1) & panningMask];
					const panningTapL    = panningTapLA + (panningTapLB - panningTapLA) * panningRatioL;
					const panningTapR    = panningTapRA + (panningTapRB - panningTapRA) * panningRatioR;
					let sampleL = panningTapL * panningVolumeL;
					let sampleR = panningTapR * panningVolumeR;
					panningDelayPos = (panningDelayPos + 1) & panningMask;
					panningOffsetL++;
					panningOffsetR++;`;

      if (usesChorus) {
        effectsSource += `

					const chorusTap0Ratio = chorusTap0Index % 1;
					const chorusTap1Ratio = chorusTap1Index % 1;
					const chorusTap2Ratio = chorusTap2Index % 1;
					const chorusTap3Ratio = chorusTap3Index % 1;
					const chorusTap4Ratio = chorusTap4Index % 1;
					const chorusTap5Ratio = chorusTap5Index % 1;
					const chorusTap0A = chorusDelayLineL[(chorusTap0Index) & chorusMask];
					const chorusTap0B = chorusDelayLineL[(chorusTap0Index + 1) & chorusMask];
					const chorusTap1A = chorusDelayLineL[(chorusTap1Index) & chorusMask];
					const chorusTap1B = chorusDelayLineL[(chorusTap1Index + 1) & chorusMask];
					const chorusTap2A = chorusDelayLineL[(chorusTap2Index) & chorusMask];
					const chorusTap2B = chorusDelayLineL[(chorusTap2Index + 1) & chorusMask];
					const chorusTap3A = chorusDelayLineR[(chorusTap3Index) & chorusMask];
					const chorusTap3B = chorusDelayLineR[(chorusTap3Index + 1) & chorusMask];
					const chorusTap4A = chorusDelayLineR[(chorusTap4Index) & chorusMask];
					const chorusTap4B = chorusDelayLineR[(chorusTap4Index + 1) & chorusMask];
					const chorusTap5A = chorusDelayLineR[(chorusTap5Index) & chorusMask];
					const chorusTap5B = chorusDelayLineR[(chorusTap5Index + 1) & chorusMask];
					const chorusTap0 = chorusTap0A + (chorusTap0B - chorusTap0A) * chorusTap0Ratio;
					const chorusTap1 = chorusTap1A + (chorusTap1B - chorusTap1A) * chorusTap1Ratio;
					const chorusTap2 = chorusTap2A + (chorusTap2B - chorusTap2A) * chorusTap2Ratio;
					const chorusTap3 = chorusTap3A + (chorusTap3B - chorusTap3A) * chorusTap3Ratio;
					const chorusTap4 = chorusTap4A + (chorusTap4B - chorusTap4A) * chorusTap4Ratio;
					const chorusTap5 = chorusTap5A + (chorusTap5B - chorusTap5A) * chorusTap5Ratio;
					chorusDelayLineL[chorusDelayPos] = sampleL * delayInputMult;
					chorusDelayLineR[chorusDelayPos] = sampleR * delayInputMult;
					sampleL = chorusCombinedMult * (sampleL + chorusVoiceMult * (chorusTap1 - chorusTap0 - chorusTap2));
					sampleR = chorusCombinedMult * (sampleR + chorusVoiceMult * (chorusTap4 - chorusTap3 - chorusTap5));
					chorusDelayPos = (chorusDelayPos + 1) & chorusMask;
					chorusTap0Index += chorusTap0Delta;
					chorusTap1Index += chorusTap1Delta;
					chorusTap2Index += chorusTap2Delta;
					chorusTap3Index += chorusTap3Delta;
					chorusTap4Index += chorusTap4Delta;
					chorusTap5Index += chorusTap5Delta;
					chorusVoiceMult += chorusVoiceMultDelta;
					chorusCombinedMult += chorusCombinedMultDelta;`;
      }

      if (usesEcho) {
        effectsSource += `

					const echoTapStartIndex = (echoDelayPos + echoDelayOffsetStart) & echoMask;
					const echoTapEndIndex   = (echoDelayPos + echoDelayOffsetEnd  ) & echoMask;
					const echoTapStartL = echoDelayLineL[echoTapStartIndex];
					const echoTapEndL   = echoDelayLineL[echoTapEndIndex];
					const echoTapStartR = echoDelayLineR[echoTapStartIndex];
					const echoTapEndR   = echoDelayLineR[echoTapEndIndex];
					const echoTapL = (echoTapStartL + (echoTapEndL - echoTapStartL) * echoDelayOffsetRatio) * echoMult;
					const echoTapR = (echoTapStartR + (echoTapEndR - echoTapStartR) * echoDelayOffsetRatio) * echoMult;

					echoShelfSampleL = echoShelfB0 * echoTapL + echoShelfB1 * echoShelfPrevInputL - echoShelfA1 * echoShelfSampleL;
					echoShelfSampleR = echoShelfB0 * echoTapR + echoShelfB1 * echoShelfPrevInputR - echoShelfA1 * echoShelfSampleR;
					echoShelfPrevInputL = echoTapL;
					echoShelfPrevInputR = echoTapR;
					sampleL += echoShelfSampleL;
					sampleR += echoShelfSampleR;

					echoDelayLineL[echoDelayPos] = sampleL * delayInputMult;
					echoDelayLineR[echoDelayPos] = sampleR * delayInputMult;
					echoDelayPos = (echoDelayPos + 1) & echoMask;
					echoDelayOffsetRatio += echoDelayOffsetRatioDelta;
					echoMult += echoMultDelta;`;
      }

      if (usesReverb) {
        effectsSource += `

					// Reverb, implemented using a feedback delay network with a Hadamard matrix and lowpass filters.
					// good ratios:    0.555235 + 0.618033 + 0.818 +   1.0 = 2.991268
					// Delay lengths:  3041     + 3385     + 4481  +  5477 = 16384 = 2^14
					// Buffer offsets: 3041    -> 6426   -> 10907 -> 16384
					const reverbDelayPos1 = (reverbDelayPos +  3041) & reverbMask;
					const reverbDelayPos2 = (reverbDelayPos +  6426) & reverbMask;
					const reverbDelayPos3 = (reverbDelayPos + 10907) & reverbMask;
					const reverbSample0 = (reverbDelayLine[reverbDelayPos]);
					const reverbSample1 = reverbDelayLine[reverbDelayPos1];
					const reverbSample2 = reverbDelayLine[reverbDelayPos2];
					const reverbSample3 = reverbDelayLine[reverbDelayPos3];
					const reverbTemp0 = -(reverbSample0 + sampleL) + reverbSample1;
					const reverbTemp1 = -(reverbSample0 + sampleR) - reverbSample1;
					const reverbTemp2 = -reverbSample2 + reverbSample3;
					const reverbTemp3 = -reverbSample2 - reverbSample3;
					const reverbShelfInput0 = (reverbTemp0 + reverbTemp2) * reverb;
					const reverbShelfInput1 = (reverbTemp1 + reverbTemp3) * reverb;
					const reverbShelfInput2 = (reverbTemp0 - reverbTemp2) * reverb;
					const reverbShelfInput3 = (reverbTemp1 - reverbTemp3) * reverb;
					reverbShelfSample0 = reverbShelfB0 * reverbShelfInput0 + reverbShelfB1 * reverbShelfPrevInput0 - reverbShelfA1 * reverbShelfSample0;
					reverbShelfSample1 = reverbShelfB0 * reverbShelfInput1 + reverbShelfB1 * reverbShelfPrevInput1 - reverbShelfA1 * reverbShelfSample1;
					reverbShelfSample2 = reverbShelfB0 * reverbShelfInput2 + reverbShelfB1 * reverbShelfPrevInput2 - reverbShelfA1 * reverbShelfSample2;
					reverbShelfSample3 = reverbShelfB0 * reverbShelfInput3 + reverbShelfB1 * reverbShelfPrevInput3 - reverbShelfA1 * reverbShelfSample3;
					reverbShelfPrevInput0 = reverbShelfInput0;
					reverbShelfPrevInput1 = reverbShelfInput1;
					reverbShelfPrevInput2 = reverbShelfInput2;
					reverbShelfPrevInput3 = reverbShelfInput3;
					reverbDelayLine[reverbDelayPos1] = reverbShelfSample0 * delayInputMult;
					reverbDelayLine[reverbDelayPos2] = reverbShelfSample1 * delayInputMult;
					reverbDelayLine[reverbDelayPos3] = reverbShelfSample2 * delayInputMult;
					reverbDelayLine[reverbDelayPos ] = reverbShelfSample3 * delayInputMult;
					reverbDelayPos = (reverbDelayPos + 1) & reverbMask;
					sampleL += reverbSample1 + reverbSample2 + reverbSample3;
					sampleR += reverbSample0 + reverbSample2 - reverbSample3;
					reverb += reverbDelta;`;
      }

      effectsSource += `

					outputDataL[sampleIndex] += sampleL * mixVolume;
					outputDataR[sampleIndex] += sampleR * mixVolume;
					mixVolume += mixVolumeDelta;`;

      if (usesDelays) {
        effectsSource += `

					delayInputMult += delayInputMultDelta;`;
      }

      effectsSource += `
				}

				instrumentState.mixVolume = mixVolume;
				instrumentState.eqFilterVolume = eqFilterVolume;

				// Avoid persistent denormal or NaN values in the delay buffers and filter history.
				const epsilon = (1.0e-24);`;

      if (usesDelays) {
        effectsSource += `

				instrumentState.delayInputMult = delayInputMult;`;
      }

      if (usesDistortion) {
        effectsSource += `

				instrumentState.distortion = distortion;
				instrumentState.distortionDrive = distortionDrive;

				if (!Number.isFinite(distortionFractionalInput1) || Math.abs(distortionFractionalInput1) < epsilon) distortionFractionalInput1 = 0.0;
				if (!Number.isFinite(distortionFractionalInput2) || Math.abs(distortionFractionalInput2) < epsilon) distortionFractionalInput2 = 0.0;
				if (!Number.isFinite(distortionFractionalInput3) || Math.abs(distortionFractionalInput3) < epsilon) distortionFractionalInput3 = 0.0;
				if (!Number.isFinite(distortionPrevInput) || Math.abs(distortionPrevInput) < epsilon) distortionPrevInput = 0.0;
				if (!Number.isFinite(distortionNextOutput) || Math.abs(distortionNextOutput) < epsilon) distortionNextOutput = 0.0;

				instrumentState.distortionFractionalInput1 = distortionFractionalInput1;
				instrumentState.distortionFractionalInput2 = distortionFractionalInput2;
				instrumentState.distortionFractionalInput3 = distortionFractionalInput3;
				instrumentState.distortionPrevInput = distortionPrevInput;
				instrumentState.distortionNextOutput = distortionNextOutput;`;
      }

      if (usesBitcrusher) {
        effectsSource += `

				if (Math.abs(bitcrusherPrevInput) < epsilon) bitcrusherPrevInput = 0.0;
				if (Math.abs(bitcrusherCurrentOutput) < epsilon) bitcrusherCurrentOutput = 0.0;
				instrumentState.bitcrusherPrevInput = bitcrusherPrevInput;
				instrumentState.bitcrusherCurrentOutput = bitcrusherCurrentOutput;
				instrumentState.bitcrusherPhase = bitcrusherPhase;
				instrumentState.bitcrusherPhaseDelta = bitcrusherPhaseDelta;
				instrumentState.bitcrusherScale = bitcrusherScale;
				instrumentState.bitcrusherFoldLevel = bitcrusherFoldLevel;`;
      }

      if (usesEqFilter) {
        effectsSource += `

				synth.sanitizeFilters(filters);
				// The filter input here is downstream from another filter so we
				// better make sure it's safe too.
				if (!(initialFilterInput1 < 100) || !(initialFilterInput2 < 100)) {
					initialFilterInput1 = 0.0;
					initialFilterInput2 = 0.0;
				}
				if (Math.abs(initialFilterInput1) < epsilon) initialFilterInput1 = 0.0;
				if (Math.abs(initialFilterInput2) < epsilon) initialFilterInput2 = 0.0;
				instrumentState.initialEqFilterInput1 = initialFilterInput1;
				instrumentState.initialEqFilterInput2 = initialFilterInput2;`;
      }

      effectsSource += `

				Synth.sanitizeDelayLine(panningDelayLine, panningDelayPos, panningMask);
				instrumentState.panningDelayPos = panningDelayPos;
				instrumentState.panningOffsetL = panningOffsetL;
				instrumentState.panningOffsetR = panningOffsetR;`;

      if (usesChorus) {
        effectsSource += `

				Synth.sanitizeDelayLine(chorusDelayLineL, chorusDelayPos, chorusMask);
				Synth.sanitizeDelayLine(chorusDelayLineR, chorusDelayPos, chorusMask);
				instrumentState.chorusPhase = chorusPhase;
				instrumentState.chorusDelayPos = chorusDelayPos;
				instrumentState.chorusVoiceMult = chorusVoiceMult;
				instrumentState.chorusCombinedMult = chorusCombinedMult;`;
      }

      if (usesEcho) {
        effectsSource += `

				Synth.sanitizeDelayLine(echoDelayLineL, echoDelayPos, echoMask);
				Synth.sanitizeDelayLine(echoDelayLineR, echoDelayPos, echoMask);
				instrumentState.echoDelayPos = echoDelayPos;
				instrumentState.echoMult = echoMult;
				instrumentState.echoDelayOffsetRatio = echoDelayOffsetRatio;

				if (!Number.isFinite(echoShelfSampleL) || Math.abs(echoShelfSampleL) < epsilon) echoShelfSampleL = 0.0;
				if (!Number.isFinite(echoShelfSampleR) || Math.abs(echoShelfSampleR) < epsilon) echoShelfSampleR = 0.0;
				if (!Number.isFinite(echoShelfPrevInputL) || Math.abs(echoShelfPrevInputL) < epsilon) echoShelfPrevInputL = 0.0;
				if (!Number.isFinite(echoShelfPrevInputR) || Math.abs(echoShelfPrevInputR) < epsilon) echoShelfPrevInputR = 0.0;
				instrumentState.echoShelfSampleL = echoShelfSampleL;
				instrumentState.echoShelfSampleR = echoShelfSampleR;
				instrumentState.echoShelfPrevInputL = echoShelfPrevInputL;
				instrumentState.echoShelfPrevInputR = echoShelfPrevInputR;`;
      }

      if (usesReverb) {
        effectsSource += `

				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos        , reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos +  3041, reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos +  6426, reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos + 10907, reverbMask);
				instrumentState.reverbDelayPos = reverbDelayPos;
				instrumentState.reverbMult = reverb;

				if (!Number.isFinite(reverbShelfSample0) || Math.abs(reverbShelfSample0) < epsilon) reverbShelfSample0 = 0.0;
				if (!Number.isFinite(reverbShelfSample1) || Math.abs(reverbShelfSample1) < epsilon) reverbShelfSample1 = 0.0;
				if (!Number.isFinite(reverbShelfSample2) || Math.abs(reverbShelfSample2) < epsilon) reverbShelfSample2 = 0.0;
				if (!Number.isFinite(reverbShelfSample3) || Math.abs(reverbShelfSample3) < epsilon) reverbShelfSample3 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput0) || Math.abs(reverbShelfPrevInput0) < epsilon) reverbShelfPrevInput0 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput1) || Math.abs(reverbShelfPrevInput1) < epsilon) reverbShelfPrevInput1 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput2) || Math.abs(reverbShelfPrevInput2) < epsilon) reverbShelfPrevInput2 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput3) || Math.abs(reverbShelfPrevInput3) < epsilon) reverbShelfPrevInput3 = 0.0;
				instrumentState.reverbShelfSample0 = reverbShelfSample0;
				instrumentState.reverbShelfSample1 = reverbShelfSample1;
				instrumentState.reverbShelfSample2 = reverbShelfSample2;
				instrumentState.reverbShelfSample3 = reverbShelfSample3;
				instrumentState.reverbShelfPrevInput0 = reverbShelfPrevInput0;
				instrumentState.reverbShelfPrevInput1 = reverbShelfPrevInput1;
				instrumentState.reverbShelfPrevInput2 = reverbShelfPrevInput2;
				instrumentState.reverbShelfPrevInput3 = reverbShelfPrevInput3;`;
      }

      effectsSource += "}";

      //console.log(effectsSource);
      effectsFunction = new Function("Config", "Synth", effectsSource)(
        Config,
        Synth,
      );
      Synth.effectsFunctionCache[signature] = effectsFunction;
    }

    effectsFunction(
      synth,
      outputDataL,
      outputDataR,
      bufferIndex,
      runLength,
      instrumentState,
    );
  }

  private static pulseWidthSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;

    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    if (
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval
    )
      tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0];
    let phaseDeltaB: number = tone.phaseDeltas[1];
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phaseA: number = tone.phases[0] % 1;
    let phaseB: number = tone.phases[1] % 1;

    let pulseWidth: number = tone.pulseWidth;
    const pulseWidthDelta: number = tone.pulseWidthDelta;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      const sawPhaseA: number = phaseA % 1;
      const sawPhaseB: number = (phaseA + pulseWidth) % 1;
      const sawPhaseC: number = phaseB % 1;
      const sawPhaseD: number = (phaseB + pulseWidth) % 1;

      let pulseWaveA: number = sawPhaseB - sawPhaseA;
      let pulseWaveB: number = sawPhaseD - sawPhaseC;

      // This is a PolyBLEP, which smooths out discontinuities at any frequency to reduce aliasing.
      if (sawPhaseA < phaseDeltaA) {
        var t = sawPhaseA / phaseDeltaA;
        pulseWaveA += (t + t - t * t - 1) * 0.5;
      } else if (sawPhaseA > 1.0 - phaseDeltaA) {
        var t = (sawPhaseA - 1.0) / phaseDeltaA;
        pulseWaveA += (t + t + t * t + 1) * 0.5;
      }
      if (sawPhaseB < phaseDeltaA) {
        var t = sawPhaseB / phaseDeltaA;
        pulseWaveA -= (t + t - t * t - 1) * 0.5;
      } else if (sawPhaseB > 1.0 - phaseDeltaA) {
        var t = (sawPhaseB - 1.0) / phaseDeltaA;
        pulseWaveA -= (t + t + t * t + 1) * 0.5;
      }
      if (sawPhaseC < phaseDeltaB) {
        var t = sawPhaseC / phaseDeltaB;
        pulseWaveB += (t + t - t * t - 1) * 0.5;
      } else if (sawPhaseC > 1.0 - phaseDeltaB) {
        var t = (sawPhaseC - 1.0) / phaseDeltaB;
        pulseWaveB += (t + t + t * t + 1) * 0.5;
      }
      if (sawPhaseD < phaseDeltaB) {
        var t = sawPhaseD / phaseDeltaB;
        pulseWaveB -= (t + t - t * t - 1) * 0.5;
      } else if (sawPhaseD > 1.0 - phaseDeltaB) {
        var t = (sawPhaseD - 1.0) / phaseDeltaB;
        pulseWaveB -= (t + t + t * t + 1) * 0.5;
      }

      const inputSample: number = pulseWaveA + pulseWaveB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;
      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;
      pulseWidth += pulseWidthDelta;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA;
    tone.phases[1] = phaseB;
    tone.phaseDeltas[0] = phaseDeltaA;
    tone.phaseDeltas[1] = phaseDeltaB;
    tone.expression = expression;
    tone.pulseWidth = pulseWidth;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static supersawSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const voiceCount: number = Config.supersawVoiceCount | 0;

    let phaseDeltaA: number = tone.phaseDeltas[0];
    let phaseDeltaB: number = tone.phaseDeltas[1];
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    const groupCount: number = instrumentState.usesUnison ? 2 : 1;
    const unisonSign: number =
      tone.specialIntervalExpressionMult * instrumentState.unison!.sign;
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phases: number[] = tone.phases;

    let dynamism: number = +tone.supersawDynamism;
    const dynamismDelta: number = +tone.supersawDynamismDelta;
    const unisonDetunes: number[] = tone.supersawUnisonDetunes;
    let shape: number = +tone.supersawShape;
    const shapeDelta: number = +tone.supersawShapeDelta;
    let delayLength: number = +tone.supersawDelayLength;
    const delayLengthDelta: number = +tone.supersawDelayLengthDelta;
    const delayLine: Float32Array = tone.supersawDelayLine!;
    const delayBufferMask: number = (delayLine.length - 1) >> 0;
    let delayIndex: number = tone.supersawDelayIndex | 0;
    delayIndex = (delayIndex & delayBufferMask) + delayLine.length;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      let supersawSample: number = 0.0;
      for (let group: number = 0; group < groupCount; group++) {
        const groupOffset: number = group * voiceCount;
        const phaseDelta: number = group == 0 ? phaseDeltaA : phaseDeltaB;
        let phase: number = (phases[groupOffset] + phaseDelta) % 1.0;
        let groupSample: number =
          phase - 0.5 * (1.0 + (voiceCount - 1.0) * dynamism);
        if (phase < phaseDelta) {
          const t: number = phase / phaseDelta;
          groupSample -= (t + t - t * t - 1) * 0.5;
        } else if (phase > 1.0 - phaseDelta) {
          const t: number = (phase - 1.0) / phaseDelta;
          groupSample -= (t + t + t * t + 1) * 0.5;
        }
        phases[groupOffset] = phase;
        for (let i: number = 1; i < voiceCount; i++) {
          const detunedPhaseDelta: number = phaseDelta * unisonDetunes[i];
          phase = (phases[groupOffset + i] + detunedPhaseDelta) % 1.0;
          groupSample += phase * dynamism;
          if (phase < detunedPhaseDelta) {
            const t: number = phase / detunedPhaseDelta;
            groupSample -= (t + t - t * t - 1) * 0.5 * dynamism;
          } else if (phase > 1.0 - detunedPhaseDelta) {
            const t: number = (phase - 1.0) / detunedPhaseDelta;
            groupSample -= (t + t + t * t + 1) * 0.5 * dynamism;
          }
          phases[groupOffset + i] = phase;
        }
        supersawSample += groupSample * (group == 0 ? 1.0 : unisonSign);
      }

      delayLine[delayIndex & delayBufferMask] = supersawSample;
      const delaySampleTime: number = delayIndex - delayLength;
      const lowerIndex: number = delaySampleTime | 0;
      const upperIndex: number = lowerIndex + 1;
      const delayRatio: number = delaySampleTime - lowerIndex;
      const prevDelaySample: number = delayLine[lowerIndex & delayBufferMask];
      const nextDelaySample: number = delayLine[upperIndex & delayBufferMask];
      const delaySample: number =
        prevDelaySample + (nextDelaySample - prevDelaySample) * delayRatio;
      delayIndex++;

      const inputSample: number = supersawSample - delaySample * shape;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;
      dynamism += dynamismDelta;
      shape += shapeDelta;
      delayLength += delayLengthDelta;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phaseDeltas[0] = phaseDeltaA;
    tone.phaseDeltas[1] = phaseDeltaB;
    tone.expression = expression;
    tone.supersawDynamism = dynamism;
    tone.supersawShape = shape;
    tone.supersawDelayLength = delayLength;
    tone.supersawDelayIndex = delayIndex;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static fmSourceTemplate: string[] = (
    `
		const data = synth.tempMonoInstrumentSampleBuffer;
		const sineWave = Config.sineWave;
		const operator#Wave = Config.getFmWave(/*operatorWave*/);

		// I'm adding 1000 to the phase to ensure that it's never negative even when modulated by other waves because negative numbers don't work with the modulus operator very well.
		let operator#Phase       = +((tone.phases[#] % 1) + 1000) * ` +
    Config.sineWaveLength +
    `;
		let operator#PhaseDelta  = +tone.phaseDeltas[#] * ` +
    Config.sineWaveLength +
    `;
		let operator#PhaseDeltaScale = +tone.phaseDeltaScales[#];
		let operator#OutputMult  = +tone.operatorExpressions[#];
		const operator#OutputDelta = +tone.operatorExpressionDeltas[#];
		let operator#Output      = +tone.feedbackOutputs[#];
		let feedbackMult         = +tone.feedbackMult;
		const feedbackDelta      = +tone.feedbackDelta;
		let expression = +tone.expression;
		const expressionDelta = +tone.expressionDelta;

		const filters = tone.noteFilters;
		const filterCount = tone.noteFilterCount|0;
		let initialFilterInput1 = +tone.initialNoteFilterInput1;
		let initialFilterInput2 = +tone.initialNoteFilterInput2;
		const applyFilters = Synth.applyFilters;

		const stopIndex = bufferIndex + runLength;
		for (let sampleIndex = bufferIndex; sampleIndex < stopIndex; sampleIndex++) {
			// INSERT OPERATOR COMPUTATION HERE
			const fmOutput = (/*operator#Scaled*/); // CARRIER OUTPUTS

			const inputSample = fmOutput;
			const sample = applyFilters(inputSample, initialFilterInput1, initialFilterInput2, filterCount, filters);
			initialFilterInput2 = initialFilterInput1;
			initialFilterInput1 = inputSample;

			feedbackMult += feedbackDelta;
			operator#OutputMult += operator#OutputDelta;
			operator#Phase += operator#PhaseDelta;
			operator#PhaseDelta *= operator#PhaseDeltaScale;

			const output = sample * expression;
			expression += expressionDelta;

			data[sampleIndex] += output;
		}

		tone.phases[#] = operator#Phase / ` +
    Config.sineWaveLength +
    `;
		tone.phaseDeltas[#] = operator#PhaseDelta / ` +
    Config.sineWaveLength +
    `;
		tone.operatorExpressions[#] = operator#OutputMult;
		tone.feedbackOutputs[#] = operator#Output;
		tone.feedbackMult = feedbackMult;
		tone.expression = expression;

		synth.sanitizeFilters(filters);
		tone.initialNoteFilterInput1 = initialFilterInput1;
		tone.initialNoteFilterInput2 = initialFilterInput2;
	`
  ).split("\n");

  private static operatorSourceTemplate: string[] = (
    `
			const operator#PhaseMix = operator#Phase/* + operator@Scaled*/;
			const operator#PhaseInt = operator#PhaseMix|0;
			const operator#Index    = operator#PhaseInt & ` +
    Config.sineWaveMask +
    `;
			const operator#Sample   = operator#Wave[operator#Index];
			operator#Output         = operator#Sample + (operator#Wave[operator#Index + 1] - operator#Sample) * (operator#PhaseMix - operator#PhaseInt);
			const operator#Scaled   = operator#OutputMult * operator#Output;
	`
  ).split("\n");

  private static sampleOperatorSourceTemplate: string[] = `
			const operator#PhaseMix = operator#Phase/* + operator@Scaled*/;
			const operator#PhaseFloor = Math.floor(operator#PhaseMix);
			const operator#Index = ((operator#PhaseFloor % operator#WaveLength) + operator#WaveLength) % operator#WaveLength;
			const operator#NextIndex = (operator#Index + 1) % operator#WaveLength;
			const operator#Sample = operator#Wave[operator#Index];
			operator#Output = (operator#Sample + (operator#Wave[operator#NextIndex] - operator#Sample) * (operator#PhaseMix - operator#PhaseFloor)) * operator#SampleGain;
			const operator#Scaled = operator#OutputMult * operator#Output;
	`.split("\n");

  private static noiseSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const wave: Float32Array = instrumentState.wave!;
    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    const singleVoice: boolean =
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval;
    if (singleVoice) tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = +tone.phaseDeltas[0];
    let phaseDeltaB: number = +tone.phaseDeltas[1];
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let phaseA: number = (tone.phases[0] % 1) * Config.chipNoiseLength;
    let phaseB: number = (tone.phases[1] % 1) * Config.chipNoiseLength;
    if (tone.phases[0] == 0.0) {
      // Zero phase means the tone was reset, just give noise a random start phase instead.
      phaseA = Math.random() * Config.chipNoiseLength;
      if (singleVoice) phaseB = phaseA;
    }
    if (tone.phases[1] == 0.0 && !singleVoice)
      phaseB = Math.random() * Config.chipNoiseLength;
    const phaseMask: number = Config.chipNoiseLength - 1;
    let noiseSampleA: number = +tone.noiseSample;
    let noiseSampleB: number = +tone.noiseSampleB;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    // This is for a "legacy" style simplified 1st order lowpass filter with
    // a cutoff frequency that is relative to the tone's fundamental frequency.
    const pitchRelativefilterA: number = Math.min(
      1.0,
      phaseDeltaA * instrumentState.noisePitchFilterMult,
    );
    const pitchRelativefilterB: number = Math.min(
      1.0,
      phaseDeltaB * instrumentState.noisePitchFilterMult,
    );

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      const waveSampleA: number = wave[phaseA & phaseMask];
      const waveSampleB: number = wave[phaseB & phaseMask];

      noiseSampleA += (waveSampleA - noiseSampleA) * pitchRelativefilterA;
      noiseSampleB += (waveSampleB - noiseSampleB) * pitchRelativefilterB;

      const inputSample: number = noiseSampleA + noiseSampleB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;
      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA / Config.chipNoiseLength;
    tone.phases[1] = phaseB / Config.chipNoiseLength;
    tone.phaseDeltas[0] = phaseDeltaA;
    tone.phaseDeltas[1] = phaseDeltaB;
    tone.expression = expression;
    tone.noiseSample = noiseSampleA;
    tone.noiseSampleB = noiseSampleB;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static spectrumSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    const wave: Float32Array = instrumentState.wave!;
    const samplesInPeriod: number = 1 << 7;
    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    const singleVoice: boolean =
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval;
    if (singleVoice) tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0] * samplesInPeriod;
    let phaseDeltaB: number = tone.phaseDeltas[1] * samplesInPeriod;
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;
    let noiseSampleA: number = +tone.noiseSample;
    let noiseSampleB: number = +tone.noiseSampleB;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    let phaseA: number = (tone.phases[0] % 1) * Config.spectrumNoiseLength;
    let phaseB: number = (tone.phases[1] % 1) * Config.spectrumNoiseLength;
    // Zero phase means the tone was reset, just give noise a random start phase instead.
    if (tone.phases[0] == 0.0) {
      phaseA =
        Synth.findRandomZeroCrossing(wave, Config.spectrumNoiseLength) +
        phaseDeltaA;
      if (singleVoice) phaseB = phaseA;
    }
    if (tone.phases[1] == 0.0 && !singleVoice)
      phaseB =
        Synth.findRandomZeroCrossing(wave, Config.spectrumNoiseLength) +
        phaseDeltaB;
    const phaseMask: number = Config.spectrumNoiseLength - 1;

    // This is for a "legacy" style simplified 1st order lowpass filter with
    // a cutoff frequency that is relative to the tone's fundamental frequency.
    const pitchRelativefilterA: number = Math.min(1.0, phaseDeltaA);
    const pitchRelativefilterB: number = Math.min(1.0, phaseDeltaB);

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      const phaseAInt: number = phaseA | 0;
      const phaseBInt: number = phaseB | 0;
      const indexA: number = phaseAInt & phaseMask;
      const indexB: number = phaseBInt & phaseMask;
      let waveSampleA: number = wave[indexA];
      let waveSampleB: number = wave[indexB];
      waveSampleA += (wave[indexA + 1] - waveSampleA) * (phaseA - phaseAInt);
      waveSampleB += (wave[indexB + 1] - waveSampleB) * (phaseB - phaseBInt);

      noiseSampleA += (waveSampleA - noiseSampleA) * pitchRelativefilterA;
      noiseSampleB += (waveSampleB - noiseSampleB) * pitchRelativefilterB;

      const inputSample: number = noiseSampleA + noiseSampleB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;
      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA / Config.spectrumNoiseLength;
    tone.phases[1] = phaseB / Config.spectrumNoiseLength;
    tone.phaseDeltas[0] = phaseDeltaA / samplesInPeriod;
    tone.phaseDeltas[1] = phaseDeltaB / samplesInPeriod;
    tone.expression = expression;
    tone.noiseSample = noiseSampleA;
    tone.noiseSampleB = noiseSampleB;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static drumsetSynth(
    synth: Synth,
    bufferIndex: number,
    runLength: number,
    tone: Tone,
    instrumentState: InstrumentState,
  ): void {
    const data: Float32Array = synth.tempMonoInstrumentSampleBuffer!;
    let wave: Float32Array = instrumentState.getDrumsetWave(tone.drumsetPitch!);
    const referenceDelta: number = InstrumentState.drumsetIndexReferenceDelta(
      tone.drumsetPitch!,
    );
    const unisonSign: number = instrumentState.usesUnison
      ? tone.specialIntervalExpressionMult * instrumentState.unison!.sign
      : 0.0;
    const singleVoice: boolean =
      instrumentState.unison!.voices == 1 &&
      !instrumentState.chord!.customInterval;
    if (singleVoice) tone.phases[1] = tone.phases[0];
    let phaseDeltaA: number = tone.phaseDeltas[0] / referenceDelta;
    let phaseDeltaB: number = tone.phaseDeltas[1] / referenceDelta;
    const phaseDeltaScaleA: number = +tone.phaseDeltaScales[0];
    const phaseDeltaScaleB: number = +tone.phaseDeltaScales[1];
    let expression: number = +tone.expression;
    const expressionDelta: number = +tone.expressionDelta;

    const filters: DynamicBiquadFilter[] = tone.noteFilters;
    const filterCount: number = tone.noteFilterCount | 0;
    let initialFilterInput1: number = +tone.initialNoteFilterInput1;
    let initialFilterInput2: number = +tone.initialNoteFilterInput2;
    const applyFilters: Function = Synth.applyFilters;

    let phaseA: number = (tone.phases[0] % 1) * Config.spectrumNoiseLength;
    let phaseB: number = (tone.phases[1] % 1) * Config.spectrumNoiseLength;
    // Zero phase means the tone was reset, just give noise a random start phase instead.
    if (tone.phases[0] == 0.0) {
      phaseA =
        Synth.findRandomZeroCrossing(wave, Config.spectrumNoiseLength) +
        phaseDeltaA;
      if (singleVoice) phaseB = phaseA;
    }
    if (tone.phases[1] == 0.0 && !singleVoice)
      phaseB =
        Synth.findRandomZeroCrossing(wave, Config.spectrumNoiseLength) +
        phaseDeltaB;
    const phaseMask: number = Config.spectrumNoiseLength - 1;

    const stopIndex: number = bufferIndex + runLength;
    for (
      let sampleIndex: number = bufferIndex;
      sampleIndex < stopIndex;
      sampleIndex++
    ) {
      const phaseAInt: number = phaseA | 0;
      const phaseBInt: number = phaseB | 0;
      const indexA: number = phaseAInt & phaseMask;
      const indexB: number = phaseBInt & phaseMask;
      let noiseSampleA: number = wave[indexA];
      let noiseSampleB: number = wave[indexB];
      noiseSampleA += (wave[indexA + 1] - noiseSampleA) * (phaseA - phaseAInt);
      noiseSampleB += (wave[indexB + 1] - noiseSampleB) * (phaseB - phaseBInt);

      const inputSample: number = noiseSampleA + noiseSampleB * unisonSign;
      const sample: number = applyFilters(
        inputSample,
        initialFilterInput1,
        initialFilterInput2,
        filterCount,
        filters,
      );
      initialFilterInput2 = initialFilterInput1;
      initialFilterInput1 = inputSample;

      phaseA += phaseDeltaA;
      phaseB += phaseDeltaB;
      phaseDeltaA *= phaseDeltaScaleA;
      phaseDeltaB *= phaseDeltaScaleB;

      const output: number = sample * expression;
      expression += expressionDelta;

      data[sampleIndex] += output;
    }

    tone.phases[0] = phaseA / Config.spectrumNoiseLength;
    tone.phases[1] = phaseB / Config.spectrumNoiseLength;
    tone.phaseDeltas[0] = phaseDeltaA * referenceDelta;
    tone.phaseDeltas[1] = phaseDeltaB * referenceDelta;
    tone.expression = expression;

    synth.sanitizeFilters(filters);
    tone.initialNoteFilterInput1 = initialFilterInput1;
    tone.initialNoteFilterInput2 = initialFilterInput2;
  }

  private static findRandomZeroCrossing(
    wave: Float32Array,
    waveLength: number,
  ): number {
    let phase: number = Math.random() * waveLength;
    const phaseMask: number = waveLength - 1;

    // Spectrum and drumset waves sounds best when they start at a zero crossing,
    // otherwise they pop. Try to find a zero crossing.
    let indexPrev: number = phase & phaseMask;
    let wavePrev: number = wave[indexPrev];
    const stride: number = 16;
    for (
      let attemptsRemaining: number = 128;
      attemptsRemaining > 0;
      attemptsRemaining--
    ) {
      const indexNext: number = (indexPrev + stride) & phaseMask;
      const waveNext: number = wave[indexNext];
      if (wavePrev * waveNext <= 0.0) {
        // Found a zero crossing! Now let's narrow it down to two adjacent sample indices.
        for (let i: number = 0; i < stride; i++) {
          const innerIndexNext: number = (indexPrev + 1) & phaseMask;
          const innerWaveNext: number = wave[innerIndexNext];
          if (wavePrev * innerWaveNext <= 0.0) {
            // Found the zero crossing again! Now let's find the exact intersection.
            const slope: number = innerWaveNext - wavePrev;
            phase = indexPrev;
            if (Math.abs(slope) > 0.00000001) {
              phase += -wavePrev / slope;
            }
            phase = Math.max(0, phase) % waveLength;
            break;
          } else {
            indexPrev = innerIndexNext;
            wavePrev = innerWaveNext;
          }
        }
        break;
      } else {
        indexPrev = indexNext;
        wavePrev = waveNext;
      }
    }

    return phase;
  }

  public static instrumentVolumeToVolumeMult(instrumentVolume: number): number {
    if (instrumentVolume <= 0) return 0.0;
    const maximumSetting: number = Config.volumeRange - 1;
    const clampedSetting: number = Math.min(maximumSetting, instrumentVolume);
    const ratio: number = (clampedSetting - 1) / (maximumSetting - 1);
    return (
      Config.volumeMinGain *
      Math.pow(Config.volumeMaxGain / Config.volumeMinGain, ratio)
    );
  }
  public static echoSustainToVolumeMult(echoSustain: number): number {
    const oldMaximumSetting: number = Config.echoSustainRange - 1;
    const oldMaximumVolume: number =
      Math.pow(oldMaximumSetting / Config.echoSustainRange, 1.1) * 0.9;
    if (echoSustain <= oldMaximumSetting) {
      return (
        Math.pow(Math.max(0.0, echoSustain) / Config.echoSustainRange, 1.1) *
        0.9
      );
    }
    const ratio: number = Math.min(
      1.0,
      (echoSustain - oldMaximumSetting) / oldMaximumSetting,
    );
    const easedRatio: number = ratio * ratio * (3.0 - 2.0 * ratio);
    return oldMaximumVolume + (1.0 - oldMaximumVolume) * easedRatio;
  }
  public static volumeMultToInstrumentVolume(volumeMult: number): number {
    if (volumeMult <= 0.0) return 0;
    let lower: number = 1;
    let upper: number = Config.volumeRange - 1;
    while (lower < upper) {
      const middle: number = Math.floor((lower + upper) / 2);
      if (Synth.instrumentVolumeToVolumeMult(middle) < volumeMult)
        lower = middle + 1;
      else upper = middle;
    }
    if (lower == 1) return lower;
    const lowerDistance: number =
      volumeMult - Synth.instrumentVolumeToVolumeMult(lower - 1);
    const upperDistance: number =
      Synth.instrumentVolumeToVolumeMult(lower) - volumeMult;
    return lowerDistance < upperDistance ? lower - 1 : lower;
  }
  public static noteSizeToVolumeMult(size: number): number {
    return Math.pow(Math.max(0.0, size) / Config.noteSizeMax, 1.5);
  }
  public static volumeMultToNoteSize(volumeMult: number): number {
    return Math.pow(Math.max(0.0, volumeMult), 1 / 1.5) * Config.noteSizeMax;
  }

  public static fadeInSettingToSeconds(setting: number): number {
    return 0.0125 * (0.95 * setting + 0.05 * setting * setting);
  }
  public static secondsToFadeInSetting(seconds: number): number {
    return clamp(
      0,
      Config.fadeInRange,
      Math.round((-0.95 + Math.sqrt(0.9025 + (0.2 * seconds) / 0.0125)) / 0.1),
    );
  }
  public static fadeOutSettingToTicks(setting: number): number {
    return Config.fadeOutTicks[setting];
  }
  public static ticksToFadeOutSetting(ticks: number): number {
    let lower: number = Config.fadeOutTicks[0];
    if (ticks <= lower) return 0;
    for (let i: number = 1; i < Config.fadeOutTicks.length; i++) {
      let upper: number = Config.fadeOutTicks[i];
      if (ticks <= upper) return ticks < (lower + upper) / 2 ? i - 1 : i;
      lower = upper;
    }
    return Config.fadeOutTicks.length - 1;
  }

  public static detuneToCents(detune: number): number {
    return (detune * (Math.abs(detune) + 1)) / 2;
  }
  public static centsToDetune(cents: number): number {
    return (Math.sign(cents) * (Math.sqrt(1 + 8 * Math.abs(cents)) - 1)) / 2.0;
  }

  private getSamplesPerTick(): number {
    if (this.song == null) return 0;
    const beatsPerMinute: number = this.song.getBeatsPerMinute();
    const beatsPerSecond: number = beatsPerMinute / 60.0;
    const partsPerSecond: number = Config.partsPerBeat * beatsPerSecond;
    const ticksPerSecond: number = Config.ticksPerPart * partsPerSecond;
    return this.samplesPerSecond / ticksPerSecond;
  }

  public static fittingPowerOfTwo(x: number): number {
    return 1 << (32 - Math.clz32(Math.ceil(x) - 1));
  }

  private sanitizeFilters(filters: DynamicBiquadFilter[]): void {
    let reset: boolean = false;
    for (const filter of filters) {
      const output1: number = Math.abs(filter.output1);
      const output2: number = Math.abs(filter.output2);
      // If either is a large value, Infinity, or NaN, then just reset all filter history.
      if (!(output1 < 100) || !(output2 < 100)) {
        reset = true;
        break;
      }
      if (output1 < epsilon) filter.output1 = 0.0;
      if (output2 < epsilon) filter.output2 = 0.0;
    }
    if (reset) {
      for (const filter of filters) {
        filter.output1 = 0.0;
        filter.output2 = 0.0;
      }
    }
  }

  public static sanitizeDelayLine(
    delayLine: Float32Array,
    lastIndex: number,
    mask: number,
  ): void {
    while (true) {
      lastIndex--;
      const index: number = lastIndex & mask;
      const sample: number = Math.abs(delayLine[index]);
      if (Number.isFinite(sample) && (sample == 0.0 || sample >= epsilon))
        break;
      delayLine[index] = 0.0;
    }
  }

  public static applyFilters(
    sample: number,
    input1: number,
    input2: number,
    filterCount: number,
    filters: DynamicBiquadFilter[],
  ): number {
    for (let i: number = 0; i < filterCount; i++) {
      const filter: DynamicBiquadFilter = filters[i];
      const output1: number = filter.output1;
      const output2: number = filter.output2;
      const a1: number = filter.a1;
      const a2: number = filter.a2;
      const b0: number = filter.b0;
      const b1: number = filter.b1;
      const b2: number = filter.b2;
      sample =
        b0 * sample + b1 * input1 + b2 * input2 - a1 * output1 - a2 * output2;
      filter.a1 = a1 + filter.a1Delta;
      filter.a2 = a2 + filter.a2Delta;
      if (filter.useMultiplicativeInputCoefficients) {
        filter.b0 = b0 * filter.b0Delta;
        filter.b1 = b1 * filter.b1Delta;
        filter.b2 = b2 * filter.b2Delta;
      } else {
        filter.b0 = b0 + filter.b0Delta;
        filter.b1 = b1 + filter.b1Delta;
        filter.b2 = b2 + filter.b2Delta;
      }
      filter.output2 = output1;
      filter.output1 = sample;
      // Updating the input values is waste if the next filter doesn't exist...
      input2 = output2;
      input1 = output1;
    }
    return sample;
  }
}

// When compiling synth.ts as a standalone application bundle, expose these imported classes as members to JavaScript:
export {
  type Dictionary,
  type DictionaryArray,
  FilterType,
  EnvelopeType,
  InstrumentType,
  type Transition,
  type Chord,
  type Envelope,
  Config,
  fastFourierTransform,
  forwardRealFourierTransform,
  inverseRealFourierTransform,
  FilterCoefficients,
  FrequencyResponse,
  DynamicBiquadFilter,
};

// A descriptive alias for clients that use the browser-independent renderer.
export { Synth as SynthEngine };
