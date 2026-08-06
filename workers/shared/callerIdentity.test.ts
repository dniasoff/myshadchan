import { describe, expect, it } from "vitest";
import {
  CALLER_KEY_PREFIX_LENGTH,
  deriveCallerKey,
  deriveIpKey,
  truncateCallerKey,
} from "./callerIdentity";

/** Builds an unverified (unsigned) JWT string for test fixtures only —
 * `deriveCallerKey` never checks the signature, so no real signing is
 * needed to exercise it. */
function makeUnverifiedJwt(payload: Record<string, unknown>): string {
  const base64UrlEncode = (value: string): string =>
    btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

describe("deriveCallerKey", () => {
  it("returns a user-prefixed key for a JWT with a sub claim", () => {
    // Arrange
    const jwt = makeUnverifiedJwt({
      sub: "11111111-2222-3333-4444-555555555555",
    });

    // Act
    const key = deriveCallerKey(`Bearer ${jwt}`);

    // Assert
    expect(key).toBe("user:11111111-2222-3333-4444-555555555555");
  });

  it("is case-insensitive and whitespace-tolerant about the Bearer prefix", () => {
    // Arrange
    const jwt = makeUnverifiedJwt({ sub: "user-1" });

    // Act
    const key = deriveCallerKey(`bearer   ${jwt}`);

    // Assert
    expect(key).toBe("user:user-1");
  });

  it("returns the anonymous bucket when the header is missing", () => {
    // Arrange / Act
    const key = deriveCallerKey(undefined);

    // Assert
    expect(key).toBe("anonymous");
  });

  it("returns the anonymous bucket when the header is null", () => {
    // Arrange / Act
    const key = deriveCallerKey(null);

    // Assert
    expect(key).toBe("anonymous");
  });

  it("returns the anonymous bucket for a token that is not a well-formed JWT", () => {
    // Arrange / Act
    const key = deriveCallerKey("Bearer not-a-jwt");

    // Assert
    expect(key).toBe("anonymous");
  });

  it("returns the anonymous bucket for a JWT payload with no sub claim", () => {
    // Arrange
    const jwt = makeUnverifiedJwt({ role: "authenticated" });

    // Act
    const key = deriveCallerKey(`Bearer ${jwt}`);

    // Assert
    expect(key).toBe("anonymous");
  });

  it("returns the anonymous bucket when the payload segment is not valid JSON", () => {
    // Arrange — well-formed three-segment shape, but garbage payload content.
    const token = "aGVhZGVy.bm90LWpzb24.c2ln";

    // Act
    const key = deriveCallerKey(`Bearer ${token}`);

    // Assert
    expect(key).toBe("anonymous");
  });

  it("returns different keys for different callers", () => {
    // Arrange
    const jwtA = makeUnverifiedJwt({ sub: "user-a" });
    const jwtB = makeUnverifiedJwt({ sub: "user-b" });

    // Act
    const keyA = deriveCallerKey(`Bearer ${jwtA}`);
    const keyB = deriveCallerKey(`Bearer ${jwtB}`);

    // Assert
    expect(keyA).not.toBe(keyB);
  });
});

describe("deriveIpKey", () => {
  it("returns an ip-prefixed key for a present header", () => {
    // Arrange / Act
    const key = deriveIpKey("203.0.113.7");

    // Assert
    expect(key).toBe("ip:203.0.113.7");
  });

  it("trims surrounding whitespace", () => {
    // Arrange / Act
    const key = deriveIpKey("  203.0.113.7  ");

    // Assert
    expect(key).toBe("ip:203.0.113.7");
  });

  it("returns the unknown bucket when the header is missing", () => {
    // Arrange / Act
    const key = deriveIpKey(undefined);

    // Assert
    expect(key).toBe("unknown");
  });

  it("returns the unknown bucket when the header is empty", () => {
    // Arrange / Act
    const key = deriveIpKey("   ");

    // Assert
    expect(key).toBe("unknown");
  });
});

describe("truncateCallerKey", () => {
  it("truncates to the documented prefix length", () => {
    // Arrange
    const key = "user:11111111-2222-3333-4444-555555555555";

    // Act
    const truncated = truncateCallerKey(key);

    // Assert
    expect(truncated).toHaveLength(CALLER_KEY_PREFIX_LENGTH);
    expect(truncated).toBe("user:111");
  });

  it("returns a short key unchanged", () => {
    // Arrange
    const key = "anon";

    // Act
    const truncated = truncateCallerKey(key);

    // Assert
    expect(truncated).toBe("anon");
  });
});
