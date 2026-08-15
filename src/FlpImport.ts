// Distributed under the Unlicense.

import { Config, InstrumentType } from "../synth/SynthConfig.js";
import {
  Channel,
  Instrument,
  Note,
  Pattern,
  makeNotePin,
} from "../synth/synth.js";
import {
  FlpImportError,
  type FlpArrangement,
  type FlpChannel,
  type FlpChannelPlugin,
  type FlpProject,
  parseFlpProject,
} from "./FlpParser.js";

interface ArrangedFlpNote {
  readonly start: number;
  readonly end: number;
  readonly pitch: number;
  readonly size: number;
  readonly order: number;
  readonly pins: readonly FlpBendPoint[];
}

interface ExpandedFlpNote {
  readonly start: number;
  readonly end: number;
  readonly pitch: number;
  readonly size: number;
  readonly order: number;
  readonly channelId: number;
  readonly midiChannel: number;
  readonly slide: boolean;
  pins: FlpBendPoint[];
}

interface FlpBendPoint {
  readonly time: number;
  readonly interval: number;
}

interface ArrangedChord {
  readonly start: number;
  readonly end: number;
  readonly pitches: number[];
  readonly size: number;
  readonly order: number;
  readonly pins: readonly FlpBendPoint[];
}

export interface FlpSongImport {
  readonly tempo: number;
  readonly beatsPerBar: number;
  readonly barCount: number;
  readonly pitchChannels: Channel[];
  readonly noiseChannels: Channel[];
  readonly channelSources: FlpChannelSource[];
  readonly arrangementId: number;
}

export interface FlpChannelSource {
  readonly sourceChannelId: number;
  readonly name: string | undefined;
  readonly kind: FlpChannel["kind"] | undefined;
  readonly samplePath: string | undefined;
  readonly plugin: FlpChannelPlugin | undefined;
  readonly playlistTracks: readonly number[];
  readonly playlistTrackNames: readonly string[];
  readonly laneIndex: number;
  readonly laneCount: number;
}

function selectArrangement(project: FlpProject): FlpArrangement | undefined {
  if (project.currentArrangementId != undefined) {
    const current: FlpArrangement | undefined = project.arrangements.find(
      (arrangement: FlpArrangement): boolean =>
        arrangement.id == project.currentArrangementId,
    );
    if (current != undefined) return current;
  }
  return (
    project.arrangements.find(
      (arrangement: FlpArrangement): boolean => arrangement.clips.length > 0,
    ) ?? project.arrangements[0]
  );
}

function quantizeFlTickToPart(flTick: number, ppq: number): number {
  // Both operands are integers small enough for this multiplication to remain
  // exact. Rounding absolute endpoints once avoids accumulating clip/offset
  // rounding errors.
  return Math.floor((flTick * Config.partsPerBeat + ppq / 2) / ppq);
}

function velocityToNoteSize(velocity: number): number {
  if (velocity <= 0) return 0;
  return Math.max(
    1,
    Math.min(
      Config.noteSizeMax,
      Math.round((velocity * Config.noteSizeMax) / 127),
    ),
  );
}

function pitchToEditorPitch(key: number): number {
  return clampEditorPitch(key - Config.keys.dictionary["C"].basePitch);
}

function clampEditorPitch(pitch: number): number {
  return Math.max(0, Math.min(Config.maxPitch, pitch));
}

function bendIntervalAt(pins: readonly FlpBendPoint[], time: number): number {
  if (time <= pins[0].time) return pins[0].interval;
  for (let index = 1; index < pins.length; index++) {
    const next: FlpBendPoint = pins[index];
    if (time > next.time) continue;
    const previous: FlpBendPoint = pins[index - 1];
    if (next.time == previous.time) return next.interval;
    const ratio: number = (time - previous.time) / (next.time - previous.time);
    return previous.interval + ratio * (next.interval - previous.interval);
  }
  return pins[pins.length - 1].interval;
}

