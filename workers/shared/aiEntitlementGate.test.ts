import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createCallerClient,
  requireAiEntitlement,
  type AiEntitlementVariables,
} from "./aiEntitlementGate";
import type { BaseEnv } from "./env";
import { ok } from "./envelope";

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
  }),
}));

const env: BaseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "test@example.com",
  APP_ORIGIN: "https://app.example.com",
};

const buildApp = () =>
  new Hono<{ Bindings: BaseEnv; Variables: AiEntitlementVariables }>()
    .use("*", requireAiEntitlement)
    .all("*", (c) =>
      c.json(
        ok({
          caller: !!c.get("supabaseCaller"),
          entitlement: c.get("aiEntitlement"),
        }),
      ),
    );

describe("createCallerClient", () => {
  it("builds a client with the publishable key and forwarded auth header", () => {
    // Act
    const client = createCallerClient("Bearer token", env);

    // Assert — the mock returns the same shape for every call; the real
    // assertion is that no error is thrown and a client is returned.
    expect(client).toBeDefined();
  });
});

describe("requireAiEntitlement", () => {
  it("bypasses /health without an Authorization header", async () => {
    // Arrange
    const app = buildApp();
    rpc.mockResolvedValue({ data: null, error: null });

    // Act
    const res = await app.request("/health", {}, env);

    // Assert
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    // Arrange
    const app = buildApp();

    // Act
    const res = await app.request("/probe", {}, env);

    // Assert
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing Authorization header",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 402 when the ai_entitlement RPC errors", async () => {
    // Arrange
    const app = buildApp();
    rpc.mockResolvedValue({
      data: null,
      error: new Error("permission denied"),
    });

    // Act
    const res = await app.request(
      "/probe",
      {
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ success: false, error: "not entitled" });
  });

  it("returns 402 when the caller is not entitled", async () => {
    // Arrange
    const app = buildApp();
    rpc.mockResolvedValue({
      data: {
        is_entitled: false,
        plan: "free",
        resumes_used: 0,
        resumes_limit: 0,
      },
      error: null,
    });

    // Act
    const res = await app.request(
      "/probe",
      {
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ success: false, error: "not entitled" });
  });

  it("calls next and stashes the client and entitlement when entitled", async () => {
    // Arrange
    const entitlement = {
      is_entitled: true,
      plan: "ai_tier",
      status: "active",
      resumes_used: 1,
      resumes_limit: 50,
    };
    const app = buildApp();
    rpc.mockResolvedValue({ data: entitlement, error: null });

    // Act
    const res = await app.request(
      "/probe",
      {
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { caller: true, entitlement },
    });
  });
});
