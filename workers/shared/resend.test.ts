import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./resend";

const INPUT = {
  apiKey: "re_test_key",
  from: "support@myshadchan.space",
  to: "parent@example.test",
  subject: "Reminder: follow up with the Cohens",
  text: "Open your reminders: https://www.myshadchan.space/#/reminders",
};

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the Resend API with a Bearer token and the recipient wrapped in an array", async () => {
    // Arrange
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-123" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({ ok: true, id: "email-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      from: INPUT.from,
      to: [INPUT.to],
      subject: INPUT.subject,
      text: INPUT.text,
    });
  });

  it("returns ok:false, retryable:false with the response body on a terminal 4xx response, never throwing", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("domain is not verified", { status: 403 }),
        ),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "Resend responded 403: domain is not verified",
      retryable: false,
    });
  });

  it("returns ok:false, retryable:true on a 429 (rate limited) response", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("too many requests", { status: 429 })),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "Resend responded 429: too many requests",
      retryable: true,
    });
  });

  it("returns ok:false, retryable:true on a 5xx (Resend's own failure) response", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("upstream error", { status: 502 })),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "Resend responded 502: upstream error",
      retryable: true,
    });
  });

  it("returns ok:false, retryable:true when fetch itself rejects (a real network-level failure), never throwing", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network unreachable")),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "transport error contacting Resend",
      retryable: true,
    });
    // The raw exception's own message never reaches a console line —
    // summarizeErrorForLog() is the only thing this file ever logs through.
    const loggedText = errorSpy.mock.calls
      .map((call) => JSON.stringify(call))
      .join("\n");
    expect(loggedText).not.toContain("network unreachable");
  });

  it("returns ok:false, retryable:true when a 2xx response body is not valid JSON", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "Resend response body was not valid JSON",
      retryable: true,
    });
  });

  it("returns ok:false, retryable:true when a 2xx response has no string id", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: "Resend response did not include an id",
      retryable: true,
    });
  });

  it("sends the Idempotency-Key header when idempotencyKey is supplied", async () => {
    // Arrange
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-123" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await sendEmail({
      ...INPUT,
      idempotencyKey: "task-notification:10:email:2026-08-07T12:00:00Z",
    });

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(
      "task-notification:10:email:2026-08-07T12:00:00Z",
    );
  });

  it("omits the Idempotency-Key header when idempotencyKey is not supplied", async () => {
    // Arrange
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-123" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await sendEmail(INPUT);

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });

  it("truncates a very long error body before it would ever be stored", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    const longBody = "x".repeat(1000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(longBody, { status: 500 })),
    );

    // Act
    const result = await sendEmail(INPUT);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThan(600);
      expect(result.error.endsWith("…")).toBe(true);
    }
  });
});