function pushBendPoint(
  pins: FlpBendPoint[],
  time: number,
  interval: number,
): void {
  if (pins.length > 0 && pins[pins.length - 1].time == time) {
    pins[pins.length - 1] = { time, interval };
  } else {
    pins.push({ time, interval });
  }
}

function applyFlSlides(events: readonly ExpandedFlpNote[]): ExpandedFlpNote[] {
  const notes: ExpandedFlpNote[] = events.filter(
    (event: ExpandedFlpNote): boolean => !event.slide,
  );
  const slides: ExpandedFlpNote[] = events
    .filter((event: ExpandedFlpNote): boolean => event.slide)
    .sort(
      (a: ExpandedFlpNote, b: ExpandedFlpNote): number =>
        a.start - b.start || a.order - b.order,
    );

  for (const slide of slides) {
    // FL slide notes are silent. They bend already-sounding notes of the same
    // color, using the highest affected pitch as the chord's reference.
    const affected: ExpandedFlpNote[] = notes.filter(
      (note: ExpandedFlpNote): boolean =>
        note.channelId == slide.channelId &&
        note.midiChannel == slide.midiChannel &&
        note.start <= slide.start &&
        slide.start < note.end,
    );
    if (affected.length == 0) continue;

    const referencePitch: number = Math.max(
      ...affected.map((note: ExpandedFlpNote): number => note.pitch),
    );
    const targetInterval: number = slide.pitch - referencePitch;
    for (const note of affected) {
      const startInterval: number = bendIntervalAt(note.pins, slide.start);
      const bendEnd: number = Math.min(slide.end, note.end);
      const completion: number =
        (bendEnd - slide.start) / (slide.end - slide.start);
      const endInterval: number =
        startInterval + completion * (targetInterval - startInterval);
      const pins: FlpBendPoint[] = note.pins.filter(
        (pin: FlpBendPoint): boolean => pin.time < slide.start,
      );
      pushBendPoint(pins, slide.start, startInterval);
      pushBendPoint(pins, bendEnd, endInterval);
      if (bendEnd < note.end) {
        pushBendPoint(pins, note.end, endInterval);
      }
      note.pins = pins;
    }
  }

  return notes;
}

function quantizeExpandedNote(
  note: ExpandedFlpNote,
  clippedStart: number,
  clippedEnd: number,
  ppq: number,
  order: number,
): ArrangedFlpNote {
  const start: number = quantizeFlTickToPart(clippedStart, ppq);
  let end: number = quantizeFlTickToPart(clippedEnd, ppq);
  if (end <= start) end = start + 1;

  const rawPins: FlpBendPoint[] = [
    { time: clippedStart, interval: bendIntervalAt(note.pins, clippedStart) },
    ...note.pins.filter(
      (pin: FlpBendPoint): boolean =>
        clippedStart < pin.time && pin.time < clippedEnd,
    ),
    { time: clippedEnd, interval: bendIntervalAt(note.pins, clippedEnd) },
  ];
  const absolutePins: FlpBendPoint[] = [];
  for (const pin of rawPins) {
    const time: number = Math.max(
      start,
      Math.min(end, quantizeFlTickToPart(pin.time, ppq)),
    );
    const pitch: number = clampEditorPitch(
      note.pitch + Math.round(pin.interval),
    );
    pushBendPoint(absolutePins, time, pitch);
  }
  if (absolutePins[absolutePins.length - 1].time < end) {
    pushBendPoint(
      absolutePins,
      end,
      absolutePins[absolutePins.length - 1].interval,
    );
  }

  const pitch: number = absolutePins[0].interval;
  return {
    start,
    end,
    pitch,
    size: note.size,
    order,
    pins: absolutePins.map((pin: FlpBendPoint): FlpBendPoint => ({
      time: pin.time,
      interval: pin.interval - pitch,
    })),
  };
}

