import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const loadedModule = (async () => {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-midi-export-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export { createMidiExportTracks, writeMidiTrackRouting } from "./src/MidiExport.ts";',
        'export { ArrayBufferWriter } from "./src/ArrayBufferWriter.ts";',
        'import { InstrumentType } from "./synth/SynthConfig.ts";',
        'export const chipInstrumentType = InstrumentType.chip;',
        'export const drumsetInstrumentType = InstrumentType.drumset;',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "midi-export-test-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(directory, { recursive: true }) };
})();

after(async () => {
  const { cleanup } = await loadedModule;
  await cleanup();
});

function makeSong(module, pitchInstrumentTypes, noiseInstrumentTypes = []) {
  const channels = [...pitchInstrumentTypes, ...noiseInstrumentTypes].map(
    (instrumentTypes) => ({
      instruments: instrumentTypes.map((type) => ({ type })),
    }),
  );
  return {
    channels,
    getChannelCount: () => channels.length,
    getChannelIsNoise: (channelIndex) =>
      channelIndex >= pitchInstrumentTypes.length,
  };
}

test(
  "MIDI export creates a distinct routed track for every instrument beyond 16",
  async () => {
    const { module } = await loadedModule;
    const instrumentTypes = Array.from(
      { length: 150 },
      () => module.chipInstrumentType,
    );
    const song = makeSong(module, [instrumentTypes]);
    const tracks = module.createMidiExportTracks(song);

    assert.equal(tracks.length, 151, "meta track plus all 150 instruments");
    for (let index = 0; index < 150; index++) {
      const track = tracks[index + 1];
      assert.equal(track.midiPort, index);
      assert.equal(track.midiChannel, 0, "melodic tracks use MIDI channel 1");
      assert.equal(track.instrumentIndex, index);
    }
  },
);

test("every drumset gets its own port on General MIDI channel 10", async () => {
  const { module } = await loadedModule;
  const song = makeSong(
    module,
    [[module.chipInstrumentType]],
    [[module.drumsetInstrumentType, module.drumsetInstrumentType]],
  );
  const tracks = module.createMidiExportTracks(song);

  assert.equal(tracks.length, 4);
  assert.deepEqual(
    tracks.slice(1).map(({ midiPort, midiChannel, isDrumset }) => ({
      midiPort,
      midiChannel,
      isDrumset,
    })),
    [
      { midiPort: 0, midiChannel: 0, isDrumset: false },
      { midiPort: 1, midiChannel: 9, isDrumset: true },
      { midiPort: 2, midiChannel: 9, isDrumset: true },
    ],
  );
});

test(
  "MIDI routing writes Device Name and the numeric MIDI Port event when representable",
  async () => {
    const { module } = await loadedModule;
    const writer = new module.ArrayBufferWriter(64);
    module.writeMidiTrackRouting(writer, 17);
    const bytes = Buffer.from(writer.toCompactArrayBuffer());
    const name = Buffer.from("GoopBox Port 18", "ascii");

    assert.deepEqual(
      bytes,
      Buffer.concat([
        Buffer.from([0x00, 0xff, 0x09, name.length]),
        name,
        Buffer.from([0x00, 0xff, 0x21, 0x01, 0x11]),
      ]),
    );
  },
);

test(
  "MIDI routing keeps tracks above numeric port 127 distinct with Device Name",
  async () => {
    const { module } = await loadedModule;
    const writer = new module.ArrayBufferWriter(64);
    module.writeMidiTrackRouting(writer, 128);
    const bytes = Buffer.from(writer.toCompactArrayBuffer());
    const name = Buffer.from("GoopBox Port 129", "ascii");

    assert.deepEqual(
      bytes,
      Buffer.concat([Buffer.from([0x00, 0xff, 0x09, name.length]), name]),
    );
    assert.equal(bytes.includes(Buffer.from([0xff, 0x21])), false);
  },
);
