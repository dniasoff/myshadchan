import { describe, expect, it } from "vitest";
import { createWorkerApp } from "./createApp";

describe("createWorkerApp", () => {
  it("responds to GET /health with the worker's name in the envelope", async () => {
    // Arrange
    const app = createWorkerApp("parse");

    // Act
    const res = await app.request("/health");
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { worker: "parse", status: "ok" },
    });
  });

  it("carries the required security headers on every response", async () => {
    // Arrange
    const app = createWorkerApp("parse");

    // Act
    const res = await app.request("/health");

    // Assert
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });
});
