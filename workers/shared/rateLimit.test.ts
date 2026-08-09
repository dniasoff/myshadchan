import { Hono } from "hono";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  checkRateLimit,
  createRateLimitMiddleware,
  isRateLimitingEnforced,
  resolveRateLimitState,
  type RateLimitEnforcementEnv,
} from "./rateLimit";

describe("checkRateLimit", () => {
  describe("when the binding is not configured in this environment", () => {
    it("allows the request when enforcement is not declared", async () => {
      // Arrange / Act
      const result = await checkRateLimit({
        binding: undefined,
        key: "user:1",
        enforced: false,
      });

      // Assert
      expect(result).toEqual({ allowed: true });
    });

    it("refuses with limiter_error when this environment declares enforcement", async () => {
      // Arrange — a dropped `[[ratelimits]]` block in a real deploy must not
      // silently pass every request.
      const result = await checkRateLimit({
        binding: undefined,
        key: "user:1",
        enforced: true,
      });

      // Assert
      expect(result).toEqual({ allowed: false, reason: "limiter_error" });
    });
  });

  describe("when the binding is present and resolves", () => {
    it("allows the request when the binding reports success", async () => {
      // Arrange
      const binding = { limit: vi.fn().mockResolvedValue({ success: true }) };

      // Act
      const result = await checkRateLimit({
        binding,
        key: "user:1",
        enforced: true,
      });

      // Assert
      expect(result).toEqual({ allowed: true });
      expect(binding.limit).toHaveBeenCalledWith({ key: "user:1" });
    });

    it("refuses with over_limit when the binding reports failure", async () => {
      // Arrange
      const binding = { limit: vi.fn().mockResolvedValue({ success: false }) };

      // Act
      const result = await checkRateLimit({
        binding,
        key: "user:1",
        enforced: true,
      });

      // Assert
      expect(result).toEqual({ allowed: false, reason: "over_limit" });
    });
  });

  describe("when the binding is present and throws — the crux case", () => {
    it("ALWAYS refuses with limiter_error, even when enforcement is not declared", async () => {
      // Arrange — a present-but-erroring binding is a live fault, never an
      // "unconfigured environment" signal, regardless of `enforced`.
      const binding = {
        limit: vi.fn().mockRejectedValue(new Error("rate limiter down")),
      };

      // Act
      const result = await checkRateLimit({
        binding,
        key: "user:1",
        enforced: false,
      });

      // Assert
      expect(result).toEqual({ allowed: false, reason: "limiter_error" });
    });

    it("ALWAYS refuses with limiter_error when enforcement is also declared", async () => {
      // Arrange
      const binding = {
        limit: vi.fn().mockRejectedValue(new Error("rate limiter down")),
      };

      // Act
      const result = await checkRateLimit({
        binding,
        key: "user:1",
        enforced: true,
      });

      // Assert
      expect(result).toEqual({ allowed: false, reason: "limiter_error" });
    });
  });

  describe("the limiter_error log line — PII redaction (External review Finding 5 residual)", () => {
    let consoleErrorSpy: MockInstance;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    // A realistic downstream failure whose OWN `.message` embeds PII — an
    // email, a personal name, an API-key-shaped string, and a resume-text
    // snippet — exactly the shape a Cloudflare RateLimit binding's own
    // error could take if it ever wraps a provider/network failure. The
    // "when the binding is present and throws" tests above only ever threw
    // a literal "rate limiter down", which cannot exercise the leak this
    // redaction exists to prevent — that is exactly how the pre-fix
    // `console.error("rateLimit.limiterError", error)` survived a whole
    // prior review wave unnoticed.
    const PII_EMAIL = "chana.friedman@example.com";
    const PII_NAME = "Chana Friedman";
    const PII_API_KEY = "sk-fake-abc123secretkey";
    const PII_RESUME_SNIPPET =
      "attends Bais Yaakov of Lakewood, learns nightly";

    it("never logs an email, personal name, API-key-shaped string, or resume snippet embedded in a throwing binding's own error message", async () => {
      // Arrange
      const binding = {
        limit: vi
          .fn()
          .mockRejectedValue(
            new Error(
              `provider rejected input for ${PII_NAME} <${PII_EMAIL}> using key ${PII_API_KEY}: "${PII_RESUME_SNIPPET}"`,
            ),
          ),
      };

      // Act
      const result = await checkRateLimit({
        binding,
        key: "user:1",
        enforced: true,
        limiterName: "parse-user",
      });

      // Assert — the fail-closed decision is unaffected by this change.
      expect(result).toEqual({ allowed: false, reason: "limiter_error" });

      const serializedCalls = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(serializedCalls).not.toContain(PII_EMAIL);
      expect(serializedCalls).not.toContain(PII_NAME);
      expect(serializedCalls).not.toContain(PII_API_KEY);
      expect(serializedCalls).not.toContain(PII_RESUME_SNIPPET);

      // The line still carries enough to debug: error class and which
      // limiter refused — just never content.
      expect(consoleErrorSpy).toHaveBeenCalledWith("rateLimit.limiterError", {
        limiterName: "parse-user",
        error: { category: "unknown", errorClass: "Error" },
      });
    });
  });

  it("distinguishes a throwing binding from an unconfigured one under identical enforcement", async () => {
    // Arrange — same `enforced: false` in both cases; only the binding
    // differs. If these ever produced the same outcome, the fail-closed
    // guarantee would be indistinguishable from "not configured here".
    const throwing = {
      limit: vi.fn().mockRejectedValue(new Error("down")),
    };

    // Act
    const unconfigured = await checkRateLimit({
      binding: undefined,
      key: "user:1",
      enforced: false,
    });
    const errored = await checkRateLimit({
      binding: throwing,
      key: "user:1",
      enforced: false,
    });

    // Assert
    expect(unconfigured.allowed).toBe(true);
    expect(errored).toEqual({ allowed: false, reason: "limiter_error" });
  });
});

