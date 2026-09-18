import { mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { tmpdir } from "node:os";

async function loadAssetCache() {
  const storage = new Map(),
    cachedResponses = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.caches = {
    open: () =>
      Promise.resolve({
        put: (url, response) => {
          cachedResponses.set(String(url), response);
          return Promise.resolve();
        },
        delete: (url) => Promise.resolve(cachedResponses.delete(String(url))),
      }),
    delete: () => {
      cachedResponses.clear();
      return Promise.resolve(true);
    },
  };

  const directory = await mkdtemp(join(tmpdir(), "goopbox-asset-cache-test-")),
    outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["synth/asset-cache.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    module,
    storage,
    cachedResponses,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

test("assets are cached independently from pinned assets", async (context) => {
  const { module, cleanup } = await loadAssetCache();
  context.after(cleanup);
  const asset = {
    source: "!r48!https://example.com/piano.wav",
    id: "asset:test",
    url: "https://example.com/piano.wav",
    name: "piano",
    rootKey: 48,
    type: "sample",
  };

  assert.deepEqual(module.getPinnedAssets(), []);
  module.pinAsset(asset);
  assert.deepEqual(
    module.getPinnedAssets().map((candidate) => candidate.source),
    [asset.source],
  );
  module.unpinAsset(asset);
  assert.deepEqual(module.getPinnedAssets(), []);
});

test("resetting the cache deletes responses but preserves pinned assets", async (context) => {
  const { module, cachedResponses, cleanup } = await loadAssetCache();
  context.after(cleanup);
  const asset = {
    source: "https://example.com/piano.wav",
    id: "asset:test",
    url: "https://example.com/piano.wav",
    name: "piano",
    rootKey: 60,
    type: "sample",
  };

  module.pinAsset(asset);
  module.cacheAsset(asset, new TextEncoder().encode("audio").buffer, new Response("ignored"));
  await module.resetAssetCache();

  assert.deepEqual(
    module.getPinnedAssets().map((candidate) => candidate.source),
    [asset.source],
  );
  assert.equal(cachedResponses.size, 0);
});
