import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynth() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-fm-frequency-test-"));
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

test("FM operator frequencies preserve floats and enforce 0 through 500", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const instrument = new synth.Instrument(false);
  instrument.setTypeAndReset(synth.InstrumentType.fm, false);
  instrument.operators[0].frequency = 123.456;

  const settings = instrument.toSettingsObject();
  assert.equal(settings.operators[0].frequency, 123.456);

  const restored = new synth.Instrument(false);
  restored.fromSettingsObject(settings, false);
  assert.equal(restored.operators[0].frequency, 123.456);

  settings.operators[0].frequency = -1;
  restored.fromSettingsObject(settings, false);
  assert.equal(restored.operators[0].frequency, 0);
  settings.operators[0].frequency = 501;
  restored.fromSettingsObject(settings, false);
  assert.equal(restored.operators[0].frequency, 500);
});

test("legacy named FM frequencies import as numeric ratios", async (context) => {
  const { synth, cleanup } = await loadSynth();
  context.after(cleanup);
  const source = new synth.Instrument(false);
  source.setTypeAndReset(synth.InstrumentType.fm, false);
  const settings = source.toSettingsObject();
  settings.operators[0].frequency = "~2×";

  const restored = new synth.Instrument(false);
  restored.fromSettingsObject(settings, false);
  assert.equal(restored.operators[0].frequency, 2);
});
