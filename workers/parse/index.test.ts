import { describe, expect, it, vi } from "vitest";
import app from "./index";

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
  }),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

describe("parse worker", () => {
  it("responds to GET /health without auth", async () => {
    // Arrange / Act
    const res = await app.request("http://parse.local/health", {}, env);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "parse", status: "ok" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 402 for an unentitled POST to any route", async () => {
    // Arrange
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
      "http://parse.local/probe",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      },
      env,
    );

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ success: false, error: "not entitled" });
  });
});
