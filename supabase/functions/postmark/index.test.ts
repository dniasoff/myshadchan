import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleInboundEmail, resolvePublicOrigin } from "./index.ts";

/**
 * Story 10.3 (AC 3, AC 7): the webhook handler itself, under test — not just
 * its helper functions. `../_shared/supabaseAdmin.ts` is mocked exactly like
 * `addNoteToContact.test.ts` established (that file is deleted by Epic 1's
 * 1.1, but the `vi.hoisted(() => vi.fn())` + `vi.mock(...)` shape survives):
 * `resolveHouseholdAccountIdForMemberEmail`, `createInboxItemFromEmail`,
 * `buildInboxItemPayload` and `extractAndUploadAttachments` all run for
 * real, against this mocked client — only the network boundary is faked.
 */

const mockFrom = vi.hoisted(() => vi.fn());
const mockStorageFrom = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => mockFrom(...args),
    storage: { from: (...args: [string]) => mockStorageFrom(...args) },
  },
}));

type MemberRow = { email: string; user_id: string };
type MembershipRow = {
  user_id: string;
  account_id: number;
  kind: string;
  status?: string;
};

/** Builds the `members` / `account_members` table doubles this handler
 * queries, keyed the same way the real tables are: `members` by email,
 * `account_members` by user_id + accounts.kind (the household-only filter
 * Task 2 adds). */
function seedDatabase(members: MemberRow[], memberships: MembershipRow[]) {
  const insertedInboxItems: unknown[] = [];

  mockFrom.mockImplementation((table: string) => {
    if (table === "members") {
      return {
        select: (fields: string) => {
          if (fields === "email") {
            return Promise.resolve({
              data: members.map((m) => ({ email: m.email })),
            });
          }
          // fields === "user_id" — the resolver's own lookup.
          return {
            eq: (_col: string, value: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: members.find((m) => m.email === value) ?? null,
                }),
            }),
          };
        },
      };
    }

    if (table === "account_members") {
      return {
        select: () => ({
          eq: (_col1: string, userId: string) => ({
            eq: (_col2: string, kind: string) => ({
              eq: (_col3: string, status: string) =>
                Promise.resolve({
                  data: memberships
                    .filter(
                      (m) =>
                        m.user_id === userId &&
                        m.kind === kind &&
                        (m.status ?? "active") === status,
                    )
                    .map((m) => ({
                      account_id: m.account_id,
                      accounts: { kind: m.kind },
                    })),
                }),
            }),
          }),
        }),
      };
    }

    if (table === "inbox_items") {
      return {
        insert: (row: unknown) => {
          insertedInboxItems.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }

    throw new Error(`Unexpected table in test: ${table}`);
  });

  mockStorageFrom.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: {
        signedUrl: "http://kong:8000/storage/v1/object/sign/attachments/x",
      },
      error: null,
    }),
  });

  return { insertedInboxItems };
}

const KNOWN_MEMBER: MemberRow = {
  email: "known@example.com",
  user_id: "11111111-1111-1111-1111-111111111111",
};

const VALID_IP = "3.134.147.250";
const AUTHORIZED_IPS = `${VALID_IP},50.31.156.6`;
// Basic base64("testuser:testpwd") — the same credential pair the
// docstring's own curl examples below use.
const VALID_AUTHORIZATION = "Basic dGVzdHVzZXI6dGVzdHB3ZA==";

const VALID_BODY = {
  FromFull: {
    Email: KNOWN_MEMBER.email,
    Name: "Known Member",
    MailboxHash: "",
  },
  ToFull: [{ Email: "someone@example.com", Name: "", MailboxHash: "" }],
  Subject: "A wonderful suggestion",
  TextBody: "Some redt text",
};

