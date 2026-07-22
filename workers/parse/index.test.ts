import { describe, expect, it } from "vitest";
import app from "./index";

describe("parse worker", () => {
  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await app.request("/health");

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "parse", status: "ok" },
    });
  });
});
