// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  type Algorithm,
  type AssetDefinition,
  type Dictionary,
  FilterType,
  SustainType,
  InstrumentType,
  EffectType,
  type AutomationTarget,
  Config,
  effectsIncludeDistortion,
} from "../synth/SynthConfig.js";
import {
  type NotePin,
  Note,
  makeNotePin,
  Pattern,
  FilterSettings,
  FilterControlPoint,
  SpectrumWave,
  HarmonicsWave,
  Instrument,
  Channel,
  Song,
  Synth,
} from "../synth/synth.js";
import {
  type Preset,
  type PresetCategory,
  EditorConfig,
} from "./EditorConfig.js";
import {
  Change,
  ChangeGroup,
  ChangeSequence,
  UndoableChange,
} from "./Change.js";
import type { SongDocument } from "./SongDocument.js";
import type { SoundFontPresetInfo } from "../synth/SynthController.js";
import { RandomBag } from "./RandomBag.js";
import { selectCurvedValue } from "./RandomValue.js";

const randomInstrumentTypeBags: Map<
  string,
  RandomBag<InstrumentType>
> = new Map();

function pickRandomInstrumentType(
  types: readonly InstrumentType[],
): InstrumentType {
  const key: string = types.join(",");
  let bag = randomInstrumentTypeBags.get(key);
  if (bag == undefined) {
    bag = new RandomBag();
    randomInstrumentTypeBags.set(key, bag);
  }
  return bag.pick(types);
}

function pitchIsInScale(doc: SongDocument, pitch: number): boolean {
  const compositionOffset = doc.song.composingKey - doc.song.key;
  const scaleIndex =
    (((Math.round(pitch) - compositionOffset) % Config.pitchesPerOctave) +
      Config.pitchesPerOctave) %
    Config.pitchesPerOctave;
  return Config.scales[doc.song.scale].flags[scaleIndex];
}

/** Snaps a positive integer pitch to the octave scale, assuming it's in range. */
function snapPitchToScale(doc: SongDocument, pitch: number) {
  if (doc.song.getChannelIsNoise(doc.channel) || doc.prefs.notesOutsideScale) {
    return Math.round(pitch); // skip
  }
  if (pitchIsInScale(doc, pitch)) {
    return Math.round(pitch); // already on scale
  }

  let distanceUp = Config.maxPitch;
  let distanceDown = Config.maxPitch;

  for (let i = pitch + 1; i < Config.maxPitch + 0.5; i++) {
    if (pitchIsInScale(doc, i)) {
      distanceUp = i - pitch;
      break;
    }
  }
  for (let i = pitch - 1; i > -0.5; i--) {
    if (pitchIsInScale(doc, i)) {
      distanceDown = pitch - i;
      break;
    }
  }

  return distanceUp < distanceDown
    ? Math.round(pitch + distanceUp)
    : Math.round(pitch - distanceDown);
}

function removeRedundantPins(pins: NotePin[]): void {
  for (let i: number = 1; i < pins.length - 1;) {
    const prevPin: NotePin = pins[i - 1];
    const pin: NotePin = pins[i];
    const nextPin: NotePin = pins[i + 1];
    const prevTimeSpan: number = pin.time - prevPin.time;
    const nextTimeSpan: number = nextPin.time - pin.time;
    if (
      (pin.interval - prevPin.interval) * nextTimeSpan ==
        (nextPin.interval - pin.interval) * prevTimeSpan &&
      (pin.size - prevPin.size) * nextTimeSpan ==
        (nextPin.size - pin.size) * prevTimeSpan
    ) {
      pins.splice(i, 1);
    } else {
      i++;
    }
  }
}

function projectNoteIntoBar(
  oldNote: Note,
  timeOffset: number,
  noteStartPart: number,
  noteEndPart: number,
  newNotes: Note[],
): void {
  // Create a new note, and interpret the pitch bend and size events
  // to determine where we need to insert pins to control interval and volume.
  const newNote: Note = new Note(
    -1,
    noteStartPart,
    noteEndPart,
    Config.noteSizeMax,
    false,
  );
  newNote.pins.length = 0;
  newNote.pitches.length = 0;
  const newNoteLength: number = noteEndPart - noteStartPart;

  for (const pitch of oldNote.pitches) {
    newNote.pitches.push(pitch);
  }

  for (let pinIndex: number = 0; pinIndex < oldNote.pins.length; pinIndex++) {
    const pin: NotePin = oldNote.pins[pinIndex];
    const newPinTime: number = pin.time + timeOffset;
    if (newPinTime < 0) {
      if (pinIndex + 1 >= oldNote.pins.length)
        throw new Error("Error converting pins in note overflow.");
      const nextPin: NotePin = oldNote.pins[pinIndex + 1];
      const nextPinTime: number = nextPin.time + timeOffset;
      if (nextPinTime > 0) {
        // Insert an interpolated pin at the start of the new note.
        const ratio: number = -newPinTime / (nextPinTime - newPinTime);
        newNote.pins.push(
          makeNotePin(
            Math.round(
              pin.interval + ratio * (nextPin.interval - pin.interval),
            ),
            0,
            Math.round(pin.size + ratio * (nextPin.size - pin.size)),
          ),
        );
      }
    } else if (newPinTime <= newNoteLength) {
      newNote.pins.push(makeNotePin(pin.interval, newPinTime, pin.size));
    } else {
      if (pinIndex < 1)
        throw new Error("Error converting pins in note overflow.");
      const prevPin: NotePin = oldNote.pins[pinIndex - 1];
      const prevPinTime: number = prevPin.time + timeOffset;
      if (prevPinTime < newNoteLength) {
        // Insert an interpolated pin at the end of the new note.
        const ratio: number =
          (newNoteLength - prevPinTime) / (newPinTime - prevPinTime);
        newNote.pins.push(
          makeNotePin(
            Math.round(
              prevPin.interval + ratio * (pin.interval - prevPin.interval),
            ),
            newNoteLength,
            Math.round(prevPin.size + ratio * (pin.size - prevPin.size)),
          ),
        );
      }
    }
  }

  // Fix from Jummbus: Ensure the first pin's interval is zero, adjust pitches and pins to compensate.
  const offsetInterval: number = newNote.pins[0].interval;
  for (
    let pitchIdx: number = 0;
    pitchIdx < newNote.pitches.length;
    pitchIdx++
  ) {
    newNote.pitches[pitchIdx] += offsetInterval;
  }
  for (let pinIdx: number = 0; pinIdx < newNote.pins.length; pinIdx++) {
    newNote.pins[pinIdx].interval -= offsetInterval;
  }

  let joinedWithPrevNote: boolean = false;
  if (newNote.start == 0) {
    newNote.continuesLastPattern =
      timeOffset < 0 || oldNote.continuesLastPattern;
  } else {
    newNote.continuesLastPattern = false;
    if (newNotes.length > 0 && oldNote.continuesLastPattern) {
      const prevNote: Note = newNotes[newNotes.length - 1];
      if (
        prevNote.end == newNote.start &&
        Synth.adjacentNotesHaveMatchingPitches(prevNote, newNote)
      ) {
        joinedWithPrevNote = true;
        const newIntervalOffset: number =
          prevNote.pins[prevNote.pins.length - 1].interval;
        const newTimeOffset: number = prevNote.end - prevNote.start;
        for (
          let pinIndex: number = 1;
          pinIndex < newNote.pins.length;
          pinIndex++
        ) {
          const tempPin: NotePin = newNote.pins[pinIndex];
          const transformedPin: NotePin = makeNotePin(
            tempPin.interval + newIntervalOffset,
            tempPin.time + newTimeOffset,
            tempPin.size,
          );
          prevNote.pins.push(transformedPin);
          prevNote.end = prevNote.start + transformedPin.time;
        }
        removeRedundantPins(prevNote.pins);
      }
    }
  }
  if (!joinedWithPrevNote) {
    newNotes.push(newNote);
  }
}

export class ChangeMoveAndOverflowNotes extends ChangeGroup {
  constructor(doc: SongDocument, newBeatsPerBar: number, partsToMove: number) {
    super();

    const pitchChannels: Channel[] = [];
    const noiseChannels: Channel[] = [];

    for (
      let channelIndex: number = 0;
      channelIndex < doc.song.getChannelCount();
      channelIndex++
    ) {
      const oldChannel: Channel = doc.song.channels[channelIndex];
      const newChannel: Channel = new Channel();
      if (channelIndex < doc.song.pitchChannelCount) {
        pitchChannels.push(newChannel);
      } else {
        noiseChannels.push(newChannel);
      }

      newChannel.muted = oldChannel.muted;
      newChannel.octave = oldChannel.octave;
      for (const instrument of oldChannel.instruments) {
        newChannel.instruments.push(instrument);
      }

      const oldPartsPerBar: number = Config.partsPerBeat * doc.song.beatsPerBar;
      const newPartsPerBar: number = Config.partsPerBeat * newBeatsPerBar;
      let currentBar: number = -1;
      let pattern: Pattern | null = null;

      for (let oldBar: number = 0; oldBar < doc.song.barCount; oldBar++) {
        const oldPattern: Pattern | null = doc.song.getPattern(
          channelIndex,
          oldBar,
        );
        if (oldPattern != null) {
          const oldBarStart: number = oldBar * oldPartsPerBar;
          for (const oldNote of oldPattern.notes) {
            const absoluteNoteStart: number =
              oldNote.start + oldBarStart + partsToMove;
            const absoluteNoteEnd: number =
              oldNote.end + oldBarStart + partsToMove;

            const startBar: number = Math.floor(
              absoluteNoteStart / newPartsPerBar,
            );
            const endBar: number = Math.ceil(absoluteNoteEnd / newPartsPerBar);
            for (let bar: number = startBar; bar < endBar; bar++) {
              const barStartPart: number = bar * newPartsPerBar;
              const noteStartPart: number = Math.max(
                0,
                absoluteNoteStart - barStartPart,
              );
              const noteEndPart: number = Math.min(
                newPartsPerBar,
                absoluteNoteEnd - barStartPart,
              );

              if (noteStartPart < noteEndPart) {
                // Ensure a pattern exists for the current bar before inserting notes into it.
                if (currentBar != bar || pattern == null) {
                  currentBar++;
                  while (currentBar < bar) {
                    newChannel.bars[currentBar] = 0;
                    currentBar++;
                  }
                  pattern = new Pattern();
                  newChannel.patterns.push(pattern);
                  newChannel.bars[currentBar] = newChannel.patterns.length;
                }

                projectNoteIntoBar(
                  oldNote,
                  absoluteNoteStart - barStartPart - noteStartPart,
                  noteStartPart,
                  noteEndPart,
                  pattern.notes,
                );
              }
            }
          }
        }
      }
    }

    removeDuplicatePatterns(pitchChannels);
    removeDuplicatePatterns(noiseChannels);
    this.append(new ChangeReplacePatterns(doc, pitchChannels, noiseChannels));
  }
}

class ChangePins extends UndoableChange {
  protected _oldStart: number;
  protected _newStart: number;
  protected _oldEnd: number;
  protected _newEnd: number;
  protected _oldPins: NotePin[];
  protected _newPins: NotePin[];
  protected _oldPitches: number[];
  protected _newPitches: number[];
  protected _oldContinuesLastPattern: boolean;
  protected _newContinuesLastPattern: boolean;
  constructor(
    protected _doc: SongDocument | null,
    protected _note: Note,
  ) {
    super(false);
    this._oldStart = this._note.start;
    this._oldEnd = this._note.end;
    this._newStart = this._note.start;
    this._newEnd = this._note.end;
    this._oldPins = this._note.pins;
    this._newPins = [];
    this._oldPitches = this._note.pitches;
    this._newPitches = [];
    this._oldContinuesLastPattern = this._note.continuesLastPattern;
    this._newContinuesLastPattern = this._note.continuesLastPattern;
  }

  protected _finishSetup(continuesLastPattern?: boolean): void {
    for (let i: number = 0; i < this._newPins.length - 1;) {
      if (this._newPins[i].time >= this._newPins[i + 1].time) {
        this._newPins.splice(i, 1);
      } else {
        i++;
      }
    }

    removeRedundantPins(this._newPins);

    const firstInterval: number = this._newPins[0].interval;
    const firstTime: number = this._newPins[0].time;
    for (let i: number = 0; i < this._oldPitches.length; i++) {
      this._newPitches[i] = this._oldPitches[i] + firstInterval;
    }
    for (let i: number = 0; i < this._newPins.length; i++) {
      this._newPins[i].interval -= firstInterval;
      this._newPins[i].time -= firstTime;
    }
    this._newStart = this._oldStart + firstTime;
    this._newEnd =
      this._newStart + this._newPins[this._newPins.length - 1].time;

    if (continuesLastPattern != undefined) {
      this._newContinuesLastPattern = continuesLastPattern;
    }
    if (this._newStart != 0) {
      this._newContinuesLastPattern = false;
    }

    this._doForwards();
    this._didSomething();
  }

  protected override _doForwards(): void {
    this._note.pins = this._newPins;
    this._note.pitches = this._newPitches;
    this._note.start = this._newStart;
    this._note.end = this._newEnd;
    this._note.continuesLastPattern = this._newContinuesLastPattern;
    if (this._doc != null) this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._note.pins = this._oldPins;
    this._note.pitches = this._oldPitches;
    this._note.start = this._oldStart;
    this._note.end = this._oldEnd;
    this._note.continuesLastPattern = this._oldContinuesLastPattern;
    if (this._doc != null) this._doc.notifier.changed();
  }
}

