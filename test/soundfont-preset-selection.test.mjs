import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadModules() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-soundfont-selection-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: `
				export { ChangeSoundFontPresetSelection } from ${JSON.stringify(join(process.cwd(), "src/changes.ts"))};
				export { Song } from ${JSON.stringify(join(process.cwd(), "synth/synth.ts"))};
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
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(directory, { recursive: true }) };
}

test("selecting a SoundFont preset preserves instrument volume", async (context) => {
  const { module, cleanup } = await loadModules();
  context.after(cleanup);
  const soundFontId = "test-soundfont";
  const song = new module.Song();
  song.assets.push({
    source: "test.sf2",
    id: soundFontId,
    url: "test.sf2",
    name: "test",
    rootKey: 60,
    type: "soundFont",
  });
  const instrument = song.channels[0].instruments[0];
  instrument.volume = 73;
  const preset = {
    index: 4,
    settings: {
      pan: 50,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      vibrato: "none",
      filterCutoffHz: null,
      filterGain: 1,
      envelopes: [],
    },
  };
  const doc = {
    song,
    channel: 0,
    getCurrentInstrument: () => 0,
    synth: { getSoundFontPresets: () => [preset] },
    notifier: { changed() {} },
  };

  new module.ChangeSoundFontPresetSelection(doc, soundFontId, preset.index);

  assert.equal(instrument.volume, 73);
});
