import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynth() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-history-state-test-"),
  );
  const outfile = join(directory, "synth.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./synth/synth.ts";',
        'export {decodeSongBinary, encodeSongBinary} from "./synth/SongBinary.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "history-state-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const synth = await import(pathToFileURL(outfile).href);
  return { synth, cleanup: () => rm(directory, { recursive: true }) };
}

function firstInstrumentState(songObject) {
  return songObject.channels[0].instruments[0];
}

test("valid dormant instrument settings round-trip exactly through raw binary", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Config, Song } = synth;
  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  instrument.effects = 0;
  instrument.chipNoise = Config.chipNoises.length - 1;
  instrument.transition = Config.transitions.length - 1;
  instrument.chord = Config.chords.length - 1;
  instrument.vibrato = Config.vibratos.length - 1;
  instrument.unison = Config.unisons.length - 1;
  instrument.fadeIn = Config.fadeInRange - 1;
  instrument.fadeOut = Config.fadeOutTicks.length - 1;
  instrument.stringSustainType = Config.sustainTypeNames.length - 1;
  instrument.algorithm = Config.algorithms.length - 1;
  instrument.feedbackType = Config.feedbacks.length - 1;
  instrument.soundFontId = "dormant-soundfont";
  instrument.soundFontPreset = 0x3ffff;
  instrument.pitchShift = 27.25;
  instrument.detune = -2.5;
  instrument.distortion = 8.75;
  instrument.operators[0].frequency = Config.operatorFrequencyMax;
  instrument.operators[0].amplitude = Config.operatorAmplitudeMax;
  instrument.operators[0].wave = Config.chipWaves.length;
  instrument.drumsetEnvelopes[0] = Config.envelopes.length - 1;
  const songData = song.toBinary();
  const restored = new Song(songData);

  assert.deepEqual(restored.toBinary(), songData);
});

test("song-specific string and asset collection limits reject CRC-valid oversized data", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song, decodeSongBinary, encodeSongBinary } = synth;
  const validSongObject = new Song().toBinaryObject();
  const corruptions = [
    [
      "asset count",
      (state) => {
        state.assets = Array.from(
          { length: 65 },
          (_, index) => `https://example.com/${index}.sf2`,
        );
      },
    ],
    [
      "asset source length",
      (state) => {
        state.assets = ["x".repeat(8193)];
      },
    ],
    [
      "SoundFont id length",
      (state) => {
        firstInstrumentState(state).soundFontId = "x".repeat(8199);
      },
    ],
  ];

  for (const [name, corrupt] of corruptions) {
    const corruptSongObject = structuredClone(validSongObject);
    corrupt(corruptSongObject);
    const songData = encodeSongBinary(corruptSongObject);
    assert.doesNotThrow(
      () => decodeSongBinary(songData),
      `${name} fixture must have a valid header and CRC`,
    );
    assert.throws(() => new Song(songData), /Invalid \.goop/, name);
  }
});

