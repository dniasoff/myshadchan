import { describe, expect, it } from "vitest";
import app from "./index";

describe("billing worker", () => {
  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await app.request("/health");

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "billing", status: "ok" },
    });
  });

  it("rejects a webhook POST with no stripe-signature header", async () => {
    // Arrange / Act
    const res = await app.request("/webhook", { method: "POST" });

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing stripe-signature header",
    });
  });

  it("responds 501 when a signature header is present but processing isn't implemented", async () => {
    // Arrange / Act
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=abc" },
    });

    // Assert
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      success: false,
      error: "webhook processing not implemented yet",
    });
  });
});