function notesToChords(notes: readonly ArrangedFlpNote[]): ArrangedChord[] {
  const chords: ArrangedChord[] = [];
  const groups = new Map<string, ArrangedChord[]>();

  for (const note of notes) {
    const key = `${note.start}:${note.end}:${note.size}:${note.pins
      .map((pin: FlpBendPoint): string => `${pin.time},${pin.interval}`)
      .join(";")}`;
    let compatible: ArrangedChord | undefined;
    const candidates: ArrangedChord[] | undefined = groups.get(key);
    if (candidates != undefined) {
      compatible = candidates.find(
        (candidate: ArrangedChord): boolean =>
          candidate.pitches.length < Config.maxChordSize &&
          candidate.pitches.indexOf(note.pitch) == -1,
      );
    }

    if (compatible == undefined) {
      compatible = {
        start: note.start,
        end: note.end,
        pitches: [],
        size: note.size,
        order: note.order,
        pins: note.pins,
      };
      chords.push(compatible);
      if (candidates == undefined) groups.set(key, [compatible]);
      else candidates.push(compatible);
    }
    compatible.pitches.push(note.pitch);
  }

  chords.sort(
    (a: ArrangedChord, b: ArrangedChord): number =>
      a.start - b.start || a.end - b.end || a.order - b.order,
  );
  return chords;
}

function splitOverlaps(chords: readonly ArrangedChord[]): ArrangedChord[][] {
  const lanes: ArrangedChord[][] = [];
  const laneEnds: number[] = [];

  for (const chord of chords) {
    let laneIndex = -1;
    let earliestAvailableEnd = Number.POSITIVE_INFINITY;
    for (let i = 0; i < laneEnds.length; i++) {
      const laneEnd: number = laneEnds[i];
      if (laneEnd <= chord.start && laneEnd < earliestAvailableEnd) {
        laneIndex = i;
        earliestAvailableEnd = laneEnd;
      }
    }
    if (laneIndex == -1) {
      laneIndex = lanes.length;
      lanes.push([]);
      laneEnds.push(0);
    }
    lanes[laneIndex].push(chord);
    laneEnds[laneIndex] = chord.end;
  }

  return lanes;
}

function makeChannel(
  lane: readonly ArrangedChord[],
  barCount: number,
  partsPerBar: number,
): Channel {
  const channel = new Channel();
  const instrument = new Instrument(false);
  instrument.setTypeAndReset(InstrumentType.chip, false);
  instrument.effects = 0;
  instrument.chord = Config.chords.dictionary["simultaneous"].index;
  channel.instruments.push(instrument);
  for (let bar = 0; bar < barCount; bar++) channel.bars.push(0);

  const patternsByBar = new Map<number, Pattern>();
  let pitchSum = 0;
  let pitchCount = 0;

  for (const chord of lane) {
    for (const pitch of chord.pitches) {
      const weight: number = chord.end - chord.start;
      pitchSum += pitch * weight;
      pitchCount += weight;
    }

    const firstBar: number = Math.floor(chord.start / partsPerBar);
    const lastBar: number = Math.ceil(chord.end / partsPerBar);
    for (let bar = firstBar; bar < lastBar && bar < barCount; bar++) {
      const barStart: number = bar * partsPerBar;
      const start: number = Math.max(chord.start, barStart) - barStart;
      const end: number =
        Math.min(chord.end, barStart + partsPerBar) - barStart;
      if (start >= end) continue;

      let pattern: Pattern | undefined = patternsByBar.get(bar);
      if (pattern == undefined) {
        pattern = new Pattern();
        patternsByBar.set(bar, pattern);
        channel.patterns.push(pattern);
        channel.bars[bar] = channel.patterns.length;
      }

      const absoluteStart: number = barStart + start;
      const absoluteEnd: number = barStart + end;
      const startInterval: number = Math.round(
        bendIntervalAt(chord.pins, absoluteStart),
      );
      const note = new Note(
        chord.pitches[0] + startInterval,
        start,
        end,
        chord.size,
      );
      note.pitches = chord.pitches.map(
        (pitch: number): number => pitch + startInterval,
      );
      const segmentPins: FlpBendPoint[] = [
        {
          time: absoluteStart,
          interval: startInterval,
        },
        ...chord.pins.filter(
          (pin: FlpBendPoint): boolean =>
            absoluteStart < pin.time && pin.time < absoluteEnd,
        ),
        {
          time: absoluteEnd,
          interval: bendIntervalAt(chord.pins, absoluteEnd),
        },
      ];
      note.pins = segmentPins.map((pin: FlpBendPoint) =>
        makeNotePin(
          Math.round(pin.interval) - startInterval,
          pin.time - absoluteStart,
          chord.size,
        ),
      );
      note.continuesLastPattern = chord.start < barStart && start == 0;
      pattern.notes.push(note);
    }
  }

  const averagePitch: number = pitchCount == 0 ? 0 : pitchSum / pitchCount;
  channel.octave = Math.max(
    0,
    Math.min(Config.pitchOctaves - 1, Math.floor(averagePitch / 12)),
  );
  return channel;
}