export class ChangeCustomizeInstrument extends Change {
  constructor(doc: SongDocument) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    if (instrument.preset != instrument.type) {
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeAssets extends Change {
  constructor(doc: SongDocument, assets: readonly AssetDefinition[]) {
    super();
    if (
      doc.song.assets.length == assets.length &&
      doc.song.assets.every(
        (asset, index) => asset.source == assets[index].source,
      )
    )
      return;
    const sampleIds: Array<{
      instrument: Instrument;
      chipWave: string | null;
      operatorWaves: Array<string | null>;
    }> = [];
    for (const channel of doc.song.channels)
      for (const instrument of channel.instruments) {
        sampleIds.push({
          instrument,
          chipWave: Config.chipWaves[instrument.chipWave]?.sampleId ?? null,
          operatorWaves: instrument.operators.map((operator): string | null =>
            operator.wave == 0
              ? null
              : (Config.chipWaves[operator.wave - 1]?.sampleId ?? null),
          ),
        });
      }
    doc.song.assets.splice(0, doc.song.assets.length, ...assets);
    Config.configureAssets(doc.song.assets);
    for (const references of sampleIds) {
      if (references.chipWave != null) {
        const chipWave = Config.chipWaves.find(
          (wave): boolean => wave.sampleId == references.chipWave,
        );
        references.instrument.chipWave = chipWave?.index ?? 1;
      }
      for (
        let index: number = 0;
        index < references.operatorWaves.length;
        index++
      ) {
        const sampleId: string | null = references.operatorWaves[index];
        if (sampleId == null) continue;
        const chipWave = Config.chipWaves.find(
          (wave): boolean => wave.sampleId == sampleId,
        );
        references.instrument.operators[index].wave =
          chipWave == undefined ? 0 : chipWave.index + 1;
      }
    }
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangePreset extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.preset;
    if (oldValue != newValue) {
      const preset: Preset | null = EditorConfig.valueToPreset(newValue);
      if (preset != null) {
        if (preset.customType != undefined) {
          instrument.type = preset.customType;
          if (
            !Config.instrumentTypeHasSpecialInterval[instrument.type] &&
            Config.chords[instrument.chord].customInterval
          ) {
            instrument.chord = 0;
          }
          instrument.clearInvalidEnvelopeTargets();
        } else if (preset.settings != undefined) {
          const tempVolume: number = instrument.volume;
          const tempPan: number = instrument.pan;
          instrument.fromSettingsObject(
            preset.settings,
            doc.song.getChannelIsNoise(doc.channel),
          );
          // Presets shouldn't override volume or panning.
          instrument.volume = tempVolume;
          instrument.pan = tempPan;
        }
      }
      instrument.preset = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeRandomGeneratedInstrument extends Change {
  constructor(doc: SongDocument) {
    super();

    interface ItemWeight<T> {
      readonly item: T;
      readonly weight: number;
    }
    function selectWeightedRandom<T>(entries: ReadonlyArray<ItemWeight<T>>): T {
      let total: number = 0;
      for (const entry of entries) {
        total += entry.weight;
      }
      let random: number = Math.random() * total;
      for (const entry of entries) {
        random -= entry.weight;
        if (random <= 0.0) return entry.item;
      }
      return entries[(Math.random() * entries.length) | 0].item;
    }
    function selectCurvedDistribution(
      min: number,
      max: number,
      peak: number,
      width: number,
    ): number {
      return selectCurvedValue(min, max, peak, width);
    }
    function percentToSetting(percent: number, settingMax: number): number {
      return (percent * settingMax) / 100;
    }
    function selectCurvedPercentage(
      min: number,
      peak: number,
      width: number,
      settingMax: number,
    ): number {
      return percentToSetting(
        selectCurvedValue(min, 100, peak, width),
        settingMax,
      );
    }
    function echoDelayFromBeats(beats: number): number {
      return (
        (beats * Config.ticksPerPart * Config.partsPerBeat) /
          Config.echoDelayStepTicks -
        1
      );
    }

    class PotentialFilterPoint {
      constructor(
        public readonly chance: number,
        public readonly type: FilterType,
        public readonly minFreq: number,
        public readonly maxFreq: number,
        public readonly centerHz: number,
        public readonly centerGain: number,
      ) {}
    }
    function applyFilterPoints(
      filter: FilterSettings,
      potentialPoints: ReadonlyArray<PotentialFilterPoint>,
    ): void {
      filter.reset();
      const usedFreqs: number[] = [];
      for (const potentialPoint of potentialPoints) {
        if (Math.random() > potentialPoint.chance) continue;
        const point: FilterControlPoint = new FilterControlPoint();
        point.type = potentialPoint.type;
        point.freq = selectCurvedDistribution(
          potentialPoint.minFreq,
          potentialPoint.maxFreq,
          FilterControlPoint.getRoundedSettingValueFromHz(
            potentialPoint.centerHz,
          ),
          1.0 / Config.filterFreqStep,
        );
        point.gain = selectCurvedDistribution(
          0,
          Config.filterGainRange - 1,
          Config.filterGainCenter + potentialPoint.centerGain,
          2.0 / Config.filterGainStep,
        );
        if (
          point.type == FilterType.peak &&
          point.gain == Config.filterGainCenter
        )
          continue; // skip pointless points. :P
        if (usedFreqs.includes(point.freq)) continue;
        usedFreqs.push(point.freq);
        filter.controlPoints[filter.controlPointCount] = point;
        filter.controlPointCount++;
      }
    }

    const isNoise: boolean = doc.song.getChannelIsNoise(doc.channel);
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    instrument.effects = 0;
    instrument.envelopeCount = 0;

    const midFreq: number =
      FilterControlPoint.getRoundedSettingValueFromHz(700.0);
    const maxFreq: number = Config.filterFreqRange - 1;
    applyFilterPoints(instrument.eqFilter, [
      new PotentialFilterPoint(
        0.8,
        FilterType.lowPass,
        midFreq,
        maxFreq,
        4000.0,
        -1,
      ),
      new PotentialFilterPoint(
        0.4,
        FilterType.highPass,
        0,
        midFreq - 1,
        250.0,
        -1,
      ),
      new PotentialFilterPoint(0.5, FilterType.peak, 0, maxFreq, 2000.0, 0),
      new PotentialFilterPoint(0.4, FilterType.peak, 0, maxFreq, 1400.0, 0),
      new PotentialFilterPoint(0.3, FilterType.peak, 0, maxFreq, 1000.0, 0),
      new PotentialFilterPoint(0.2, FilterType.peak, 0, maxFreq, 500.0, 0),
    ]);
    if (instrument.eqFilter.controlPointCount > 0)
      instrument.effects |= 1 << EffectType.eqFilter;

    if (isNoise) {
      const type: InstrumentType = pickRandomInstrumentType([
        InstrumentType.noise,
        InstrumentType.spectrum,
        InstrumentType.drumset,
      ]);
      instrument.preset = instrument.type = type;

      instrument.fadeIn =
        Math.random() < 0.8
          ? 0
          : selectCurvedDistribution(0, Config.fadeInRange - 1, 0, 2);
      instrument.fadeOut = selectCurvedDistribution(
        0,
        Config.fadeOutTicks.length - 1,
        Config.fadeOutNeutral,
        2,
      );

      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.transition;
        instrument.transition =
          Config.transitions.dictionary[
            selectWeightedRandom([
              { item: "normal", weight: 30 },
              { item: "interrupt", weight: 1 },
              { item: "slide", weight: 2 },
            ])
          ].index;
      }
      if (Math.random() < 0.2) {
        instrument.effects |= 1 << EffectType.chord;
        instrument.chord =
          Config.chords.dictionary[
            selectWeightedRandom([
              { item: "strum", weight: 2 },
              { item: "arpeggio", weight: 1 },
            ])
          ].index;
      }
      if (Math.random() < 0.1) {
        instrument.pitchShift =
          Config.pitchShiftCenter + selectCurvedValue(-12, 12, 0, 2);
        if (instrument.pitchShift != Config.pitchShiftCenter) {
          instrument.effects |= 1 << EffectType.pitchShift;
          instrument.addEnvelope(
            Config.instrumentAutomationTargets.dictionary["pitchShift"].index,
            0,
            Config.envelopes.dictionary[
              selectWeightedRandom([
                { item: "flare", weight: 4 },
                { item: "twang", weight: 28 },
                { item: "tremolo", weight: 3 },
                { item: "decay", weight: 7 },
              ])
            ].index,
          );
        }
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.vibrato;
        instrument.vibrato = selectCurvedDistribution(
          0,
          Config.echoSustainRange - 1,
          Config.echoSustainRange >> 1,
          2,
        );
        instrument.vibrato =
          Config.vibratos.dictionary[
            selectWeightedRandom([
              { item: "light", weight: 2 },
              { item: "delayed", weight: 2 },
              { item: "heavy", weight: 1 },
              { item: "shaky", weight: 2 },
            ])
          ].index;
      }
      if (Math.random() < 0.8) {
        instrument.effects |= 1 << EffectType.noteFilter;
        applyFilterPoints(instrument.noteFilter, [
          new PotentialFilterPoint(
            1.0,
            FilterType.lowPass,
            midFreq,
            maxFreq,
            8000.0,
            -1,
          ),
        ]);
        instrument.addEnvelope(
          Config.instrumentAutomationTargets.dictionary["noteFilterAllFreqs"]
            .index,
          0,
          Config.envelopes.dictionary[
            selectWeightedRandom([
              { item: "punch", weight: 4 },
              { item: "flare", weight: 6 },
              { item: "twang", weight: 24 },
              { item: "swell", weight: 5 },
              { item: "tremolo", weight: 6 },
              { item: "decay", weight: 12 },
            ])
          ].index,
        );
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.distortion;
        instrument.distortion = selectCurvedPercentage(
          1,
          100,
          200 / (Config.distortionRange - 1),
          Config.distortionRange - 1,
        );
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.bitcrusher;
        instrument.bitcrusherFreq = selectCurvedPercentage(
          0,
          (100 * (Config.bitcrusherFreqRange >> 1)) /
            (Config.bitcrusherFreqRange - 1),
          200 / (Config.bitcrusherFreqRange - 1),
          Config.bitcrusherFreqRange - 1,
        );
        instrument.bitcrusherQuantization = selectCurvedPercentage(
          0,
          (100 * (Config.bitcrusherQuantizationRange >> 1)) /
            (Config.bitcrusherQuantizationRange - 1),
          200 / (Config.bitcrusherQuantizationRange - 1),
          Config.bitcrusherQuantizationRange - 1,
        );
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.chorus;
        instrument.chorus = selectCurvedPercentage(
          1,
          100,
          100 / (Config.chorusRange - 1),
          Config.chorusRange - 1,
        );
      }
      if (Math.random() < 0.1) {
        instrument.echoSustain = percentToSetting(
          selectCurvedValue(
            0,
            200,
            (100 * (Config.echoSustainRange >> 1)) /
              (Config.echoSustainRange - 1),
            200 / (Config.echoSustainRange - 1),
          ),
          Config.echoSustainRange - 1,
        );
        instrument.echoDelay = echoDelayFromBeats(
          selectCurvedValue(0.25, 2, 1, 0.25, 0.25),
        );
        if (instrument.echoSustain != 0 || instrument.echoDelay != 0) {
          instrument.effects |= 1 << EffectType.echo;
        }
      }
      if (Math.random() < 0.5) {
        instrument.effects |= 1 << EffectType.reverb;
        instrument.reverb = selectCurvedPercentage(
          1,
          100 / (Config.reverbRange - 1),
          100 / (Config.reverbRange - 1),
          Config.reverbRange - 1,
        );
      }

      function normalize(harmonics: number[]): void {
        let max: number = 0;
        for (const value of harmonics) {
          if (value > max) max = value;
        }
        if (max == 0) {
          harmonics[0] = Config.harmonicsMax;
          return;
        }
        for (let i: number = 0; i < harmonics.length; i++) {
          harmonics[i] = (Config.harmonicsMax * harmonics[i]) / max;
        }
      }
      function generateNoiseSpectrum(): number[] {
        const spectrumGenerators: Array<() => number[]> = [
          (): number[] => {
            const spectrum: number[] = [];
            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
              spectrum[i] = Math.random() < 0.5 ? Math.random() : 0.0;
            }
            return spectrum;
          },
          (): number[] => {
            let current: number = 1.0;
            const spectrum: number[] = [current];
            for (let i = 1; i < Config.spectrumControlPoints; i++) {
              current *= Math.pow(2, Math.random() - 0.52);
              spectrum[i] = current;
            }
            return spectrum;
          },
          (): number[] => {
            let current: number = 1.0;
            const spectrum: number[] = [current];
            for (let i = 1; i < Config.spectrumControlPoints; i++) {
              current *= Math.pow(2, Math.random() - 0.52);
              spectrum[i] = current * Math.random();
            }
            return spectrum;
          },
        ];
        const spectrum: number[] =
          spectrumGenerators[(Math.random() * spectrumGenerators.length) | 0]();
        normalize(spectrum);
        return spectrum;
      }
      switch (type) {
        case InstrumentType.noise:
          {
            instrument.chipNoise =
              (Math.random() * Config.chipNoises.length) | 0;
          }
          break;
        case InstrumentType.spectrum:
          {
            const spectrum: number[] = generateNoiseSpectrum();
            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
              instrument.spectrumWave.spectrum[i] = Math.round(spectrum[i]);
            }
            instrument.spectrumWave.markCustomWaveDirty();
          }
          break;
        case InstrumentType.drumset:
          {
            for (let i: number = 0; i < Config.drumCount; i++) {
              const envelope =
                Config.envelopes[(Math.random() * Config.envelopes.length) | 0];
              const spectrum: number[] = generateNoiseSpectrum();
              instrument.drumsetEnvelopes[i] = envelope.index;
              instrument.drumsetEnvelopeSpeeds[i] =
                Math.round(Math.random() * 500) / 100;
              instrument.drumsetEnvelopeAs[i] =
                Math.round(Math.random() * 200) / 100;
              instrument.drumsetEnvelopeBs[i] =
                Math.round(Math.random() * 200) / 100;
              for (let j: number = 0; j < Config.spectrumControlPoints; j++) {
                instrument.drumsetSpectrumWaves[i].spectrum[j] = Math.round(
                  spectrum[j],
                );
              }
              instrument.drumsetSpectrumWaves[i].markCustomWaveDirty();
            }
          }
          break;
        default:
          throw new Error(
            "Unhandled noise instrument type in random generator.",
          );
      }
    } else {
      const soundFontPresets = doc.song.assets.flatMap((asset) =>
        asset.type == "soundFont"
          ? (doc.synth.getSoundFontPresets(asset.id) ?? []).map((preset) => ({
              soundFontId: asset.id,
              presetIndex: preset.index,
            }))
          : [],
      );
      const types: InstrumentType[] = [
        InstrumentType.chip,
        InstrumentType.pwm,
        InstrumentType.supersaw,
        InstrumentType.harmonics,
        InstrumentType.pickedString,
        InstrumentType.spectrum,
        InstrumentType.fm,
      ];
      if (soundFontPresets.length > 0) types.push(InstrumentType.soundFont);
      const type: InstrumentType = pickRandomInstrumentType(types);
      instrument.preset = instrument.type = type;
      if (type == InstrumentType.soundFont) {
        const preset =
          soundFontPresets[(Math.random() * soundFontPresets.length) | 0]!;
        instrument.soundFontId = preset.soundFontId;
        instrument.soundFontPreset = preset.presetIndex;
      }

      instrument.fadeIn =
        Math.random() < 0.5
          ? 0
          : selectCurvedDistribution(0, Config.fadeInRange - 1, 0, 2);
      instrument.fadeOut = selectCurvedDistribution(
        0,
        Config.fadeOutTicks.length - 1,
        Config.fadeOutNeutral,
        2,
      );
      if (Math.random() < 0.35) {
        instrument.effects |= 1 << EffectType.unison;
        instrument.unison =
          Config.unisons.dictionary[
            selectWeightedRandom([
              { item: "shimmer", weight: 5 },
              { item: "hum", weight: 4 },
              { item: "honky tonk", weight: 3 },
              { item: "dissonant", weight: 1 },
              { item: "fifth", weight: 1 },
              { item: "octave", weight: 2 },
              { item: "bowed", weight: 2 },
              { item: "piano", weight: 5 },
            ])
          ].index;
      }

      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.transition;
        instrument.transition =
          Config.transitions.dictionary[
            selectWeightedRandom([
              { item: "interrupt", weight: 1 },
              { item: "slide", weight: 2 },
            ])
          ].index;
      }
      if (Math.random() < 0.2) {
        instrument.effects |= 1 << EffectType.chord;
        instrument.chord =
          Config.chords.dictionary[
            selectWeightedRandom([
              { item: "strum", weight: 2 },
              { item: "arpeggio", weight: 1 },
            ])
          ].index;
      }
      if (Math.random() < 0.05) {
        instrument.pitchShift =
          Config.pitchShiftCenter + selectCurvedValue(-12, 12, 0, 1);
        if (instrument.pitchShift != Config.pitchShiftCenter) {
          instrument.effects |= 1 << EffectType.pitchShift;
          instrument.addEnvelope(
            Config.instrumentAutomationTargets.dictionary["pitchShift"].index,
            0,
            Config.envelopes.dictionary[
              selectWeightedRandom([
                { item: "flare", weight: 2 },
                { item: "flare", weight: 1 },
                { item: "flare", weight: 1 },
                { item: "twang", weight: 16 },
                { item: "twang", weight: 8 },
                { item: "twang", weight: 4 },
                { item: "decay", weight: 4 },
                { item: "decay", weight: 2 },
                { item: "decay", weight: 1 },
              ])
            ].index,
          );
        }
      }
      if (Math.random() < 0.25) {
        instrument.effects |= 1 << EffectType.vibrato;
        instrument.vibrato = selectCurvedDistribution(
          0,
          Config.echoSustainRange - 1,
          Config.echoSustainRange >> 1,
          2,
        );
        instrument.vibrato =
          Config.vibratos.dictionary[
            selectWeightedRandom([
              { item: "light", weight: 2 },
              { item: "delayed", weight: 2 },
              { item: "heavy", weight: 1 },
              { item: "shaky", weight: 2 },
            ])
          ].index;
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.distortion;
        instrument.distortion = selectCurvedPercentage(
          1,
          100,
          200 / (Config.distortionRange - 1),
          Config.distortionRange - 1,
        );
      }
      if (effectsIncludeDistortion(instrument.effects) && Math.random() < 0.8) {
        instrument.effects |= 1 << EffectType.noteFilter;
        applyFilterPoints(instrument.noteFilter, [
          new PotentialFilterPoint(
            1.0,
            FilterType.lowPass,
            midFreq,
            maxFreq,
            2000.0,
            -1,
          ),
          new PotentialFilterPoint(
            0.9,
            FilterType.highPass,
            0,
            midFreq - 1,
            500.0,
            -1,
          ),
          new PotentialFilterPoint(0.4, FilterType.peak, 0, maxFreq, 1400.0, 0),
        ]);
      } else if (Math.random() < 0.5) {
        instrument.effects |= 1 << EffectType.noteFilter;
        applyFilterPoints(instrument.noteFilter, [
          new PotentialFilterPoint(
            1.0,
            FilterType.lowPass,
            midFreq,
            maxFreq,
            8000.0,
            -1,
          ),
        ]);
        instrument.addEnvelope(
          Config.instrumentAutomationTargets.dictionary["noteFilterAllFreqs"]
            .index,
          0,
          Config.envelopes.dictionary[
            selectWeightedRandom([
              { item: "punch", weight: 6 },
              { item: "flare", weight: 2 },
              { item: "flare", weight: 4 },
              { item: "flare", weight: 2 },
              { item: "twang", weight: 2 },
              { item: "twang", weight: 4 },
              { item: "twang", weight: 4 },
              { item: "swell", weight: 4 },
              { item: "swell", weight: 2 },
              { item: "swell", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "tremolo", weight: 1 },
              { item: "decay", weight: 1 },
              { item: "decay", weight: 2 },
              { item: "decay", weight: 2 },
            ])
          ].index,
        );
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.bitcrusher;
        instrument.bitcrusherFreq = selectCurvedPercentage(
          0,
          0,
          200 / (Config.bitcrusherFreqRange - 1),
          Config.bitcrusherFreqRange - 1,
        );
        instrument.bitcrusherQuantization = selectCurvedPercentage(
          0,
          (100 * (Config.bitcrusherQuantizationRange >> 1)) /
            (Config.bitcrusherQuantizationRange - 1),
          200 / (Config.bitcrusherQuantizationRange - 1),
          Config.bitcrusherQuantizationRange - 1,
        );
      }
      if (Math.random() < 0.1) {
        instrument.effects |= 1 << EffectType.chorus;
        instrument.chorus = selectCurvedPercentage(
          1,
          100,
          100 / (Config.chorusRange - 1),
          Config.chorusRange - 1,
        );
      }
      if (Math.random() < 0.1) {
        instrument.echoSustain = percentToSetting(
          selectCurvedValue(
            0,
            200,
            (100 * (Config.echoSustainRange >> 1)) /
              (Config.echoSustainRange - 1),
            200 / (Config.echoSustainRange - 1),
          ),
          Config.echoSustainRange - 1,
        );
        instrument.echoDelay = echoDelayFromBeats(
          selectCurvedValue(0.25, 2, 1, 0.25, 0.25),
        );
        if (instrument.echoSustain != 0 || instrument.echoDelay != 0) {
          instrument.effects |= 1 << EffectType.echo;
        }
      }
      if (Math.random() < 0.5) {
        instrument.effects |= 1 << EffectType.reverb;
        instrument.reverb = selectCurvedPercentage(
          1,
          100 / (Config.reverbRange - 1),
          100 / (Config.reverbRange - 1),
          Config.reverbRange - 1,
        );
      }

      function normalize(harmonics: number[]): void {
        let max: number = 0;
        for (const value of harmonics) {
          if (value > max) max = value;
        }
        for (let i: number = 0; i < harmonics.length; i++) {
          harmonics[i] = (Config.harmonicsMax * harmonics[i]) / max;
        }
      }
      switch (type) {
        case InstrumentType.chip:
          {
            instrument.chipWave = (Math.random() * Config.chipWaves.length) | 0;
          }
          break;
        case InstrumentType.pwm:
        case InstrumentType.supersaw:
          {
            if (type == InstrumentType.supersaw) {
              instrument.supersawDynamism = selectCurvedDistribution(
                0,
                Config.supersawDynamismMax,
                Config.supersawDynamismMax,
                2,
              );
              instrument.supersawSpread = selectCurvedDistribution(
                0,
                Config.supersawSpreadMax,
                Math.ceil(Config.supersawSpreadMax / 3),
                4,
              );
              instrument.supersawShape = selectCurvedDistribution(
                0,
                Config.supersawShapeMax,
                0,
                4,
              );
            }

            instrument.pulseWidth = selectCurvedDistribution(
              0,
              Config.pulseWidthRange - 1,
              Config.pulseWidthRange - 1,
              2,
            );

            if (Math.random() < 0.6) {
              instrument.addEnvelope(
                Config.instrumentAutomationTargets.dictionary["pulseWidth"]
                  .index,
                0,
                Config.envelopes.dictionary[
                  selectWeightedRandom([
                    { item: "punch", weight: 6 },
                    { item: "flare", weight: 2 },
                    { item: "flare", weight: 4 },
                    { item: "flare", weight: 2 },
                    { item: "twang", weight: 2 },
                    { item: "twang", weight: 4 },
                    { item: "twang", weight: 4 },
                    { item: "swell", weight: 4 },
                    { item: "swell", weight: 2 },
                    { item: "swell", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "decay", weight: 1 },
                    { item: "decay", weight: 2 },
                    { item: "decay", weight: 2 },
                  ])
                ].index,
              );
            }
          }
          break;
        case InstrumentType.pickedString:
        case InstrumentType.harmonics:
          {
            if (type == InstrumentType.pickedString) {
              instrument.stringSustain =
                (Math.random() * Config.stringSustainRange) | 0;
            }

            const harmonicGenerators: Function[] = [
              (): number[] => {
                const harmonics: number[] = [];
                for (
                  let i: number = 0;
                  i < Config.harmonicsControlPoints;
                  i++
                ) {
                  harmonics[i] = Math.random() < 0.4 ? Math.random() : 0.0;
                }
                harmonics[(Math.random() * 8) | 0] = Math.pow(
                  Math.random(),
                  0.25,
                );
                return harmonics;
              },
              (): number[] => {
                let current: number = 1.0;
                const harmonics: number[] = [current];
                for (let i = 1; i < Config.harmonicsControlPoints; i++) {
                  current *= Math.pow(2, Math.random() - 0.55);
                  harmonics[i] = current;
                }
                return harmonics;
              },
              (): number[] => {
                let current: number = 1.0;
                const harmonics: number[] = [current];
                for (let i = 1; i < Config.harmonicsControlPoints; i++) {
                  current *= Math.pow(2, Math.random() - 0.55);
                  harmonics[i] = current * Math.random();
                }
                return harmonics;
              },
            ];
            const generator =
              harmonicGenerators[
                (Math.random() * harmonicGenerators.length) | 0
              ];
            const harmonics: number[] = generator();
            normalize(harmonics);
            for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
              instrument.harmonicsWave.harmonics[i] = Math.round(harmonics[i]);
            }
            instrument.harmonicsWave.markCustomWaveDirty();
          }
          break;
        case InstrumentType.spectrum:
          {
            const spectrum: number[] = [];
            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
              const isHarmonic: boolean =
                i == 0 ||
                i == 7 ||
                i == 11 ||
                i == 14 ||
                i == 16 ||
                i == 18 ||
                i == 21;
              if (isHarmonic) {
                spectrum[i] = Math.pow(Math.random(), 0.25);
              } else {
                spectrum[i] = Math.pow(Math.random(), 3) * 0.5;
              }
            }
            normalize(spectrum);
            for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
              instrument.spectrumWave.spectrum[i] = Math.round(spectrum[i]);
            }
            instrument.spectrumWave.markCustomWaveDirty();
          }
          break;
        case InstrumentType.fm:
          {
            instrument.algorithm =
              (Math.random() * Config.algorithms.length) | 0;
            instrument.feedbackType =
              (Math.random() * Config.feedbacks.length) | 0;
            const algorithm: Algorithm =
              Config.algorithms[instrument.algorithm];
            for (let i: number = 0; i < Config.operatorCount; i++) {
              instrument.operators[i].wave =
                (Math.random() * (Config.chipWaves.length + 1)) | 0;
            }
            for (let i: number = 0; i < algorithm.carrierCount; i++) {
              instrument.operators[i].frequency = selectCurvedDistribution(
                1,
                20,
                1,
                3,
              );
              instrument.operators[i].amplitude = selectCurvedDistribution(
                0,
                Config.operatorAmplitudeMax,
                Config.operatorAmplitudeMax - 1,
                2,
              );
            }
            for (
              let i: number = algorithm.carrierCount;
              i < Config.operatorCount;
              i++
            ) {
              instrument.operators[i].frequency = selectCurvedDistribution(
                2,
                20,
                2,
                3,
              );
              instrument.operators[i].amplitude =
                (Math.pow(Math.random(), 2) * Config.operatorAmplitudeMax) | 0;
              if (
                instrument.envelopeCount < Config.maxEnvelopeCount &&
                Math.random() < 0.4
              ) {
                instrument.addEnvelope(
                  Config.instrumentAutomationTargets.dictionary[
                    "operatorAmplitude"
                  ].index,
                  i,
                  Config.envelopes.dictionary[
                    selectWeightedRandom([
                      { item: "punch", weight: 2 },
                      { item: "flare", weight: 2 },
                      { item: "flare", weight: 2 },
                      { item: "flare", weight: 2 },
                      { item: "twang", weight: 2 },
                      { item: "twang", weight: 2 },
                      { item: "twang", weight: 2 },
                      { item: "swell", weight: 2 },
                      { item: "swell", weight: 2 },
                      { item: "swell", weight: 2 },
                      { item: "tremolo", weight: 1 },
                      { item: "tremolo", weight: 1 },
                      { item: "tremolo", weight: 1 },
                      { item: "tremolo", weight: 1 },
                      { item: "tremolo", weight: 1 },
                      { item: "tremolo", weight: 1 },
                      { item: "decay", weight: 1 },
                      { item: "decay", weight: 1 },
                      { item: "decay", weight: 1 },
                    ])
                  ].index,
                );
              }
              if (
                instrument.envelopeCount < Config.maxEnvelopeCount &&
                Math.random() < 0.05
              ) {
                instrument.addEnvelope(
                  Config.instrumentAutomationTargets.dictionary[
                    "operatorFrequency"
                  ].index,
                  i,
                  Config.envelopes.dictionary[
                    selectWeightedRandom([
                      { item: "punch", weight: 4 },
                      { item: "flare", weight: 4 },
                      { item: "flare", weight: 2 },
                      { item: "flare", weight: 1 },
                      { item: "twang", weight: 16 },
                      { item: "twang", weight: 2 },
                      { item: "twang", weight: 1 },
                      { item: "swell", weight: 4 },
                      { item: "swell", weight: 2 },
                      { item: "swell", weight: 1 },
                      { item: "decay", weight: 2 },
                      { item: "decay", weight: 1 },
                      { item: "decay", weight: 1 },
                    ])
                  ].index,
                );
              }
            }
            instrument.feedbackAmplitude =
              (Math.pow(Math.random(), 3) * Config.operatorAmplitudeMax) | 0;
            if (
              instrument.envelopeCount < Config.maxEnvelopeCount &&
              Math.random() < 0.4
            ) {
              instrument.addEnvelope(
                Config.instrumentAutomationTargets.dictionary[
                  "feedbackAmplitude"
                ].index,
                0,
                Config.envelopes.dictionary[
                  selectWeightedRandom([
                    { item: "punch", weight: 2 },
                    { item: "flare", weight: 2 },
                    { item: "flare", weight: 2 },
                    { item: "flare", weight: 2 },
                    { item: "twang", weight: 2 },
                    { item: "twang", weight: 2 },
                    { item: "twang", weight: 2 },
                    { item: "swell", weight: 2 },
                    { item: "swell", weight: 2 },
                    { item: "swell", weight: 2 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "tremolo", weight: 1 },
                    { item: "decay", weight: 1 },
                    { item: "decay", weight: 1 },
                    { item: "decay", weight: 1 },
                  ])
                ].index,
              );
            }
          }
          break;
        case InstrumentType.soundFont:
          break;
        default:
          throw new Error(
            "Unhandled pitched instrument type in random generator.",
          );
      }
    }

    // Envelope parameters are continuous in the restructured model, so generated
    // instruments choose them directly instead of selecting numbered variants.
    for (let i: number = 0; i < instrument.envelopeCount; i++) {
      const settings = instrument.envelopes[i];
      settings.speed = Math.round(Math.random() * 500) / 100;
      settings.a = Math.round(Math.random() * 200) / 100;
      settings.b = Math.round(Math.random() * 200) / 100;
    }

    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeTransition extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.transition;
    if (oldValue != newValue) {
      this._didSomething();
      instrument.transition = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
    }
  }
}

