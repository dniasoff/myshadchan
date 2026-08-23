import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  cleanupPartialBundle,
  canonicalizeMessageNotificationRows,
  computeSimulatedReceiptCounts,
  beginDemoSeedWithReconciliation,
  handleSeedDemo,
  markDemoOnboardingSeedFailedBestEffort,
  listRealRootMembers,
  randomSecret,
  insertAndResolveDemoListing,
  requireSafePositiveBigintId,
  uploadSeededResumeFile,
} from "./index.ts";

const adminFrom = vi.hoisted(() => vi.fn());
const adminStorageFrom = vi.hoisted(() => vi.fn());
const adminDeleteUser = vi.hoisted(() => vi.fn());
const adminListUsers = vi.hoisted(() => vi.fn());
const adminCreateUser = vi.hoisted(() => vi.fn());
const adminUpdateUserById = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());
const resolveAccountId = vi.hoisted(() => vi.fn());
const findUnfinishedDemoRun = vi.hoisted(() => vi.fn());
const getAssetBytes = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => adminFrom(...args),
    storage: { from: (...args: [string]) => adminStorageFrom(...args) },
    rpc: (...args: [string, Record<string, unknown>]) => adminRpc(...args),
    auth: {
      admin: {
        deleteUser: (...args: [string]) => adminDeleteUser(...args),
        listUsers: (...args: unknown[]) => adminListUsers(...args),
        createUser: (...args: unknown[]) => adminCreateUser(...args),
        updateUserById: (...args: unknown[]) => adminUpdateUserById(...args),
      },
    },
  },
}));

vi.mock("../_shared/resolveDemoAccount.ts", () => ({
  resolveAccountId: (...args: [string]) => resolveAccountId(...args),
  findUnfinishedDemoRun: (...args: [number]) => findUnfinishedDemoRun(...args),
  userScopedClient: vi.fn(),
}));

vi.mock("../_shared/authentication.ts", () => ({
  AuthMiddleware: (req: Request, next: (req: Request) => Promise<Response>) =>
    next(req),
  UserMiddleware: (
    req: Request,
    next: (req: Request, user?: unknown) => Promise<Response>,
  ) => next(req),
}));

vi.mock("../_shared/cors.ts", () => ({
  corsHeaders: {},
  OptionsMiddleware: (
    req: Request,
    next: (req: Request) => Promise<Response>,
  ) => next(req),
}));

