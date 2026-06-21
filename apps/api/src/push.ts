import type { ChatMessage } from "@repo/shared";
import type { AuthEnv } from "./auth";
import type { Db } from "./db";
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsForRoomMembers,
} from "./db/push-subscriptions";

type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSendResult =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "failed"; statusCode?: number };

export interface PushSender {
  send(
    subscription: StoredPushSubscription,
    payload: string,
  ): Promise<PushSendResult>;
}

export type FetchLike = typeof fetch;

const encoder = new TextEncoder();
const AES_128_GCM_RECORD_SIZE = 4096;
// RFC 8291 Section 4: 4096 octet body support minus aes128gcm header (86),
// delimiter (1), and authentication tag (16).
const MAX_WEB_PUSH_PLAINTEXT_BYTES = 3993;

export function vapidSubject(env: AuthEnv) {
  return env.VAPID_SUBJECT || `mailto:${env.EMAIL_FROM}`;
}

export function hasPushConfig(env: AuthEnv) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function createWebCryptoPushSender(
  env: AuthEnv,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): PushSender | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return new WebCryptoPushSender({
    publicKey,
    privateKey,
    subject: vapidSubject(env),
    fetchImpl,
  });
}

export async function sendMessagePushNotifications({
  db,
  env,
  message,
  excludeUserIds,
  pushSender = createWebCryptoPushSender(env) ?? undefined,
}: {
  db: Db;
  env: AuthEnv;
  message: ChatMessage;
  excludeUserIds?: Set<string>;
  pushSender?: PushSender;
}) {
  if (!pushSender) return;

  const subscriptions = await listPushSubscriptionsForRoomMembers(db, {
    roomId: message.roomId,
    senderUserId: message.userId,
    excludeUserIds,
  });

  const payload = JSON.stringify({
    title: `${message.userName} さんから新着メッセージ`,
    body: message.body,
    roomId: message.roomId,
    messageId: message.id,
    url: `/?room=${encodeURIComponent(message.roomId)}`,
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      let result: PushSendResult;
      try {
        result = await pushSender.send(subscription, payload);
      } catch (error) {
        console.error("Push notification delivery threw", {
          endpointHost: safeEndpointHost(subscription.endpoint),
          error: normalizePushError(error),
        });
        await deletePushSubscriptionByEndpoint(db, subscription.endpoint);
        return;
      }

      if (result.status === "gone") {
        await deletePushSubscriptionByEndpoint(db, subscription.endpoint);
        return;
      }
      if (result.status === "failed") {
        console.error("Push notification delivery failed", {
          status: result.statusCode,
          endpointHost: safeEndpointHost(subscription.endpoint),
        });
      }
    }),
  );
}

class WebCryptoPushSender implements PushSender {
  constructor(
    private readonly options: {
      publicKey: string;
      privateKey: string;
      subject: string;
      fetchImpl: FetchLike;
    },
  ) {}

  async send(
    subscription: StoredPushSubscription,
    payload: string,
  ): Promise<PushSendResult> {
    if (encoder.encode(payload).length > MAX_WEB_PUSH_PLAINTEXT_BYTES) {
      return { status: "failed" };
    }

    const encrypted = await encryptPayload(subscription, payload);
    const aud = new URL(subscription.endpoint).origin;
    const token = await createVapidJwt({
      audience: aud,
      subject: this.options.subject,
      publicKey: this.options.publicKey,
      privateKey: this.options.privateKey,
    });

    const response = await this.options.fetchImpl(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${token}, k=${this.options.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "2419200",
        Urgency: "normal",
      },
      body: encrypted,
    });

    if (response.ok) return { status: "sent" };
    if (response.status === 404 || response.status === 410) {
      return { status: "gone" };
    }
    return { status: "failed", statusCode: response.status };
  }
}

async function createVapidJwt({
  audience,
  subject,
  publicKey,
  privateKey,
}: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
}) {
  const header = base64UrlEncodeJson({ typ: "JWT", alg: "ES256" });
  const claims = base64UrlEncodeJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const input = `${header}.${claims}`;
  const key = await importVapidPrivateKey(publicKey, privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(input),
  );
  return `${input}.${bytesToBase64Url(ecdsaSignatureToJose(signature))}`;
}

async function importVapidPrivateKey(publicKey: string, privateKey: string) {
  const publicBytes = base64UrlToBytes(publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error("invalid VAPID public key");
  }

  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: privateKey.replace(/=+$/g, ""),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function encryptPayload(
  subscription: StoredPushSubscription,
  payload: string,
) {
  const receiverPublicKeyBytes = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  const receiverPublicKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const senderKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const senderPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", senderKeys.publicKey) as ArrayBuffer,
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverPublicKey } as never,
      senderKeys.privateKey,
      256,
    ),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(
    prkKey,
    concatBytes(
      encoder.encode("WebPush: info\0"),
      receiverPublicKeyBytes,
      senderPublicKey,
    ),
    32,
  );
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(
    prk,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdfExpand(
    prk,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  const contentEncryptionKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const record = concatBytes(encoder.encode(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      contentEncryptionKey,
      toArrayBuffer(record),
    ),
  );

  return concatBytes(
    salt,
    uint32(AES_128_GCM_RECORD_SIZE),
    new Uint8Array([senderPublicKey.length]),
    senderPublicKey,
    ciphertext,
  );
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(ikm)));
}

async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prk),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      toArrayBuffer(concatBytes(info, new Uint8Array([0x01]))),
    ),
  );
  return result.slice(0, length);
}

function base64UrlEncodeJson(value: unknown) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function base64UrlToBytes(value: string) {
  const base64 = normalizeBase64Url(value).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeBase64Url(value: string) {
  const withoutPadding = value.replace(/=+$/g, "");
  return withoutPadding + "=".repeat((4 - (withoutPadding.length % 4)) % 4);
}

function ecdsaSignatureToJose(signature: ArrayBuffer) {
  const bytes = new Uint8Array(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30) {
    throw new Error("unsupported ECDSA signature format");
  }

  let offset = 2;
  const rLength = bytes[offset + 1] ?? 0;
  const r = bytes.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  const sLength = bytes[offset + 1] ?? 0;
  const s = bytes.slice(offset + 2, offset + 2 + sLength);
  return concatBytes(leftPad32(r), leftPad32(s));
}

function leftPad32(bytes: Uint8Array) {
  const withoutLeadingZero = bytes[0] === 0 ? bytes.slice(1) : bytes;
  if (withoutLeadingZero.length > 32) {
    throw new Error("invalid ECDSA signature integer");
  }
  const result = new Uint8Array(32);
  result.set(withoutLeadingZero, 32 - withoutLeadingZero.length);
  return result;
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function uint32(value: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function safeEndpointHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

function normalizePushError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
