import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-asset-remap-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {ChangeAssets} from "./src/changes.ts";',
        'export {Song} from "./synth/synth.ts";',
        'export {Config, parseAssetDefinition} from "./synth/SynthConfig.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "asset-remap-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { ...module, cleanup: () => rm(directory, { recursive: true }) };
}

test("asset edits preserve sample references by identity", async (context) => {
  const { ChangeAssets, Config, Song, parseAssetDefinition, cleanup } =
    await loadModules();
  context.after(cleanup);
  const first = parseAssetDefinition("https://example.com/first.wav");
  const second = parseAssetDefinition("https://example.com/second.wav");
  assert.notEqual(first, null);
  assert.notEqual(second, null);
  const song = new Song();
  const doc = { song, notifier: { changed() {} } };
  new ChangeAssets(doc, [first, second]);
  const instrument = song.channels[0].instruments[0];
  instrument.chipWave = Config.chipWaves.find(
    (wave) => wave.sampleId == second.id,
  ).index;
  instrument.operators[0].wave =
    Config.chipWaves.find((wave) => wave.sampleId == first.id).index + 1;

  new ChangeAssets(doc, [second, first]);
  assert.equal(Config.chipWaves[instrument.chipWave].sampleId, second.id);
  assert.equal(
    Config.chipWaves[instrument.operators[0].wave - 1].sampleId,
    first.id,
  );
  assert.doesNotThrow(() => new Song(song.toBinary()));

  new ChangeAssets(doc, [second]);
  assert.equal(Config.chipWaves[instrument.chipWave].sampleId, second.id);
  assert.equal(instrument.operators[0].wave, 0);
  assert.doesNotThrow(() => new Song(song.toBinary()));

  new ChangeAssets(doc, []);
  assert.equal(instrument.chipWave, 1);
  assert.doesNotThrow(() => new Song(song.toBinary()));
});
