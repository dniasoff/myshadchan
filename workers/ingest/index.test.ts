import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "./emailFixtures";
import {
  insertedRows,
  makeMessage,
  resetFakeDb,
  seedDefaultTables,
  setInsertError,
  tables,
} from "./ingestTestHarness";

// See `index.senderAndAttachments.test.ts` for sender classification,
// attachment upload, and FR24 forwarded-sender recovery coverage — split out
// (coding-style.md: grow the file count, not the file) once this suite grew
// past the ~400-line typical ceiling. Both files share the
// `@supabase/supabase-js` mock `ingestTestHarness.ts` registers (see that
// module's own doc comment for why importing it is enough — no `vi.mock`
// call needed in this file).
import worker, { handleInboundEmail } from "./index";

describe("ingest worker", () => {
  beforeEach(() => {
    resetFakeDb();
    seedDefaultTables(tables);
  });

  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await worker.fetch(
      new Request("http://ingest.local/health"),
      TEST_ENV,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "ingest", status: "ok" },
    });
  });

  describe("recipient resolution", () => {
    it("files a captured email under the household matching the recipient token", async () => {
      // Arrange
      const message = makeMessage({
        to: "abc123def456@myshadchan.space",
        from: "known.parent@example.com",
      });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items).toHaveLength(1);
      expect(message.rejected).toEqual([]);
    });

    it("rejects an address matching no household's inbound token — the only bounce", async () => {
      // Arrange
      const message = makeMessage({ to: "nosuchtoken@myshadchan.space" });

      // Act
      await worker.email(message, TEST_ENV, {} as ExecutionContext);

      // Assert
      expect(message.rejected).toHaveLength(1);
      expect(message.rejected[0]).toMatch(/recipient/i);
      expect(insertedRows.inbox_items).toBeUndefined();
    });
  });

  describe("failure semantics", () => {
    it("rejects when the tenant-table write fails, and does not leave the message unaccounted for", async () => {
      // Arrange
      setInsertError({ message: "connection reset" });
      const message = makeMessage({});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      await worker.email(message, TEST_ENV, {} as ExecutionContext);

      // Assert
      expect(message.rejected).toHaveLength(1);
      errorSpy.mockRestore();
    });

    it("does NOT reject on the success path", async () => {
      // Arrange
      const message = makeMessage({});

      // Act
      await worker.email(message, TEST_ENV, {} as ExecutionContext);

      // Assert
      expect(message.rejected).toEqual([]);
    });
  });
});