vi.mock("../_shared/utils.ts", () => ({
  createErrorResponse: (status: number, message: string) =>
    new Response(JSON.stringify({ error: message, message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("./assets/manifest.ts", () => ({
  DEMO_SHARE_ASSET_KEY: "misc/rivky-klein-for-leah-feldman.pdf",
  getAssetBytes: (...args: unknown[]) => getAssetBytes(...args),
}));

type QueryResult = {
  data?: unknown;
  count?: number;
  error?: { message: string } | null;
};

function queryBuilder(result: QueryResult = { data: [], error: null }) {
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of [
    "select",
    "delete",
    "update",
    "eq",
    "in",
    "or",
    "limit",
    "order",
  ]) {
    query[method] = () =>
      method === "eq" ||
      method === "in" ||
      method === "or" ||
      method === "limit" ||
      method === "order"
        ? Promise.resolve(result)
        : query;
  }
  query.insert = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  query.maybeSingle = () => Promise.resolve(result);
  return query;
}

function accountQueryBuilder(
  result: QueryResult = { data: null, error: null },
) {
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.maybeSingle = () => Promise.resolve(result);
  return query;
}

function request(method = "POST") {
  return new Request("https://demo.test/seed", { method });
}

const fakeUser = { id: "11111111-1111-1111-1111-111111111111" };

beforeEach(() => {
  vi.clearAllMocks();
  resolveAccountId.mockResolvedValue(42);
  findUnfinishedDemoRun.mockResolvedValue(null);
  getAssetBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  adminDeleteUser.mockResolvedValue({ error: null });
  adminListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  adminCreateUser.mockResolvedValue({ data: { user: null }, error: null });
  adminUpdateUserById.mockResolvedValue({ error: null });
  adminRpc.mockImplementation((functionName: string) =>
    functionName === "demo_run_lease_is_current"
      ? { data: true, error: null }
      : { data: null, error: null },
  );
  adminFrom.mockImplementation((table: string) => {
    if (table === "accounts") {
      return accountQueryBuilder({
        data: { kind: "household" },
        error: null,
      });
    }
    return table === "demo_run_accounts"
      ? queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
          ],
          error: null,
        })
      : queryBuilder();
  });
  adminStorageFrom.mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue({ error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
  }));
});

describe("seed_demo direct harness", () => {
  it("rejects malformed, missing, non-positive, fractional, and unsafe bigint IDs", () => {
    expect(requireSafePositiveBigintId("9007199254740991", "id")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(requireSafePositiveBigintId(9007199254740991n, "id")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const value of [
      undefined,
      null,
      "",
      "0",
      "-1",
      "1.5",
      "9007199254740992",
      Number.MAX_SAFE_INTEGER + 1,
      1.25,
      0,
    ]) {
      expect(() => requireSafePositiveBigintId(value, "id")).toThrow();
    }
  });

  it("reconciles an actor INSERT whose response was lost and retries the resolver", async () => {
    const actorInsert = vi
      .fn()
      .mockRejectedValue(new Error("insert response lost after commit"));
    const resolver = vi
      .fn()
      .mockRejectedValueOnce(new Error("resolver response lost"))
      .mockResolvedValueOnce({ data: "9007199254740991", error: null });
    const actorClient = {
      from: vi.fn().mockReturnValue({ insert: actorInsert }),
    } as never;
    const rootClient = { rpc: resolver } as never;

    await expect(
      insertAndResolveDemoListing(
        actorClient,
        rootClient,
        { account_id: 42, listing_type: "single" },
        { p_run_id: 7 },
        "boundary listing",
      ),
    ).resolves.toBe(Number.MAX_SAFE_INTEGER);
    expect(actorInsert).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("keeps seed failure marking best-effort when its transport fails", async () => {
    adminRpc.mockRejectedValueOnce(new Error("failure marker response lost"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      markDemoOnboardingSeedFailedBestEffort(
        91,
        "lease-token",
        new Error("original seed failure"),
      ),
    ).resolves.toBeUndefined();
    expect(adminRpc).toHaveBeenCalledWith(
      "fail_demo_onboarding_seed",
      expect.objectContaining({ p_run_id: 91 }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "seed_demo: fail_demo_onboarding_seed transport failure",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("resets the exact reconciled Auth actor to the retry password after response loss", async () => {
    const actorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const appMetadata = {
      demo: true,
      demo_run_id: 915,
      demo_actor_key: "dovid-klein",
    };
    adminCreateUser.mockRejectedValueOnce(new Error("fetch failed"));
    adminListUsers.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: actorId,
            email: "dovid-klein@demo.invalid",
            app_metadata: appMetadata,
          },
        ],
      },
      error: null,
    });

    await expect(
      (await import("./index.ts")).createOrReconcileSyntheticUser(
        "dovid-klein@demo.invalid",
        "retry-password",
        "Dovid",
        "Klein",
        appMetadata,
      ),
    ).resolves.toEqual({ id: actorId });
    expect(adminUpdateUserById).toHaveBeenCalledWith(actorId, {
      password: "retry-password",
      email_confirm: true,
      app_metadata: appMetadata,
    });
  });

  it("keeps generated synthetic passwords bcrypt-compatible through create and reconciliation", async () => {
    const createdPassword = randomSecret();
    const reconciledPassword = randomSecret();
    for (const password of [createdPassword, reconciledPassword]) {
      expect(new TextEncoder().encode(password).byteLength).toBeLessThanOrEqual(
        72,
      );
      expect(password).toMatch(/^[0-9a-f]{64}$/);
    }

    const createdActorId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const reconciledActorId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const createdMetadata = {
      demo: true,
      demo_run_id: 916,
      demo_actor_key: "leah-feldman",
    };
    const reconciledMetadata = {
      demo: true,
      demo_run_id: 917,
      demo_actor_key: "miriam-gross",
    };

    adminCreateUser.mockResolvedValueOnce({
      data: { user: { id: createdActorId } },
      error: null,
    });
    await expect(
      (await import("./index.ts")).createOrReconcileSyntheticUser(
        "leah-feldman@demo.invalid",
        createdPassword,
        "Leah",
        "Feldman",
        createdMetadata,
      ),
    ).resolves.toEqual({ id: createdActorId });

    adminCreateUser.mockRejectedValueOnce(new Error("fetch failed"));
    adminListUsers.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: reconciledActorId,
            email: "miriam-gross@demo.invalid",
            app_metadata: reconciledMetadata,
          },
        ],
      },
      error: null,
    });
    await expect(
      (await import("./index.ts")).createOrReconcileSyntheticUser(
        "miriam-gross@demo.invalid",
        reconciledPassword,
        "Miriam",
        "Gross",
        reconciledMetadata,
      ),
    ).resolves.toEqual({ id: reconciledActorId });

    expect(adminCreateUser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ password: createdPassword }),
    );
    expect(adminCreateUser).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ password: reconciledPassword }),
    );
    expect(adminUpdateUserById).toHaveBeenCalledWith(reconciledActorId, {
      password: reconciledPassword,
      email_confirm: true,
      app_metadata: reconciledMetadata,
    });
  });

  it("returns duplicate unfinished metadata without exposing credentials", async () => {
    findUnfinishedDemoRun.mockResolvedValue({
      id: 81,
      status: "failed",
      updated_at: "2026-08-23T00:00:00.000Z",
    });

    const response = await handleSeedDemo(request(), fakeUser as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      seeded: false,
      reason: "demo_cleanup_required",
      runId: 81,
      status: "failed",
      updated_at: "2026-08-23T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret/i);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("resumes an exact active run when the final seed response was lost", async () => {
    findUnfinishedDemoRun.mockResolvedValue({
      id: 82,
      status: "active",
      updated_at: "2026-08-23T00:00:00.000Z",
    });

    const response = await handleSeedDemo(request(), fakeUser as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      seeded: true,
      resumed: true,
      runId: 82,
      status: "active",
      bundle: { runId: 82, status: "active" },
    });
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("returns a normal non-secret response when the account is not empty", async () => {
    adminFrom.mockImplementation((table: string) =>
      table === "accounts"
        ? accountQueryBuilder({ data: { kind: "household" }, error: null })
        : queryBuilder({ count: 1, data: null, error: null }),
    );

    const response = await handleSeedDemo(request(), fakeUser as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ seeded: false, reason: "account_not_empty" });
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret/i);
  });

  it("uses a schema-safe projection for every guarded table, including the composite-key lock table", async () => {
    const projections = new Map<string, unknown>();
    const guardedTables = [
      "singles",
      "single_preferences",
      "single_notes",
      "shadchanim",
      "references",
      "shidduchim",
      "inbox_items",
      "message_notifications",
      "task_notifications",
      "messages",
      "threads",
      "thread_participants",
      "tasks",
      "reference_links",
      "redts",
      "shidduch_education",
      "resume_photos",
      "resumes",
      "entity_files",
      "medical_notes",
      "shidduchim_external_links",
      "date_records",
      "interactions",
      "identity_signals",
      "listing_withdrawal_locks",
      "trusted_senders",
      "listings",
      "invites",
      "analytics_events",
      "share_links",
    ];
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return accountQueryBuilder({
          data: { kind: "household" },
          error: null,
        });
      }

      const query = queryBuilder({
        count: table === "listing_withdrawal_locks" ? 1 : 0,
        data: null,
        error: null,
      });
      query.select = (columns: unknown) => {
        projections.set(table, columns);
        if (table === "listing_withdrawal_locks" && columns === "id") {
          query.eq = () =>
            Promise.resolve({
              count: null,
              data: null,
              error: { message: 'column "id" does not exist' },
            });
        }
        return query;
      };
      return query;
    });

    const response = await handleSeedDemo(request(), fakeUser as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ seeded: false, reason: "account_not_empty" });
    expect(projections.get("listing_withdrawal_locks")).toBe("*");
    expect(guardedTables.every((table) => projections.get(table) === "*")).toBe(
      true,
    );
  });

  it("computes exactly two message events plus reminder and share receipts", () => {
    expect(
      computeSimulatedReceiptCounts(
        [
          { message_id: 101 },
          { message_id: 101 },
          { message_id: 102 },
          { message_id: 102 },
        ],
        [{ id: 201 }],
        [{ id: 301 }],
      ),
    ).toEqual({
      messageReceiptCount: 2,
      reminderReceiptCount: 1,
      shareReceiptCount: 1,
      total: 4,
    });
  });

  it("canonicalizes multi-recipient fan-out to one manifest receipt per message", () => {
    const rows = [
      { id: "204", message_id: "102", recipient_member_id: 9 },
      { id: "202", message_id: "101", recipient_member_id: 8 },
      { id: "203", message_id: "102", recipient_member_id: 8 },
      { id: "201", message_id: "101", recipient_member_id: 9 },
    ];

    expect(canonicalizeMessageNotificationRows(rows)).toEqual([
      rows[3],
      rows[2],
    ]);
  });

  it("keeps the seeded Dovid-Leah exchange at one non-sender per message", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const threadSource = source.slice(
      source.indexOf("const thread = await rpcRow"),
      source.indexOf(
        "const threadId =",
        source.indexOf("const thread = await rpcRow"),
      ),
    );

    expect(threadSource).toContain(
      "p_participant_member_ids: [actorMembershipId],",
    );
    expect(threadSource).not.toContain("rootObserverMembershipIds");
  });

  it("uses one expiry and embeds the generated pre-watermarked share asset", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const asset = readFileSync(
      new URL(
        "./assets/misc/rivky-klein-for-leah-feldman.pdf",
        import.meta.url,
      ),
    );
    const snapshotSource = source.slice(
      source.indexOf("const shareAssetSnapshot"),
      source.indexOf("const { error: snapshotError }"),
    );

    expect(source).toContain("const shareExpiresAt = daysFromNowIso(21)");
    expect(source).toContain("expires_at: shareExpiresAt");
    expect(source).toContain("DEMO_SHARE_ASSET_KEY");
    expect(source).toContain("getAssetBytes(DEMO_SHARE_ASSET_KEY)");
    expect(snapshotSource).toContain("bytesBase64");
    expect(snapshotSource).toContain('mimeType: "application/pdf"');
    expect(snapshotSource).toContain("preWatermarked: true");
    expect(snapshotSource).toContain("sha256: shareAssetSha256");
    expect(snapshotSource).not.toContain("storagePath");
    expect(asset.byteLength).toBeGreaterThan(0);
    expect(createHash("sha256").update(asset).digest("hex")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(source).toContain("connectionScopedTables");
    expect(source).toContain(".list(String(accountId), { limit: 1 })");
    expect(source).toContain('from("analytics_events")');
    expect(source).toContain('event_type: "item_filed"');
    expect(source).toContain('event_type: "channel_capture"');
    expect(source).toContain('event_type: "time_to_file"');
    expect(source).toContain("contexts: accountIdByContext.size");
    expect(source).toContain("syntheticActors: actorUserIdByKey.size");
    expect(source).toContain(
      "invitations: createdResourceIds.invitations.size",
    );
    expect(source).not.toContain("invitations: 2");
  });

  it("reconciles a committed begin lease after an RPC response loss", async () => {
    let callerToken = "";
    adminRpc.mockImplementation(
      (_fn: string, params: Record<string, unknown>) => {
        callerToken = params.p_lease_token as string;
        return Promise.reject(new Error("begin response lost"));
      },
    );
    adminFrom.mockImplementation((table: string) => {
      if (table !== "demo_runs") return queryBuilder();
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = () =>
        Promise.resolve({
          data: {
            id: 915,
            lease_token: callerToken,
            lease_epoch: 1,
            original_root_name: "Original",
            status: "seeding",
            operation: "seed",
            lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        });
      return query;
    });

    const resultPromise = beginDemoSeedWithReconciliation(42);
    const result = await resultPromise;
    const observedToken = adminRpc.mock.calls[0]?.[1]?.p_lease_token;

    expect(result).toMatchObject({ run_id: 915, lease_token: observedToken });
    expect(adminRpc).toHaveBeenCalledWith(
      "begin_demo_seed",
      expect.objectContaining({
        p_root_account_id: 42,
      }),
    );
  });

  it("registers storage before upload and never uploads when registration fails", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const storageClient = { from: vi.fn().mockReturnValue({ upload }) };
    adminRpc.mockImplementation((fn: string) =>
      fn === "register_demo_storage"
        ? Promise.resolve({
            data: null,
            error: { message: "manifest unavailable" },
          })
        : Promise.resolve({ data: null, error: null }),
    );

    await expect(
      uploadSeededResumeFile(
        7,
        "lease-token",
        42,
        {
          filename: "resume.pdf",
          assetKey: "resume:root" as never,
          mimeType: "application/pdf",
          singleId: 9,
        },
        {
          rpc: (...args: unknown[]) =>
            adminRpc(...(args as [string, Record<string, unknown>])),
          storage: storageClient,
        } as never,
      ),
    ).rejects.toThrow("manifest unavailable");
    expect(upload).not.toHaveBeenCalled();
  });

  it("resolves every real root member from public.members without auth pagination", async () => {
    const membershipUserId = "customer-beyond-auth-page";
    const maintenanceUserId = "temporary-maintenance-user";
    adminFrom.mockImplementation((table: string) => {
      if (table === "account_members") {
        const query = queryBuilder({
          data: [
            { id: 17, user_id: membershipUserId },
            { id: 18, user_id: maintenanceUserId },
          ],
          error: null,
        });
        query.eq = () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: 17, user_id: membershipUserId },
                { id: 18, user_id: maintenanceUserId },
              ],
              error: null,
            }),
        });
        return query;
      }
      if (table === "members") {
        return queryBuilder({
          data: [
            { user_id: membershipUserId, email: "customer@example.test" },
            {
              user_id: maintenanceUserId,
              email: "demo-reseed-1@atomic-crm-demo.internal",
            },
          ],
          error: null,
        });
      }
      return queryBuilder();
    });

    await expect(listRealRootMembers(42)).resolves.toEqual([
      { id: 17, userId: membershipUserId, email: "customer@example.test" },
    ]);
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("successfully compensates a core/bundle failure without leaving a blocker", async () => {
    const deleteCalls: string[] = [];
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return queryBuilder({
          data: [{ id: 42, kind: "household" }],
          error: null,
        });
      }
      if (table === "demo_run_accounts") {
        return queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
          ],
          error: null,
        });
      }
      const query = queryBuilder();
      query.delete = () => {
        deleteCalls.push(table);
        return query;
      };
      return query;
    });

    await expect(
      cleanupPartialBundle(91, 42, [], [], "lease-token"),
    ).resolves.toBe(true);

    expect(deleteCalls.filter((table) => table === "demo_runs")).toHaveLength(
      0,
    );
    expect(adminRpc).toHaveBeenCalledWith(
      "finalize_demo_seed_cleanup",
      expect.objectContaining({
        p_run_id: 91,
        p_lease_token: "lease-token",
      }),
    );
    expect(adminFrom).not.toHaveBeenCalledWith("demo_runs");
    expect(adminFrom).not.toHaveBeenCalledWith("member_state");
  });

  it("retains the manifest when lease-fenced finalization fails", async () => {
    const finalizerError = { message: "stale lease" };
    const deleteCalls: string[] = [];
    adminRpc.mockImplementation((functionName: string) =>
      functionName === "finalize_demo_seed_cleanup"
        ? { data: null, error: finalizerError }
        : functionName === "demo_run_lease_is_current"
          ? { data: true, error: null }
          : { data: null, error: null },
    );
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return queryBuilder({
          data: [{ id: 42, kind: "household" }],
          error: null,
        });
      }
      if (table === "demo_run_accounts") {
        return queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
          ],
          error: null,
        });
      }
      const query = queryBuilder();
      query.delete = () => {
        deleteCalls.push(table);
        return query;
      };
      return query;
    });

    await expect(
      cleanupPartialBundle(915, 42, [], [], "lease-token"),
    ).resolves.toBe(false);

    expect(adminRpc).toHaveBeenCalledWith(
      "finalize_demo_seed_cleanup",
      expect.objectContaining({
        p_run_id: 915,
        p_lease_token: "lease-token",
      }),
    );
    expect(adminRpc).toHaveBeenCalledWith(
      "fail_demo_run",
      expect.objectContaining({
        p_run_id: 915,
        p_lease_token: "lease-token",
        p_operation: "seed",
      }),
    );
    expect(deleteCalls).not.toContain("demo_runs");
    expect(adminFrom).not.toHaveBeenCalledWith("demo_runs");
  });

  it("treats a missing synthetic Auth user as already deleted during compensation", async () => {
    const actorId = "missing-synthetic-actor";
    adminDeleteUser.mockResolvedValue({
      error: { status: 404, code: "user_not_found", message: "User not found" },
    });

    adminFrom.mockImplementation((table: string) => {
      if (table === "demo_run_users")
        return queryBuilder({
          data: [{ user_id: actorId, actor_key: "missing-actor" }],
          error: null,
        });
      if (table === "demo_run_actor_intents")
        return queryBuilder({
          data: [
            {
              actor_key: "missing-actor",
              expected_email: "missing-actor@demo.invalid",
              auth_user_id: actorId,
              state: "reconciled",
            },
          ],
          error: null,
        });
      if (table === "account_members") {
        const query = queryBuilder();
        query.delete = () => {
          const filtered = queryBuilder();
          filtered.eq = () => filtered;
          filtered.in = () => Promise.resolve({ error: null });
          return filtered;
        };
        return query;
      }
      return table === "accounts"
        ? queryBuilder({ data: [{ id: 42, kind: "household" }], error: null })
        : table === "demo_run_accounts"
          ? queryBuilder({
              data: [
                {
                  account_id: 42,
                  context_key: "primary-household",
                  context_kind: "household",
                  is_root: true,
                },
              ],
              error: null,
            })
          : queryBuilder();
    });
    adminListUsers.mockResolvedValue({ data: { users: [] }, error: null });

    await expect(
      cleanupPartialBundle(911, 42, [], [actorId], "lease-token"),
    ).resolves.toBe(true);
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("treats a thrown Auth not-found as already deleted during compensation", async () => {
    const actorId = "thrown-missing-synthetic-actor";
    adminDeleteUser.mockRejectedValue({
      status: 404,
      code: "user_not_found",
      message: "User not found",
    });

    adminFrom.mockImplementation((table: string) => {
      if (table === "demo_run_users")
        return queryBuilder({
          data: [{ user_id: actorId, actor_key: "thrown-missing-actor" }],
          error: null,
        });
      if (table === "demo_run_actor_intents")
        return queryBuilder({
          data: [
            {
              actor_key: "thrown-missing-actor",
              expected_email: "thrown-missing-actor@demo.invalid",
              auth_user_id: actorId,
              state: "reconciled",
            },
          ],
          error: null,
        });
      if (table === "account_members") {
        const query = queryBuilder();
        query.delete = () => {
          const filtered = queryBuilder();
          filtered.eq = () => filtered;
          filtered.in = () => Promise.resolve({ error: null });
          return filtered;
        };
        return query;
      }
      return table === "accounts"
        ? queryBuilder({ data: [{ id: 42, kind: "household" }], error: null })
        : table === "demo_run_accounts"
          ? queryBuilder({
              data: [
                {
                  account_id: 42,
                  context_key: "primary-household",
                  context_kind: "household",
                  is_root: true,
                },
              ],
              error: null,
            })
          : queryBuilder();
    });
    adminListUsers.mockResolvedValue({ data: { users: [] }, error: null });

    await expect(
      cleanupPartialBundle(912, 42, [], [actorId], "lease-token"),
    ).resolves.toBe(true);
  });

  it("discovers a committed companion from the manifest after its RPC response is lost", async () => {
    const deletedAccountIds: number[] = [];
    const deletedTables: string[] = [];
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        const query = queryBuilder({
          data: [
            { id: 42, kind: "household" },
            { id: 43, kind: "household" },
          ],
          error: null,
        });
        query.delete = () => {
          deletedTables.push("accounts");
          return {
            eq: (_column: unknown, id: unknown) => {
              if (typeof id === "number") deletedAccountIds.push(id);
              return Promise.resolve({ error: null });
            },
            in: (_column: unknown, ids: unknown[]) => {
              deletedAccountIds.push(...(ids as number[]));
              return Promise.resolve({ error: null });
            },
          };
        };
        return query;
      }
      if (table === "demo_run_accounts") {
        return queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
            {
              account_id: 43,
              context_key: "gross-household",
              context_kind: "household",
              is_root: false,
            },
          ],
          error: null,
        });
      }
      const query = queryBuilder();
      query.delete = () => {
        deletedTables.push(table);
        return {
          in: (_column: unknown, ids: unknown[]) => {
            if (table === "accounts") {
              deletedAccountIds.push(...(ids as number[]));
            }
            return Promise.resolve({ error: null });
          },
          eq: (_column: unknown, id: unknown) => {
            if (table === "accounts" && typeof id === "number") {
              deletedAccountIds.push(id);
            }
            return Promise.resolve({ error: null });
          },
        };
      };
      return query;
    });

    await expect(
      cleanupPartialBundle(913, 42, [], [], "lease-token"),
    ).resolves.toBe(true);

    expect(adminRpc).toHaveBeenCalledWith(
      "delete_demo_companion_contexts",
      expect.objectContaining({ p_run_id: 913, p_operation: "seed" }),
    );
    expect(adminRpc).toHaveBeenCalledWith(
      "finalize_demo_seed_cleanup",
      expect.objectContaining({
        p_run_id: 913,
        p_lease_token: expect.any(String),
      }),
    );
    expect(deletedAccountIds).not.toContain(43);
    expect(deletedTables).not.toContain("demo_runs");
  });

  it("retains the manifest when Auth reconciliation fails after create response loss", async () => {
    const deleteCalls: string[] = [];
    adminListUsers.mockRejectedValue(new Error("Auth list unavailable"));
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return queryBuilder({
          data: [{ id: 42, kind: "household" }],
          error: null,
        });
      }
      if (table === "demo_run_accounts") {
        return queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
          ],
          error: null,
        });
      }
      if (table === "demo_run_actor_intents") {
        return queryBuilder({
          data: [
            {
              actor_key: "leah-feldman",
              expected_email: "demo-914-leah-feldman@demo.invalid",
              auth_user_id: null,
              state: "pending",
            },
          ],
          error: null,
        });
      }
      const query = queryBuilder();
      query.delete = () => {
        deleteCalls.push(table);
        return query;
      };
      return query;
    });

    await expect(
      cleanupPartialBundle(914, 42, [], [], "lease-token"),
    ).resolves.toBe(false);

    expect(adminListUsers).toHaveBeenCalled();
    expect(adminDeleteUser).not.toHaveBeenCalled();
    expect(deleteCalls).not.toContain("demo_runs");
  });

  it("retains exactly one failed handle when cleanup enumeration fails", async () => {
    const statusUpdates: unknown[] = [];
    const deleteCalls: string[] = [];
    adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return queryBuilder({
          data: [{ id: 42, kind: "household" }],
          error: null,
        });
      }
      if (table === "demo_run_accounts") {
        return queryBuilder({
          data: [
            {
              account_id: 42,
              context_key: "primary-household",
              context_kind: "household",
              is_root: true,
            },
          ],
          error: null,
        });
      }
      const query = queryBuilder(
        table === "demo_run_storage"
          ? { data: null, error: { message: "cannot enumerate manifest" } }
          : { data: [], error: null },
      );
      query.update = (patch: unknown) => {
        statusUpdates.push(patch);
        return query;
      };
      query.delete = () => {
        deleteCalls.push(table);
        return query;
      };
      return query;
    });

    await expect(
      cleanupPartialBundle(92, 42, [], [], "lease-token"),
    ).resolves.toBe(false);

    expect(statusUpdates).toHaveLength(0);
    expect(adminRpc).toHaveBeenCalledWith(
      "fail_demo_run",
      expect.objectContaining({
        p_run_id: 92,
        p_lease_token: "lease-token",
        p_operation: "seed",
      }),
    );
    expect(deleteCalls).toEqual([]);
  });
});
