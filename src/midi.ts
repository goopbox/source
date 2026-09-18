// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export const defaultMidiExpression = 0x7f;
export const defaultMidiPitchBend = 0x20_00;
const squareLeadMidiProgram = 80;

interface SoundFontMidiPreset {
  readonly index: number;
  readonly program: number;
}

export function getSoundFontMidiProgram(
  presets: readonly SoundFontMidiPreset[] | null,
  presetIndex: number,
): number {
  const program: number | undefined = presets?.find(
    (preset: SoundFontMidiPreset): boolean => preset.index === presetIndex,
  )?.program;
  if (program === undefined || !Number.isInteger(program) || program < 0 || program >= 0x80) {
    return squareLeadMidiProgram;
  }
  return program;
}

export enum MidiChunkType {
  header = 0x4d_54_68_64, // "MThd" as bytes, big endian
  track = 0x4d_54_72_6b, // "MTrk" as bytes, big endian
}

export enum MidiFileFormat {
  singleTrack = 0x00_00,
  simultaneousTracks = 0x00_01,
  independentTracks = 0x00_02,
}

// Lower 4 bits indicate channel, except for meta and sysex events.
export enum MidiEventType {
  //ChannelMode = 0x70,
  noteOff = 0x80,
  noteOn = 0x90,
  keyPressure = 0xa0,
  controlChange = 0xb0,
  programChange = 0xc0,
  channelPressure = 0xd0,
  pitchBend = 0xe0,
  metaAndSysex = 0xf0,

  // These events are identified by all 8 bits.
  meta = 0xff,
  // SysexStart = 0xF0,
  // SysexEscape = 0xF7,
}

export enum MidiControlEventMessage {
  setParameterMSB = 0x06,
  volumeMSB = 0x07,
  panMSB = 0x0a,
  expressionMSB = 0x0b,

  setParameterLSB = 0x26,
  //VolumeLSB = 0x27,
  //ExpressionLSB = 0x2B,

  //NonRegisteredParameterNumberLSB = 0x62,
  //NonRegisteredParameterNumberMSB = 0x63,
  registeredParameterNumberLSB = 0x64,
  registeredParameterNumberMSB = 0x65,

  // Channel mode messages:
  /*
	AllSoundOff = 0x78,
	resetControllers = 0x79,
	localControl = 0x7A,
	allNotesOff = 0x7B,
	omniModeOff = 0x7C,
	omniModeOn = 0x7D,
	monoMode = 0x7E,
	polyphonicMode = 0x7F,
	*/
}

export enum MidiRegisteredParameterNumberMSB {
  pitchBendRange = 0x00, // Semitones
  fineTuning = 0x00,
  coarseTuning = 0x00,
  tuningProgramSelect = 0x00,
  tuningBankSelect = 0x00,
  reset = 0x7f,
}

export enum MidiRegisteredParameterNumberLSB {
  pitchBendRange = 0x00, // Cents
  fineTuning = 0x01,
  coarseTuning = 0x02,
  tuningProgramSelect = 0x03,
  tuningBankSelect = 0x04,
  reset = 0x7f,
}

export enum MidiMetaEventMessage {
  sequenceNumber = 0x00,
  text = 0x01,
  copyrightNotice = 0x02,
  trackName = 0x03,
  instrumentName = 0x04,
  lyricText = 0x05,
  marker = 0x06,
  cuePoint = 0x07,
  deviceName = 0x09,
  channelPrefix = 0x20,
  midiPort = 0x21,
  endOfTrack = 0x2f,
  tempo = 0x51,
  smpteOffset = 0x54,
  timeSignature = 0x58,
  keySignature = 0x59,
  sequencerSpecificEvent = 0x7f,
}