describe("resolveRateLimitState", () => {
  it("resolves the exact literal 'true' to enforced", () => {
    // Arrange / Act / Assert
    expect(resolveRateLimitState("true")).toBe("enforced");
  });

  it("resolves an unset value to not_configured", () => {
    // Arrange — the only legitimate case: a plain-Node test harness that
    // never goes through wrangler at all.
    expect(resolveRateLimitState(undefined)).toBe("not_configured");
  });

  it("resolves 'false' to malformed, not to not_configured", () => {
    // Arrange — External review Finding 3: nothing in this repo's deploy
    // path legitimately produces a literal "false"; wrangler.toml's [vars]
    // always declares "true". A stray "false" is drift, not an intentional
    // off switch, and must not resolve the same way as a clean absence.
    expect(resolveRateLimitState("false")).toBe("malformed");
  });

  it("resolves a differently-cased or otherwise unrecognized value to malformed", () => {
    // Arrange / Act / Assert
    expect(resolveRateLimitState("TRUE")).toBe("malformed");
    expect(resolveRateLimitState("1")).toBe("malformed");
    expect(resolveRateLimitState("")).toBe("malformed");
  });
});

describe("isRateLimitingEnforced", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns true for the exact literal 'true'", () => {
    // Arrange / Act / Assert
    expect(isRateLimitingEnforced("true")).toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns false when unset — the only environment allowed to fail open", () => {
    // Arrange / Act / Assert
    expect(isRateLimitingEnforced(undefined)).toBe(false);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // The exact bug External review Finding 3 reported: the pre-fix code
  // returned `false` (not enforced) here — a manual deploy that mistyped or
  // dropped the enforcement marker got unlimited rate limiting silently.
  it("returns true (fail closed) for 'false' — malformed values are rejected, not treated as off", () => {
    // Arrange / Act / Assert
    expect(isRateLimitingEnforced("false")).toBe(true);
  });

  it("returns true (fail closed) for a differently-cased or malformed value", () => {
    // Arrange / Act / Assert
    expect(isRateLimitingEnforced("TRUE")).toBe(true);
    expect(isRateLimitingEnforced("1")).toBe(true);
  });

  it("logs the malformed value so it is visible in Cloudflare Logs", () => {
    // Arrange / Act
    isRateLimitingEnforced("TRUE");

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "rateLimit.enforcementMarkerMalformed",
      { value: "TRUE" },
    );
  });
});

interface TestEnv extends RateLimitEnforcementEnv {
  TEST_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

const TEST_CONFIG = { limit: 10, periodSeconds: 60 as const };

function buildApp() {
  return new Hono<{ Bindings: TestEnv }>()
    .use(
      "*",
      createRateLimitMiddleware<{ Bindings: TestEnv }>({
        limiterName: "test-limiter",
        config: TEST_CONFIG,
        getBinding: (env) => env.TEST_LIMITER,
        deriveKey: () => "user:1",
        workerName: "test",
        surface: "test",
      }),
    )
    .all("*", (c) => c.text("ok"));
}

describe("createRateLimitMiddleware", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  it("bypasses /health without consulting the binding", async () => {
    // Arrange
    const limiter = { limit: vi.fn() };
    const env: TestEnv = { TEST_LIMITER: limiter };

    // Act
    const res = await app.request("/health", {}, env);

    // Assert
    expect(res.status).toBe(200);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("calls next and returns 200 when the request is allowed", async () => {
    // Arrange
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const env: TestEnv = { TEST_LIMITER: limiter };

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("returns 429 with a Retry-After header when the caller is over the limit", async () => {
    // Arrange
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const env: TestEnv = { TEST_LIMITER: limiter };

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({
      success: false,
      error: "rate limit exceeded",
      meta: { limiter: "test-limiter" },
    });
  });

  it("returns 503 when the binding is absent and this environment declares enforcement", async () => {
    // Arrange
    const env: TestEnv = { RATE_LIMITING_ENFORCED: "true" };

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: "rate limiter unavailable",
      meta: { limiter: "test-limiter" },
    });
  });

  it("allows the request when the binding is absent and enforcement is not declared", async () => {
    // Arrange — local dev / this repo's plain-Node "workers" vitest project:
    // no binding, no RATE_LIMITING_ENFORCED secret.
    const env: TestEnv = {};

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(200);
  });

  it("returns 503 when the binding is absent and the enforcement marker is malformed — External review Finding 3", async () => {
    // Arrange — a stray, unrecognized value must fail CLOSED, not silently
    // behave like the binding was never configured here at all.
    const env: TestEnv = { RATE_LIMITING_ENFORCED: "TRUE" };

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(503);
  });

  it("returns 503 when the binding throws, even without enforcement declared", async () => {
    // Arrange
    const limiter = { limit: vi.fn().mockRejectedValue(new Error("down")) };
    const env: TestEnv = { TEST_LIMITER: limiter };

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(503);
  });
});