test("CRC-valid unsafe numeric domains and note bends are rejected without poisoning synthesis", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const {
    Config,
    Note,
    Song,
    SynthEngine,
    decodeSongBinary,
    encodeSongBinary,
  } = synth;
  const song = new Song();
  song.channels[0].instruments[0].volume = 50;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(
    new Note(24, 0, 12, Config.noteSizeMax),
  );
  const validSongObject = song.toBinaryObject();
  const unsafeMagnitude = Number.MAX_VALUE;
  const validEnvelope = () => ({
    target: Config.instrumentAutomationTargets.dictionary.noteVolume.index,
    index: 0,
    envelope: Config.envelopes.dictionary.twang.index,
    speed: 5,
    a: 1,
    b: 0,
  });
  const validFilterPoint = () => ({ type: 0, freq: 0, gain: 0 });
  const corruptions = [
    [
      "instrument type",
      (state) => {
        firstInstrumentState(state).type = Config.instrumentTypeNames.length;
      },
    ],
    [
      "preset",
      (state) => {
        firstInstrumentState(state).preset = 0x100000000;
      },
    ],
    [
      "chip wave",
      (state) => {
        firstInstrumentState(state).chipWave = Config.chipWaves.length;
      },
    ],
    [
      "chip noise",
      (state) => {
        firstInstrumentState(state).chipNoise = Config.chipNoises.length;
      },
    ],
    [
      "fade in",
      (state) => {
        firstInstrumentState(state).fadeIn = Config.fadeInRange;
      },
    ],
    [
      "fade out",
      (state) => {
        firstInstrumentState(state).fadeOut = Config.fadeOutTicks.length;
      },
    ],
    [
      "transition",
      (state) => {
        firstInstrumentState(state).transition = Config.transitions.length;
      },
    ],
    [
      "vibrato",
      (state) => {
        firstInstrumentState(state).vibrato = Config.vibratos.length;
      },
    ],
    [
      "unison",
      (state) => {
        firstInstrumentState(state).unison = Config.unisons.length;
      },
    ],
    [
      "effects",
      (state) => {
        firstInstrumentState(state).effects = 2 ** Config.effectNames.length;
      },
    ],
    [
      "chord",
      (state) => {
        firstInstrumentState(state).chord = Config.chords.length;
      },
    ],
    [
      "string sustain type",
      (state) => {
        firstInstrumentState(state).stringSustainType =
          Config.sustainTypeNames.length;
      },
    ],
    [
      "SoundFont preset",
      (state) => {
        firstInstrumentState(state).soundFontPreset = 0x40000;
      },
    ],
    [
      "algorithm",
      (state) => {
        firstInstrumentState(state).algorithm = Config.algorithms.length;
      },
    ],
    [
      "feedback type",
      (state) => {
        firstInstrumentState(state).feedbackType = Config.feedbacks.length;
      },
    ],
    [
      "filter type",
      (state) => {
        const point = validFilterPoint();
        point.type = Config.filterTypeNames.length;
        firstInstrumentState(state).eqFilter = [point];
      },
    ],
    [
      "filter frequency",
      (state) => {
        const point = validFilterPoint();
        point.freq = Config.filterFreqRange;
        firstInstrumentState(state).eqFilter = [point];
      },
    ],
    [
      "filter gain",
      (state) => {
        const point = validFilterPoint();
        point.gain = Config.filterGainRange;
        firstInstrumentState(state).eqFilter = [point];
      },
    ],
    [
      "dormant note filter",
      (state) => {
        const point = validFilterPoint();
        point.freq = unsafeMagnitude;
        firstInstrumentState(state).noteFilter = [point];
      },
    ],
    [
      "envelope speed",
      (state) => {
        const envelope = validEnvelope();
        envelope.speed = unsafeMagnitude;
        firstInstrumentState(state).envelopes = [envelope];
      },
    ],
    [
      "envelope A",
      (state) => {
        const envelope = validEnvelope();
        envelope.a = unsafeMagnitude;
        firstInstrumentState(state).envelopes = [envelope];
      },
    ],
    [
      "envelope B",
      (state) => {
        const envelope = validEnvelope();
        envelope.b = unsafeMagnitude;
        firstInstrumentState(state).envelopes = [envelope];
      },
    ],
    [
      "operator frequency",
      (state) => {
        firstInstrumentState(state).operators[0].frequency =
          Config.operatorFrequencyMax + 1;
      },
    ],
    [
      "operator amplitude",
      (state) => {
        firstInstrumentState(state).operators[0].amplitude =
          Config.operatorAmplitudeMax + 1;
      },
    ],
    [
      "operator wave",
      (state) => {
        firstInstrumentState(state).operators[0].wave =
          Config.chipWaves.length + 1;
      },
    ],
    [
      "spectrum",
      (state) => {
        firstInstrumentState(state).spectrum[0] = Config.spectrumMax + 1;
      },
    ],
    [
      "harmonics",
      (state) => {
        firstInstrumentState(state).harmonics[0] = Config.harmonicsMax + 1;
      },
    ],
    [
      "drum envelope type",
      (state) => {
        firstInstrumentState(state).drumsetEnvelopes[0] =
          Config.envelopes.length;
      },
    ],
    [
      "drum envelope speed",
      (state) => {
        firstInstrumentState(state).drumsetEnvelopeSpeeds[0] = unsafeMagnitude;
      },
    ],
    [
      "drum envelope A",
      (state) => {
        firstInstrumentState(state).drumsetEnvelopeAs[0] = unsafeMagnitude;
      },
    ],
    [
      "drum envelope B",
      (state) => {
        firstInstrumentState(state).drumsetEnvelopeBs[0] = unsafeMagnitude;
      },
    ],
    [
      "drum spectrum",
      (state) => {
        firstInstrumentState(state).drumsetSpectra[0][0] =
          Config.spectrumMax + 1;
      },
    ],
    [
      "first pin interval",
      (state) => {
        state.channels[0].patterns[0].notes[0].pins[0].interval = 1;
      },
    ],
    [
      "high pin interval",
      (state) => {
        state.channels[0].patterns[0].notes[0].pins[1].interval =
          Config.maxPitch;
      },
    ],
    [
      "low pin interval",
      (state) => {
        state.channels[0].patterns[0].notes[0].pins[1].interval = -25;
      },
    ],
  ];
  for (const name of [
    "volume",
    "pan",
    "pulseWidth",
    "supersawDynamism",
    "supersawSpread",
    "supersawShape",
    "stringSustain",
    "feedbackAmplitude",
  ]) {
    corruptions.push([
      name,
      (state) => {
        firstInstrumentState(state)[name] = unsafeMagnitude;
      },
    ]);
  }

  for (const [name, corrupt] of corruptions) {
    const corruptSongObject = structuredClone(validSongObject);
    corrupt(corruptSongObject);
    const songData = encodeSongBinary(corruptSongObject);
    assert.doesNotThrow(
      () => decodeSongBinary(songData),
      `${name} fixture must have a valid header and CRC`,
    );
    assert.throws(() => new Song(songData), /Invalid \.goop/, name);
  }

  const poisonedSongObject = structuredClone(validSongObject);
  firstInstrumentState(poisonedSongObject).volume = unsafeMagnitude;
  const poisonedSongData = encodeSongBinary(poisonedSongObject);
  const engine = new SynthEngine(song);
  assert.throws(() => engine.setSong(poisonedSongData), /Invalid \.goop/);
  assert.strictEqual(
    engine.song,
    song,
    "a rejected binary song must leave the live engine song intact",
  );
  engine.play();
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  engine.synthesize(left, right, left.length);
  assert.ok(
    left.some((sample) => sample != 0) || right.some((sample) => sample != 0),
    "the retained song should still render audio",
  );
  assert.ok(
    left.every(Number.isFinite) && right.every(Number.isFinite),
    "rejected data must not poison rendered samples",
  );
});

