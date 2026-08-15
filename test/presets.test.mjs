import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

test("all presets use the current instrument settings format", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-preset-test-"));
  context.after(() => rm(directory, { recursive: true }));
  const outfile = join(directory, "presets.mjs");
  await build({
    stdin: {
      contents: `
				export { EditorConfig } from ${JSON.stringify(join(process.cwd(), "src/EditorConfig.ts"))};
				export { Instrument } from ${JSON.stringify(join(process.cwd(), "synth/synth.ts"))};
			`,
      loader: "ts",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const { EditorConfig, Instrument } = await import(
    pathToFileURL(outfile).href
  );
  let count = 0;
  for (const category of EditorConfig.presetCategories) {
    for (const preset of category.presets) {
      if (preset.settings == undefined) continue;
      const instrument = new Instrument(preset.isNoise === true);
      assert.doesNotThrow(
        () =>
          instrument.fromSettingsObject(
            preset.settings,
            preset.isNoise === true,
          ),
        `${category.name}: ${preset.name}`,
      );
      count++;
    }
  }
  assert.equal(count, 178);
});
