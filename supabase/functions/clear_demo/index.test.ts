import { beforeEach, describe, expect, it, vi } from "vitest";
import { type User } from "jsr:@supabase/supabase-js@2";
import { claimDemoClearWithReconciliation, handleClearDemo } from "./index.ts";

const mockAdminFrom = vi.hoisted(() => vi.fn());
const mockAdminRpc = vi.hoisted(() => vi.fn());
const mockAdminStorageFrom = vi.hoisted(() => vi.fn());
const mockResolveAccountId = vi.hoisted(() => vi.fn());

let fakeState: FakeLifecycleState;

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => mockAdminFrom(...args),
    rpc: (...args: [string, Record<string, unknown>]) => mockAdminRpc(...args),
    storage: { from: (...args: [string]) => mockAdminStorageFrom(...args) },
    auth: {
      admin: {
        deleteUser: (...args: [string]) => fakeState.authDelete(...args),
        listUsers: (...args: unknown[]) => fakeState.authList(...args),
      },
    },
  },
}));

vi.mock("../_shared/resolveDemoAccount.ts", () => ({
  resolveAccountId: (...args: [string]) => mockResolveAccountId(...args),
}));

vi.mock("../_shared/authentication.ts", () => ({
  AuthMiddleware: (req: Request, next: (req: Request) => Promise<Response>) =>
    next(req),
  UserMiddleware: (
    req: Request,
    next: (req: Request, user?: User) => Promise<Response>,
  ) => next(req),
}));

const ROOT_ID = 42;
const COMPANION_ID = 43;
const GROSS_ID = 44;
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const FAKE_USER = { id: ACTOR_ID } as unknown as User;

type Resource = { resource_type: string; resource_id: number };
type RelationshipRow = Record<string, unknown>;

type FakeLifecycleState = {
  demo: boolean;
  runId: number | null;
  resources: Resource[];
  relationshipRows: Record<string, RelationshipRow>;
  actorIds: string[];
  authError: { status?: number; code?: string; message: string } | null;
  authList: (
    ...args: unknown[]
  ) => Promise<{ data: { users: unknown[] }; error: unknown | null }>;
  finalizeError: string | null;
  completedAt: string | null;
  heartbeatError: string | null;
  claimBusy: boolean;
  calls: Array<{ fn: string; params: Record<string, unknown> }>;
  deletedRelationships: Array<{ table: string; id: number }>;
  deletedAccounts: number[];
  authDelete: (userId: string) => Promise<{ error: unknown | null }>;
};

function newState(
  overrides: Partial<FakeLifecycleState> = {},
): FakeLifecycleState {
  const state = {
    demo: true,
    runId: 7001,
    resources: [
      { resource_type: "connection", resource_id: 9001 },
      { resource_type: "invite", resource_id: 9002 },
    ],
    relationshipRows: {
      connections: {
        household_account_id: ROOT_ID,
        shadchanus_account_id: COMPANION_ID,
        status: "accepted",
      },
      child_grants: {
        proposer_account_id: ROOT_ID,
        target_single_id: 7007,
        grantee_account_id: COMPANION_ID,
        status: "accepted",
      },
      invites: { account_id: ROOT_ID, status: "accepted" },
    },
    actorIds: [],
    authError: null,
    authList: async () => ({ data: { users: [] }, error: null }),
    finalizeError: null,
    completedAt: null,
    heartbeatError: null,
    claimBusy: false,
    calls: [],
    deletedRelationships: [],
    deletedAccounts: [],
  } as FakeLifecycleState;
  state.authDelete = async () => ({ error: state.authError });
  return Object.assign(state, overrides);
}

