import { assetCacheName } from "../synth/AssetCacheConfig.js";

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerFetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface ServiceWorkerScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEvent) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: WorkerFetchEvent) => void,
  ): void;
  skipWaiting(): Promise<void>;
}

const worker: ServiceWorkerScope = self as unknown as ServiceWorkerScope;
const applicationCachePrefix: string = "goopbox-audio-worklet-";
const applicationCacheName: string = `${applicationCachePrefix}2`;

worker.addEventListener("install", (event: ExtendableEvent): void => {
  event.waitUntil(
    caches
      .open(applicationCacheName)
      .then(async (cache: Cache): Promise<void> => {
        await cache.addAll([
          "/",
          "/synth_worklet.js",
          "https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js",
        ]);
        await worker.skipWaiting();
      }),
  );
});

worker.addEventListener("activate", (event: ExtendableEvent): void => {
  event.waitUntil(
    (async (): Promise<void> => {
      const cacheNames: string[] = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (cacheName: string): boolean =>
              cacheName.startsWith(applicationCachePrefix) &&
              cacheName != applicationCacheName,
          )
          .map((cacheName: string): Promise<boolean> =>
            caches.delete(cacheName),
          ),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event: WorkerFetchEvent): void => {
  if (event.request.method != "GET") return;

  const isPermanentExternalResource: boolean =
    event.request.url.startsWith("https://fonts.googleapis.com") ||
    event.request.url.startsWith("https://fonts.gstatic.com") ||
    event.request.url.startsWith("https://cdn.jsdelivr.net");

  event.respondWith(
    (async (): Promise<Response> => {
      const cachedAsset: Response | undefined = await (
        await caches.open(assetCacheName)
      ).match(event.request);
      if (cachedAsset != undefined) return cachedAsset;

      const applicationCache: Cache = await caches.open(applicationCacheName);
      if (isPermanentExternalResource) {
        const cachedResponse: Response | undefined =
          await applicationCache.match(event.request);
        if (cachedResponse != undefined) return cachedResponse;
        const response: Response = await fetch(event.request);
        await applicationCache.put(event.request, response.clone());
        return response;
      }

      try {
        const response: Response = await fetch(event.request);
        if (event.request.url.startsWith(worker.location.origin))
          await applicationCache.put(event.request, response.clone());
        return response;
      } catch (error: unknown) {
        const cachedResponse: Response | undefined =
          await applicationCache.match(event.request);
        if (cachedResponse != undefined) return cachedResponse;
        throw error;
      }
    })(),
  );
});
