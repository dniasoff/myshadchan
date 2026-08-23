import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "./emailFixtures";
import {
  insertedRows,
  rpc,
  makeMessage,
  from,
  resetFakeDb,
  seedDefaultTables,
  storageFrom,
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

    it("rejects simulated demo inbound before parsing, classification, upload, or tenant writes", async () => {
      // Arrange — this represents a failed/partial demo run that remains a
      // cleanup handle. The raw stream getter is the parser boundary: it must
      // never be touched for simulated mail.
      tables.demo_simulated_accounts = [{ account_id: 1 }];
      const message = makeMessage({
        raw: "this must never be read",
      });
      const rawGetter = vi.fn(() => {
        throw new Error("demo inbound parser should not run");
      });
      Object.defineProperty(message, "raw", { get: rawGetter });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(message.rejected).toHaveLength(1);
      expect(message.rejected[0]).toMatch(/simulated/i);
      expect(rawGetter).not.toHaveBeenCalled();
      expect(insertedRows.inbox_items).toBeUndefined();
      expect(storageFrom).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalledWith("members");
      expect(from).not.toHaveBeenCalledWith("trusted_senders");
      expect(rpc).toHaveBeenCalledWith(
        "claim_demo_ingest",
        expect.objectContaining({ p_account_id: 1 }),
      );
      expect(rpc).not.toHaveBeenCalledWith(
        "heartbeat_demo_ingest_claim",
        expect.anything(),
      );
    });

    it("holds an admitted ordinary claim through upload and inbox commit", async () => {
      const message = makeMessage({
        raw: "From: known.parent@example.com\nSubject: Claim ordering\n\nHello",
      });

      await handleInboundEmail(message, TEST_ENV);

      const claimCall = rpc.mock.invocationCallOrder[0];
      const heartbeatCalls = rpc.mock.invocationCallOrder.filter(
        (_, index) =>
          rpc.mock.calls[index]?.[0] === "heartbeat_demo_ingest_claim",
      );
      const releaseCall = rpc.mock.invocationCallOrder.find(
        (_, index) =>
          rpc.mock.calls[index]?.[0] === "release_demo_ingest_claim",
      );
      expect(claimCall).toBeDefined();
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(2);
      expect(releaseCall).toBeDefined();
      expect(releaseCall).toBeGreaterThan(Math.max(...heartbeatCalls));
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