function buildFromDoubles() {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "accounts") {
      return {
        select: () => {
          const query: Record<string, (...args: unknown[]) => unknown> = {};
          query.eq = () => query;
          query.in = () =>
            Promise.resolve({
              data: [
                { id: ROOT_ID, kind: "household" },
                { id: COMPANION_ID, kind: "shadchanus" },
                { id: GROSS_ID, kind: "household" },
              ],
              error: null,
            });
          query.maybeSingle = () =>
            Promise.resolve({
              data: { demo: fakeState.demo, kind: "household" },
              error: null,
            });
          return query;
        },
        delete: () => ({
          in: (column: string, ids: number[]) => {
            if (column === "id") fakeState.deletedAccounts.push(...ids);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }

    if (table === "demo_runs") {
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.in = () => query;
      query.order = () => query;
      query.limit = () => query;
      query.maybeSingle = () =>
        Promise.resolve({
          data: fakeState.runId
            ? { id: fakeState.runId, status: "active" }
            : null,
          error: null,
        });
      return query;
    }

    if (table === "demo_run_accounts") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: fakeState.runId
                ? [
                    {
                      account_id: ROOT_ID,
                      context_key: "primary-household",
                      context_kind: "household",
                      is_root: true,
                    },
                    {
                      account_id: COMPANION_ID,
                      context_key: "feldman-shadchanus",
                      context_kind: "shadchanus",
                      is_root: false,
                    },
                    {
                      account_id: GROSS_ID,
                      context_key: "gross-household",
                      context_kind: "household",
                      is_root: false,
                    },
                  ]
                : [],
              error: null,
            }),
        }),
      };
    }

    if (table === "demo_run_storage") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    }

    if (table === "demo_run_resources") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: fakeState.resources, error: null }),
        }),
      };
    }

    if (table === "demo_run_users") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: fakeState.actorIds.map((user_id) => ({
                user_id,
                actor_key: "test-actor",
              })),
              error: null,
            }),
        }),
      };
    }

    if (table === "demo_run_actor_intents") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: fakeState.actorIds.map((user_id) => ({
                actor_key: "test-actor",
                expected_email: "demo-test-actor@demo.invalid",
                auth_user_id: user_id,
                state: "reconciled",
              })),
              error: null,
            }),
        }),
      };
    }

    if (table === "account_members") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
        delete: () => ({
          in: () => Promise.resolve({ error: null }),
          eq: () => ({
            in: () => Promise.resolve({ error: null }),
          }),
        }),
      };
    }

    if (
      table === "resumes" ||
      table === "resume_photos" ||
      table === "entity_files" ||
      table === "inbox_items"
    ) {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
      };
    }

    if (
      table === "connections" ||
      table === "connection_invites" ||
      table === "child_grants" ||
      table === "invites"
    ) {
      return {
        select: (columns: string) => ({
          eq: (_column: string, _id: number) => ({
            maybeSingle: () => {
              const row = fakeState.relationshipRows[table];
              return Promise.resolve({
                data: row && columns ? row : null,
                error: null,
              });
            },
          }),
        }),
        delete: () => ({
          eq: (_column: string, id: number) => {
            fakeState.deletedRelationships.push({ table, id });
            return Promise.resolve({ error: null });
          },
        }),
      };
    }

    if (table === "singles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { account_id: 999 }, error: null }),
          }),
        }),
        delete: () => ({
          in: () => Promise.resolve({ error: null }),
        }),
      };
    }

    return {
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
        eq: () => Promise.resolve({ error: null }),
      }),
    };
  });

  mockAdminStorageFrom.mockImplementation(() => ({
    list: () => Promise.resolve({ data: [], error: null }),
    remove: () => Promise.resolve({ error: null }),
  }));

  mockAdminRpc.mockImplementation(
    (fn: string, params: Record<string, unknown>) => {
      fakeState.calls.push({ fn, params });
      if (fn === "claim_demo_clear") {
        if (fakeState.claimBusy) {
          return Promise.resolve({
            data: null,
            error: { code: "lock_not_available", message: "demo run is busy" },
          });
        }
        if (fakeState.runId == null) {
          return Promise.resolve({ data: { outcome: "no_run" }, error: null });
        }
        return Promise.resolve({
          data: {
            outcome: "claimed",
            run_id: fakeState.runId,
            lease_token: params.p_lease_token,
            status: "clearing",
          },
          error: null,
        });
      }
      if (fn === "get_demo_release_receipt") {
        return Promise.resolve({
          data: { root_account_id: ROOT_ID },
          error: null,
        });
      }
      if (fn === "heartbeat_demo_run" && fakeState.heartbeatError) {
        return Promise.resolve({
          data: null,
          error: { message: fakeState.heartbeatError },
        });
      }
      if (fn === "finalize_demo_clear" && fakeState.finalizeError) {
        return Promise.resolve({
          data: null,
          error: { message: fakeState.finalizeError },
        });
      }
      return Promise.resolve({
        data:
          fn === "finalize_demo_clear"
            ? {
                outcome: "finalized",
                run_id: fakeState.runId,
                ...(fakeState.completedAt
                  ? { completed_at: fakeState.completedAt }
                  : {}),
              }
            : true,
        error: null,
      });
    },
  );
  fakeState.authList = async () => ({
    data: {
      users: fakeState.actorIds.map((id) => ({
        id,
        email: "demo-test-actor@demo.invalid",
        app_metadata: {
          demo: true,
          demo_run_id: fakeState.runId,
          demo_actor_key: "test-actor",
        },
      })),
    },
    error: null,
  });
}

