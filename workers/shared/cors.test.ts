import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  BILLING_WORKER_ALLOWED_HEADERS,
  BILLING_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
  LOCAL_DEV_ORIGINS,
  PRODUCTION_ORIGINS,
} from "./cors";

function buildApp(origins: readonly string[]) {
  const app = new Hono();
  app.use(
    "*",
    createCorsMiddleware({
      origins,
      methods: ["POST"],
      allowHeaders: ["Content-Type"],
    }),
  );
  app.post("/route", (c) => c.json({ ok: true }));
  return app;
}

describe("createCorsMiddleware", () => {
  it("echoes back an allowlisted origin on a real request", async () => {
    // Arrange
    const app = buildApp(PRODUCTION_ORIGINS);

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: "https://www.myshadchan.space" },
    });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://www.myshadchan.space",
    );
  });

  it("never echoes a non-allowlisted origin", async () => {
    // Arrange
    const app = buildApp(PRODUCTION_ORIGINS);

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });

    // Assert
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("never sets a wildcard origin", async () => {
    // Arrange
    const app = buildApp(PRODUCTION_ORIGINS);

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: "https://www.myshadchan.space" },
    });

    // Assert
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("answers an OPTIONS preflight itself, without reaching the route handler", async () => {
    // Arrange
    const app = buildApp(PRODUCTION_ORIGINS);

    // Act
    const res = await app.request("/route", {
      method: "OPTIONS",
      headers: {
        Origin: "https://www.myshadchan.space",
        "Access-Control-Request-Method": "POST",
      },
    });

    // Assert
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("BILLING_WORKER_ALLOWED_ORIGINS / BILLING_WORKER_ALLOWED_HEADERS", () => {
  it("covers production and local-dev origins, exactly like the AI worker's own set", () => {
    // Arrange / Act / Assert
    expect(BILLING_WORKER_ALLOWED_ORIGINS).toEqual([
      ...PRODUCTION_ORIGINS,
      ...LOCAL_DEV_ORIGINS,
    ]);
    expect(BILLING_WORKER_ALLOWED_ORIGINS).toEqual(AI_WORKER_ALLOWED_ORIGINS);
  });

  it("allows Content-Type and Authorization, matching the AI worker's headers", () => {
    // Arrange / Act / Assert
    expect(BILLING_WORKER_ALLOWED_HEADERS).toEqual(AI_WORKER_ALLOWED_HEADERS);
  });
});
