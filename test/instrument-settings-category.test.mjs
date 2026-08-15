import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadCategoryHelpers() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-settings-category-test-"),
  );
  const outfile = join(directory, "category.mjs");
  await build({
    entryPoints: ["src/InstrumentSettingsCategory.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const helpers = await import(pathToFileURL(outfile).href);
  return { helpers, cleanup: () => rm(directory, { recursive: true }) };
}

const instrument = {
  type: "FM",
  volume: 80,
  pan: 10,
  algorithm: "1←(2 3 4)",
  operators: [{ frequency: 1, amplitude: 12 }],
  effects: ["reverb"],
  eqFilter: [],
  reverb: 50,
  envelopes: [{ target: "noteVolume", envelope: "twang" }],
};

test("instrument settings category copies contain only their category", async (context) => {
  const { helpers, cleanup } = await loadCategoryHelpers();
  context.after(cleanup);
  const { copyInstrumentSettingsCategory } = helpers;
  assert.deepEqual(copyInstrumentSettingsCategory(instrument, "specific"), {
    category: "specific",
    settings: {
      type: "FM",
      algorithm: "1←(2 3 4)",
      operators: [{ frequency: 1, amplitude: 12 }],
    },
  });
  assert.deepEqual(
    copyInstrumentSettingsCategory(instrument, "effects").settings,
    {
      effects: ["reverb"],
      eqFilter: [],
      reverb: 50,
    },
  );
  assert.deepEqual(
    copyInstrumentSettingsCategory(instrument, "envelopes").settings,
    {
      envelopes: [{ target: "noteVolume", envelope: "twang" }],
    },
  );
});

test("category paste replaces only that category and removes stale fields", async (context) => {
  const { helpers, cleanup } = await loadCategoryHelpers();
  context.after(cleanup);
  const { copyInstrumentSettingsCategory, pasteInstrumentSettingsCategory } =
    helpers;
  const chorusInstrument = { ...instrument, effects: ["chorus"], chorus: 75 };
  delete chorusInstrument.reverb;
  const copy = copyInstrumentSettingsCategory(chorusInstrument, "effects");
  const pasted = pasteInstrumentSettingsCategory(instrument, copy);
  assert.deepEqual(pasted.effects, ["chorus"]);
  assert.equal(pasted.chorus, 75);
  assert.equal("reverb" in pasted, false);
  assert.equal(pasted.algorithm, instrument.algorithm);
  assert.deepEqual(pasted.envelopes, instrument.envelopes);
  assert.equal(pasted.volume, instrument.volume);
});

test("category clipboard validation requires the requested category", async (context) => {
  const { helpers, cleanup } = await loadCategoryHelpers();
  context.after(cleanup);
  const { copyInstrumentSettingsCategory, isInstrumentSettingsCategoryCopy } =
    helpers;
  const copy = copyInstrumentSettingsCategory(instrument, "specific");
  assert.equal(isInstrumentSettingsCategoryCopy(copy, "specific"), true);
  assert.equal(isInstrumentSettingsCategoryCopy(copy, "effects"), false);
  assert.equal(
    isInstrumentSettingsCategoryCopy(
      { category: "specific", settings: {} },
      "specific",
    ),
    true,
  );
  assert.equal(
    isInstrumentSettingsCategoryCopy({ category: "specific" }, "specific"),
    false,
  );
});
