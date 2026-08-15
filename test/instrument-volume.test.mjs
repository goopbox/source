import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynth() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-instrument-volume-test-"),
  );
  const outfile = join(directory, "synth.mjs");
  await build({
    entryPoints: ["synth/synth.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const synth = await import(pathToFileURL(outfile).href);
  return { synth, cleanup: () => rm(directory, { recursive: true }) };
}

test("instrument volume uses a perceptual curve from 5% to 6x", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const { Config, Synth } = synth;

  assert.equal(Synth.instrumentVolumeToVolumeMult(0), 0);
  assert.equal(Synth.instrumentVolumeToVolumeMult(1), 0.05);
  assert.ok(Math.abs(Synth.instrumentVolumeToVolumeMult(100) - 6.0) < 1e-12);

  const middleSetting = 50;
  const ratio = (middleSetting - 1) / (Config.volumeRange - 2);
  const expected =
    Config.volumeMinGain *
    Math.pow(Config.volumeMaxGain / Config.volumeMinGain, ratio);
  assert.ok(
    Math.abs(Synth.instrumentVolumeToVolumeMult(middleSetting) - expected) <
      1e-12,
  );
  assert.ok(Synth.instrumentVolumeToVolumeMult(50) < 1.0);
  assert.ok(Synth.instrumentVolumeToVolumeMult(75) > 1.0);
});

test("instrument volume conversion still round-trips every setting", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  for (let setting = 0; setting < synth.Config.volumeRange; setting++) {
    assert.equal(
      synth.Synth.volumeMultToInstrumentVolume(
        synth.Synth.instrumentVolumeToVolumeMult(setting),
      ),
      setting,
    );
  }
});

test("instrument default volume is near 1x on the new curve", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const instrument = new synth.Instrument(false);
  assert.equal(instrument.volume, synth.Config.volumeDefault);
  assert.ok(
    Math.abs(
      synth.Synth.instrumentVolumeToVolumeMult(instrument.volume) - 1.0,
    ) < 0.01,
  );
  instrument.setTypeAndReset(synth.InstrumentType.chip, false);
  assert.equal(instrument.volume, synth.Config.volumeDefault);
  instrument.fromSettingsObject({ type: "chip" }, false);
  assert.equal(instrument.volume, synth.Config.volumeDefault);
});
