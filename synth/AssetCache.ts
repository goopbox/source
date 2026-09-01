import { parseAssetDefinition, type AssetDefinition } from "./SynthConfig.js";
import { assetCacheName } from "./AssetCacheConfig.js";

export { assetCacheName };
export const assetCacheEvents: EventTarget = new EventTarget();

const pinnedStorageKey: string = "pinnedAssets";
let pendingCacheOperation: Promise<void> = Promise.resolve();

function readPinnedSources(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(pinnedStorageKey) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (source: unknown): source is string => typeof source == "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writePinnedSources(sources: readonly string[]): void {
  localStorage.setItem(pinnedStorageKey, JSON.stringify(sources));
  assetCacheEvents.dispatchEvent(new Event("change"));
}

function enqueueCacheOperation(operation: () => Promise<void>): Promise<void> {
  const result: Promise<void> = pendingCacheOperation.then(
    operation,
    operation,
  );
  pendingCacheOperation = result.catch((): void => {});
  return result;
}

export function cacheAsset(asset: AssetDefinition, response: Response): void {
  if (typeof caches == "undefined") return;
  void enqueueCacheOperation(async (): Promise<void> => {
    await (await caches.open(assetCacheName)).put(asset.url, response);
  }).catch((): void => {
    /* Caching is opportunistic. */
  });
}

export function getPinnedAssets(): AssetDefinition[] {
  return readPinnedSources().flatMap((source: string): AssetDefinition[] => {
    const asset: AssetDefinition | null = parseAssetDefinition(source);
    return asset == null ? [] : [asset];
  });
}

export function pinAsset(asset: AssetDefinition): void {
  const sources: string[] = readPinnedSources().filter(
    (source: string): boolean => source != asset.source,
  );
  sources.unshift(asset.source);
  writePinnedSources(sources);
}

export function unpinAsset(asset: AssetDefinition): void {
  writePinnedSources(
    readPinnedSources().filter(
      (source: string): boolean => source != asset.source,
    ),
  );
}

export function resetAssetCache(): Promise<void> {
  return enqueueCacheOperation(async (): Promise<void> => {
    try {
      if (typeof caches != "undefined") await caches.delete(assetCacheName);
    } finally {
      assetCacheEvents.dispatchEvent(new Event("change"));
    }
  });
}