function buildRequest(
  overrides: {
    method?: string;
    forwardedFor?: string | null;
    authorization?: string | null;
    body?: unknown;
  } = {},
): Request {
  const {
    method = "POST",
    forwardedFor = VALID_IP,
    authorization = VALID_AUTHORIZATION,
    body = VALID_BODY,
  } = overrides;

  const headers = new Headers({ "Content-Type": "application/json" });
  if (forwardedFor !== null) headers.set("x-forwarded-for", forwardedFor);
  if (authorization !== null) headers.set("Authorization", authorization);

  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/functions/v1/postmark", {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

function stubValidSecrets() {
  vi.stubEnv("POSTMARK_WEBHOOK_USER", "testuser");
  vi.stubEnv("POSTMARK_WEBHOOK_PASSWORD", "testpwd");
  vi.stubEnv("POSTMARK_WEBHOOK_AUTHORIZED_IPS", AUTHORIZED_IPS);
  vi.stubEnv("VITE_INBOUND_EMAIL", "");
}

describe("postmark handleInboundEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubValidSecrets();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------
  // AC 7 / Task 1: the cold-start fix itself.
  // ---------------------------------------------------------------------
  describe("missing secrets (AC 7 — request-scoped, not import-time)", () => {
    it.each([
      "POSTMARK_WEBHOOK_USER",
      "POSTMARK_WEBHOOK_PASSWORD",
      "POSTMARK_WEBHOOK_AUTHORIZED_IPS",
    ])(
      "returns 500 and never reaches supabaseAdmin when %s is unset",
      async (missingVar) => {
        // Arrange
        seedDatabase([KNOWN_MEMBER], []);
        vi.stubEnv(missingVar, "");
        const request = buildRequest();

        // Act
        const response = await handleInboundEmail(request);

        // Assert — the handler EXECUTED (no import-time throw) and reported a
        // diagnosable, request-scoped failure instead.
        expect(response.status).toBe(500);
        expect(mockFrom).not.toHaveBeenCalled();
      },
    );

    it("does not 500 when only VITE_INBOUND_EMAIL is unset — it is a convenience var, not a required secret", async () => {
      // Arrange — deliberately still unstubbed to "" by stubValidSecrets();
      // this asserts absence of the optional var never blocks capture.
      seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );
      const request = buildRequest();

      // Act
      const response = await handleInboundEmail(request);

      // Assert
      expect(response.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // checkRequestTypeAndHeaders / checkBody — unchanged behaviour, now
  // reachable through the exported handler.
  // ---------------------------------------------------------------------
  describe("request validation", () => {
    it("returns 401 and writes nothing when x-forwarded-for is missing", async () => {
      seedDatabase([KNOWN_MEMBER], []);
      const response = await handleInboundEmail(
        buildRequest({ forwardedFor: null }),
      );
      expect(response.status).toBe(401);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns 401 when x-forwarded-for carries no authorized IP", async () => {
      seedDatabase([KNOWN_MEMBER], []);
      const response = await handleInboundEmail(
        buildRequest({ forwardedFor: "9.9.9.9" }),
      );
      expect(response.status).toBe(401);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    // Story 10.3 review fix (F-D): a caller who controls the WHOLE header
    // used to be able to sneak a real authorized IP anywhere in a
    // comma-separated list of their own invention (`.some()`). Only the
    // right-most entry — the position a proxy chain appends to, never
    // prepends — is trusted now.
    it("returns 401 when an authorized IP is only a PREFIX entry, never the right-most one (review fix F-D)", async () => {
      seedDatabase([KNOWN_MEMBER], []);
      const response = await handleInboundEmail(
        buildRequest({ forwardedFor: `${VALID_IP},9.9.9.9` }),
      );
      expect(response.status).toBe(401);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns 200 when the authorized IP is the right-most entry, even with an untrusted prefix ahead of it", async () => {
      seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );
      const response = await handleInboundEmail(
        buildRequest({ forwardedFor: `9.9.9.9,${VALID_IP}` }),
      );
      expect(response.status).toBe(200);
    });

    it("returns 405 for a non-POST method", async () => {
      seedDatabase([KNOWN_MEMBER], []);
      const response = await handleInboundEmail(
        buildRequest({ method: "GET" }),
      );
      expect(response.status).toBe(405);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns 401 for an incorrect Authorization header", async () => {
      seedDatabase([KNOWN_MEMBER], []);
      const response = await handleInboundEmail(
        buildRequest({ authorization: "Basic bm90dGhlcmlnaHRvbmU=" }),
      );
      expect(response.status).toBe(401);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it.each([
      ["ToFull", { ...VALID_BODY, ToFull: [] }],
      ["FromFull", { ...VALID_BODY, FromFull: undefined }],
      ["Subject", { ...VALID_BODY, Subject: undefined }],
      ["TextBody", { ...VALID_BODY, TextBody: undefined }],
    ])(
      "returns 403 and writes nothing when %s is missing",
      async (_field, body) => {
        seedDatabase([KNOWN_MEMBER], []);
        const response = await handleInboundEmail(buildRequest({ body }));
        expect(response.status).toBe(403);
        expect(mockFrom).not.toHaveBeenCalled();
      },
    );
  });

  // ---------------------------------------------------------------------
  // The capture path itself.
  // ---------------------------------------------------------------------
  describe("capture", () => {
    it("returns 403 and never inserts for an unknown sender", async () => {
      const { insertedInboxItems } = seedDatabase([], []);
      const response = await handleInboundEmail(buildRequest());
      expect(response.status).toBe(403);
      // Review finding F6: pin the SPECIFIC known-member guard
      // (`memberEmails.includes(memberEmail)`), not merely "some 403
      // happened for some reason". With zero members seeded,
      // resolveHouseholdAccountIdForMemberEmail ALSO 403s (via a different
      // message, "No MyShadchan account for sender ...") once it can't find
      // a members row — so a status-only assertion stayed green even with
      // the known-member check deleted outright (mutation-tested: `if
      // (!memberEmails.includes(memberEmail))` -> `if (false)` still passed
      // 18/18 before this assertion was added). The response body is the
      // one thing that differs between the two 403s.
      expect(await response.text()).toContain("is not a known MyShadchan user");
      expect(insertedInboxItems).toHaveLength(0);
    });

    it("returns 200 and inserts one unresolved inbox_items row for a known member, no attachment", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(200);
      expect(insertedInboxItems).toEqual([
        {
          account_id: 7,
          source: "email",
          raw_text: VALID_BODY.TextBody,
          subject: VALID_BODY.Subject,
          sender: null,
          sender_needs_confirmation: false,
          attachments: null,
          status: "unresolved",
        },
      ]);
    });

    it("uploads the attachment and populates the insert's attachments array for a known member with one attachment", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );

      const response = await handleInboundEmail(
        buildRequest({
          body: {
            ...VALID_BODY,
            Attachments: [
              {
                Name: "resume.txt",
                // base64("test content")
                Content: "dGVzdCBjb250ZW50",
                ContentType: "text/plain",
                ContentLength: 12,
              },
            ],
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockStorageFrom).toHaveBeenCalledWith("attachments");
      expect(insertedInboxItems).toHaveLength(1);
      const row = insertedInboxItems[0] as { attachments: unknown[] | null };
      expect(row.attachments).toHaveLength(1);
      expect((row.attachments as { title: string }[])[0].title).toBe(
        "resume.txt",
      );
    });

    it("files the capture in the HOUSEHOLD account when the sender holds both a household and a shadchanus membership (AC 2)", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [
          { user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" },
          { user_id: KNOWN_MEMBER.user_id, account_id: 9, kind: "shadchanus" },
        ],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(200);
      expect((insertedInboxItems[0] as { account_id: number }).account_id).toBe(
        7,
      );
    });

    it("refuses (403) rather than guessing when the sender holds no household membership at all (shadchan-only)", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 9, kind: "shadchanus" }],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(403);
      expect(insertedInboxItems).toHaveLength(0);
    });

    it("refuses (403) rather than arbitrarily picking when the sender holds TWO household memberships (family shape 4)", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [
          { user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" },
          { user_id: KNOWN_MEMBER.user_id, account_id: 8, kind: "household" },
        ],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(403);
      expect(insertedInboxItems).toHaveLength(0);
    });

    it("ignores ARCHIVED household memberships when resolving the account", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [
          {
            user_id: KNOWN_MEMBER.user_id,
            account_id: 7,
            kind: "household",
            status: "active",
          },
          {
            user_id: KNOWN_MEMBER.user_id,
            account_id: 8,
            kind: "household",
            status: "archived",
          },
        ],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(200);
      expect((insertedInboxItems[0] as { account_id: number }).account_id).toBe(
        7,
      );
    });

    it("refuses (403) when the sender's only household membership is archived", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [
          {
            user_id: KNOWN_MEMBER.user_id,
            account_id: 7,
            kind: "household",
            status: "archived",
          },
        ],
      );

      const response = await handleInboundEmail(buildRequest());

      expect(response.status).toBe(403);
      expect(insertedInboxItems).toHaveLength(0);
    });

    // Story 10.2: sender recovery from forwarded headers (FR24).
    it("recovers a confident original sender from a forwarded email", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );

      const forwardedBody = [
        "Hi, please see below.",
        "",
        "---------- Forwarded message ----------",
        "From: Mrs. Feldman <mrs.feldman@example.com>",
        "Date: Mon, 21 Jul 2026 10:00:00 +0000",
        "Subject: A suggestion",
        "To: member@example.com",
        "",
        "A wonderful boy for Rivky.",
      ].join("\n");

      const response = await handleInboundEmail(
        buildRequest({
          body: {
            ...VALID_BODY,
            TextBody: forwardedBody,
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(insertedInboxItems).toHaveLength(1);
      const row = insertedInboxItems[0] as {
        sender: string | null;
        sender_needs_confirmation: boolean;
        shadchan_id: unknown;
      };
      expect(row.sender).toBe("Mrs. Feldman");
      expect(row.sender_needs_confirmation).toBe(false);
      expect(row.shadchan_id).toBeUndefined();
      // Negative AC-4 check: we never looked up or set a shadchan record.
      expect(mockFrom).not.toHaveBeenCalledWith("shadchanim");
    });

    it("flags a doubly-forwarded email as ambiguous and leaves sender null", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );

      const forwardedBody = [
        "---------- Forwarded message ----------",
        "From: member@example.com",
        "",
        "---------- Forwarded message ----------",
        "From: Mrs. Feldman <mrs.feldman@example.com>",
        "",
        "A wonderful boy for Rivky.",
      ].join("\n");

      const response = await handleInboundEmail(
        buildRequest({
          body: {
            ...VALID_BODY,
            TextBody: forwardedBody,
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(insertedInboxItems).toHaveLength(1);
      const row = insertedInboxItems[0] as {
        sender: string | null;
        sender_needs_confirmation: boolean;
        shadchan_id: unknown;
      };
      expect(row.sender).toBeNull();
      expect(row.sender_needs_confirmation).toBe(true);
      expect(row.shadchan_id).toBeUndefined();
      expect(mockFrom).not.toHaveBeenCalledWith("shadchanim");
    });

    it("overrides a self-referential recovered sender to ambiguous", async () => {
      const { insertedInboxItems } = seedDatabase(
        [KNOWN_MEMBER],
        [{ user_id: KNOWN_MEMBER.user_id, account_id: 7, kind: "household" }],
      );

      const forwardedBody = [
        "---------- Forwarded message ----------",
        `From: ${KNOWN_MEMBER.email}`,
        "",
        "A wonderful boy for Rivky.",
      ].join("\n");

      const response = await handleInboundEmail(
        buildRequest({
          body: {
            ...VALID_BODY,
            TextBody: forwardedBody,
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(insertedInboxItems).toHaveLength(1);
      const row = insertedInboxItems[0] as {
        sender: string | null;
        sender_needs_confirmation: boolean;
      };
      expect(row.sender).toBeNull();
      expect(row.sender_needs_confirmation).toBe(true);
    });
  });
});

/**
 * Story 10.3 review fix (F-E, non-blocking/minor): `resolvePublicOrigin` had
 * zero direct coverage — only exercised end-to-end by `e2e/email-ingress.spec.ts`,
 * which covers exactly one shape (http + a non-default port, via forwarded
 * headers). The https/443 suppression, the `host.includes(":")` branch, and
 * the no-forwarded-headers fallback were exercised by nothing.
 */
describe("resolvePublicOrigin (review fix F-E)", () => {
  const buildRequestWithHeaders = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:8081/functions/v1/postmark", { headers });

  it("builds an http origin with a non-default port from the forwarded headers", () => {
    const req = buildRequestWithHeaders({
      "x-forwarded-proto": "http",
      "x-forwarded-host": "127.0.0.1",
      "x-forwarded-port": "54351",
    });

    expect(resolvePublicOrigin(req)).toBe("http://127.0.0.1:54351");
  });

  it("suppresses the port when it is https's default (443)", () => {
    const req = buildRequestWithHeaders({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "project.supabase.co",
      "x-forwarded-port": "443",
    });

    expect(resolvePublicOrigin(req)).toBe("https://project.supabase.co");
  });

  it("suppresses the port when it is http's default (80)", () => {
    const req = buildRequestWithHeaders({
      "x-forwarded-proto": "http",
      "x-forwarded-host": "example.com",
      "x-forwarded-port": "80",
    });

    expect(resolvePublicOrigin(req)).toBe("http://example.com");
  });

  it("omits the port when x-forwarded-host already carries one (host.includes(':'))", () => {
    const req = buildRequestWithHeaders({
      "x-forwarded-proto": "http",
      "x-forwarded-host": "127.0.0.1:54351",
      "x-forwarded-port": "54351",
    });

    // The port is already embedded in the host — appending it again would
    // produce "127.0.0.1:54351:54351".
    expect(resolvePublicOrigin(req)).toBe("http://127.0.0.1:54351");
  });

  it("builds a bare proto://host with no port header at all", () => {
    const req = buildRequestWithHeaders({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "project.supabase.co",
    });

    expect(resolvePublicOrigin(req)).toBe("https://project.supabase.co");
  });

  it("falls back to the request's own URL origin when no forwarded headers are present", () => {
    // The known-broken fallback F8 was written about (a container's
    // internal listener, unreachable by any real client) — verified
    // harmless in both real environments today (see index.ts's own
    // comment), but nothing before this test pinned WHAT the fallback
    // actually returns.
    const req = new Request("http://127.0.0.1:8081/functions/v1/postmark");

    expect(resolvePublicOrigin(req)).toBe("http://127.0.0.1:8081");
  });

  it("falls back when only one of proto/host is present", () => {
    const req = buildRequestWithHeaders({ "x-forwarded-proto": "https" });

    expect(resolvePublicOrigin(req)).toBe(new URL(req.url).origin);
  });
});
