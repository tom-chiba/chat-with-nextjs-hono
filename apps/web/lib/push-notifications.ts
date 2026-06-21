import { client } from "./rpc";

export type PushNotificationCapability =
  | "supported"
  | "unsupported"
  | "denied";

export function getPushNotificationCapability(): PushNotificationCapability {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

export async function currentPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

export async function subscribeToPushNotifications() {
  const publicKey = await fetchVapidPublicKey();
  const registration = await ensureServiceWorkerRegistration();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知が許可されませんでした");
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await savePushSubscription(subscription);
  return subscription;
}

export async function unsubscribeFromPushNotifications() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;

  await deletePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

async function fetchVapidPublicKey() {
  const res = await client.push["vapid-public-key"].$get();
  if (!res.ok) throw new Error("Push 通知はまだ設定されていません");
  const data = await res.json();
  if (typeof data.publicKey !== "string" || data.publicKey.length === 0) {
    throw new Error("Push 通知の公開鍵が取得できませんでした");
  }
  return data.publicKey;
}

async function savePushSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Push Subscription の形式が不正です");
  }
  const res = await client.push.subscriptions.$post({
    json: {
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      },
    },
  });
  if (!res.ok) throw new Error("通知の購読登録に失敗しました");
}

async function deletePushSubscription(endpoint: string) {
  const res = await client.push.subscriptions.$delete({ json: { endpoint } });
  if (!res.ok) throw new Error("通知の購読解除に失敗しました");
}

async function ensureServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
