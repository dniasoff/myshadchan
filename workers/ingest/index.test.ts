import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
};

describe("ingest worker", () => {
  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await worker.fetch(
      new Request("http://ingest.local/health"),
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "ingest", status: "ok" },
    });
  });

  it("logs the sender and recipient when an inbound email arrives", async () => {
    // Arrange
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = {
      from: "sender@example.com",
      to: "account-abc123@inbox.myshadchan.com",
    } as ForwardableEmailMessage;

    // Act
    await worker.email(message, env, {} as ExecutionContext);

    // Assert
    expect(logSpy).toHaveBeenCalledWith(
      "[ingest/email] received message from sender@example.com to account-abc123@inbox.myshadchan.com",
    );
    logSpy.mockRestore();
  });
});
