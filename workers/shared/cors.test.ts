import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { OriginMatcher } from "./cors";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  BILLING_WORKER_ALLOWED_HEADERS,
  BILLING_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
  isVercelPreviewOrigin,
  LOCAL_DEV_ORIGINS,
  PRODUCTION_ORIGINS,
} from "./cors";

function buildApp(origins: readonly string[] | OriginMatcher) {
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
  it("is a predicate function, not a plain origins list (F19)", () => {
    // Arrange / Act / Assert
    expect(typeof BILLING_WORKER_ALLOWED_ORIGINS).toBe("function");
  });

  it("admits every production and local-dev origin, exactly like the AI worker's own set", () => {
    // Arrange / Act / Assert
    for (const origin of [...PRODUCTION_ORIGINS, ...LOCAL_DEV_ORIGINS]) {
      expect(BILLING_WORKER_ALLOWED_ORIGINS(origin)).toBe(true);
      expect(AI_WORKER_ALLOWED_ORIGINS as readonly string[]).toContain(origin);
    }
  });

  it("allows Content-Type and Authorization, matching the AI worker's headers", () => {
    // Arrange / Act / Assert
    expect(BILLING_WORKER_ALLOWED_HEADERS).toEqual(AI_WORKER_ALLOWED_HEADERS);
  });
});

describe("isVercelPreviewOrigin / VERCEL_PREVIEW_ORIGIN_PATTERN (F19)", () => {
  it("admits this project's own unique-deployment preview origin", () => {
    // Arrange / Act / Assert — the real shape observed against the live
    // project (`vercel ls --scope team_vh6r4A6auhjSNmZApI8YD20v`).
    expect(
      isVercelPreviewOrigin(
        "https://myshadchan-71x5ohkmq-dniasoffs-projects.vercel.app",
      ),
    ).toBe(true);
  });

  it("admits this project's own git-branch-alias preview origin", () => {
    // Arrange / Act / Assert
    expect(
      isVercelPreviewOrigin(
        "https://myshadchan-git-feature-billing-dniasoffs-projects.vercel.app",
      ),
    ).toBe(true);
  });

  it("rejects a lookalike hosted under an attacker's OWN Vercel team", () => {
    // Arrange / Act / Assert — same `myshadchan-` prefix, but the team-slug
    // suffix (globally unique per Vercel team) is not, and cannot be,
    // `dniasoffs-projects`.
    expect(
      isVercelPreviewOrigin(
        "https://myshadchan-71x5ohkmq-attacker-team.vercel.app",
      ),
    ).toBe(false);
  });

  it("rejects a suffix-hijack attempt appending a hostile domain after .vercel.app", () => {
    // Arrange / Act / Assert — proves the pattern is anchored with `$`,
    // not just "contains a valid-looking prefix".
    expect(
      isVercelPreviewOrigin(
        "https://myshadchan-71x5ohkmq-dniasoffs-projects.vercel.app.evil.example",
      ),
    ).toBe(false);
  });

  it("rejects a prefix-spoof attempt that merely ends in the right project name", () => {
    // Arrange / Act / Assert — proves the pattern is anchored with `^`.
    expect(
      isVercelPreviewOrigin(
        "https://evilmyshadchan-71x5ohkmq-dniasoffs-projects.vercel.app",
      ),
    ).toBe(false);
  });

  it("rejects a bare .vercel.app origin with no project/team structure at all", () => {
    // Arrange / Act / Assert
    expect(isVercelPreviewOrigin("https://vercel.app")).toBe(false);
    expect(isVercelPreviewOrigin("https://evil.vercel.app")).toBe(false);
  });

  it("rejects an http (non-TLS) origin even with an otherwise-valid shape", () => {
    // Arrange / Act / Assert
    expect(
      isVercelPreviewOrigin(
        "http://myshadchan-71x5ohkmq-dniasoffs-projects.vercel.app",
      ),
    ).toBe(false);
  });
});

describe("createCorsMiddleware with an OriginMatcher (F19)", () => {
  it("echoes back a real preview origin on an allowed request", async () => {
    // Arrange
    const app = buildApp(BILLING_WORKER_ALLOWED_ORIGINS);
    const previewOrigin =
      "https://myshadchan-71x5ohkmq-dniasoffs-projects.vercel.app";

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: previewOrigin },
    });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(previewOrigin);
  });

  it("never echoes a hostile lookalike origin, end to end through the middleware", async () => {
    // Arrange
    const app = buildApp(BILLING_WORKER_ALLOWED_ORIGINS);
    const hostileOrigin =
      "https://myshadchan-71x5ohkmq-attacker-team.vercel.app";

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: hostileOrigin },
    });

    // Assert
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does NOT widen AI_WORKER_ALLOWED_ORIGINS — it stays a plain exact-match list unaffected by F19", async () => {
    // Arrange — this pins scope: the preview-origin allowance is
    // billing-specific (Story 12.4's own need), not a blanket change to
    // every Worker sharing this module.
    const app = buildApp(AI_WORKER_ALLOWED_ORIGINS);
    const previewOrigin =
      "https://myshadchan-71x5ohkmq-dniasoffs-projects.vercel.app";

    // Act
    const res = await app.request("/route", {
      method: "POST",
      headers: { Origin: previewOrigin },
    });

    // Assert
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