export class ChangeToggleEffects extends Change {
  constructor(doc: SongDocument, toggleFlag: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.effects;
    const wasSelected: boolean = (oldValue & (1 << toggleFlag)) != 0;
    const newValue: number = wasSelected
      ? oldValue & ~(1 << toggleFlag)
      : oldValue | (1 << toggleFlag);
    instrument.effects = newValue;
    instrument.preset = instrument.type;
    if (wasSelected) instrument.clearInvalidEnvelopeTargets();
    this._didSomething();
    doc.notifier.changed();
  }
}

export class ChangePatternNumbers extends Change {
  constructor(
    doc: SongDocument,
    value: number,
    startBar: number,
    startChannel: number,
    width: number,
    height: number,
  ) {
    super();
    if (value > doc.song.patternsPerChannel) throw new Error("invalid pattern");

    for (let bar: number = startBar; bar < startBar + width; bar++) {
      for (
        let channelIndex: number = startChannel;
        channelIndex < startChannel + height;
        channelIndex++
      ) {
        if (doc.song.channels[channelIndex].bars[bar] != value) {
          doc.song.channels[channelIndex].bars[bar] = value;
          this._didSomething();
        }
      }
    }

    doc.notifier.changed();
  }
}

export class ChangeBarCount extends Change {
  constructor(doc: SongDocument, newValue: number, atBeginning: boolean) {
    super();
    if (doc.song.barCount != newValue) {
      for (const channel of doc.song.channels) {
        if (atBeginning) {
          while (channel.bars.length < newValue) {
            channel.bars.unshift(0);
          }
          if (doc.song.barCount > newValue) {
            channel.bars.splice(0, doc.song.barCount - newValue);
          }
        } else {
          while (channel.bars.length < newValue) {
            channel.bars.push(0);
          }
          channel.bars.length = newValue;
        }
      }

      if (atBeginning) {
        const diff: number = newValue - doc.song.barCount;
        doc.bar = Math.max(0, doc.bar + diff);
        if (diff < 0 || doc.barScrollPos > 0) {
          doc.barScrollPos = Math.max(0, doc.barScrollPos + diff);
        }
        doc.song.loopStart = Math.max(0, doc.song.loopStart + diff);
      }
      doc.bar = Math.min(doc.bar, newValue - 1);
      doc.song.loopLength = Math.min(newValue, doc.song.loopLength);
      doc.song.loopStart = Math.min(
        newValue - doc.song.loopLength,
        doc.song.loopStart,
      );
      doc.song.barCount = newValue;
      doc.notifier.changed();

      this._didSomething();
    }
  }
}