function expandArrangement(
  project: FlpProject,
  arrangement: FlpArrangement,
): {
  readonly notesByChannel: Map<number, ArrangedFlpNote[]>;
  readonly tracksByChannel: Map<number, Set<number>>;
  readonly arrangementEndPart: number;
} {
  const patternsById = new Map(
    project.patterns.map((pattern) => [pattern.id, pattern] as const),
  );
  const notesByChannel = new Map<number, ArrangedFlpNote[]>();
  const tracksByChannel = new Map<number, Set<number>>();
  let arrangementEndTick = 0;
  let order = 0;

  for (const clip of arrangement.clips) {
    const pattern = patternsById.get(clip.patternId);
    if (pattern == undefined || clip.length == 0) continue;

    const clipEndTick: number = clip.position + clip.length;
    arrangementEndTick = Math.max(arrangementEndTick, clipEndTick);
    const sourceStart: number = clip.startOffset ?? 0;
    const sourceEnd: number = Math.min(
      sourceStart + clip.length,
      clip.endOffset ?? Number.POSITIVE_INFINITY,
    );
    if (sourceEnd <= sourceStart) continue;

    const expandedNotes: ExpandedFlpNote[] = pattern.notes.map(
      (flNote, noteOrder: number): ExpandedFlpNote => {
        const start: number = clip.position + flNote.position - sourceStart;
        const end: number = start + Math.max(1, flNote.length);
        return {
          start,
          end,
          pitch: pitchToEditorPitch(flNote.key),
          size: velocityToNoteSize(flNote.velocity),
          order: noteOrder,
          channelId: flNote.channelId,
          midiChannel: flNote.midiChannel,
          slide: flNote.slide,
          pins: [
            { time: start, interval: 0 },
            { time: end, interval: 0 },
          ],
        };
      },
    );
    for (const expanded of applyFlSlides(expandedNotes)) {
      // FL uses zero-length note records for Channel Rack/step-sequencer
      // triggers. They are still musical events, so retain them as the
      // shortest note goopbox can represent.
      const clippedStart: number = Math.max(expanded.start, clip.position);
      const clippedEnd: number = Math.min(
        expanded.end,
        clip.position + sourceEnd - sourceStart,
      );
      if (clippedStart >= clippedEnd) continue;

      const arranged: ArrangedFlpNote = quantizeExpandedNote(
        expanded,
        clippedStart,
        clippedEnd,
        project.ppq,
        order++,
      );
      let channelNotes: ArrangedFlpNote[] | undefined = notesByChannel.get(
        expanded.channelId,
      );
      if (channelNotes == undefined) {
        channelNotes = [];
        notesByChannel.set(expanded.channelId, channelNotes);
      }
      channelNotes.push(arranged);
      let channelTracks: Set<number> | undefined = tracksByChannel.get(
        expanded.channelId,
      );
      if (channelTracks == undefined) {
        channelTracks = new Set<number>();
        tracksByChannel.set(expanded.channelId, channelTracks);
      }
      channelTracks.add(clip.track);
    }
  }

  return {
    notesByChannel,
    tracksByChannel,
    arrangementEndPart: quantizeFlTickToPart(arrangementEndTick, project.ppq),
  };
}

