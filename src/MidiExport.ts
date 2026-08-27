// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE-MIT file.

import { InstrumentType } from "../synth/SynthConfig.js";
import { ArrayBufferWriter } from "./ArrayBufferWriter.js";
import { MidiEventType, MidiMetaEventMessage } from "./Midi.js";

export interface MidiExportSong {
  readonly channels: readonly {
    readonly instruments: readonly { readonly type: InstrumentType }[];
  }[];
  getChannelCount(): number;
  getChannelIsNoise(channelIndex: number): boolean;
}

export interface MidiExportTrack {
  readonly isMeta: boolean;
  readonly channel: number;
  readonly instrumentIndex: number;
  readonly midiPort: number;
  readonly midiChannel: number;
  readonly isNoise: boolean;
  readonly isDrumset: boolean;
}

export function createMidiExportTracks(
  song: MidiExportSong,
): MidiExportTrack[] {
  const tracks: MidiExportTrack[] = [
    {
      isMeta: true,
      channel: -1,
      instrumentIndex: -1,
      midiPort: -1,
      midiChannel: -1,
      isNoise: false,
      isDrumset: false,
    },
  ];

  let midiPort: number = 0;
  for (let channel: number = 0; channel < song.getChannelCount(); channel++) {
    for (
      let instrumentIndex: number = 0;
      instrumentIndex < song.channels[channel].instruments.length;
      instrumentIndex++
    ) {
      const isDrumset: boolean =
        song.channels[channel].instruments[instrumentIndex].type ==
        InstrumentType.drumset;
      tracks.push({
        isMeta: false,
        channel,
        instrumentIndex,
        midiPort: midiPort++,
        midiChannel: isDrumset ? 9 : 0,
        isNoise: song.getChannelIsNoise(channel),
        isDrumset,
      });
    }
  }

  return tracks;
}

export function writeMidiTrackRouting(
  writer: ArrayBufferWriter,
  midiPort: number,
): void {
  if (!Number.isSafeInteger(midiPort) || midiPort < 0)
    throw new Error("Invalid MIDI port index: " + midiPort);

  writer.writeMidiVariableLength(0);
  writer.writeUint8(MidiEventType.meta);
  writer.writeMidi7Bits(MidiMetaEventMessage.deviceName);
  writer.writeMidiAscii("GoopBox Port " + (midiPort + 1));

  // FF 21 uses a 7-bit numeric port id. Device Name (FF 09) is the
  // standards-recommended way to retain a distinct device namespace when the
  // file needs more numeric ports than FF 21 can represent.
  if (midiPort < 0x80) {
    writer.writeMidiVariableLength(0);
    writer.writeUint8(MidiEventType.meta);
    writer.writeMidi7Bits(MidiMetaEventMessage.midiPort);
    writer.writeMidiVariableLength(1);
    writer.writeMidi7Bits(midiPort);
  }
}
