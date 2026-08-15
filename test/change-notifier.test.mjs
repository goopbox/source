import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadChangeNotifier() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-change-notifier-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["src/ChangeNotifier.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    ChangeNotifier: module.ChangeNotifier,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

test("a throwing watcher does not leave the notifier stuck notifying", async (context) => {
  const { ChangeNotifier, cleanup } = await loadChangeNotifier();
  context.after(cleanup);
  const notifier = new ChangeNotifier();
  let shouldThrow = true;
  let successfulNotifications = 0;
  notifier.watch(() => {
    if (shouldThrow) throw new Error("render failed");
  });
  notifier.watch(() => successfulNotifications++);

  notifier.changed();
  assert.throws(() => notifier.notifyWatchers(), /render failed/);

  shouldThrow = false;
  notifier.changed();
  assert.doesNotThrow(() => notifier.notifyWatchers());
  assert.equal(successfulNotifications, 1);
});
