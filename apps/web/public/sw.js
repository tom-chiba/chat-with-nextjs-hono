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

// /_next/static はコンテンツハッシュ付きで内容が不変。再検証は無駄なので cache-first。
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

// それ以外の静的アセット（同名で差し替わりうる）。stale-while-revalidate 対象。
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  );
}

// キャッシュの無制限増加を抑える。デプロイのたびに増えるハッシュ付きアセットが
// 溜まり続けないよう、挿入順（caches は挿入順を保持）に古いものから削除する。
const MAX_STATIC_ENTRIES = 96;
async function putWithLimit(cache, request, response) {
  await cache.put(request, response);
  const keys = await cache.keys();
  if (keys.length > MAX_STATIC_ENTRIES) {
    await Promise.all(
      keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((k) => cache.delete(k)),
    );
  }
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

  // 不変アセット（/_next/static）: cache-first。ヒット時は再検証 fetch をしない。
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request).catch(() => undefined);
        if (res && res.ok) await putWithLimit(cache, request, res.clone());
        return res || Response.error();
      })(),
    );
    return;
  }

  // その他の静的アセット: stale-while-revalidate。
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) putWithLimit(cache, request, res.clone());
            return res;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const data = event.data?.json() ?? {};
      const title =
        typeof data.title === "string" ? data.title : "新着メッセージ";
      const body = typeof data.body === "string" ? data.body : "";
      const url = typeof data.url === "string" ? data.url : "/";

      await self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag:
          typeof data.roomId === "string"
            ? `room-${data.roomId}`
            : "chat-message",
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(event.notification.data?.url || "/", self.location.origin);
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(url.href);
          return client.focus();
        }
      }

      return self.clients.openWindow(url.href);
    })(),
  );
});
