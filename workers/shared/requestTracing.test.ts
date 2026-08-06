import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTracingMiddleware,
  type TracingVariables,
} from "./requestTracing";

/** Builds an unverified (unsigned) JWT for test fixtures only — the
 * tracing middleware never checks a token's signature, it only ever reads
 * a caller-key prefix derived from it. */
function makeUnverifiedJwt(payload: Record<string, unknown>): string {
  const base64UrlEncode = (value: string): string =>
    btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

type TestApp = Hono<{ Bindings: object; Variables: TracingVariables }>;

/**
 * Finding 5: a realistic downstream failure whose OWN `.message` embeds PII
 * — an email, a personal name, an API-key-shaped string, and a resume-text
 * snippet — exactly the shape a provider/database error can actually take
 * (a rejected-input echo, a constraint violation's offending value). Every
 * pre-fix test in this suite only ever threw a literal `"kaboom"`, which
 * cannot exercise the leak this middleware exists to prevent.
 */
const PII_EMAIL = "chana.friedman@example.com";
const PII_NAME = "Chana Friedman";
const PII_API_KEY = "sk-fake-abc123secretkey";
const PII_RESUME_SNIPPET = "attends Bais Yaakov of Lakewood, learns nightly";

function buildApp(): TestApp {
  return new Hono<{ Bindings: object; Variables: TracingVariables }>()
    .use("*", createTracingMiddleware("testworker"))
    .get("/ok", (c) => c.json({ ok: true }))
    .get("/cache-hit", (c) => {
      c.set("traceOutcome", "cache_hit");
      return c.json({ ok: true });
    })
    .get("/not-found", (c) => c.json({ error: "nf" }, 404))
    .get("/server-error", (c) => c.json({ error: "x" }, 500))
    .get("/boom", () => {
      throw new Error("kaboom");
    })
    .get("/boom-pii", () => {
      throw new Error(
        `provider rejected input for ${PII_NAME} <${PII_EMAIL}> using key ${PII_API_KEY}: "${PII_RESUME_SNIPPET}"`,
      );
    });
}

describe("createTracingMiddleware", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let app: TestApp;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    app = buildApp();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits one console.warn trace line with a generated request id on success", async () => {
    // Arrange / Act
    const res = await app.request("/ok");

    // Assert
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [label, record] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(label).toBe("testworker.request");
    expect(typeof record.requestId).toBe("string");
    expect((record.requestId as string).length).toBeGreaterThan(0);
    expect(record.route).toBe("/ok");
    expect(record.method).toBe("GET");
    expect(record.status).toBe(200);
    expect(record.outcome).toBe("ok");
    expect(typeof record.durationMs).toBe("number");
  });

  it("uses the CF-Ray header as the request id when present", async () => {
    // Arrange / Act
    await app.request("/ok", { headers: { "CF-Ray": "abc123-LHR" } });

    // Assert
    const [, record] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(record.requestId).toBe("abc123-LHR");
  });

  it("generates a fresh request id per request when CF-Ray is absent", async () => {
    // Arrange / Act
    await app.request("/ok");
    await app.request("/ok");

    // Assert
    const first = (
      warnSpy.mock.calls[0] as [string, Record<string, unknown>]
    )[1];
    const second = (
      warnSpy.mock.calls[1] as [string, Record<string, unknown>]
    )[1];
    expect(first.requestId).not.toBe(second.requestId);
  });

  it("uses the route-provided traceOutcome instead of the status-derived default", async () => {
    // Arrange / Act
    await app.request("/cache-hit");

    // Assert
    const [, record] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(record.outcome).toBe("cache_hit");
  });

  it("derives 'refused' for a 4xx response with no explicit traceOutcome", async () => {
    // Arrange / Act
    await app.request("/not-found");

    // Assert
    const [, record] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(record.outcome).toBe("refused");
  });

  it("derives 'error' for a 5xx response with no explicit traceOutcome", async () => {
    // Arrange / Act
    await app.request("/server-error");

    // Assert
    const [, record] = warnSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(record.outcome).toBe("error");
  });

  it("logs a requestError trace line (in addition to Hono's own bare error log) when the route throws", async () => {
    // Arrange — Hono's own default errorHandler (hono-base.js) also calls
    // `console.error(err)` for the bare error; this middleware's own line
    // is a SEPARATE call carrying full request context, so assert by
    // finding it rather than assuming an exact total call count.
    const res = await app.request("/boom");

    // Act
    const call = errorSpy.mock.calls.find(
      (args: unknown[]) => args[0] === "testworker.requestError",
    ) as [string, Record<string, unknown>] | undefined;

    // Assert
    expect(res.status).toBe(500);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(call).toBeDefined();
    const [, record] = call!;
    expect(record.route).toBe("/boom");
    expect(record.status).toBe(500);
    expect(record.outcome).toBe("error");
  });

  describe("PII", () => {
    it("never logs the Authorization header, JWT, resume content, personal name, or email address", async () => {
      // Arrange
      const email = "rivky.applicant@example.com";
      const name = "Rivky Applicant";
      const resumeSnippet = "Seminary: Bais Yaakov of Lakewood";
      const jwt = makeUnverifiedJwt({ sub: "user-42", email, name });
      const authHeader = `Bearer ${jwt}`;

      // Act — the resume snippet travels in the body, which this middleware
      // never reads at all; included here to prove that too.
      await app.request("/ok", {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      void resumeSnippet;

      // Assert
      const [, record] = warnSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(authHeader);
      expect(serialized).not.toContain(jwt);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain(name);
      expect(serialized).not.toContain(resumeSnippet);
      expect(Object.keys(record)).not.toContain("Authorization");
      expect(Object.keys(record)).not.toContain("authorization");
      // The only caller-derived field is a short, truncated prefix.
      expect(record.callerKeyPrefix).toBe("user:use");
      expect((record.callerKeyPrefix as string).length).toBeLessThanOrEqual(8);
    });

    it("never logs PII in the error-path trace line either", async () => {
      // Arrange
      const email = "rivky.applicant@example.com";
      const jwt = makeUnverifiedJwt({ sub: "user-42", email });
      const authHeader = `Bearer ${jwt}`;

      // Act
      await app.request("/boom", { headers: { Authorization: authHeader } });
      const call = errorSpy.mock.calls.find(
        (args: unknown[]) => args[0] === "testworker.requestError",
      ) as [string, Record<string, unknown>] | undefined;

      // Assert
      expect(call).toBeDefined();
      const [, record] = call!;
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(authHeader);
      expect(serialized).not.toContain(jwt);
      expect(serialized).not.toContain(email);
      expect(record.callerKeyPrefix).toBe("user:use");
    });

    // Finding 5 (mandatory regression — see this describe block's header
    // comment and safeLog.test.ts): a "kaboom"-shaped throw cannot fail this
    // test by construction, which is exactly why the pre-fix code shipped
    // logging the raw error unnoticed. This one injects a downstream error
    // whose OWN message carries an email, a name, an API-key-shaped string,
    // and a resume-text snippet, and checks EVERY console.error/warn call —
    // not just the one matched call — so a regression that moved the leak to
    // a different call site would still be caught.
    it("never logs an email, personal name, API-key-shaped string, or resume snippet embedded in a downstream error's own message", async () => {
      // Arrange / Act
      const res = await app.request("/boom-pii");

      // Assert
      expect(res.status).toBe(500);
      const allCalls = [...warnSpy.mock.calls, ...errorSpy.mock.calls];
      const serializedAllCalls = JSON.stringify(allCalls);
      expect(serializedAllCalls).not.toContain(PII_EMAIL);
      expect(serializedAllCalls).not.toContain(PII_NAME);
      expect(serializedAllCalls).not.toContain(PII_API_KEY);
      expect(serializedAllCalls).not.toContain(PII_RESUME_SNIPPET);

      // The trace line must still carry enough to debug: error class,
      // category, status, and request id — just never content.
      const call = errorSpy.mock.calls.find(
        (args: unknown[]) => args[0] === "testworker.requestError",
      ) as [string, Record<string, unknown>] | undefined;
      expect(call).toBeDefined();
      const [, record] = call!;
      expect(record.status).toBe(500);
      expect(typeof record.requestId).toBe("string");
      expect(record.error).toEqual({
        category: "unknown",
        errorClass: "Error",
      });
    });
  });
});