function buildRequest(body: unknown = {}): Request {
  return new Request("http://localhost/functions/v1/clear_demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("clear_demo manifest lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeState = newState();
    buildFromDoubles();
    mockResolveAccountId.mockResolvedValue(ROOT_ID);
  });

  it("claims, heartbeats, deletes only owned relationship IDs, and finalizes atomically", async () => {
    const response = await handleClearDemo(
      buildRequest({ releaseDemoFlag: true }),
      FAKE_USER,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cleared: true,
      accountId: ROOT_ID,
      runId: 7001,
    });
    expect(fakeState.deletedRelationships).toEqual([
      { table: "connections", id: 9001 },
      { table: "invites", id: 9002 },
    ]);
    expect(fakeState.calls[0]?.fn).toBe("claim_demo_clear");
    expect(
      fakeState.calls.some(({ fn }) => fn === "get_demo_release_receipt"),
    ).toBe(false);
    expect(fakeState.calls.some(({ fn }) => fn === "heartbeat_demo_run")).toBe(
      true,
    );
    expect(fakeState.calls.at(-1)).toMatchObject({
      fn: "finalize_demo_clear",
      params: {
        p_release_demo: true,
        p_release_persona: true,
        p_actor_user_id: ACTOR_ID,
      },
    });
    expect(fakeState.calls.some(({ fn }) => fn === "fail_demo_run")).toBe(
      false,
    );
  });

  it("reports the finalizer timestamp without inventing one", async () => {
    fakeState.completedAt = "2026-08-23T03:41:00.000Z";

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cleared: true,
      lastClearedAt: fakeState.completedAt,
    });
  });

  it("reconciles a committed clear claim after its RPC response is lost", async () => {
    let callerToken = "";
    mockAdminRpc.mockImplementation(
      (fn: string, params: Record<string, unknown>) => {
        if (fn !== "claim_demo_clear")
          return Promise.resolve({ data: null, error: null });
        callerToken = params.p_lease_token as string;
        return Promise.reject(new Error("claim response lost"));
      },
    );
    const baseFrom = mockAdminFrom.getMockImplementation()!;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "demo_runs") return baseFrom(table);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = () =>
        Promise.resolve({
          data: {
            id: fakeState.runId,
            lease_token: callerToken,
            status: "clearing",
          },
          error: null,
        });
      return query;
    });

    await expect(
      claimDemoClearWithReconciliation(ROOT_ID),
    ).resolves.toMatchObject({
      outcome: "claimed",
      run_id: fakeState.runId,
      lease_token: callerToken,
      status: "clearing",
    });
  });

  it("accepts finalize response loss only after the exact run is absent", async () => {
    fakeState.finalizeError = "finalize response lost";
    const baseFrom = mockAdminFrom.getMockImplementation()!;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "demo_runs") return baseFrom(table);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.in = () => query;
      query.order = () => query;
      query.limit = () => query;
      query.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return query;
    });

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cleared: true });
  });

  it("fails closed when a manifest resource points outside the exact run", async () => {
    fakeState.resources = [{ resource_type: "connection", resource_id: 9001 }];
    fakeState.relationshipRows.connections = {
      household_account_id: ROOT_ID,
      shadchanus_account_id: 999,
      status: "accepted",
    };

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(fakeState.deletedRelationships).toEqual([]);
    expect(fakeState.calls.at(-1)?.fn).toBe("fail_demo_run");
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );
  });

  it("accepts and clears an official single-row listing withdrawal tombstone", async () => {
    fakeState.resources = [
      { resource_type: "connection", resource_id: 9001 },
      { resource_type: "invite", resource_id: 9002 },
      { resource_type: "listing_withdrawal", resource_id: 7007 },
    ];

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cleared: true,
      accountId: ROOT_ID,
      runId: 7001,
    });
    expect(fakeState.calls).toContainEqual(
      expect.objectContaining({
        fn: "assert_demo_resource_ownership",
        params: expect.objectContaining({
          p_resource_type: "listing_withdrawal",
          p_resource_id: 7007,
          p_require_present: false,
        }),
      }),
    );
    expect(fakeState.calls.at(-1)?.fn).toBe("finalize_demo_clear");
  });

  it("retains the run when a manifested grant targets a production single", async () => {
    fakeState.resources = [{ resource_type: "child_grant", resource_id: 9003 }];

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(fakeState.deletedRelationships).toEqual([]);
    expect(fakeState.calls.at(-1)?.fn).toBe("fail_demo_run");
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );
  });

  it("rejects an unknown manifest resource before restore or deletion", async () => {
    fakeState.resources = [
      { resource_type: "future_resource", resource_id: 9004 },
    ];

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(
      fakeState.calls.some(({ fn }) => fn === "assert_demo_resource_ownership"),
    ).toBe(false);
    expect(
      fakeState.calls.some(({ fn }) => fn === "restore_demo_member_state"),
    ).toBe(false);
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );
  });

  it("rejects a manifest kind mismatch before touching the bundle", async () => {
    const baseFrom = mockAdminFrom.getMockImplementation()!;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "demo_run_accounts") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    account_id: ROOT_ID,
                    context_key: "primary-household",
                    context_kind: "shadchanus",
                    is_root: true,
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      return baseFrom(table);
    });

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(
      fakeState.calls.some(({ fn }) => fn === "restore_demo_member_state"),
    ).toBe(false);
    expect(fakeState.deletedRelationships).toEqual([]);
  });

  it("rejects a mismatched Auth identity before actor deletion", async () => {
    fakeState.actorIds = [ACTOR_ID];
    fakeState.authList = async () => ({
      data: {
        users: [
          {
            id: ACTOR_ID,
            email: "demo-test-actor@demo.invalid",
            app_metadata: {
              demo: true,
              demo_run_id: 9999,
              demo_actor_key: "test-actor",
            },
          },
        ],
      },
      error: null,
    });

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(
      fakeState.calls.some(({ fn }) => fn === "restore_demo_member_state"),
    ).toBe(false);
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );
  });

  it("rejects a registered storage path outside every manifest account", async () => {
    const baseFrom = mockAdminFrom.getMockImplementation()!;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "demo_run_storage") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    bucket: "documents",
                    storage_path: "999/not-owned.pdf",
                    resource_key: "resume",
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      return baseFrom(table);
    });
    const remove = vi.fn().mockResolvedValue({ error: null });
    mockAdminStorageFrom.mockReturnValue({ remove });

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(500);
    expect(remove).not.toHaveBeenCalled();
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );
  });

  it("maps an active lifecycle lease conflict to 409 without cleanup", async () => {
    fakeState.claimBusy = true;

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(409);
    expect(fakeState.deletedRelationships).toEqual([]);
    expect(fakeState.calls.map(({ fn }) => fn)).toEqual(["claim_demo_clear"]);
  });

  it("treats a successful no-run claim as an idempotent response-loss retry", async () => {
    fakeState.runId = null;

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cleared: true,
      accountId: ROOT_ID,
      alreadyCleared: true,
    });
    expect(fakeState.deletedRelationships).toEqual([]);
  });

  it("looks up the release receipt only after a no-run claim", async () => {
    fakeState.runId = null;

    const response = await handleClearDemo(
      buildRequest({ releaseDemoFlag: true }),
      FAKE_USER,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cleared: true,
      accountId: ROOT_ID,
      alreadyCleared: true,
    });
    expect(fakeState.calls.map(({ fn }) => fn)).toEqual([
      "claim_demo_clear",
      "get_demo_release_receipt",
    ]);
  });

  it("keeps a failed clear retryable after an Auth error, then succeeds on retry", async () => {
    fakeState.actorIds = [ACTOR_ID];
    fakeState.authError = { status: 500, message: "Auth unavailable" };

    const first = await handleClearDemo(buildRequest(), FAKE_USER);
    expect(first.status).toBe(500);
    expect(fakeState.calls.at(-1)?.fn).toBe("fail_demo_run");
    expect(fakeState.calls.some(({ fn }) => fn === "finalize_demo_clear")).toBe(
      false,
    );

    fakeState.authError = null;
    const second = await handleClearDemo(buildRequest(), FAKE_USER);
    expect(second.status).toBe(200);
    expect(fakeState.calls.at(-1)?.fn).toBe("finalize_demo_clear");
  });

  it("treats an already-deleted Auth actor as success during compensation", async () => {
    fakeState.actorIds = [ACTOR_ID];
    fakeState.authError = {
      status: 404,
      code: "user_not_found",
      message: "User not found",
    };

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(fakeState.calls.at(-1)?.fn).toBe("finalize_demo_clear");
  });

  it("treats a thrown Auth not-found as idempotent during clear", async () => {
    fakeState.actorIds = [ACTOR_ID];
    fakeState.authDelete = async () => {
      throw { status: 404, code: "user_not_found", message: "User not found" };
    };

    const response = await handleClearDemo(buildRequest(), FAKE_USER);

    expect(response.status).toBe(200);
    expect(fakeState.calls.at(-1)?.fn).toBe("finalize_demo_clear");
  });

  it("retains the run when heartbeat or finalization fails", async () => {
    fakeState.heartbeatError = "lease expired";
    const heartbeatFailure = await handleClearDemo(buildRequest(), FAKE_USER);
    expect(heartbeatFailure.status).toBe(500);
    expect(fakeState.calls.at(-1)?.fn).toBe("fail_demo_run");

    fakeState.heartbeatError = null;
    fakeState.finalizeError = "finalizer unavailable";
    const finalizerFailure = await handleClearDemo(buildRequest(), FAKE_USER);
    expect(finalizerFailure.status).toBe(500);
    expect(fakeState.calls.at(-1)?.fn).toBe("fail_demo_run");
  });
});
