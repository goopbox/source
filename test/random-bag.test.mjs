import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadRandomBag() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-random-bag-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["src/RandomBag.ts"],
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
  const bag = new RandomBag();
  const items = [1, 2, 3, 4];
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
