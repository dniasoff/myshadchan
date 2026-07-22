import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
};

describe("cron worker", () => {
  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await worker.fetch(
      new Request("http://cron.local/health"),
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "cron", status: "ok" },
    });
  });

  it("logs a sweep tick when the scheduled trigger fires", async () => {
    // Arrange
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Act
    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    // Assert
    expect(logSpy).toHaveBeenCalledWith("[cron] sweep tick");
    logSpy.mockRestore();
  });
});
