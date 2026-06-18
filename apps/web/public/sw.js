/* Service Worker（軽量チャットツールの最小オフライン対応）
 *
 * 方針:
 * - ナビゲーション（HTML）: network-first。失敗時はキャッシュ → /offline にフォールバック。
 * - 静的アセット（/_next/static, /icons, アイコン類）: stale-while-revalidate。
 * - それ以外（API・WebSocket・クロスオリジン）: 介入しない（素通し）。
 *
 * 注意: 認証/チャットの動的データはキャッシュしない（古い内容の表示やセッション漏れを避ける）。
 */

const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_URL = "/offline";

// インストール時に最小限のシェルを先読みする。
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 旧バージョンのキャッシュを破棄する。
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外（POST など）と同一オリジン以外は介入しない。
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ナビゲーション: network-first → キャッシュ → オフラインページ。
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match(request);
          return cached || (await cache.match(OFFLINE_URL));
        }
      })(),
    );
    return;
  }

  // 静的アセット: stale-while-revalidate。
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })(),
    );
  }
});
