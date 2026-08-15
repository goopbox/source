import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadPanModules() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-pan-conversion-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {panPercentToSetting, panSettingToPercent} from "./src/PanConversion.ts";',
        'export {ChangePan} from "./src/changes.ts";',
        'export {Song} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "pan-conversion-entry.ts",
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

test("pan display percentages round-trip every internal setting", async (context) => {
  const { panPercentToSetting, panSettingToPercent, cleanup } =
    await loadPanModules();
  context.after(cleanup);

  assert.deepEqual(
    [0, 25, 50, 75, 100].map(panSettingToPercent),
    [-100, -50, 0, 50, 100],
  );
  for (let setting = 0; setting <= 100; setting++) {
    assert.equal(panPercentToSetting(panSettingToPercent(setting)), setting);
  }
  assert.equal(panPercentToSetting(-1000), 0);
  assert.equal(panPercentToSetting(1000), 100);
});

test("pan changes use the internal scale represented by the editor percentage", async (context) => {
  const { ChangePan, Song, panPercentToSetting, panSettingToPercent, cleanup } =
    await loadPanModules();
  context.after(cleanup);

  const song = new Song();
  const instrument = song.channels[0].instruments[0];
  const doc = {
    song,
    channel: 0,
    getCurrentInstrument: () => 0,
    notifier: { changed() {} },
  };

  const change = new ChangePan(doc, instrument.pan, panPercentToSetting(-100));
  assert.equal(change.isNoop(), false);
  assert.equal(instrument.pan, 0);
  assert.equal(panSettingToPercent(instrument.pan), -100);

  const restored = new Song(song.toBinary());
  assert.equal(restored.channels[0].instruments[0].pan, 0);
});
