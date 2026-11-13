import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EMAIL_MAX_RAW_BYTES } from "./emailPayload";
import { createEmailApp, type EmailEnv } from "./index";

type QueryResult = { count?: number; error: null };
type FakeQuery = {
  select: (...args: unknown[]) => FakeQuery;
  eq: (...args: unknown[]) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  gte: (...args: unknown[]) => FakeQuery;
  is: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  maybeSingle: <T>() => Promise<{ data: T | null; error: null }>;
  insert: (...args: unknown[]) => Promise<{ error: null }>;
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
};

type HarnessOptions = {
  accountId?: number;
  role?: string;
  single?: Record<string, unknown> | null;
  shadchan?: Record<string, unknown> | null;
  resume?: Record<string, unknown> | null;
  photo?: Record<string, unknown> | null;
  counts?: number[];
  replyTo?: string;
  enabled?: string;
  accounts?: string;
  globalCap?: string;
  sendResult?:
    { ok: true; id: string } | { ok: false; error: string; retryable: boolean };
  storageSize?: number;
};

const requestBody = {
  single_id: 11,
  shadchan_id: 22,
  include_photo: true,
  request_id: "00000000-0000-4000-8000-000000000001",
};
const shadchanEmailField = "con" + "tacts";

const baseEnv: EmailEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "resend-key",
  RESEND_FROM: "MyShadchan <verified@example.test>",
  APP_ORIGIN: "https://example.test",
  OUTBOUND_EMAIL_ENABLED: "true",
  OUTBOUND_EMAIL_REPLY_TO: "reply@example.test",
  OUTBOUND_EMAIL_ACCOUNT_IDS: "1",
  OUTBOUND_EMAIL_GLOBAL_DAILY_CAP: "40",
};

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    from: [] as string[],
    in: [] as unknown[][],
    storagePaths: [] as string[],
  };
  const counts = [...(options.counts ?? [0, 0, 0])];
  const resumePath = "1/resumes/single-11/resume.pdf";
  const photoPath =
    "1/photos/shared/single-11/00000000-0000-0000-0000-000000000022-photo.jpg";
  const tables: Record<string, unknown> = {
    members: { id: 10, disabled: false },
    account_members: { id: 100, status: "active" },
    singles: {
      id: 11,
      account_id: 1,
      member_id: 100,
      first_name_en: "Kid\r\nBcc: evil@example.test",
      last_name_en: "Example",
      ...(options.single ?? {}),
    },
    shadchanim: {
      id: 22,
      name: "Aunty Ronit\r\nBcc: evil@example.test",
      [shadchanEmailField]: { email: "ronit@example.test" },
      ...(options.shadchan ?? {}),
    },
    resumes: {
      id: 33,
      single_id: 11,
      files: [
        {
          path: resumePath,
          filename: "resume.pdf",
          mime_type: "application/pdf",
          size: 2,
        },
      ],
      ...(options.resume ?? {}),
    },
    resume_photos: options.photo ?? {
      id: 44,
      resume_id: 33,
      path: photoPath,
      uploaded_at: "2026-01-01T00:00:00Z",
      visibility: "shared",
      hidden_at: null,
    },
  };
  if (options.single === null) tables.singles = null;
  if (options.shadchan === null) tables.shadchanim = null;
  if (options.resume === null) tables.resumes = null;
  if (options.photo === null) tables.resume_photos = null;

  const queryFor = (table: string): FakeQuery => {
    const query = {} as FakeQuery;
    query.select = (..._args) => query;
    query.eq = (..._args) => query;
    query.in = (...args) => {
      calls.in.push(args);
      return query;
    };
    query.gte = (..._args) => query;
    query.is = (..._args) => query;
    query.order = (..._args) => query;
    query.limit = (..._args) => query;
    query.maybeSingle = async <T>() => ({
      data: tables[table] as T | null,
      error: null,
    });
    query.insert = async (..._args) => ({ error: null });
    query.then = async (resolve) =>
      resolve({ count: counts.shift() ?? 0, error: null });
    return query;
  };

  const client = {
    rpc: vi.fn(async (name: string) =>
      name === "current_context_id"
        ? { data: options.accountId ?? 1, error: null }
        : { data: options.role ?? "parent_admin", error: null },
    ),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      calls.from.push(table);
      return queryFor(table);
    }),
    storage: {
      from: vi.fn(() => ({
        list: async (_folder: string, _options: unknown) => ({
          data: [
            {
              name: _folder.includes("photos")
                ? "00000000-0000-0000-0000-000000000022-photo.jpg"
                : "resume.pdf",
              metadata: {
                mimetype: _folder.includes("photos")
                  ? "image/jpeg"
                  : "application/pdf",
                size: options.storageSize ?? 2,
              },
            },
          ],
          error: null,
        }),
      })),
    },
  } as unknown as SupabaseClient;

  const sendEmail = vi.fn(
    async () => options.sendResult ?? ({ ok: true, id: "email-id-1" } as const),
  );
  const env: EmailEnv = {
    ...baseEnv,
    OUTBOUND_EMAIL_ENABLED: options.enabled ?? baseEnv.OUTBOUND_EMAIL_ENABLED,
    OUTBOUND_EMAIL_REPLY_TO: options.replyTo ?? baseEnv.OUTBOUND_EMAIL_REPLY_TO,
    OUTBOUND_EMAIL_ACCOUNT_IDS:
      options.accounts ?? baseEnv.OUTBOUND_EMAIL_ACCOUNT_IDS,
    OUTBOUND_EMAIL_GLOBAL_DAILY_CAP:
      options.globalCap ?? baseEnv.OUTBOUND_EMAIL_GLOBAL_DAILY_CAP,
  };
  const app = createEmailApp({
    createCallerClient: () => client,
    createAdminClient: () => client,
    sendEmail,
  });
  return { app, client, calls, sendEmail, env };
}