export function convertFlpProject(project: FlpProject): FlpSongImport {
  const arrangement: FlpArrangement | undefined = selectArrangement(project);
  if (arrangement == undefined) {
    throw new FlpImportError("empty", "FLP contained no playlist arrangement.");
  }

  const beatsPerBar: number = Math.max(
    Config.beatsPerBarMin,
    Math.min(Config.beatsPerBarMax, project.beatsPerBar),
  );
  const partsPerBar: number = beatsPerBar * Config.partsPerBeat;
  const { notesByChannel, tracksByChannel, arrangementEndPart } =
    expandArrangement(project, arrangement);
  if (notesByChannel.size == 0) {
    throw new FlpImportError("empty", "FLP contained no importable note data.");
  }

  let finalNoteEnd = 0;
  for (const notes of notesByChannel.values()) {
    for (const note of notes) finalNoteEnd = Math.max(finalNoteEnd, note.end);
  }
  const songEndPart: number = Math.max(arrangementEndPart, finalNoteEnd, 1);
  const barCount: number = Math.ceil(songEndPart / partsPerBar);
  if (barCount > Config.barCountMax) {
    throw new FlpImportError(
      "corrupt",
      "FLP arrangement exceeds goopbox's song length limit.",
    );
  }

  const sourceChannelOrder: number[] = project.channels
    .map((channel) => channel.id)
    .filter((channelId) => notesByChannel.has(channelId));
  for (const channelId of notesByChannel.keys()) {
    if (sourceChannelOrder.indexOf(channelId) == -1) {
      sourceChannelOrder.push(channelId);
    }
  }

  const pitchChannels: Channel[] = [];
  const channelSources: FlpChannelSource[] = [];
  const sourceChannelsById = new Map<number, FlpChannel>(
    project.channels.map((channel: FlpChannel) => [channel.id, channel]),
  );
  for (const channelId of sourceChannelOrder) {
    const sourceNotes: ArrangedFlpNote[] = notesByChannel.get(channelId)!;
    const chords: ArrangedChord[] = notesToChords(sourceNotes);
    const lanes: ArrangedChord[][] = splitOverlaps(chords);
    const source: FlpChannel | undefined = sourceChannelsById.get(channelId);
    const playlistTracks: number[] = [
      ...(tracksByChannel.get(channelId) ?? []),
    ].sort((a, b) => a - b);
    const playlistTrackNames: string[] = playlistTracks.flatMap(
      (trackIndex: number): string[] => {
        const name: string | undefined = arrangement.tracks[trackIndex]?.name;
        return name == null ? [] : [name];
      },
    );
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      if (pitchChannels.length >= Config.pitchChannelCountMax) {
        throw new FlpImportError(
          "corrupt",
          "FLP arrangement requires more channels than goopbox supports.",
        );
      }
      pitchChannels.push(makeChannel(lanes[laneIndex], barCount, partsPerBar));
      channelSources.push({
        sourceChannelId: channelId,
        name: source?.name,
        kind: source?.kind,
        samplePath: source?.samplePath,
        plugin: source?.plugin,
        playlistTracks,
        playlistTrackNames,
        laneIndex,
        laneCount: lanes.length,
      });
    }
  }

  return {
    tempo: Math.max(
      Config.tempoMin,
      Math.min(Config.tempoMax, Math.round(project.tempo)),
    ),
    beatsPerBar,
    barCount,
    pitchChannels,
    noiseChannels: [],
    channelSources,
    arrangementId: arrangement.id,
  };
}

export function importFlp(buffer: ArrayBuffer): FlpSongImport {
  return convertFlpProject(parseFlpProject(buffer));
}

export { FlpImportError } from "./FlpParser.js";
