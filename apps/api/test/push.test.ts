import { describe, expect, test } from "vitest";
import { createWebCryptoPushSender, type FetchLike, type PushSender } from "../src/push";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function generateVapidKeys() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey;
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error("invalid test VAPID key");
  return {
    publicKey: bytesToBase64Url(
      Uint8Array.from([0x04, ...base64UrlToBytes(jwk.x), ...base64UrlToBytes(jwk.y)]),
    ),
    privateKey: jwk.d,
  };
}

async function generateSubscriptionKeys() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: keys.privateKey,
    publicKey,
    p256dh: bytesToBase64Url(publicKey),
    authSecret: auth,
    auth: bytesToBase64Url(auth),
  };
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

describe("WebCryptoPushSender", () => {
  test("Workers 標準 API だけで暗号化した Web Push リクエストを作る", async () => {
    const vapid = await generateVapidKeys();
    const subscriptionKeys = await generateSubscriptionKeys();
    const requests: Request[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 201 });
    };
    const sender = createWebCryptoPushSender(
      {
        EMAIL_FROM: "test@example.com",
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
      },
      fetchImpl,
    );
    if (!sender) throw new Error("sender was not created");

    const result = await sender.send(
      {
        endpoint: "https://push.example.com/send/1",
        p256dh: subscriptionKeys.p256dh,
        auth: subscriptionKeys.auth,
      },
      JSON.stringify({ body: "hello" }),
    );

    expect(result).toEqual({ status: "sent" });
    const request = requests[0];
    if (!request) throw new Error("push request was not sent");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(request?.headers.get("Authorization")).toContain("vapid t=");
    expect(request?.headers.get("Authorization")).toContain(`k=${vapid.publicKey}`);

    const body = new Uint8Array(await request.arrayBuffer());
    expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65);
    expect(body.length).toBeLessThanOrEqual(4096);
    expect(new DataView(body.buffer).getUint32(16, false)).toBe(4096);
    expect(body[20]).toBe(65);

    const decrypted = await decryptWebPushBody({
      body,
      receiverPrivateKey: subscriptionKeys.privateKey,
      receiverPublicKey: subscriptionKeys.publicKey,
      authSecret: subscriptionKeys.authSecret,
    });
    expect(decrypted).toBe(JSON.stringify({ body: "hello" }));
  });

  test("404/410 は失効 subscription として返す", async () => {
    const sender: PushSender = {
      async send() {
        return { status: "gone" };
      },
    };
    await expect(
      sender.send(
        {
          endpoint: "https://push.example.com/gone",
          p256dh: "unused",
          auth: "unused",
        },
        "{}",
      ),
    ).resolves.toEqual({ status: "gone" });
  });
});

async function decryptWebPushBody({
  body,
  receiverPrivateKey,
  receiverPublicKey,
  authSecret,
}: {
  body: Uint8Array;
  receiverPrivateKey: CryptoKey;
  receiverPublicKey: Uint8Array;
  authSecret: Uint8Array;
}) {
  const salt = body.slice(0, 16);
  const idLength = body[20] ?? 0;
  const senderPublicKeyBytes = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const senderPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(senderPublicKeyBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: senderPublicKey } as never,
      receiverPrivateKey,
      256,
    ),
  );

  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(
    prkKey,
    concatBytes(encoder.encode("WebPush: info\0"), receiverPublicKey, senderPublicKeyBytes),
    32,
  );
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(cek), { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      key,
      toArrayBuffer(ciphertext),
    ),
  );
  expect(plaintext.at(-1)).toBe(0x02);
  return decoder.decode(plaintext.slice(0, -1));
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

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prk),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(concatBytes(info, new Uint8Array([0x01])))),
  );
  return result.slice(0, length);
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
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