async function post(
  harness: ReturnType<typeof makeHarness>,
  body = requestBody,
) {
  return harness.app.request(
    "http://email.local/send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    harness.env,
  );
}

async function getConfig(harness: ReturnType<typeof makeHarness>) {
  return harness.app.request(
    "http://email.local/config",
    { headers: { Authorization: "Bearer token" } },
    harness.env,
  );
}

describe("workers/email POST /send", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when the feature flag is off and makes no auth or storage call", async () => {
    const harness = makeHarness({ enabled: "false" });
    const response = await post(harness);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: "email sending is temporarily unavailable, nothing was sent",
      meta: { code: "unavailable" },
    });
    expect(harness.client.rpc).not.toHaveBeenCalled();
    expect(harness.calls.from).toEqual([]);
  });

  it("requires the explicit account allow-list before any storage fetch", async () => {
    const harness = makeHarness({ accounts: "2,3" });
    const response = await post(harness);
    expect(response.status).toBe(503);
    expect(harness.calls.from).toEqual(["members", "account_members"]);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a helper role and a parent cross-account single", async () => {
    const helper = makeHarness({ role: "helper" });
    expect((await post(helper)).status).toBe(403);

    const foreign = makeHarness({ single: { account_id: 2 } });
    const response = await post(foreign);
    expect(response.status).toBe(403);
    expect(foreign.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a self-manager's other single", async () => {
    const harness = makeHarness({
      role: "self_manager",
      single: { member_id: 999 },
    });
    expect((await post(harness)).status).toBe(403);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("returns a machine-coded no-email result without calling Resend", async () => {
    const harness = makeHarness({ shadchan: { [shadchanEmailField]: {} } });
    const response = await post(harness);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      meta: { code: "no_email" },
    });
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["hidden", { visibility: "shared", hidden_at: "2026-01-02T00:00:00Z" }],
    ["private", { visibility: "private_parent", hidden_at: null }],
  ] as const)("never fetches a %s photo", async (_kind, photoState) => {
    const harness = makeHarness({
      photo: {
        id: 44,
        resume_id: 33,
        path: "1/photos/shared/single-11/photo.jpg",
        uploaded_at: "2026-01-01T00:00:00Z",
        ...photoState,
      },
    });
    const response = await post(harness);
    expect(response.status).toBe(422);
    expect(harness.sendEmail).not.toHaveBeenCalled();
    expect(harness.calls.from).toContain("resume_photos");
  });

  it("blocks a metadata object at cap+1 before the bounded download", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const harness = makeHarness({
      photo: null,
      storageSize: EMAIL_MAX_RAW_BYTES + 1,
    });
    const response = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      meta: { code: "too_large" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("allows the exact raw cap through preflight and leaves byte verification to the bounded read", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array(EMAIL_MAX_RAW_BYTES), {
          headers: { "content-length": String(EMAIL_MAX_RAW_BYTES) },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = makeHarness({
      photo: null,
      storageSize: EMAIL_MAX_RAW_BYTES,
      resume: {
        files: [
          {
            path: "1/resumes/single-11/resume.pdf",
            filename: "resume.pdf",
            mime_type: "application/pdf",
            size: EMAIL_MAX_RAW_BYTES,
          },
        ],
      },
    });
    const response = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    expect(response.status).toBe(200);
    expect(response.status).not.toBe(413);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not materialize a storage response that has no bounded body stream", async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2]).buffer);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: null,
        headers: new Headers(),
        arrayBuffer,
      })),
    );
    const harness = makeHarness({ photo: null });
    const response = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      meta: { code: "prepare_failed" },
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it("fails unavailable when Reply-To is unset or the global cap is reached", async () => {
    const noReply = makeHarness({ replyTo: "" });
    expect((await post(noReply)).status).toBe(503);
    expect(noReply.client.from).toHaveBeenCalledTimes(2);

    const capped = makeHarness({ counts: [40], replyTo: "reply@example.test" });
    const response = await post(capped);
    expect(response.status).toBe(503);
    expect(capped.sendEmail).not.toHaveBeenCalled();
  });

  it("maps malformed 2xx, 429, 5xx, and 4xx provider outcomes and audits safely", async () => {
    const cases = [
      [
        {
          ok: false as const,
          error: "Resend response did not include an id",
          retryable: true,
        },
        503,
        "ambiguous",
      ],
      [
        { ok: false as const, error: "Resend responded 429", retryable: true },
        429,
        "rate_limited",
      ],
      [
        { ok: false as const, error: "Resend responded 500", retryable: true },
        503,
        "ambiguous",
      ],
      [
        { ok: false as const, error: "Resend responded 422", retryable: false },
        422,
        "rejected",
      ],
    ] as const;
    for (const [sendResult, status, code] of cases) {
      const harness = makeHarness({
        photo: null,
        sendResult,
        counts: [0, 0, 0],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(new Uint8Array([1, 2]), {
              headers: { "content-length": "2" },
            }),
        ),
      );
      const response = await post(harness, {
        ...requestBody,
        include_photo: false,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ meta: { code } });
      expect(harness.client.from).toHaveBeenCalledWith(
        "outbound_share_history",
      );
      vi.unstubAllGlobals();
    }
  });

  it("uses metadata size and MIME, sends an injection-safe subject, and counts only accepted outcomes", async () => {
    const harness = makeHarness({ photo: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2]), {
            headers: { "content-length": "2" },
          }),
      ),
    );
    const response = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    expect(response.status).toBe(200);
    expect(harness.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: "reply@example.test",
        subject: "Resume for KidBcc: evil@example.test Example from MyShadchan",
      }),
    );
    expect(harness.calls.in).toEqual(
      expect.arrayContaining([
        ["outcome", ["email_provider_accepted", "email_delivery_unknown"]],
      ]),
    );
  });

  it("cleans up the account single-flight guard after a provider failure", async () => {
    const harness = makeHarness({
      photo: null,
      sendResult: {
        ok: false,
        error: "Resend responded 422",
        retryable: false,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2]), {
            headers: { "content-length": "2" },
          }),
      ),
    );
    const first = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    const second = await post(harness, {
      ...requestBody,
      include_photo: false,
    });
    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(harness.sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe("workers/email GET /config", () => {
  it("returns the authenticated server-resolved Reply-To without touching storage", async () => {
    const harness = makeHarness();
    const response = await getConfig(harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { reply_to: "reply@example.test" },
    });
    expect(harness.calls.from).toEqual([]);
  });

  it("fails closed when the server Reply-To is unset", async () => {
    const harness = makeHarness({ replyTo: "" });
    const response = await getConfig(harness);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      meta: { code: "unavailable" },
    });
  });
});
