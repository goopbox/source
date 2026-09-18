import { mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { tmpdir } from "node:os";

async function loadRandomBag() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-random-bag-test-")),
    outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["src/random-bag.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    RandomBag: module.RandomBag,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

test("random bag picks every item once before refilling", async (context) => {
  const { RandomBag, cleanup } = await loadRandomBag();
  context.after(cleanup);
  const bag = new RandomBag(),
    items = [1, 2, 3, 4];
  assert.deepEqual(new Set(items.map(() => bag.pick(items))), new Set(items));
  assert.deepEqual(new Set(items.map(() => bag.pick(items))), new Set(items));
});

test("random bag resets when its available items change", async (context) => {
  const { RandomBag, cleanup } = await loadRandomBag();
  context.after(cleanup);
  const bag = new RandomBag();
  bag.pick([1, 2]);
  assert.equal(bag.pick([3]), 3);
});