test("corrupt dormant indices and empty song structures are rejected atomically", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Config, Note, Song, decodeSongBinary, encodeSongBinary } = synth;
  const song = new Song();
  const songObject = song.toBinaryObject();
  songObject.assets = ["https://example.com/current.wav"];
  song.fromBinary(encodeSongBinary(songObject));
  song.tempo = 211;
  song.channels[0].bars[0] = 1;
  song.channels[0].patterns[0].notes.push(new Note(24, 0, 12, 7));
  const validSongObject = song.toBinaryObject();
  const before = song.toBinary();
  const channelReference = song.channels[0];
  const instrumentReference = channelReference.instruments[0];
  const chipWavesReference = Config.chipWaves;
  const corruptions = [
    [
      "empty channels",
      (state) => {
        state.channels = [];
      },
    ],
    [
      "empty instruments",
      (state) => {
        state.channels[0].instruments = [];
      },
    ],
    [
      "chip wave",
      (state) => {
        firstInstrumentState(state).chipWave = Config.chipWaves.length;
      },
    ],
    [
      "chip noise",
      (state) => {
        firstInstrumentState(state).chipNoise = Config.chipNoises.length;
      },
    ],
    [
      "transition",
      (state) => {
        firstInstrumentState(state).transition = Config.transitions.length;
      },
    ],
    [
      "chord",
      (state) => {
        firstInstrumentState(state).chord = Config.chords.length;
      },
    ],
    [
      "vibrato",
      (state) => {
        firstInstrumentState(state).vibrato = Config.vibratos.length;
      },
    ],
    [
      "unison",
      (state) => {
        firstInstrumentState(state).unison = Config.unisons.length;
      },
    ],
    [
      "algorithm",
      (state) => {
        firstInstrumentState(state).algorithm = Config.algorithms.length;
      },
    ],
    [
      "feedback",
      (state) => {
        firstInstrumentState(state).feedbackType = Config.feedbacks.length;
      },
    ],
    [
      "operator wave",
      (state) => {
        firstInstrumentState(state).operators[0].wave =
          Config.chipWaves.length + 1;
      },
    ],
    [
      "drum envelope",
      (state) => {
        firstInstrumentState(state).drumsetEnvelopes[0] =
          Config.envelopes.length;
      },
    ],
    [
      "envelope target",
      (state) => {
        firstInstrumentState(state).envelopes = [
          {
            target: Config.instrumentAutomationTargets.length,
            index: 0,
            envelope: 0,
            speed: 1,
            a: 1,
            b: 1,
          },
        ];
      },
    ],
    [
      "envelope target index",
      (state) => {
        firstInstrumentState(state).envelopes = [
          {
            target:
              Config.instrumentAutomationTargets.dictionary.noteVolume.index,
            index: 1,
            envelope: 0,
            speed: 1,
            a: 1,
            b: 1,
          },
        ];
      },
    ],
    [
      "envelope setting",
      (state) => {
        firstInstrumentState(state).envelopes = [
          {
            target:
              Config.instrumentAutomationTargets.dictionary.noteVolume.index,
            index: 0,
            envelope: Config.envelopes.length,
            speed: 1,
            a: 1,
            b: 1,
          },
        ];
      },
    ],
  ];

  for (const [name, corrupt] of corruptions) {
    const corruptSongObject = structuredClone(validSongObject);
    corrupt(corruptSongObject);
    assert.throws(
      () => song.fromBinary(encodeSongBinary(corruptSongObject)),
      /Invalid \.goop/,
      name,
    );
    assert.deepEqual(
      song.toBinary(),
      before,
      `${name} must not mutate the song`,
    );
    assert.strictEqual(
      song.channels[0],
      channelReference,
      `${name} must not replace the channel graph`,
    );
    assert.strictEqual(
      song.channels[0].instruments[0],
      instrumentReference,
      `${name} must not replace the instrument graph`,
    );
    assert.strictEqual(
      Config.chipWaves,
      chipWavesReference,
      `${name} must restore asset chip waves`,
    );
  }
});

test("a late instrument binary error does not partially apply earlier fields", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Song } = synth;
  const instrument = new Song().channels[0].instruments[0];
  const before = instrument.toBinaryState();
  const corrupt = structuredClone(before);
  corrupt.transition = corrupt.transition == 0 ? 1 : 0;
  corrupt.drumsetSpectra = [];

  assert.throws(() => instrument.fromBinaryState(corrupt), /Invalid \.goop/);
  assert.deepEqual(instrument.toBinaryState(), before);
});