// Editor noise channels are very different from MIDI drumsets, but here's an attempt at converting between them.
export interface AnalogousDrum {
  frequency: number;
  duration: number;
  volume: number;
}
export const analogousDrumMap: Record<number, AnalogousDrum> = {
  35: { frequency: 0, duration: 2, volume: 3 }, // Acoustic Bass Drum
  36: { frequency: 0, duration: 2, volume: 3 }, // Bass Drum 1
  37: { frequency: 5, duration: 1, volume: 3 }, // Side Stick
  38: { frequency: 4, duration: 2, volume: 3 }, // Acoustic Snare
  39: { frequency: 5, duration: 2, volume: 3 }, // Hand Clap
  40: { frequency: 4, duration: 2, volume: 3 }, // Electric Snare
  41: { frequency: 1, duration: 2, volume: 3 }, // Low Floor Tom
  42: { frequency: 8, duration: 1, volume: 3 }, // Closed Hi Hat
  43: { frequency: 1, duration: 2, volume: 3 }, // High Floor Tom
  44: { frequency: 8, duration: 1, volume: 2 }, // Pedal Hi-Hat
  45: { frequency: 2, duration: 2, volume: 3 }, // Low Tom
  46: { frequency: 8, duration: 4, volume: 3 }, // Open Hi-Hat
  47: { frequency: 2, duration: 2, volume: 3 }, // Low-Mid Tom
  48: { frequency: 3, duration: 2, volume: 3 }, // Hi-Mid Tom
  49: { frequency: 7, duration: 4, volume: 3 }, // Crash Cymbal 1
  50: { frequency: 3, duration: 2, volume: 3 }, // High Tom
  51: { frequency: 6, duration: 4, volume: 2 }, // Ride Cymbal 1
  52: { frequency: 7, duration: 4, volume: 3 }, // Chinese Cymbal
  53: { frequency: 6, duration: 2, volume: 3 }, // Ride Bell
  54: { frequency: 11, duration: 2, volume: 3 }, // Tambourine
  55: { frequency: 9, duration: 4, volume: 3 }, // Splash Cymbal
  56: { frequency: 7, duration: 1, volume: 2 }, // Cowbell
  57: { frequency: 7, duration: 4, volume: 3 }, // Crash Cymbal 2
  58: { frequency: 10, duration: 2, volume: 2 }, // Vibraslap
  59: { frequency: 6, duration: 4, volume: 3 }, // Ride Cymbal 2
  //60: { frequency:  7, duration: 1, volume: 3 }, // Hi Bongo
  //61: { frequency:  5, duration: 1, volume: 3 }, // Low Bongo
  //62: { frequency:  6, duration: 1, volume: 3 }, // Mute Hi Conga
  //63: { frequency:  5, duration: 1, volume: 3 }, // Open Hi Conga
  //64: { frequency:  4, duration: 1, volume: 3 }, // Low Conga
  //65: { frequency:  6, duration: 2, volume: 3 }, // High Timbale
  //66: { frequency:  4, duration: 2, volume: 3 }, // Low Timbale
  //67: { frequency: 10, duration: 1, volume: 2 }, // High Agogo
  //68: { frequency:  9, duration: 1, volume: 2 }, // Low Agogo
  69: { frequency: 10, duration: 2, volume: 3 }, // Cabasa
  70: { frequency: 10, duration: 2, volume: 3 }, // Maracas
  //71: { frequency: 10, duration: 2, volume: 3 }, // Short Whistle
  //72: { frequency:  9, duration: 2, volume: 3 }, // Long Whistle
  73: { frequency: 10, duration: 1, volume: 2 }, // Short Guiro
  74: { frequency: 10, duration: 2, volume: 2 }, // Long Guiro
  //75: { frequency: 10, duration: 1, volume: 2 }, // Claves
  //76: { frequency:  6, duration: 1, volume: 2 }, // Hi Wood Block
  //77: { frequency:  5, duration: 1, volume: 2 }, // Low Wood Block
  //78: { frequency:  6, duration: 2, volume: 3 }, // Mute Cuica
  //79: { frequency:  4, duration: 2, volume: 3 }, // Open Cuica
  //80: { frequency:  7, duration: 1, volume: 2 }, // Mute Triangle
  //81: { frequency:  7, duration: 4, volume: 2 }, // Open Triangle
};

export function midiVolumeToVolumeMult(volume: number): number {
  // Default midi volume is 100, pow(100/127,4)≈0.384 so I'm considering that the baseline volume.
  return (volume / 127) ** 4.0 / 0.3844015376046128;
}
export function volumeMultToMidiVolume(volumeMult: number): number {
  return (volumeMult * 0.3844015376046128) ** 0.25 * 127;
}
export function midiExpressionToVolumeMult(expression: number): number {
  return (expression / 127) ** 4.0;
}
export function volumeMultToMidiExpression(volumeMult: number): number {
  return volumeMult ** 0.25 * 127;
}
