import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadAssetCache() {
  const storage = new Map();
  const cachedResponses = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.caches = {
    open: async () => ({
      put: async (url, response) => cachedResponses.set(String(url), response),
      delete: async (url) => cachedResponses.delete(String(url)),
    }),
    delete: async () => {
      cachedResponses.clear();
      return true;
    },
  };

  const directory = await mkdtemp(join(tmpdir(), "goopbox-asset-cache-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["synth/AssetCache.ts"],
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

test("asset caching defaults on and pinned assets are manual", async (context) => {
  const { module, storage, cleanup } = await loadAssetCache();
  context.after(cleanup);
  const asset = {
    source: "!r48!https://example.com/piano.wav",
    id: "asset:test",
    url: "https://example.com/piano.wav",
    name: "piano",
    rootKey: 48,
    type: "sample",
  };

  assert.equal(module.isAssetCacheEnabled(), true);
  assert.deepEqual(module.getPinnedAssets(), []);
  module.pinAsset(asset);
  assert.deepEqual(
    module.getPinnedAssets().map((candidate) => candidate.source),
    [asset.source],
  );
  module.unpinAsset(asset);
  assert.deepEqual(module.getPinnedAssets(), []);
  assert.equal(storage.get("assetCacheEnabled"), undefined);
});

test("disabling the cache deletes responses and pinned assets", async (context) => {
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
  module.cacheAsset(asset, new Response("audio"));
  await module.disableAndDeleteAssetCache();

  assert.equal(module.isAssetCacheEnabled(), false);
  assert.deepEqual(module.getPinnedAssets(), []);
  assert.equal(cachedResponses.size, 0);
});
