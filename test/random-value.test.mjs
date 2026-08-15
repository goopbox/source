import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const samples = Array.from({ length: 1000 }, (_, index) => index / 1000);

async function loadRandomValue(context) {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-random-value-test-"));
  context.after(() => rm(directory, { recursive: true }));
  const outfile = join(directory, "random-value.mjs");
  await build({
    entryPoints: ["src/RandomValue.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

test("random effect percentages use native whole display values", async (context) => {
  const { selectCurvedValue } = await loadRandomValue(context);
  const values = samples.map((random) =>
    selectCurvedValue(1, 100, 100 / 3, 100 / 3, 1, () => random),
  );
  assert.ok(
    values.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 100,
    ),
  );
  assert.ok(
    new Set(values).size > 3,
    "reverb should not be limited to legacy storage steps",
  );
});

test("random special effect values respect their display bounds and snapping", async (context) => {
  const { selectCurvedValue } = await loadRandomValue(context);
  const pitchShiftValues = samples.map((random) =>
    selectCurvedValue(-12, 12, 0, 2, 1, () => random),
  );
  assert.ok(
    pitchShiftValues.every(
      (value) => Number.isInteger(value) && value >= -12 && value <= 12,
    ),
  );

  const echoDelayValues = samples.map((random) =>
    selectCurvedValue(0.25, 2, 1, 0.25, 0.25, () => random),
  );
  assert.ok(
    echoDelayValues.every(
      (value) => value >= 0.25 && value <= 2 && Number.isInteger(value * 4),
    ),
  );
});
