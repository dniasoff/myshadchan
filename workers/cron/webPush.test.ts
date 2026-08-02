import { afterEach, describe, expect, it, vi } from "vitest";

import { sendWebPush } from "./webPush";

/**
 * `sendWebPush` signs a real VAPID JWT with Web Crypto — these tests
 * generate a real P-256 key pair once, then verify the signature Web Crypto
 * itself produced actually verifies against that key, rather than merely
 * asserting the string "looks like a JWT". A broken signing pipeline (wrong
 * curve, DER instead of raw r‖s, a swapped X/Y) would still produce a
 * three-part dot-separated string; only re-verification catches it.
 */

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
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateVapidKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
  verifyKey: CryptoKey;
}> {
  // `generateKey`'s return type is `CryptoKey | CryptoKeyPair` because some
  // algorithms (e.g. AES) yield a single symmetric key — ECDSA always yields
  // a pair, so this narrows the otherwise-ambiguous union.
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const rawPublic = (await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  )) as ArrayBuffer;
  const jwkPrivate = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;
  if (!jwkPrivate.d) {
    throw new Error("exported private key JWK has no 'd' component");
  }
  return {
    publicKey: base64UrlEncode(new Uint8Array(rawPublic)),
    privateKey: jwkPrivate.d,
    verifyKey: keyPair.publicKey,
  };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
}

function parseVapidHeader(authorization: string): { jwt: string; k: string } {
  const match = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  if (!match) {
    throw new Error(
      `Authorization header did not match VAPID shape: ${authorization}`,
    );
  }
  return { jwt: match[1], k: match[2] };
}

async function verifyJwtSignature(
  jwt: string,
  verifyKey: CryptoKey,
): Promise<boolean> {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split(".");
  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`,
  );
  const signature = base64UrlDecode(encodedSignature);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    signature,
    signingInput,
  );
}

const SUBSCRIPTION = {
  endpoint: "https://push.example.test/subscriptions/abc123",
  p256dh: "unused-by-empty-payload-push",
  auth: "unused-by-empty-payload-push",
};

describe("sendWebPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a POST with a cryptographically valid VAPID Authorization header and no body", async () => {
    // Arrange
    const { publicKey, privateKey, verifyKey } = await generateVapidKeyPair();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await sendWebPush(
      SUBSCRIPTION,
      publicKey,
      privateKey,
      "mailto:ops@myshadchan.space",
    );

    // Assert
    expect(result).toEqual({ ok: true, status: 201, expired: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SUBSCRIPTION.endpoint);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();

    const headers = init.headers as Record<string, string>;
    expect(headers.TTL).toBe("60");

    const { jwt, k } = parseVapidHeader(headers.Authorization);
    expect(k).toBe(publicKey);
    expect(await verifyJwtSignature(jwt, verifyKey)).toBe(true);

    const payload = decodeJwtPayload(jwt);
    expect(payload.aud).toBe("https://push.example.test");
    expect(payload.sub).toBe("mailto:ops@myshadchan.space");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp as number).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("reports expired: true on a 410 Gone, so the sweep can self-heal the dead subscription", async () => {
    // Arrange
    const { publicKey, privateKey } = await generateVapidKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 410 })),
    );

    // Act
    const result = await sendWebPush(
      SUBSCRIPTION,
      publicKey,
      privateKey,
      "mailto:ops@myshadchan.space",
    );

    // Assert
    expect(result).toEqual({ ok: false, status: 410, expired: true });
  });

  it("reports expired: true on a 404 Not Found", async () => {
    // Arrange
    const { publicKey, privateKey } = await generateVapidKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    // Act
    const result = await sendWebPush(
      SUBSCRIPTION,
      publicKey,
      privateKey,
      "mailto:ops@myshadchan.space",
    );

    // Assert
    expect(result).toEqual({ ok: false, status: 404, expired: true });
  });

  it("reports a transport failure (e.g. 500) as not ok and not expired", async () => {
    // Arrange
    const { publicKey, privateKey } = await generateVapidKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    // Act
    const result = await sendWebPush(
      SUBSCRIPTION,
      publicKey,
      privateKey,
      "mailto:ops@myshadchan.space",
    );

    // Assert
    expect(result).toEqual({ ok: false, status: 500, expired: false });
  });

  it("rejects a VAPID_PUBLIC_KEY that is not an uncompressed P-256 point", async () => {
    // Arrange
    const badPublicKey = base64UrlEncode(new Uint8Array(65).fill(1)); // wrong leading byte
    vi.stubGlobal("fetch", vi.fn());

    // Act / Assert
    await expect(
      sendWebPush(
        SUBSCRIPTION,
        badPublicKey,
        "AA",
        "mailto:ops@myshadchan.space",
      ),
    ).rejects.toThrow(/uncompressed P-256 point/);
  });
});
