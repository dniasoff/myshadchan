/**
 * Story 7.5 (Task 6, AC-5, AC-9, AC-10): sends a Web Push message (VAPID,
 * RFC 8292) to one registered subscription.
 *
 * Deliberately an EMPTY-payload push, not an encrypted one. The `web-push`
 * npm package depends on Node's `crypto` module, which Cloudflare Workers do
 * not provide even under `nodejs_compat` for every API surface that package
 * needs — the story's own Task 6 says not to add it as a dependency without
 * first verifying it under this project's flag, and there is no Workers
 * runtime available to verify that claim in this environment. Rather than
 * ship an unverified dependency (or a hand-rolled RFC 8291 aes128gcm
 * payload-encryption implementation — real cryptography, wrong in subtle
 * ways, with no test vectors on hand to check it against), this sends a
 * push with NO application payload at all: RFC 8030 requires every push
 * service to accept a zero-length body, VAPID auth needs nothing but the
 * signed JWT, and Task 5's own principle ("never include message body text
 * in the email") applies here for free — a push that carries no content
 * can't leak one. The service worker's own `push` handler (this story's
 * Task 7, `vite.config.ts` — outside this stack's declared file set) shows
 * a fixed "you have a new message" notification and lets `notificationclick`
 * do the navigating; it needs no decrypted payload to do either.
 *
 * `p256dh`/`auth` stay on `PushSubscription` (types.ts) and in the stored
 * row regardless: they cost nothing to keep and are exactly what a future,
 * verified payload-encryption story would need without a second migration.
 *
 * VAPID itself (the `Authorization: vapid t=<jwt>, k=<publicKey>` header) IS
 * implemented here, with Web Crypto directly (`crypto.subtle.importKey` /
 * `.sign`) rather than a library — ES256 JWT signing is small, well-
 * specified, and exactly what Workers' documented Web Crypto support
 * covers, unlike payload encryption's ECDH + HKDF + AES-GCM chain.
 */

export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendWebPushResult {
  ok: boolean;
  status: number;
  /**
   * True on 404/410 — the push service is telling us the subscription is
   * dead. The caller (sweepMessages.ts) is the one that acts on this by
   * calling `delete_push_subscription_by_endpoint()`, never a `.from(...)`
   * call from this file (AC-10).
   */
  expired: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * `VAPID_PUBLIC_KEY` is the standard uncompressed P-256 point (65 bytes:
 * 0x04 || X(32) || Y(32), base64url-encoded) every Web Push library
 * generates. `VAPID_PRIVATE_KEY` is the raw 32-byte scalar. Web Crypto's
 * `importKey("raw", …)` cannot import an EC private key at all — it needs
 * `jwk` or `pkcs8` — so this reassembles the JWK Web Crypto wants from the
 * public point's X/Y plus the private scalar.
 */
async function importVapidPrivateKey(
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<CryptoKey> {
  const publicKeyBytes = base64UrlDecode(vapidPublicKey);
  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error(
      "VAPID_PUBLIC_KEY must be an uncompressed P-256 point (65 bytes, leading 0x04)",
    );
  }
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);
  const d = base64UrlDecode(vapidPrivateKey);

  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(d),
    ext: true,
  };

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The `Authorization` header VAPID (RFC 8292) requires: a short-lived JWT
 * naming the push service's origin as `aud`, signed ES256, plus the raw
 * public key so the push service can verify it without a prior handshake.
 * `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, …)` already
 * produces the raw (r‖s) signature JWS ES256 requires — never the DER form
 * some other ECDSA APIs default to.
 */
async function buildVapidAuthorization(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const encoder = new TextEncoder();

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    // 12 hours — comfortably inside RFC 8292's "no more than 24 hours"
    // ceiling, and this token is minted fresh on every send, never cached.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapidSubject,
  };

  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importVapidPrivateKey(vapidPublicKey, vapidPrivateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput),
  );
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  const jwt = `${signingInput}.${encodedSignature}`;

  return `vapid t=${jwt}, k=${vapidPublicKey}`;
}

/**
 * Sends one empty-payload Web Push message. `vapidSubject` is a
 * `mailto:`/`https:` contact URI, per RFC 8292 — the push service's own
 * abuse-contact convention, not this app's data.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<SendWebPushResult> {
  const authorization = await buildVapidAuthorization(
    subscription.endpoint,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
  );

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      TTL: "60",
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    expired: response.status === 404 || response.status === 410,
  };
}
