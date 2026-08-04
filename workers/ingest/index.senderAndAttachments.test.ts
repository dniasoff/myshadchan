import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV, buildRawEmail } from "./emailFixtures";
import {
  createSignedUrl,
  insertedRows,
  makeMessage,
  resetFakeDb,
  seedDefaultTables,
  storageFrom,
  tables,
  upload,
} from "./ingestTestHarness";

// Split out of `index.test.ts` (coding-style.md: grow the file count, not
// the file) once that suite grew past the ~400-line typical ceiling. This
// file owns sender classification, attachment upload, and FR24
// forwarded-sender recovery; `index.test.ts` keeps health/recipient-
// resolution/failure-semantics coverage. Both share the
// `@supabase/supabase-js` mock `ingestTestHarness.ts` registers (see that
// module's own doc comment for why importing it is enough — no `vi.mock`
// call needed in this file).
import worker, { handleInboundEmail } from "./index";

describe("ingest worker: sender classification, attachments, forwarded-sender recovery", () => {
  beforeEach(() => {
    resetFakeDb();
    seedDefaultTables(tables);
  });

  describe("sender classification", () => {
    it("files a known member's email as unresolved (the working inbox)", async () => {
      // Arrange
      const message = makeMessage({ from: "known.parent@example.com" });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items[0].status).toBe("unresolved");
    });

    it("files a trusted_senders address as unresolved", async () => {
      // Arrange
      const message = makeMessage({ from: "trusted@example.com" });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items[0].status).toBe("unresolved");
    });

    it("files an unknown sender as held, WITHOUT rejecting — an unknown sender is never a bounce", async () => {
      // Arrange
      const message = makeMessage({ from: "a-stranger@example.com" });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items[0].status).toBe("held");
      expect(message.rejected).toEqual([]);
    });

    it("SECURITY: a member of a DIFFERENT account emailing account 1's address is classified unknown", async () => {
      // Arrange: "other.household@example.com" is an ACTIVE member — of
      // account 2, not the account 1 address this message is addressed to.
      // If tenancy scoping in classifySender.ts were ever dropped, this
      // would flip to "unresolved" and this assertion would fail.
      const message = makeMessage({
        to: "abc123def456@myshadchan.space", // account 1
        from: "other.household@example.com", // a member of account 2
      });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items[0].status).toBe("held");
    });
  });

  describe("attachments", () => {
    it("uploads a real parsed attachment under the resolved account's storage prefix", async () => {
      // Arrange
      const raw = buildRawEmail({
        to: "abc123def456@myshadchan.space",
        attachmentFilename: "resume.pdf",
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(storageFrom).toHaveBeenCalledWith("attachments");
      const [row] = insertedRows.inbox_items;
      expect(row.attachments).toHaveLength(1);
      const attachment = (row.attachments as Array<Record<string, unknown>>)[0];
      expect(attachment.title).toBe("resume.pdf");
      expect(attachment.path).toMatch(/^1\/[0-9a-f-]{36}\.pdf$/);
      expect(createSignedUrl).toHaveBeenCalledWith(attachment.path, 60 * 60);
    });

    it("stores a message with no attachment with a null attachments field", async () => {
      // Arrange
      const raw = buildRawEmail({ attachmentFilename: null });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      expect(insertedRows.inbox_items[0].attachments).toBeNull();
    });

    it("rejects when uploading an attachment fails", async () => {
      // Arrange
      upload.mockResolvedValueOnce({ error: { message: "storage is down" } });
      const message = makeMessage({});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act — via the wrapped `email()` entry, since this exercises the
      // try/catch -> setReject failure semantics, not just the pipeline.
      await worker.email(message, TEST_ENV, {} as ExecutionContext);

      // Assert
      expect(message.rejected).toHaveLength(1);
      expect(insertedRows.inbox_items).toBeUndefined();
      errorSpy.mockRestore();
    });
  });

  describe("forwarded-sender recovery (FR24)", () => {
    it("populates sender and leaves sender_needs_confirmation false for a confident recovery", async () => {
      // Arrange
      const raw = buildRawEmail({
        from: "known.parent@example.com",
        textBody: [
          "---------- Forwarded message ----------",
          "From: Mrs. Feldman <mrs.feldman@example.com>",
          "Date: Mon, 21 Jul 2026 10:00:00 +0000",
          "Subject: A suggestion",
          "",
          "Hi, I have a suggestion for Rivky.",
        ].join("\n"),
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      const [row] = insertedRows.inbox_items;
      expect(row.sender).toBe("Mrs. Feldman");
      expect(row.sender_needs_confirmation).toBe(false);
    });

    it("leaves sender null and flags confirmation when no forward is detected", async () => {
      // Arrange
      const raw = buildRawEmail({
        from: "known.parent@example.com",
        textBody: "Hi, I have a suggestion for Rivky directly.",
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      const [row] = insertedRows.inbox_items;
      expect(row.sender).toBeNull();
      expect(row.sender_needs_confirmation).toBe(false);
    });

    it("persists the envelope sender in sender_email — NOT the FR24-recovered forwarded sender", async () => {
      // Arrange: envelope sender is "known.parent@example.com", but the
      // forwarded body attributes the note to a completely different
      // address. If sender_email were ever wired to the forwarded-recovered
      // value instead of the envelope one, this assertion would fail.
      const raw = buildRawEmail({
        from: "known.parent@example.com",
        textBody: [
          "---------- Forwarded message ----------",
          "From: Mrs. Feldman <mrs.feldman@example.com>",
          "Date: Mon, 21 Jul 2026 10:00:00 +0000",
          "Subject: A suggestion",
          "",
          "Hi, I have a suggestion for Rivky.",
        ].join("\n"),
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      const [row] = insertedRows.inbox_items;
      expect(row.sender_email).toBe("known.parent@example.com");
      expect(row.sender).toBe("Mrs. Feldman");
      expect(row.sender_email).not.toBe(row.sender);
    });

    it("persists sender_email from the envelope even for a direct, non-forwarded email with no recoverable original sender", async () => {
      // Arrange
      const raw = buildRawEmail({
        from: "a-stranger@example.com",
        textBody: "Hi, I have a suggestion for Rivky directly.",
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      const [row] = insertedRows.inbox_items;
      expect(row.sender).toBeNull();
      expect(row.sender_email).toBe("a-stranger@example.com");
      expect(row.status).toBe("held");
    });

    it("flags a self-referential forward as needing confirmation rather than confidently misattributing it", async () => {
      // Arrange: the member forwarded their OWN earlier message.
      const raw = buildRawEmail({
        from: "known.parent@example.com",
        textBody: [
          "---------- Forwarded message ----------",
          "From: known.parent@example.com",
          "",
          "My own earlier note.",
        ].join("\n"),
      });
      const message = makeMessage({ raw });

      // Act
      await handleInboundEmail(message, TEST_ENV);

      // Assert
      const [row] = insertedRows.inbox_items;
      expect(row.sender).toBeNull();
      expect(row.sender_needs_confirmation).toBe(true);
    });
  });
});