export class ChangeInsertBars extends Change {
  constructor(doc: SongDocument, start: number, count: number) {
    super();

    const newLength: number = Math.min(
      Config.barCountMax,
      doc.song.barCount + count,
    );
    count = newLength - doc.song.barCount;
    if (count == 0) return;

    for (const channel of doc.song.channels) {
      while (channel.bars.length < newLength) {
        channel.bars.splice(start, 0, 0);
      }
    }
    doc.song.barCount = newLength;

    doc.bar += count;
    if (doc.song.loopStart >= start) {
      doc.song.loopStart += count;
    } else if (doc.song.loopStart + doc.song.loopLength >= start) {
      doc.song.loopLength += count;
    }

    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeDeleteBars extends Change {
  constructor(doc: SongDocument, start: number, count: number) {
    super();

    for (const channel of doc.song.channels) {
      channel.bars.splice(start, count);
      if (channel.bars.length == 0) channel.bars.push(0);
    }
    doc.song.barCount = Math.max(1, doc.song.barCount - count);

    doc.bar = Math.max(0, doc.bar - count);
    doc.barScrollPos = Math.max(0, doc.barScrollPos - count);
    if (doc.song.loopStart >= start) {
      doc.song.loopStart = Math.max(0, doc.song.loopStart - count);
    } else if (doc.song.loopStart + doc.song.loopLength > start) {
      doc.song.loopLength -= count;
    }
    doc.song.loopLength = Math.max(
      1,
      Math.min(doc.song.barCount - doc.song.loopStart, doc.song.loopLength),
    );

    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeChannelOrder extends Change {
  constructor(
    doc: SongDocument,
    selectionMin: number,
    selectionMax: number,
    offset: number,
  ) {
    super();
    doc.song.channels.splice(
      selectionMin + offset,
      0,
      ...doc.song.channels.splice(
        selectionMin,
        selectionMax - selectionMin + 1,
      ),
    );
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeChannelCount extends Change {
  constructor(
    doc: SongDocument,
    newPitchChannelCount: number,
    newNoiseChannelCount: number,
  ) {
    super();
    if (
      doc.song.pitchChannelCount != newPitchChannelCount ||
      doc.song.noiseChannelCount != newNoiseChannelCount
    ) {
      const newChannels: Channel[] = [];

      function changeGroup(
        newCount: number,
        oldCount: number,
        newStart: number,
        oldStart: number,
        octave: number,
        isNoise: boolean,
      ): void {
        for (let i: number = 0; i < newCount; i++) {
          const channelIndex = i + newStart;
          const oldChannel = i + oldStart;
          if (i < oldCount) {
            newChannels[channelIndex] = doc.song.channels[oldChannel];
          } else {
            newChannels[channelIndex] = new Channel();
            newChannels[channelIndex].octave = octave;
            for (let j: number = 0; j < Config.instrumentCountMin; j++) {
              const instrument: Instrument = new Instrument(isNoise);
              const presetValue: number = pickRandomPresetValue();
              const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
              instrument.fromSettingsObject(preset.settings, isNoise);
              instrument.preset = presetValue;
              instrument.volume = Config.volumeDefault;
              newChannels[channelIndex].instruments[j] = instrument;
            }
            for (let j: number = 0; j < doc.song.patternsPerChannel; j++) {
              newChannels[channelIndex].patterns[j] = new Pattern();
            }
            for (let j: number = 0; j < doc.song.barCount; j++) {
              newChannels[channelIndex].bars[j] = 0;
            }
          }
        }
      }

      changeGroup(
        newPitchChannelCount,
        doc.song.pitchChannelCount,
        0,
        0,
        3,
        false,
      );
      changeGroup(
        newNoiseChannelCount,
        doc.song.noiseChannelCount,
        newPitchChannelCount,
        doc.song.pitchChannelCount,
        0,
        true,
      );

      doc.song.pitchChannelCount = newPitchChannelCount;
      doc.song.noiseChannelCount = newNoiseChannelCount;
      for (
        let channelIndex: number = 0;
        channelIndex < doc.song.getChannelCount();
        channelIndex++
      ) {
        doc.song.channels[channelIndex] = newChannels[channelIndex];
      }
      doc.song.channels.length = doc.song.getChannelCount();

      doc.channel = Math.min(
        doc.channel,
        newPitchChannelCount + newNoiseChannelCount - 1,
      );
      doc.notifier.changed();

      this._didSomething();
    }
  }
}

export class ChangeAddChannel extends ChangeGroup {
  constructor(doc: SongDocument, index: number, isNoise: boolean) {
    super();
    const newPitchChannelCount: number =
      doc.song.pitchChannelCount + (isNoise ? 0 : 1);
    const newNoiseChannelCount: number =
      doc.song.noiseChannelCount + (isNoise ? 1 : 0);
    if (
      newPitchChannelCount <= Config.pitchChannelCountMax &&
      newNoiseChannelCount <= Config.noiseChannelCountMax
    ) {
      const addedChannelIndex: number = isNoise
        ? doc.song.pitchChannelCount + doc.song.noiseChannelCount
        : doc.song.pitchChannelCount;
      this.append(
        new ChangeChannelCount(doc, newPitchChannelCount, newNoiseChannelCount),
      );
      this.append(new ChangeChannelOrder(doc, index, addedChannelIndex - 1, 1));
    }
  }
}

export class ChangeRemoveChannel extends ChangeGroup {
  constructor(doc: SongDocument, minIndex: number, maxIndex: number) {
    super();

    while (maxIndex >= minIndex) {
      const isNoise: boolean = doc.song.getChannelIsNoise(maxIndex);
      doc.song.channels.splice(maxIndex, 1);
      if (isNoise) {
        doc.song.noiseChannelCount--;
      } else {
        doc.song.pitchChannelCount--;
      }
      maxIndex--;
    }

    if (doc.song.pitchChannelCount < Config.pitchChannelCountMin) {
      this.append(
        new ChangeChannelCount(
          doc,
          Config.pitchChannelCountMin,
          doc.song.noiseChannelCount,
        ),
      );
    }

    this.append(new ChangeChannelBar(doc, Math.max(0, minIndex - 1), doc.bar));

    this._didSomething();
    doc.notifier.changed();
  }
}

export class ChangeChannelBar extends Change {
  constructor(
    doc: SongDocument,
    newChannel: number,
    newBar: number,
    silently: boolean = false,
    horizontalOnly: boolean = false,
  ) {
    super();
    const oldChannel: number = doc.channel;
    const oldBar: number = doc.bar;
    doc.channel = newChannel;
    doc.bar = newBar;
    if (!silently) {
      if (horizontalOnly) {
        doc.barScrollPos = Math.min(
          doc.bar,
          Math.max(doc.bar - (doc.trackVisibleBars - 1), doc.barScrollPos),
        );
      } else {
        doc.selection.scrollToSelectedPattern();
      }
    }
    doc.notifier.changed();
    if (oldChannel != newChannel || oldBar != newBar) {
      this._didSomething();
    }
  }
}

export class ChangeUnison extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.unison;
    if (oldValue != newValue) {
      this._didSomething();
      instrument.unison = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
    }
  }
}

export class ChangeChord extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.chord;
    if (oldValue != newValue) {
      this._didSomething();
      instrument.chord = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
    }
  }
}

export class ChangeVibrato extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.vibrato;
    if (oldValue != newValue) {
      instrument.vibrato = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeSpectrum extends Change {
  constructor(
    doc: SongDocument,
    instrument: Instrument,
    spectrumWave: SpectrumWave,
  ) {
    super();
    spectrumWave.markCustomWaveDirty();
    instrument.preset = instrument.type;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeHarmonics extends Change {
  constructor(
    doc: SongDocument,
    instrument: Instrument,
    harmonicsWave: HarmonicsWave,
  ) {
    super();
    harmonicsWave.markCustomWaveDirty();
    instrument.preset = instrument.type;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeDrumsetEnvelope extends Change {
  constructor(doc: SongDocument, drumIndex: number, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.drumsetEnvelopes[drumIndex];
    if (oldValue != newValue) {
      instrument.drumsetEnvelopes[drumIndex] = newValue;
      instrument.drumsetEnvelopeSpeeds[drumIndex] =
        Config.envelopes[newValue].speed;
      instrument.drumsetEnvelopeAs[drumIndex] = Config.envelopes[newValue].a;
      instrument.drumsetEnvelopeBs[drumIndex] = Config.envelopes[newValue].b;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeDrumsetEnvelopeParameter extends Change {
  constructor(
    doc: SongDocument,
    drumIndex: number,
    parameter: "speed" | "a" | "b",
    oldValue: number,
    newValue: number,
  ) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const values = {
      speed: instrument.drumsetEnvelopeSpeeds,
      a: instrument.drumsetEnvelopeAs,
      b: instrument.drumsetEnvelopeBs,
    };
    values[parameter][drumIndex] = newValue;
    instrument.preset = instrument.type;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

class ChangeInstrumentSlider extends Change {
  protected _instrument: Instrument;
  constructor(private _doc: SongDocument) {
    super();
    this._instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
  }

  public override commit(): void {
    if (!this.isNoop()) {
      this._instrument.preset = this._instrument.type;
      this._doc.notifier.changed();
    }
  }
}

export class ChangePulseWidth extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.pulseWidth = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeSupersawDynamism extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.supersawDynamism = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}
export class ChangeSupersawSpread extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.supersawSpread = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}
export class ChangeSupersawShape extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.supersawShape = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangePitchShift extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.pitchShift = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeDetune extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.detune = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeDistortion extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.distortion = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeBitcrusherFreq extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.bitcrusherFreq = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeBitcrusherQuantization extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.bitcrusherQuantization = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeStringSustain extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.stringSustain = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeStringSustainType extends Change {
  constructor(doc: SongDocument, newValue: SustainType) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: SustainType = instrument.stringSustainType;
    if (oldValue != newValue) {
      instrument.stringSustainType = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeFilterAddPoint extends UndoableChange {
  private _doc: SongDocument;
  private _instrument: Instrument;
  private _instrumentPrevPreset: number;
  private _instrumentNextPreset: number;
  private _filterSettings: FilterSettings;
  private _point: FilterControlPoint;
  private _index: number;
  private _envelopeTargetsAdd: number[] = [];
  private _envelopeIndicesAdd: number[] = [];
  private _envelopeTargetsRemove: number[] = [];
  private _envelopeIndicesRemove: number[] = [];
  constructor(
    doc: SongDocument,
    filterSettings: FilterSettings,
    point: FilterControlPoint,
    index: number,
    isNoteFilter: boolean,
    deletion: boolean = false,
  ) {
    super(deletion);
    this._doc = doc;
    this._instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
    this._instrumentNextPreset = deletion
      ? this._instrument.preset
      : this._instrument.type;
    this._instrumentPrevPreset = deletion
      ? this._instrument.type
      : this._instrument.preset;
    this._filterSettings = filterSettings;
    this._point = point;
    this._index = index;

    for (
      let envelopeIndex: number = 0;
      envelopeIndex < this._instrument.envelopeCount;
      envelopeIndex++
    ) {
      let target: number = this._instrument.envelopes[envelopeIndex].target;
      let targetIndex: number = this._instrument.envelopes[envelopeIndex].index;
      this._envelopeTargetsAdd.push(target);
      this._envelopeIndicesAdd.push(targetIndex);
      if (deletion) {
        // When deleting a filter control point, find all envelopes that targeted that
        // point and clear them, and all envelopes that targeted later points and
        // decrement those to keep them in sync with the new list of points.
        const automationTarget: AutomationTarget =
          Config.instrumentAutomationTargets[target];
        if (
          automationTarget.isFilter &&
          (automationTarget.effect == EffectType.noteFilter) == isNoteFilter
        ) {
          if (automationTarget.maxCount == Config.filterMaxPoints) {
            if (targetIndex == index) {
              target =
                Config.instrumentAutomationTargets.dictionary["none"].index;
              targetIndex = 0;
            } else if (targetIndex > index) {
              targetIndex--;
            }
          } else {
            if (filterSettings.controlPointCount <= 1) {
              target =
                Config.instrumentAutomationTargets.dictionary["none"].index;
              targetIndex = 0;
            }
          }
        }
      }
      this._envelopeTargetsRemove.push(target);
      this._envelopeIndicesRemove.push(targetIndex);
    }

    this._didSomething();
    this.redo();
  }

  protected override _doForwards(): void {
    this._filterSettings.controlPoints.splice(this._index, 0, this._point);
    this._filterSettings.controlPointCount++;
    this._filterSettings.controlPoints.length =
      this._filterSettings.controlPointCount;
    this._instrument.preset = this._instrumentNextPreset;
    for (
      let envelopeIndex: number = 0;
      envelopeIndex < this._instrument.envelopeCount;
      envelopeIndex++
    ) {
      this._instrument.envelopes[envelopeIndex].target =
        this._envelopeTargetsAdd[envelopeIndex];
      this._instrument.envelopes[envelopeIndex].index =
        this._envelopeIndicesAdd[envelopeIndex];
    }
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._filterSettings.controlPoints.splice(this._index, 1);
    this._filterSettings.controlPointCount--;
    this._filterSettings.controlPoints.length =
      this._filterSettings.controlPointCount;
    this._instrument.preset = this._instrumentPrevPreset;
    for (
      let envelopeIndex: number = 0;
      envelopeIndex < this._instrument.envelopeCount;
      envelopeIndex++
    ) {
      this._instrument.envelopes[envelopeIndex].target =
        this._envelopeTargetsRemove[envelopeIndex];
      this._instrument.envelopes[envelopeIndex].index =
        this._envelopeIndicesRemove[envelopeIndex];
    }
    this._doc.notifier.changed();
  }
}

export class ChangeFilterMovePoint extends UndoableChange {
  private _doc: SongDocument;
  private _instrument: Instrument;
  private _instrumentPrevPreset: number;
  private _instrumentNextPreset: number;
  private _point: FilterControlPoint;
  private _oldFreq: number;
  private _newFreq: number;
  private _oldGain: number;
  private _newGain: number;
  constructor(
    doc: SongDocument,
    point: FilterControlPoint,
    oldFreq: number,
    newFreq: number,
    oldGain: number,
    newGain: number,
  ) {
    super(false);
    this._doc = doc;
    this._instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
    this._instrumentNextPreset = this._instrument.type;
    this._instrumentPrevPreset = this._instrument.preset;
    this._point = point;
    this._oldFreq = oldFreq;
    this._newFreq = newFreq;
    this._oldGain = oldGain;
    this._newGain = newGain;
    this._didSomething();
    this.redo();
  }

  protected override _doForwards(): void {
    this._point.freq = this._newFreq;
    this._point.gain = this._newGain;
    this._instrument.preset = this._instrumentNextPreset;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._point.freq = this._oldFreq;
    this._point.gain = this._oldGain;
    this._instrument.preset = this._instrumentPrevPreset;
    this._doc.notifier.changed();
  }
}

export class ChangeFadeInOut extends UndoableChange {
  private _doc: SongDocument;
  private _instrument: Instrument;
  private _instrumentPrevPreset: number;
  private _instrumentNextPreset: number;
  private _oldFadeIn: number;
  private _oldFadeOut: number;
  private _newFadeIn: number;
  private _newFadeOut: number;
  constructor(doc: SongDocument, fadeIn: number, fadeOut: number) {
    super(false);
    this._doc = doc;
    this._instrument =
      this._doc.song.channels[this._doc.channel].instruments[
        this._doc.getCurrentInstrument()
      ];
    this._instrumentNextPreset = this._instrument.type;
    this._instrumentPrevPreset = this._instrument.preset;
    this._oldFadeIn = this._instrument.fadeIn;
    this._oldFadeOut = this._instrument.fadeOut;
    this._newFadeIn = fadeIn;
    this._newFadeOut = fadeOut;
    this._didSomething();
    this.redo();
  }

  protected override _doForwards(): void {
    this._instrument.fadeIn = this._newFadeIn;
    this._instrument.fadeOut = this._newFadeOut;
    this._instrument.preset = this._instrumentNextPreset;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._instrument.fadeIn = this._oldFadeIn;
    this._instrument.fadeOut = this._oldFadeOut;
    this._instrument.preset = this._instrumentPrevPreset;
    this._doc.notifier.changed();
  }
}

export class ChangeAlgorithm extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.algorithm;
    if (oldValue != newValue) {
      instrument.algorithm = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeFeedbackType extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.feedbackType;
    if (oldValue != newValue) {
      instrument.feedbackType = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeOperatorFrequency extends Change {
  constructor(doc: SongDocument, operatorIndex: number, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    newValue = Math.max(0, Math.min(Config.operatorFrequencyMax, newValue));
    const oldValue: number = instrument.operators[operatorIndex].frequency;
    if (oldValue != newValue) {
      instrument.operators[operatorIndex].frequency = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeOperatorWave extends Change {
  constructor(doc: SongDocument, operatorIndex: number, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.operators[operatorIndex].wave;
    if (oldValue != newValue) {
      instrument.operators[operatorIndex].wave = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeOperatorAmplitude extends ChangeInstrumentSlider {
  constructor(
    doc: SongDocument,
    operatorIndex: number,
    oldValue: number,
    newValue: number,
  ) {
    super(doc);
    this._instrument.operators[operatorIndex].amplitude = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeFeedbackAmplitude extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.feedbackAmplitude = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeAddChannelInstrument extends Change {
  constructor(doc: SongDocument) {
    super();
    const channel: Channel = doc.song.channels[doc.channel];
    const isNoise: boolean = doc.song.getChannelIsNoise(doc.channel);
    const maxInstruments: number = doc.song.getMaxInstrumentsPerChannel();
    if (channel.instruments.length >= maxInstruments) return;
    const presetValue: number = pickRandomPresetValue();
    const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
    const instrument: Instrument = new Instrument(isNoise);
    instrument.fromSettingsObject(preset.settings, isNoise);
    instrument.preset = presetValue;
    instrument.volume = Config.volumeDefault;
    channel.instruments.push(instrument);
    doc.viewedInstrument[doc.channel] = channel.instruments.length - 1;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeRemoveChannelInstrument extends Change {
  constructor(doc: SongDocument) {
    super();
    const channel: Channel = doc.song.channels[doc.channel];
    if (channel.instruments.length <= Config.instrumentCountMin) return;
    const removedIndex: number = doc.viewedInstrument[doc.channel];
    channel.instruments.splice(removedIndex, 1);
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeViewInstrument extends Change {
  constructor(doc: SongDocument, index: number) {
    super();
    if (doc.viewedInstrument[doc.channel] != index) {
      doc.viewedInstrument[doc.channel] = index;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeKey extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    if (doc.song.key != newValue) {
      doc.song.key = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeComposingKey extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    if (doc.song.composingKey != newValue) {
      doc.song.composingKey = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeLoop extends Change {
  constructor(
    private _doc: SongDocument,
    public oldStart: number,
    public oldLength: number,
    public newStart: number,
    public newLength: number,
  ) {
    super();
    this._doc.song.loopStart = this.newStart;
    this._doc.song.loopLength = this.newLength;
    this._doc.notifier.changed();
    if (this.oldStart != this.newStart || this.oldLength != this.newLength) {
      this._didSomething();
    }
  }
}

export class ChangePitchAdded extends UndoableChange {
  private _doc: SongDocument;
  private _note: Note;
  private _pitch: number;
  private _index: number;
  constructor(
    doc: SongDocument,
    note: Note,
    pitch: number,
    index: number,
    deletion: boolean = false,
  ) {
    super(deletion);
    this._doc = doc;
    this._note = note;
    this._pitch = pitch;
    this._index = index;
    this._didSomething();
    this.redo();
  }

  protected override _doForwards(): void {
    this._note.pitches.splice(this._index, 0, this._pitch);
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._note.pitches.splice(this._index, 1);
    this._doc.notifier.changed();
  }
}

export class ChangeOctave extends Change {
  constructor(
    doc: SongDocument,
    public oldValue: number,
    newValue: number,
  ) {
    super();
    doc.song.channels[doc.channel].octave = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeRhythm extends ChangeGroup {
  constructor(doc: SongDocument, newValue: number) {
    super();

    if (doc.song.rhythm != newValue) {
      doc.song.rhythm = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangePaste extends ChangeGroup {
  constructor(
    doc: SongDocument,
    pattern: Pattern,
    notes: any[],
    selectionStart: number,
    selectionEnd: number,
    oldPartDuration: number,
  ) {
    super();

    // Erase the current contents of the selection:
    this.append(
      new ChangeNoteTruncate(doc, pattern, selectionStart, selectionEnd),
    );

    let noteInsertionIndex: number = 0;
    for (let i: number = 0; i < pattern.notes.length; i++) {
      if (pattern.notes[i].start < selectionStart) {
        if (pattern.notes[i].end > selectionStart) throw new Error();

        noteInsertionIndex = i + 1;
      } else if (pattern.notes[i].start < selectionEnd) {
        throw new Error();
      }
    }

    while (selectionStart < selectionEnd) {
      for (const noteObject of notes) {
        const noteStart: number = noteObject["start"] + selectionStart;
        const noteEnd: number = noteObject["end"] + selectionStart;
        if (noteStart >= selectionEnd) break;
        const note: Note = new Note(
          noteObject["pitches"][0],
          noteStart,
          noteEnd,
          noteObject["pins"][0]["size"],
          false,
        );
        note.pitches.length = 0;
        for (const pitch of noteObject["pitches"]) {
          note.pitches.push(pitch);
        }
        note.pins.length = 0;
        for (const pin of noteObject["pins"]) {
          note.pins.push(makeNotePin(pin.interval, pin.time, pin.size));
        }
        note.continuesLastPattern =
          noteObject["continuesLastPattern"] === true && note.start == 0;
        pattern.notes.splice(noteInsertionIndex++, 0, note);
        if (note.end > selectionEnd) {
          this.append(
            new ChangeNoteLength(doc, note, note.start, selectionEnd),
          );
        }
      }

      selectionStart += oldPartDuration;
    }

    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangePasteInstrument extends ChangeGroup {
  constructor(doc: SongDocument, instrument: Instrument, instrumentCopy: any) {
    super();
    instrument.fromSettingsObject(
      instrumentCopy,
      doc.song.getChannelIsNoise(doc.channel),
    );
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangePatternsPerChannel extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    if (doc.song.patternsPerChannel != newValue) {
      for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
        const channelBars: number[] = doc.song.channels[i].bars;
        const channelPatterns: Pattern[] = doc.song.channels[i].patterns;
        for (let j: number = 0; j < channelBars.length; j++) {
          if (channelBars[j] > newValue) channelBars[j] = 0;
        }
        for (let j: number = channelPatterns.length; j < newValue; j++) {
          channelPatterns[j] = new Pattern();
        }
        channelPatterns.length = newValue;
      }
      doc.song.patternsPerChannel = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeRectifyPatterns extends Change {
  constructor(doc: SongDocument) {
    super();
    const rectifiedPatterns: Pattern[][] = [];
    let patternsPerChannel: number = 0;

    for (const channel of doc.song.channels) {
      // Empty patterns are equivalent to empty cells.
      for (let bar: number = 0; bar < channel.bars.length; bar++) {
        const patternNumber: number = channel.bars[bar];
        if (
          patternNumber != 0 &&
          channel.patterns[patternNumber - 1].notes.length == 0
        ) {
          channel.bars[bar] = 0;
          this._didSomething();
        }
      }

      // Discard notes that cannot be reached from the sequence.
      const referencedPatterns: Set<number> = new Set(channel.bars);
      for (
        let patternIndex: number = 0;
        patternIndex < channel.patterns.length;
        patternIndex++
      ) {
        if (
          !referencedPatterns.has(patternIndex + 1) &&
          channel.patterns[patternIndex].notes.length > 0
        ) {
          channel.patterns[patternIndex].notes.length = 0;
          this._didSomething();
        }
      }

      // Visiting bars in order both deduplicates patterns and assigns dense pattern
      // numbers in the exact order of their first appearance.
      const newPatterns: Pattern[] = [];
      for (let bar: number = 0; bar < channel.bars.length; bar++) {
        const oldPatternNumber: number = channel.bars[bar];
        if (oldPatternNumber == 0) continue;

        const oldPattern: Pattern = channel.patterns[oldPatternNumber - 1];
        let newPatternNumber: number = 0;
        for (
          let patternIndex: number = 0;
          patternIndex < newPatterns.length;
          patternIndex++
        ) {
          if (
            comparePatternNotes(
              oldPattern.notes,
              newPatterns[patternIndex].notes,
            )
          ) {
            newPatternNumber = patternIndex + 1;
            break;
          }
        }

        if (newPatternNumber == 0) {
          newPatterns.push(oldPattern);
          newPatternNumber = newPatterns.length;
        }
        if (channel.bars[bar] != newPatternNumber) {
          channel.bars[bar] = newPatternNumber;
          this._didSomething();
        }
      }

      rectifiedPatterns.push(newPatterns);
      patternsPerChannel = Math.max(patternsPerChannel, newPatterns.length);
    }

    // The serialized song format requires at least one pattern slot.
    patternsPerChannel = Math.max(1, patternsPerChannel);
    for (
      let channelIndex: number = 0;
      channelIndex < doc.song.channels.length;
      channelIndex++
    ) {
      const patterns: Pattern[] = doc.song.channels[channelIndex].patterns;
      const newPatterns: Pattern[] = rectifiedPatterns[channelIndex];
      for (
        let patternIndex: number = 0;
        patternIndex < patternsPerChannel;
        patternIndex++
      ) {
        const pattern: Pattern =
          newPatterns[patternIndex] ||
          (patterns[patternIndex]?.notes.length == 0
            ? patterns[patternIndex]
            : new Pattern());
        if (patterns[patternIndex] !== pattern) {
          patterns[patternIndex] = pattern;
          this._didSomething();
        }
      }
      if (patterns.length != patternsPerChannel) {
        patterns.length = patternsPerChannel;
        this._didSomething();
      }
    }
    if (doc.song.patternsPerChannel != patternsPerChannel) {
      doc.song.patternsPerChannel = patternsPerChannel;
      this._didSomething();
    }

    if (!this.isNoop()) doc.notifier.changed();
  }
}

export class ChangeEnsurePatternExists extends UndoableChange {
  private _doc!: SongDocument;
  private _bar!: number;
  private _channelIndex!: number;
  private _patternIndex!: number;
  private _patternOldNotes: Note[] | null = null;
  private _oldPatternCount!: number;
  private _newPatternCount!: number;

  constructor(doc: SongDocument, channelIndex: number, bar: number) {
    super(false);
    const song: Song = doc.song;
    if (song.channels[channelIndex].bars[bar] != 0) return;

    this._doc = doc;
    this._bar = bar;
    this._channelIndex = channelIndex;
    this._oldPatternCount = song.patternsPerChannel;
    this._newPatternCount = song.patternsPerChannel;

    let firstEmptyUnusedIndex: number | null = null;
    let firstUnusedIndex: number | null = null;
    for (
      let patternIndex: number = 1;
      patternIndex <= song.patternsPerChannel;
      patternIndex++
    ) {
      let used = false;
      for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
        if (song.channels[channelIndex].bars[barIndex] == patternIndex) {
          used = true;
          break;
        }
      }
      if (used) continue;
      if (firstUnusedIndex == null) {
        firstUnusedIndex = patternIndex;
      }
      const pattern: Pattern =
        song.channels[channelIndex].patterns[patternIndex - 1];
      if (pattern.notes.length == 0) {
        firstEmptyUnusedIndex = patternIndex;
        break;
      }
    }

    if (firstEmptyUnusedIndex != null) {
      this._patternIndex = firstEmptyUnusedIndex;
    } else if (song.patternsPerChannel < song.barCount) {
      this._newPatternCount = song.patternsPerChannel + 1;
      this._patternIndex = song.patternsPerChannel + 1;
    } else if (firstUnusedIndex != null) {
      this._patternIndex = firstUnusedIndex;
      this._patternOldNotes =
        song.channels[channelIndex].patterns[firstUnusedIndex - 1].notes;
    } else {
      throw new Error();
    }

    this._didSomething();
    this._doForwards();
  }

  protected override _doForwards(): void {
    const song: Song = this._doc.song;
    for (
      let j: number = song.patternsPerChannel;
      j < this._newPatternCount;
      j++
    ) {
      for (let i: number = 0; i < song.getChannelCount(); i++) {
        song.channels[i].patterns[j] = new Pattern();
      }
    }
    song.patternsPerChannel = this._newPatternCount;
    const pattern: Pattern =
      song.channels[this._channelIndex].patterns[this._patternIndex - 1];
    pattern.notes = [];
    song.channels[this._channelIndex].bars[this._bar] = this._patternIndex;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    const song: Song = this._doc.song;
    const pattern: Pattern =
      song.channels[this._channelIndex].patterns[this._patternIndex - 1];
    if (this._patternOldNotes != null) pattern.notes = this._patternOldNotes;
    song.channels[this._channelIndex].bars[this._bar] = 0;
    for (let i: number = 0; i < song.getChannelCount(); i++) {
      song.channels[i].patterns.length = this._oldPatternCount;
    }
    song.patternsPerChannel = this._oldPatternCount;
    this._doc.notifier.changed();
  }
}

export class ChangePinTime extends ChangePins {
  constructor(
    doc: SongDocument | null,
    note: Note,
    pinIndex: number,
    shiftedTime: number,
    continuesLastPattern: boolean,
  ) {
    super(doc, note);

    shiftedTime -= this._oldStart;
    const originalTime: number = this._oldPins[pinIndex].time;
    const skipStart: number = Math.min(originalTime, shiftedTime);
    const skipEnd: number = Math.max(originalTime, shiftedTime);
    let setPin: boolean = false;
    for (let i: number = 0; i < this._oldPins.length; i++) {
      const oldPin: NotePin = note.pins[i];
      const time: number = oldPin.time;
      if (time < skipStart) {
        this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
      } else if (time > skipEnd) {
        if (!setPin) {
          if (this._newPins.length > 0)
            continuesLastPattern = note.continuesLastPattern;
          this._newPins.push(
            makeNotePin(
              this._oldPins[pinIndex].interval,
              shiftedTime,
              this._oldPins[pinIndex].size,
            ),
          );
          setPin = true;
        }
        this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
      }
    }
    if (!setPin) {
      continuesLastPattern = note.continuesLastPattern;
      this._newPins.push(
        makeNotePin(
          this._oldPins[pinIndex].interval,
          shiftedTime,
          this._oldPins[pinIndex].size,
        ),
      );
    }

    this._finishSetup(continuesLastPattern);
  }
}

export class ChangePitchBend extends ChangePins {
  constructor(
    doc: SongDocument | null,
    note: Note,
    bendStart: number,
    bendEnd: number,
    bendTo: number,
    pitchIndex: number,
  ) {
    super(doc, note);

    bendStart -= this._oldStart;
    bendEnd -= this._oldStart;
    bendTo -= note.pitches[pitchIndex];

    let setStart: boolean = false;
    let setEnd: boolean = false;
    let prevInterval: number = 0;
    let prevSize: number = Config.noteSizeMax;
    let persist: boolean = true;
    let i: number;
    let direction: number;
    let stop: number;
    let push: (item: NotePin) => void;
    if (bendEnd > bendStart) {
      i = 0;
      direction = 1;
      stop = note.pins.length;
      push = (item: NotePin) => {
        this._newPins.push(item);
      };
    } else {
      i = note.pins.length - 1;
      direction = -1;
      stop = -1;
      push = (item: NotePin) => {
        this._newPins.unshift(item);
      };
    }
    for (; i != stop; i += direction) {
      const oldPin: NotePin = note.pins[i];
      const time: number = oldPin.time;
      for (;;) {
        if (!setStart) {
          if (time * direction <= bendStart * direction) {
            prevInterval = oldPin.interval;
            prevSize = oldPin.size;
          }
          if (time * direction < bendStart * direction) {
            push(makeNotePin(oldPin.interval, time, oldPin.size));
            break;
          } else {
            push(makeNotePin(prevInterval, bendStart, prevSize));
            setStart = true;
          }
        } else if (!setEnd) {
          if (time * direction <= bendEnd * direction) {
            prevInterval = oldPin.interval;
            prevSize = oldPin.size;
          }
          if (time * direction < bendEnd * direction) {
            break;
          } else {
            push(makeNotePin(bendTo, bendEnd, prevSize));
            setEnd = true;
          }
        } else {
          if (time * direction == bendEnd * direction) {
            break;
          } else {
            if (oldPin.interval != prevInterval) persist = false;
            push(
              makeNotePin(
                persist ? bendTo : oldPin.interval,
                time,
                oldPin.size,
              ),
            );
            break;
          }
        }
      }
    }
    if (!setEnd) {
      push(makeNotePin(bendTo, bendEnd, prevSize));
    }

    this._finishSetup();
  }
}

export class ChangePatternRhythm extends ChangeSequence {
  constructor(doc: SongDocument, pattern: Pattern) {
    super();
    const minDivision: number =
      Config.partsPerBeat / Config.rhythms[doc.song.rhythm].stepsPerBeat;

    const changeRhythm: (oldTime: number) => number = function (
      oldTime: number,
    ): number {
      let thresholds: number[] | null =
        Config.rhythms[doc.song.rhythm].roundUpThresholds;
      if (thresholds != null) {
        const beatStart: number =
          Math.floor(oldTime / Config.partsPerBeat) * Config.partsPerBeat;
        const remainder: number = oldTime - beatStart;
        let newTime: number = beatStart;
        for (const threshold of thresholds) {
          if (remainder >= threshold) {
            newTime += minDivision;
          } else {
            break;
          }
        }
        return newTime;
      } else {
        return Math.round(oldTime / minDivision) * minDivision;
      }
    };

    let i: number = 0;
    while (i < pattern.notes.length) {
      const note: Note = pattern.notes[i];
      if (changeRhythm(note.start) >= changeRhythm(note.end)) {
        this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
      } else {
        this.append(new ChangeRhythmNote(doc, note, changeRhythm));
        i++;
      }
    }
  }
}

class ChangeRhythmNote extends ChangePins {
  constructor(
    doc: SongDocument | null,
    note: Note,
    changeRhythm: (oldTime: number) => number,
  ) {
    super(doc, note);

    for (const oldPin of this._oldPins) {
      this._newPins.push(
        makeNotePin(
          oldPin.interval,
          changeRhythm(oldPin.time + this._oldStart) - this._oldStart,
          oldPin.size,
        ),
      );
    }

    this._finishSetup();
  }
}

export class ChangeMoveNotesSideways extends ChangeGroup {
  constructor(doc: SongDocument, beatsToMove: number, strategy: string) {
    super();
    let partsToMove: number = Math.round(
      (beatsToMove % doc.song.beatsPerBar) * Config.partsPerBeat,
    );
    if (partsToMove < 0)
      partsToMove += doc.song.beatsPerBar * Config.partsPerBeat;
    if (partsToMove == 0.0) return;

    switch (strategy) {
      case "wrapAround":
        {
          const partsPerBar: number =
            Config.partsPerBeat * doc.song.beatsPerBar;
          for (const channel of doc.song.channels) {
            for (const pattern of channel.patterns) {
              const newNotes: Note[] = [];

              for (let bar: number = 1; bar >= 0; bar--) {
                const barStartPart: number = bar * partsPerBar;

                for (const oldNote of pattern.notes) {
                  const absoluteNoteStart: number = oldNote.start + partsToMove;
                  const absoluteNoteEnd: number = oldNote.end + partsToMove;
                  const noteStartPart: number = Math.max(
                    0,
                    absoluteNoteStart - barStartPart,
                  );
                  const noteEndPart: number = Math.min(
                    partsPerBar,
                    absoluteNoteEnd - barStartPart,
                  );

                  if (noteStartPart < noteEndPart) {
                    projectNoteIntoBar(
                      oldNote,
                      absoluteNoteStart - barStartPart - noteStartPart,
                      noteStartPart,
                      noteEndPart,
                      newNotes,
                    );
                  }
                }
              }

              pattern.notes = newNotes;
            }
          }
        }
        break;
      case "overflow":
        {
          let originalBarCount: number = doc.song.barCount;
          let originalLoopStart: number = doc.song.loopStart;
          let originalLoopLength: number = doc.song.loopLength;

          this.append(
            new ChangeMoveAndOverflowNotes(
              doc,
              doc.song.beatsPerBar,
              partsToMove,
            ),
          );

          if (beatsToMove < 0) {
            let firstBarIsEmpty: boolean = true;
            for (const channel of doc.song.channels) {
              if (channel.bars[0] != 0) firstBarIsEmpty = false;
            }
            if (firstBarIsEmpty) {
              for (const channel of doc.song.channels) {
                channel.bars.shift();
              }
              doc.song.barCount--;
            } else {
              originalBarCount++;
              originalLoopStart++;
              doc.bar++;
            }
          }
          while (doc.song.barCount < originalBarCount) {
            for (const channel of doc.song.channels) {
              channel.bars.push(0);
            }
            doc.song.barCount++;
          }
          doc.song.loopStart = originalLoopStart;
          doc.song.loopLength = originalLoopLength;
        }
        break;
      default:
        throw new Error("Unrecognized beats-per-bar conversion strategy.");
    }

    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeBeatsPerBar extends ChangeGroup {
  constructor(doc: SongDocument, newValue: number, strategy: string) {
    super();
    if (doc.song.beatsPerBar != newValue) {
      switch (strategy) {
        case "splice":
          {
            if (doc.song.beatsPerBar > newValue) {
              const sequence: ChangeSequence = new ChangeSequence();
              for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
                for (
                  let j: number = 0;
                  j < doc.song.channels[i].patterns.length;
                  j++
                ) {
                  sequence.append(
                    new ChangeNoteTruncate(
                      doc,
                      doc.song.channels[i].patterns[j],
                      newValue * Config.partsPerBeat,
                      doc.song.beatsPerBar * Config.partsPerBeat,
                    ),
                  );
                }
              }
            }
          }
          break;
        case "stretch":
          {
            const changeRhythm = function (oldTime: number): number {
              return Math.round((oldTime * newValue) / doc.song.beatsPerBar);
            };
            for (
              let channelIndex: number = 0;
              channelIndex < doc.song.getChannelCount();
              channelIndex++
            ) {
              for (
                let patternIndex: number = 0;
                patternIndex < doc.song.channels[channelIndex].patterns.length;
                patternIndex++
              ) {
                const pattern: Pattern =
                  doc.song.channels[channelIndex].patterns[patternIndex];
                let noteIndex: number = 0;
                while (noteIndex < pattern.notes.length) {
                  const note: Note = pattern.notes[noteIndex];
                  if (changeRhythm(note.start) >= changeRhythm(note.end)) {
                    this.append(
                      new ChangeNoteAdded(doc, pattern, note, noteIndex, true),
                    );
                  } else {
                    this.append(new ChangeRhythmNote(doc, note, changeRhythm));
                    noteIndex++;
                  }
                }
              }
            }
            this.append(
              new ChangeTempo(
                doc,
                doc.song.tempo,
                (doc.song.tempo * newValue) / doc.song.beatsPerBar,
              ),
            );
          }
          break;
        case "overflow":
          {
            this.append(new ChangeMoveAndOverflowNotes(doc, newValue, 0));
            doc.song.loopStart = 0;
            doc.song.loopLength = doc.song.barCount;
          }
          break;
        default:
          throw new Error("Unrecognized beats-per-bar conversion strategy.");
      }

      doc.song.beatsPerBar = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeScale extends ChangeGroup {
  constructor(doc: SongDocument, newValue: number) {
    super();
    if (doc.song.scale != newValue) {
      doc.song.scale = newValue;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeDetectComposingKey extends ChangeGroup {
  constructor(doc: SongDocument) {
    super();
    const song: Song = doc.song;
    const basePitch: number = Config.keys[song.key].basePitch;
    const keyWeights: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (
      let channelIndex: number = 0;
      channelIndex < song.pitchChannelCount;
      channelIndex++
    ) {
      for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
        const pattern: Pattern | null = song.getPattern(channelIndex, barIndex);
        if (pattern != null) {
          for (const note of pattern.notes) {
            const prevPin: NotePin = note.pins[0];
            for (
              let pinIndex: number = 1;
              pinIndex < note.pins.length;
              pinIndex++
            ) {
              const nextPin: NotePin = note.pins[pinIndex];
              if (prevPin.interval == nextPin.interval) {
                let weight: number = nextPin.time - prevPin.time;
                weight += Math.max(
                  0,
                  Math.min(Config.partsPerBeat, nextPin.time + note.start) -
                    (prevPin.time + note.start),
                );
                weight *= nextPin.size + prevPin.size;
                for (const pitch of note.pitches) {
                  const key = (basePitch + prevPin.interval + pitch) % 12;
                  keyWeights[key] += weight;
                }
              }
            }
          }
        }
      }
    }

    let bestKey: number = 0;
    let bestKeyWeight: number = 0;
    for (let key: number = 0; key < 12; key++) {
      // Look for the root of the most prominent major or minor chord.
      const keyWeight: number =
        keyWeights[key] *
        (3 * keyWeights[(key + 7) % 12] +
          keyWeights[(key + 4) % 12] +
          keyWeights[(key + 3) % 12]);
      if (bestKeyWeight < keyWeight) {
        bestKeyWeight = keyWeight;
        bestKey = key;
      }
    }

    if (bestKey != song.composingKey) {
      song.composingKey = bestKey;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export function getRandomPresetValues(): number[] {
  const eligiblePresetValues: number[] = [];
  for (
    let categoryIndex: number = 0;
    categoryIndex < EditorConfig.presetCategories.length;
    categoryIndex++
  ) {
    const category: PresetCategory =
      EditorConfig.presetCategories[categoryIndex];
    if (category.name == "Novelty Presets") continue;
    for (
      let presetIndex: number = 0;
      presetIndex < category.presets.length;
      presetIndex++
    ) {
      const preset: Preset = category.presets[presetIndex];
      if (preset.settings != undefined) {
        eligiblePresetValues.push((categoryIndex << 6) + presetIndex);
      }
    }
  }
  return eligiblePresetValues;
}

export function pickRandomPresetValue(): number {
  const eligiblePresetValues: number[] = getRandomPresetValues();
  return eligiblePresetValues[
    (Math.random() * eligiblePresetValues.length) | 0
  ];
}

export function setDefaultInstruments(song: Song): void {
  for (
    let channelIndex: number = 0;
    channelIndex < song.channels.length;
    channelIndex++
  ) {
    for (const instrument of song.channels[channelIndex].instruments) {
      const isNoise: boolean = song.getChannelIsNoise(channelIndex);
      const presetValue: number =
        channelIndex == song.pitchChannelCount
          ? EditorConfig.nameToPresetValue(
              Math.random() > 0.5 ? "chip noise" : "standard drumset",
            )!
          : pickRandomPresetValue();
      const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
      instrument.fromSettingsObject(preset.settings, isNoise);
      instrument.preset = presetValue;
      instrument.volume = Config.volumeDefault;
    }
  }
}

export class ChangeSong extends ChangeGroup {
  constructor(doc: SongDocument, songData: Uint8Array | null) {
    super();
    if (songData == null) {
      doc.song.initToDefault(true);
      this.append(new ChangePatternSelection(doc, 0, 0));
      doc.selection.resetBoxSelection();
      setDefaultInstruments(doc.song);
      doc.song.scale = doc.prefs.rememberScaleChoice
        ? doc.prefs.defaultScale
        : 0;

      for (let i: number = 0; i <= doc.song.channels.length; i++) {
        doc.viewedInstrument[i] = 0;
      }
      doc.viewedInstrument.length = doc.song.channels.length;
    } else {
      doc.song.fromBinary(songData);
      this.append(new ChangeValidateTrackSelection(doc));
    }
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeValidateTrackSelection extends Change {
  constructor(doc: SongDocument) {
    super();
    const channelIndex: number = Math.min(
      doc.channel,
      doc.song.getChannelCount() - 1,
    );
    const bar: number = Math.max(0, Math.min(doc.song.barCount - 1, doc.bar));
    if (doc.channel != channelIndex || doc.bar != bar) {
      doc.bar = bar;
      doc.channel = channelIndex;
      this._didSomething();
    }
    doc.selection.scrollToSelectedPattern();
    doc.notifier.changed();
  }
}

export class ChangeReplacePatterns extends ChangeGroup {
  constructor(
    doc: SongDocument,
    pitchChannels: Channel[],
    noiseChannels: Channel[],
  ) {
    super();

    const song: Song = doc.song;

    function removeExtraSparseChannels(
      channels: Channel[],
      maxLength: number,
    ): void {
      while (channels.length > maxLength) {
        let sparsestIndex: number = channels.length - 1;
        let mostZeroes: number = 0;
        for (
          let channelIndex: number = 0;
          channelIndex < channels.length - 1;
          channelIndex++
        ) {
          let zeroes: number = 0;
          for (const bar of channels[channelIndex].bars) {
            if (bar == 0) zeroes++;
          }
          if (zeroes >= mostZeroes) {
            sparsestIndex = channelIndex;
            mostZeroes = zeroes;
          }
        }
        channels.splice(sparsestIndex, 1);
      }
    }

    removeExtraSparseChannels(pitchChannels, Config.pitchChannelCountMax);
    removeExtraSparseChannels(noiseChannels, Config.noiseChannelCountMax);

    while (pitchChannels.length < Config.pitchChannelCountMin)
      pitchChannels.push(new Channel());
    while (noiseChannels.length < Config.noiseChannelCountMin)
      noiseChannels.push(new Channel());

    // Set minimum counts.
    song.barCount = 1;
    song.patternsPerChannel = 8;
    const combinedChannels: Channel[] = pitchChannels.concat(noiseChannels);
    for (
      let channelIndex: number = 0;
      channelIndex < combinedChannels.length;
      channelIndex++
    ) {
      const channel: Channel = combinedChannels[channelIndex];
      song.barCount = Math.max(song.barCount, channel.bars.length);
      song.patternsPerChannel = Math.max(
        song.patternsPerChannel,
        channel.patterns.length,
      );
      song.channels[channelIndex] = channel;
    }
    song.channels.length = combinedChannels.length;
    song.pitchChannelCount = pitchChannels.length;
    song.noiseChannelCount = noiseChannels.length;

    song.barCount = Math.min(Config.barCountMax, song.barCount);
    song.patternsPerChannel = Math.min(
      Config.barCountMax,
      song.patternsPerChannel,
    );
    for (
      let channelIndex: number = 0;
      channelIndex < song.channels.length;
      channelIndex++
    ) {
      const channel: Channel = song.channels[channelIndex];

      for (
        let barIndex: number = 0;
        barIndex < channel.bars.length;
        barIndex++
      ) {
        if (
          channel.bars[barIndex] > song.patternsPerChannel ||
          channel.bars[barIndex] < 0
        ) {
          channel.bars[barIndex] = 0;
        }
      }
      while (channel.bars.length < song.barCount) {
        channel.bars.push(0);
      }
      channel.bars.length = song.barCount;

      if (channel.instruments.length > song.getMaxInstrumentsPerChannel()) {
        channel.instruments.length = song.getMaxInstrumentsPerChannel();
      }

      while (channel.patterns.length < song.patternsPerChannel) {
        channel.patterns.push(new Pattern());
      }
      channel.patterns.length = song.patternsPerChannel;
    }

    song.loopStart = Math.max(0, Math.min(song.barCount - 1, song.loopStart));
    song.loopLength = Math.min(song.barCount - song.loopStart, song.loopLength);

    this.append(new ChangeValidateTrackSelection(doc));
    doc.notifier.changed();
    this._didSomething();
  }
}

export function comparePatternNotes(a: Note[], b: Note[]): boolean {
  if (a.length != b.length) return false;

  for (let noteIndex: number = 0; noteIndex < a.length; noteIndex++) {
    const oldNote: Note = a[noteIndex];
    const newNote: Note = b[noteIndex];
    if (
      newNote.start != oldNote.start ||
      newNote.end != oldNote.end ||
      newNote.continuesLastPattern != oldNote.continuesLastPattern ||
      newNote.pitches.length != oldNote.pitches.length ||
      newNote.pins.length != oldNote.pins.length
    ) {
      return false;
    }

    for (
      let pitchIndex: number = 0;
      pitchIndex < oldNote.pitches.length;
      pitchIndex++
    ) {
      if (newNote.pitches[pitchIndex] != oldNote.pitches[pitchIndex]) {
        return false;
      }
    }

    for (let pinIndex: number = 0; pinIndex < oldNote.pins.length; pinIndex++) {
      if (
        newNote.pins[pinIndex].interval != oldNote.pins[pinIndex].interval ||
        newNote.pins[pinIndex].time != oldNote.pins[pinIndex].time ||
        newNote.pins[pinIndex].size != oldNote.pins[pinIndex].size
      ) {
        return false;
      }
    }
  }

  return true;
}

export function removeDuplicatePatterns(channels: Channel[]): void {
  for (const channel of channels) {
    const newPatterns: Pattern[] = [];
    for (let bar: number = 0; bar < channel.bars.length; bar++) {
      if (channel.bars[bar] == 0) continue;

      const oldPattern: Pattern = channel.patterns[channel.bars[bar] - 1];

      let foundMatchingPattern: boolean = false;
      for (
        let newPatternIndex: number = 0;
        newPatternIndex < newPatterns.length;
        newPatternIndex++
      ) {
        const newPattern: Pattern = newPatterns[newPatternIndex];

        if (newPattern.notes.length != oldPattern.notes.length) {
          continue;
        }

        if (comparePatternNotes(oldPattern.notes, newPattern.notes)) {
          foundMatchingPattern = true;
          channel.bars[bar] = newPatternIndex + 1;
          break;
        }
      }

      if (!foundMatchingPattern) {
        newPatterns.push(oldPattern);
        channel.bars[bar] = newPatterns.length;
      }
    }

    for (
      let patternIndex: number = 0;
      patternIndex < newPatterns.length;
      patternIndex++
    ) {
      channel.patterns[patternIndex] = newPatterns[patternIndex];
    }
    channel.patterns.length = newPatterns.length;
  }
}

export class ChangeTempo extends Change {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super();
    doc.song.tempo = Math.max(
      Config.tempoMin,
      Math.min(Config.tempoMax, Math.round(newValue)),
    );
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeEchoDelay extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.echoDelay = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeEchoSustain extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.echoSustain = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeChorus extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.chorus = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeReverb extends ChangeInstrumentSlider {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super(doc);
    this._instrument.reverb = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeNoteAdded extends UndoableChange {
  private _doc: SongDocument;
  private _pattern: Pattern;
  private _note: Note;
  private _index: number;
  constructor(
    doc: SongDocument,
    pattern: Pattern,
    note: Note,
    index: number,
    deletion: boolean = false,
  ) {
    super(deletion);
    this._doc = doc;
    this._pattern = pattern;
    this._note = note;
    this._index = index;
    this._didSomething();
    this.redo();
  }

  protected override _doForwards(): void {
    this._pattern.notes.splice(this._index, 0, this._note);
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._pattern.notes.splice(this._index, 1);
    this._doc.notifier.changed();
  }
}

export class ChangeNoteLength extends ChangePins {
  constructor(
    doc: SongDocument | null,
    note: Note,
    truncStart: number,
    truncEnd: number,
  ) {
    super(doc, note);
    const continuesLastPattern: boolean =
      (this._oldStart < 0 || note.continuesLastPattern) && truncStart == 0;

    truncStart -= this._oldStart;
    truncEnd -= this._oldStart;
    let setStart: boolean = false;
    let prevSize: number = this._oldPins[0].size;
    let prevInterval: number = this._oldPins[0].interval;
    let pushLastPin: boolean = true;
    let i: number;
    for (i = 0; i < this._oldPins.length; i++) {
      const oldPin: NotePin = this._oldPins[i];
      if (oldPin.time < truncStart) {
        prevSize = oldPin.size;
        prevInterval = oldPin.interval;
      } else {
        if (oldPin.time > truncStart && !setStart) {
          this._newPins.push(makeNotePin(prevInterval, truncStart, prevSize));
          setStart = true;
        }
        if (oldPin.time <= truncEnd) {
          this._newPins.push(
            makeNotePin(oldPin.interval, oldPin.time, oldPin.size),
          );
          if (oldPin.time == truncEnd) {
            pushLastPin = false;
            break;
          }
        } else {
          break;
        }
      }
    }

    if (pushLastPin)
      this._newPins.push(
        makeNotePin(this._oldPins[i].interval, truncEnd, this._oldPins[i].size),
      );

    this._finishSetup(continuesLastPattern);
  }
}

export class ChangeNoteTruncate extends ChangeSequence {
  constructor(
    doc: SongDocument,
    pattern: Pattern,
    start: number,
    end: number,
    skipNote?: Note,
  ) {
    super();
    let i: number = 0;
    while (i < pattern.notes.length) {
      const note: Note = pattern.notes[i];
      if (note == skipNote && skipNote != undefined) {
        i++;
      } else if (note.end <= start) {
        i++;
      } else if (note.start >= end) {
        break;
      } else if (note.start < start && note.end > end) {
        const copy: Note = note.clone();
        this.append(new ChangeNoteLength(doc, note, note.start, start));
        i++;
        this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
        this.append(new ChangeNoteLength(doc, copy, end, copy.end));
        i++;
      } else if (note.start < start) {
        this.append(new ChangeNoteLength(doc, note, note.start, start));
        i++;
      } else if (note.end > end) {
        this.append(new ChangeNoteLength(doc, note, end, note.end));
        i++;
      } else {
        this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
      }
    }
  }
}

class ChangeSplitNotesAtPoint extends UndoableChange {
  private _doc!: SongDocument;
  private _pattern!: Pattern;
  private _note!: Note;
  private _noteIndex!: number;
  private _oldEnd!: number;
  private _oldPins!: NotePin[];
  private _newPins!: NotePin[];
  private _splitNote!: Note;

  constructor(doc: SongDocument, pattern: Pattern, cutPoint: number) {
    super(false);

    for (let i: number = pattern.notes.length - 1; i >= 0; i--) {
      const note: Note = pattern.notes[i];
      if (!(note.start < cutPoint && cutPoint < note.end)) continue;

      // Separate the pins left and right of the cut point into two notes, also adjust the times.
      // Right note pins will need to be normalized by pitch and interval, but that means knowing the
      // exact values at the cutpoint.
      const cutRelativeToNote: number = cutPoint - note.start;
      const cutIndex: number = note.pins.findIndex(
        (pin: NotePin) => pin.time > cutRelativeToNote,
      );
      if (cutIndex == -1) break;

      const newPins: NotePin[] = note.pins
        .slice(0, cutIndex)
        .map((pin: NotePin) => makeNotePin(pin.interval, pin.time, pin.size));
      const splitNote: Note = note.clone();
      splitNote.continuesLastPattern = false;
      splitNote.start = cutPoint;
      splitNote.pins = splitNote.pins.slice(cutIndex);
      for (const pin of splitNote.pins) pin.time -= cutRelativeToNote;

      // Distance from the cutpoint determines interpolation bias for pitch and volume.
      const leftPin: NotePin = newPins[newPins.length - 1];
      const rightPin: NotePin = splitNote.pins[0];
      const spaceToLeftPin: number = cutRelativeToNote - leftPin.time;
      const spaceBetweenPins: number = spaceToLeftPin + rightPin.time;
      const percentBetweenPins: number =
        spaceBetweenPins > 0 ? spaceToLeftPin / spaceBetweenPins : 0;

      // Round the new pin's fractional values to make it legal, snapping to scale (if needed).
      const cutPitch: number =
        leftPin.interval +
        percentBetweenPins * (rightPin.interval - leftPin.interval);
      const cutPin: NotePin = makeNotePin(
        snapPitchToScale(doc, note.pitches[0] + cutPitch) - note.pitches[0],
        cutRelativeToNote,
        Math.round(
          leftPin.size + percentBetweenPins * (rightPin.size - leftPin.size),
        ),
      );

      // Note pitch must start at zero and pins get adjusted for the difference in starting pitch.
      splitNote.pitches = splitNote.pitches.map(
        (pitch: number) => pitch + cutPin.interval,
      );
      for (const pin of splitNote.pins) pin.interval -= cutPin.interval;

      // Notes need pins at their exact start/end. We cut the pins left and right earlier, but now
      // insert the cut pin as needed to the end of left note and start of right note.
      if (leftPin.time != cutRelativeToNote) {
        newPins.push(cutPin);
      } else {
        newPins[newPins.length - 1].interval = cutPin.interval; // adjusts to match scale snapping.
      }
      if (rightPin.time > 0)
        splitNote.pins.unshift(makeNotePin(0, 0, cutPin.size));

      this._doc = doc;
      this._pattern = pattern;
      this._note = note;
      this._noteIndex = i;
      this._oldEnd = note.end;
      this._oldPins = note.pins;
      this._newPins = newPins;
      this._splitNote = splitNote;
      this._didSomething();
      this.redo();
      break;
    }
  }

  protected override _doForwards(): void {
    this._note.end = this._splitNote.start;
    this._note.pins = this._newPins;
    this._pattern.notes.splice(this._noteIndex + 1, 0, this._splitNote);
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._pattern.notes.splice(this._noteIndex + 1, 1);
    this._note.end = this._oldEnd;
    this._note.pins = this._oldPins;
    this._doc.notifier.changed();
  }
}

class ChangeSplitNotesAtSelection extends ChangeSequence {
  constructor(doc: SongDocument, pattern: Pattern) {
    super();
    this.append(
      new ChangeSplitNotesAtPoint(
        doc,
        pattern,
        doc.selection.patternSelectionStart,
      ),
    );
    this.append(
      new ChangeSplitNotesAtPoint(
        doc,
        pattern,
        doc.selection.patternSelectionEnd,
      ),
    );
  }
}

class ChangeTransposeNote extends UndoableChange {
  protected _doc: SongDocument;
  protected _note: Note;
  protected _oldStart!: number;
  protected _newStart!: number;
  protected _oldEnd!: number;
  protected _newEnd!: number;
  protected _oldPins: NotePin[];
  protected _newPins: NotePin[];
  protected _oldPitches: number[];
  protected _newPitches: number[];
  constructor(
    doc: SongDocument,
    channelIndex: number,
    note: Note,
    upward: boolean,
    ignoreScale: boolean = false,
    octave: boolean = false,
  ) {
    super(false);
    this._doc = doc;
    this._note = note;
    this._oldPins = note.pins;
    this._newPins = [];
    this._oldPitches = note.pitches;
    this._newPitches = [];

    // I'm disabling pitch transposing for noise channels to avoid
    // accidentally messing up noise channels when pitch shifting all
    // channels at once.
    const isNoise: boolean = doc.song.getChannelIsNoise(channelIndex);
    if (isNoise != doc.song.getChannelIsNoise(doc.channel)) return;

    const maxPitch: number = isNoise ? Config.drumCount - 1 : Config.maxPitch;

    for (let i: number = 0; i < this._oldPitches.length; i++) {
      let pitch: number = this._oldPitches[i];
      if (octave && !isNoise) {
        if (upward) {
          pitch = Math.min(maxPitch, pitch + 12);
        } else {
          pitch = Math.max(0, pitch - 12);
        }
      } else {
        if (upward) {
          for (let j: number = pitch + 1; j <= maxPitch; j++) {
            if (
              isNoise ||
              ignoreScale ||
              pitchIsInScale(doc, j)
            ) {
              pitch = j;
              break;
            }
          }
        } else {
          for (let j: number = pitch - 1; j >= 0; j--) {
            if (
              isNoise ||
              ignoreScale ||
              pitchIsInScale(doc, j)
            ) {
              pitch = j;
              break;
            }
          }
        }
      }

      let foundMatch: boolean = false;
      for (let j: number = 0; j < this._newPitches.length; j++) {
        if (this._newPitches[j] == pitch) {
          foundMatch = true;
          break;
        }
      }
      if (!foundMatch) this._newPitches.push(pitch);
    }

    let min: number = 0;
    let max: number = maxPitch;

    for (let i: number = 1; i < this._newPitches.length; i++) {
      const diff: number = this._newPitches[0] - this._newPitches[i];
      if (min < diff) min = diff;
      if (max > diff + maxPitch) max = diff + maxPitch;
    }

    for (const oldPin of this._oldPins) {
      let interval: number = oldPin.interval + this._oldPitches[0];

      if (interval < min) interval = min;
      if (interval > max) interval = max;
      if (octave && !isNoise) {
        if (upward) {
          interval = Math.min(max, interval + 12);
        } else {
          interval = Math.max(min, interval - 12);
        }
      } else {
        if (upward) {
          for (let i: number = interval + 1; i <= max; i++) {
            if (
              isNoise ||
              ignoreScale ||
              pitchIsInScale(doc, i)
            ) {
              interval = i;
              break;
            }
          }
        } else {
          for (let i: number = interval - 1; i >= min; i--) {
            if (
              isNoise ||
              ignoreScale ||
              pitchIsInScale(doc, i)
            ) {
              interval = i;
              break;
            }
          }
        }
      }
      interval -= this._newPitches[0];
      this._newPins.push(makeNotePin(interval, oldPin.time, oldPin.size));
    }

    if (this._newPins[0].interval != 0)
      throw new Error("wrong pin start interval");

    for (let i: number = 1; i < this._newPins.length - 1;) {
      if (
        this._newPins[i - 1].interval == this._newPins[i].interval &&
        this._newPins[i].interval == this._newPins[i + 1].interval &&
        this._newPins[i - 1].size == this._newPins[i].size &&
        this._newPins[i].size == this._newPins[i + 1].size
      ) {
        this._newPins.splice(i, 1);
      } else {
        i++;
      }
    }

    this._doForwards();
    this._didSomething();
  }

  protected override _doForwards(): void {
    this._note.pins = this._newPins;
    this._note.pitches = this._newPitches;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._note.pins = this._oldPins;
    this._note.pitches = this._oldPitches;
    this._doc.notifier.changed();
  }
}

export class ChangeTranspose extends ChangeSequence {
  constructor(
    doc: SongDocument,
    channelIndex: number,
    pattern: Pattern,
    upward: boolean,
    ignoreScale: boolean = false,
    octave: boolean = false,
  ) {
    super();
    if (doc.selection.patternSelectionActive) {
      this.append(new ChangeSplitNotesAtSelection(doc, pattern));
    }
    for (const note of pattern.notes) {
      if (
        doc.selection.patternSelectionActive &&
        (note.end <= doc.selection.patternSelectionStart ||
          note.start >= doc.selection.patternSelectionEnd)
      ) {
        continue;
      }
      this.append(
        new ChangeTransposeNote(
          doc,
          channelIndex,
          note,
          upward,
          ignoreScale,
          octave,
        ),
      );
    }
  }
}

export class ChangeTrackSelection extends Change {
  constructor(
    doc: SongDocument,
    newX0: number,
    newX1: number,
    newY0: number,
    newY1: number,
  ) {
    super();
    doc.selection.boxSelectionX0 = newX0;
    doc.selection.boxSelectionX1 = newX1;
    doc.selection.boxSelectionY0 = newY0;
    doc.selection.boxSelectionY1 = newY1;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangePatternSelection extends UndoableChange {
  private _doc: SongDocument;
  private _oldStart: number;
  private _oldEnd: number;
  private _oldActive: boolean;
  private _newStart: number;
  private _newEnd: number;
  private _newActive: boolean;

  constructor(doc: SongDocument, newStart: number, newEnd: number) {
    super(false);
    this._doc = doc;
    this._oldStart = doc.selection.patternSelectionStart;
    this._oldEnd = doc.selection.patternSelectionEnd;
    this._oldActive = doc.selection.patternSelectionActive;
    this._newStart = newStart;
    this._newEnd = newEnd;
    this._newActive = newStart < newEnd;
    this._doForwards();
    this._didSomething();
  }

  protected override _doForwards(): void {
    this._doc.selection.patternSelectionStart = this._newStart;
    this._doc.selection.patternSelectionEnd = this._newEnd;
    this._doc.selection.patternSelectionActive = this._newActive;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._doc.selection.patternSelectionStart = this._oldStart;
    this._doc.selection.patternSelectionEnd = this._oldEnd;
    this._doc.selection.patternSelectionActive = this._oldActive;
    this._doc.notifier.changed();
  }
}

export class ChangeDragSelectedNotes extends ChangeSequence {
  constructor(
    doc: SongDocument,
    channelIndex: number,
    pattern: Pattern,
    parts: number,
    transpose: number,
  ) {
    super();

    if (parts == 0 && transpose == 0) return;
    if (doc.selection.patternSelectionActive) {
      this.append(new ChangeSplitNotesAtSelection(doc, pattern));
    }

    const oldStart: number = doc.selection.patternSelectionStart;
    const oldEnd: number = doc.selection.patternSelectionEnd;
    const newStart: number = Math.max(
      0,
      Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldStart + parts),
    );
    const newEnd: number = Math.max(
      0,
      Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldEnd + parts),
    );
    if (newStart == newEnd) {
      // Just erase the current contents of the selection:
      this.append(new ChangeNoteTruncate(doc, pattern, oldStart, oldEnd));
    } else if (parts < 0) {
      // Clear space for the dragged notes:
      this.append(
        new ChangeNoteTruncate(
          doc,
          pattern,
          newStart,
          Math.min(oldStart, newEnd),
        ),
      );
    } else {
      // Clear space for the dragged notes:
      this.append(
        new ChangeNoteTruncate(
          doc,
          pattern,
          Math.max(oldEnd, newStart),
          newEnd,
        ),
      );
    }

    this.append(new ChangePatternSelection(doc, newStart, newEnd));
    const draggedNotes = [];
    let noteInsertionIndex: number = 0;
    let i: number = 0;
    while (i < pattern.notes.length) {
      const note: Note = pattern.notes[i];
      if (note.end <= oldStart || note.start >= oldEnd) {
        i++;
        if (note.end <= newStart) noteInsertionIndex = i;
      } else {
        draggedNotes.push(note.clone());
        this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
      }
    }

    for (const note of draggedNotes) {
      note.start += parts;
      note.end += parts;
      if (note.end <= newStart) continue;
      if (note.start >= newEnd) continue;

      this.append(
        new ChangeNoteAdded(doc, pattern, note, noteInsertionIndex++, false),
      );

      this.append(
        new ChangeNoteLength(
          doc,
          note,
          Math.max(note.start, newStart),
          Math.min(newEnd, note.end),
        ),
      );

      for (let i: number = 0; i < Math.abs(transpose); i++) {
        this.append(
          new ChangeTransposeNote(
            doc,
            channelIndex,
            note,
            transpose > 0,
            doc.prefs.notesOutsideScale,
          ),
        );
      }
    }
  }
}

export class ChangeDuplicateSelectedReusedPatterns extends ChangeGroup {
  constructor(
    doc: SongDocument,
    barStart: number,
    barWidth: number,
    channelStart: number,
    channelHeight: number,
  ) {
    super();
    for (
      let channelIndex: number = channelStart;
      channelIndex < channelStart + channelHeight;
      channelIndex++
    ) {
      const reusablePatterns: Dictionary<number> = {};

      for (let bar: number = barStart; bar < barStart + barWidth; bar++) {
        const currentPatternIndex: number =
          doc.song.channels[channelIndex].bars[bar];
        if (currentPatternIndex == 0) continue;

        if (reusablePatterns[String(currentPatternIndex)] == undefined) {
          let isUsedElsewhere = false;
          for (let bar2: number = 0; bar2 < doc.song.barCount; bar2++) {
            if (bar2 < barStart || bar2 >= barStart + barWidth) {
              if (
                doc.song.channels[channelIndex].bars[bar2] ==
                currentPatternIndex
              ) {
                isUsedElsewhere = true;
                break;
              }
            }
          }
          if (isUsedElsewhere) {
            // Need to duplicate the pattern.
            const copiedPattern: Pattern = doc.song.getPattern(
              channelIndex,
              bar,
            )!;
            this.append(
              new ChangePatternNumbers(doc, 0, bar, channelIndex, 1, 1),
            );
            this.append(new ChangeEnsurePatternExists(doc, channelIndex, bar));
            const newPattern: Pattern | null = doc.song.getPattern(
              channelIndex,
              bar,
            );
            if (newPattern == null) throw new Error();
            this.append(
              new ChangePaste(
                doc,
                newPattern,
                copiedPattern.notes,
                0,
                Config.partsPerBeat * doc.song.beatsPerBar,
                Config.partsPerBeat * doc.song.beatsPerBar,
              ),
            );

            reusablePatterns[String(currentPatternIndex)] =
              doc.song.channels[channelIndex].bars[bar];
          } else {
            reusablePatterns[String(currentPatternIndex)] = currentPatternIndex;
          }
        }

        this.append(
          new ChangePatternNumbers(
            doc,
            reusablePatterns[String(currentPatternIndex)],
            bar,
            channelIndex,
            1,
            1,
          ),
        );
      }
    }
  }
}

export class ChangeVolume extends Change {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super();
    doc.song.channels[doc.channel].instruments[
      doc.getCurrentInstrument()
    ].volume = newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangePan extends Change {
  constructor(doc: SongDocument, oldValue: number, newValue: number) {
    super();
    doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()].pan =
      newValue;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }
}

export class ChangeSizeBend extends UndoableChange {
  private _doc: SongDocument;
  private _note: Note;
  private _oldPins: NotePin[];
  private _newPins: NotePin[];
  constructor(
    doc: SongDocument,
    note: Note,
    bendPart: number,
    bendSize: number,
    bendInterval: number,
    uniformSize: boolean,
  ) {
    super(false);
    this._doc = doc;
    this._note = note;
    this._oldPins = note.pins;
    this._newPins = [];

    let inserted: boolean = false;

    for (const pin of note.pins) {
      if (pin.time < bendPart) {
        if (uniformSize) {
          this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
        } else {
          this._newPins.push(pin);
        }
      } else if (pin.time == bendPart) {
        this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
        inserted = true;
      } else {
        if (!uniformSize && !inserted) {
          this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
          inserted = true;
        }
        if (uniformSize) {
          this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
        } else {
          this._newPins.push(pin);
        }
      }
    }

    removeRedundantPins(this._newPins);

    this._doForwards();
    this._didSomething();
  }

  protected override _doForwards(): void {
    this._note.pins = this._newPins;
    this._doc.notifier.changed();
  }

  protected override _doBackwards(): void {
    this._note.pins = this._oldPins;
    this._doc.notifier.changed();
  }
}

export class ChangeChipWave extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    if (instrument.chipWave != newValue) {
      instrument.chipWave = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeSoundFont extends Change {
  constructor(doc: SongDocument, newValue: string | null) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    if (instrument.soundFontId != newValue) {
      instrument.soundFontId = newValue;
      instrument.soundFontPreset = 0;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeSoundFontPreset extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    if (instrument.soundFontPreset != newValue) {
      instrument.soundFontPreset = Math.max(0, newValue | 0);
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export function applySoundFontPreset(
  instrument: Instrument,
  soundFontId: string,
  preset: SoundFontPresetInfo,
  tempo: number,
  isNoiseChannel: boolean,
): void {
  const volume: number = instrument.volume;
  instrument.setTypeAndReset(InstrumentType.soundFont, isNoiseChannel);
  instrument.soundFontId = soundFontId;
  instrument.soundFontPreset = preset.index;
  instrument.volume = volume;
  instrument.pan = preset.settings.pan;
  instrument.fadeIn = Synth.secondsToFadeInSetting(
    preset.settings.fadeInSeconds,
  );
  const releaseTicks: number =
    (preset.settings.fadeOutSeconds *
      tempo *
      Config.ticksPerPart *
      Config.partsPerBeat) /
    60;
  instrument.fadeOut = Synth.ticksToFadeOutSetting(
    releaseTicks < 1 ? -1 : releaseTicks,
  );
  if (preset.settings.vibrato != "none") {
    instrument.effects |= 1 << EffectType.vibrato;
    instrument.vibrato =
      Config.vibratos.dictionary[preset.settings.vibrato].index;
  }
  if (preset.settings.filterCutoffHz != null) {
    instrument.effects |= 1 << EffectType.noteFilter;
    instrument.noteFilter.addPoint(
      FilterType.lowPass,
      FilterControlPoint.getRoundedSettingValueFromHz(
        preset.settings.filterCutoffHz,
      ),
      FilterControlPoint.getRoundedSettingValueFromLinearGain(
        preset.settings.filterGain,
      ),
    );
  }
  for (const envelope of preset.settings.envelopes) {
    const target =
      Config.instrumentAutomationTargets.dictionary[envelope.target];
    if (!instrument.supportsEnvelopeTarget(target.index, 0)) continue;
    const speed: number =
      envelope.envelope == "tremolo"
        ? (envelope.speed * 60) / tempo
        : envelope.speed;
    instrument.addEnvelope(
      target.index,
      0,
      Config.envelopes.dictionary[envelope.envelope].index,
      speed,
      envelope.a,
      envelope.b,
    );
  }
  instrument.preset = InstrumentType.soundFont;
}

export class ChangeSoundFontPresetSelection extends Change {
  constructor(doc: SongDocument, soundFontId: string, presetIndex: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const asset = doc.song.assets.find(
      (candidate) =>
        candidate.type == "soundFont" && candidate.id == soundFontId,
    );
    if (asset == undefined) return;
    const nextPreset = Math.max(0, presetIndex | 0);
    const preset = doc.synth
      .getSoundFontPresets(soundFontId)
      ?.find((candidate) => candidate.index == nextPreset);
    if (preset == undefined) return;
    applySoundFontPreset(
      instrument,
      soundFontId,
      preset,
      doc.song.tempo,
      doc.song.getChannelIsNoise(doc.channel),
    );
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeSamplePresetSelection extends Change {
  constructor(doc: SongDocument, sampleId: string) {
    super();
    const asset = doc.song.assets.find(
      (candidate) => candidate.type == "sample" && candidate.id == sampleId,
    );
    const chipWave = Config.chipWaves.find(
      (candidate) => candidate.sampleId == sampleId,
    );
    if (asset == undefined || chipWave == undefined) return;
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const volume: number = instrument.volume;
    const pan: number = instrument.pan;
    instrument.setTypeAndReset(
      InstrumentType.chip,
      doc.song.getChannelIsNoise(doc.channel),
    );
    instrument.chipWave = chipWave.index;
    instrument.volume = volume;
    instrument.pan = pan;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeNoiseWave extends Change {
  constructor(doc: SongDocument, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    if (instrument.chipNoise != newValue) {
      instrument.chipNoise = newValue;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeAddEnvelope extends Change {
  constructor(doc: SongDocument) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    instrument.addEnvelope(0, 0, 0);
    instrument.preset = instrument.type;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeRemoveEnvelope extends Change {
  constructor(doc: SongDocument, index: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    instrument.envelopeCount--;
    for (let i: number = index; i < instrument.envelopeCount; i++) {
      instrument.envelopes[i].target = instrument.envelopes[i + 1].target;
      instrument.envelopes[i].index = instrument.envelopes[i + 1].index;
      instrument.envelopes[i].envelope = instrument.envelopes[i + 1].envelope;
      instrument.envelopes[i].speed = instrument.envelopes[i + 1].speed;
      instrument.envelopes[i].a = instrument.envelopes[i + 1].a;
      instrument.envelopes[i].b = instrument.envelopes[i + 1].b;
    }
    // TODO: Shift any envelopes that were targeting other envelope indices after the removed one.
    instrument.preset = instrument.type;
    doc.notifier.changed();
    this._didSomething();
  }
}

export class ChangeSetEnvelopeTarget extends Change {
  constructor(
    doc: SongDocument,
    envelopeIndex: number,
    target: number,
    targetIndex: number,
  ) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldTarget: number = instrument.envelopes[envelopeIndex].target;
    const oldIndex: number = instrument.envelopes[envelopeIndex].index;
    if (oldTarget != target || oldIndex != targetIndex) {
      instrument.envelopes[envelopeIndex].target = target;
      instrument.envelopes[envelopeIndex].index = targetIndex;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeSetEnvelopeType extends Change {
  constructor(doc: SongDocument, envelopeIndex: number, newValue: number) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    const oldValue: number = instrument.envelopes[envelopeIndex].envelope;
    if (oldValue != newValue) {
      instrument.envelopes[envelopeIndex].envelope = newValue;
      instrument.envelopes[envelopeIndex].speed =
        Config.envelopes[newValue].speed;
      instrument.envelopes[envelopeIndex].a = Config.envelopes[newValue].a;
      instrument.envelopes[envelopeIndex].b = Config.envelopes[newValue].b;
      instrument.preset = instrument.type;
      doc.notifier.changed();
      this._didSomething();
    }
  }
}

export class ChangeSetEnvelopeParameter extends Change {
  constructor(
    doc: SongDocument,
    envelopeIndex: number,
    parameter: "speed" | "a" | "b",
    oldValue: number,
    newValue: number,
  ) {
    super();
    const instrument: Instrument =
      doc.song.channels[doc.channel].instruments[doc.getCurrentInstrument()];
    instrument.envelopes[envelopeIndex][parameter] = newValue;
    instrument.preset = instrument.type;
    doc.notifier.changed();
    if (oldValue != newValue) this._didSomething();
  }

  public override commit(): void {
    // Parameter changes are already applied prospectively while dragging.
  }
}
