import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type User } from "jsr:@supabase/supabase-js@2";
import { handleClearDemo } from "./index.ts";

/**
 * Closes a live production gap: the deployed `clear_demo` performed an
 * unconditional 16-table wipe of the caller's own account with no check
 * that the account was actually a demo account. `handleClearDemo` is tested
 * directly here — bypassing real JWT verification (`AuthMiddleware`) —
 * exactly like `postmark/index.test.ts` tests `handleInboundEmail` directly;
 * only `../_shared/supabaseAdmin.ts` and `../_shared/resolveDemoAccount.ts`
 * are mocked, so the guard, the delete loop, and the error mapping all run
 * for real against these doubles.
 */

const mockAdminFrom = vi.hoisted(() => vi.fn());
const mockAdminStorageFrom = vi.hoisted(() => vi.fn());
const mockResolveAccountId = vi.hoisted(() => vi.fn());
const mockUserScopedClient = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => mockAdminFrom(...args),
    storage: { from: (...args: [string]) => mockAdminStorageFrom(...args) },
  },
}));

vi.mock("../_shared/resolveDemoAccount.ts", () => ({
  resolveAccountId: (...args: [string]) => mockResolveAccountId(...args),
  userScopedClient: (...args: [Request]) => mockUserScopedClient(...args),
}));

// `handleClearDemo` (the thing under test) never calls AuthMiddleware or
// UserMiddleware itself — they only wrap it inside `Deno.serve`, exactly
// like `postmark/index.test.ts` tests `handleInboundEmail` beneath its own
// wrapping middleware. But merely IMPORTING "./index.ts" still statically
// imports "../_shared/authentication.ts", which imports the real
// "jsr:@panva/jose@6" — a specifier the "functions" Vitest project has no
// alias for (unlike "jsr:@supabase/supabase-js@2"), so it fails to resolve
// under Node. Stubbing the module here avoids ever loading the real file,
// with no change needed to `vitest.config.ts` or `authentication.ts`.
vi.mock("../_shared/authentication.ts", () => ({
  AuthMiddleware: (req: Request, next: (req: Request) => Promise<Response>) =>
    next(req),
  UserMiddleware: (
    req: Request,
    next: (req: Request, user?: User) => Promise<Response>,
  ) => next(req),
}));

const DEMO_ACCOUNT_ID = 42;
const FAKE_USER = {
  id: "11111111-1111-1111-1111-111111111111",
} as unknown as User;

type AdminOptions = {
  demo?: boolean | null;
  noRow?: boolean;
  selectError?: string;
  /** Shared with `buildFakeDb` so tests can assert relative ORDER between
   * the delete loop and the accounts.demo release, not just that both
   * happened. */
  callOrder?: string[];
  updateError?: string;
};

/** Wires `supabaseAdmin.from("accounts")` (the guard's own read, plus the
 * conditional `.update` — only called when `releaseDemoFlag` is true) and
 * the three `collectStoragePaths` reads
 * (`resumes`/`resume_photos`/`entity_files`), each returning no files so
 * storage removal is a no-op in every test. */
function buildFakeAdmin(options: AdminOptions) {
  const accountsSelectCalls: number[] = [];
  const accountsUpdateAttempts: unknown[] = [];
  const callOrder = options.callOrder ?? [];

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "accounts") {
      return {
        select: () => ({
          eq: (_col: string, id: number) => ({
            maybeSingle: () => {
              accountsSelectCalls.push(id);
              if (options.selectError) {
                return Promise.resolve({
                  data: null,
                  error: { message: options.selectError },
                });
              }
              if (options.noRow) {
                return Promise.resolve({ data: null, error: null });
              }
              return Promise.resolve({
                data: { demo: options.demo ?? null },
                error: null,
              });
            },
          }),
        }),
        update: (patch: unknown) => {
          accountsUpdateAttempts.push(patch);
          callOrder.push("update:accounts");
          return {
            eq: () =>
              Promise.resolve(
                options.updateError
                  ? { error: { message: options.updateError } }
                  : { error: null },
              ),
          };
        },
      };
    }
    if (
      table === "resumes" ||
      table === "resume_photos" ||
      table === "entity_files"
    ) {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    }
    throw new Error(`Unexpected admin table in test: ${table}`);
  });

  mockAdminStorageFrom.mockImplementation(() => ({
    remove: () => Promise.resolve({ error: null }),
  }));

  return { accountsSelectCalls, accountsUpdateAttempts, callOrder };
}

type DbOptions = {
  /** Table whose delete should fail, simulating a mid-loop failure. */
  failTable?: string;
  /** Shared with `buildFakeAdmin` — see its `callOrder` doc. */
  callOrder?: string[];
};

/** Wires the USER-scoped client the DELETE_ORDER loop runs on. */
function buildFakeDb(options: DbOptions = {}) {
  const deleteCalls: Array<{ table: string; accountId: unknown }> = [];
  const callOrder = options.callOrder ?? [];
  const from = vi.fn((table: string) => ({
    delete: () => ({
      eq: (_col: string, value: unknown) => {
        deleteCalls.push({ table, accountId: value });
        callOrder.push(`delete:${table}`);
        if (options.failTable === table) {
          return Promise.resolve({ error: { message: "delete failed" } });
        }
        return Promise.resolve({ error: null });
      },
    }),
  }));
  mockUserScopedClient.mockReturnValue({ from });
  return { deleteCalls, from, callOrder };
}

function buildRequest(body: unknown = { accountId: 999999 }): Request {
  return new Request("http://localhost/functions/v1/clear_demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("clear_demo handleClearDemo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccountId.mockResolvedValue(DEMO_ACCOUNT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("guard allows a demo account", () => {
    it("clears every table, scoped to the resolved account, and does not touch accounts.demo when releaseDemoFlag is omitted", async () => {
      // Arrange
      const admin = buildFakeAdmin({ demo: true });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        cleared: true,
        accountId: DEMO_ACCOUNT_ID,
      });
      expect(db.deleteCalls.length).toBeGreaterThan(0);
      expect(db.deleteCalls.every((c) => c.accountId === DEMO_ACCOUNT_ID)).toBe(
        true,
      );
      // Regression guard for the bricking trap: an omitted/false
      // releaseDemoFlag (the reseeder's shape) must never write
      // accounts.demo — writing `false` here is what made a demo account
      // permanently unclearable the next time a seed_demo run failed before
      // reaching its own final `demo = true` write. The true-flag path is
      // covered separately below in "releaseDemoFlag opt-in".
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });
  });

  describe("guard refuses a non-demo account", () => {
    it("returns 403 and performs zero deletes when demo is false", async () => {
      // Arrange
      const admin = buildFakeAdmin({ demo: false });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
      // The guard's read of `accounts` must be the ONLY admin read that ever
      // happened — proving the check runs before any other table is touched.
      expect(mockAdminFrom).toHaveBeenCalledTimes(1);
      expect(mockAdminStorageFrom).not.toHaveBeenCalled();
      const body = await response.json();
      expect(body.message).toMatch(/not a demo account/i);
      // Must not leak account data in the error response.
      expect(JSON.stringify(body)).not.toContain(String(DEMO_ACCOUNT_ID));
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });
  });

  describe("guard fails closed when the demo flag is unreadable", () => {
    it("returns 403 and performs zero deletes when demo is NULL", async () => {
      // Arrange
      buildFakeAdmin({ demo: null });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
    });

    it("returns 403 and performs zero deletes when the account row cannot be read (query error)", async () => {
      // Arrange
      buildFakeAdmin({ selectError: "connection reset" });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
    });

    it("returns 403 and performs zero deletes when no account row exists", async () => {
      // Arrange
      buildFakeAdmin({ noRow: true });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("re-clearability invariant", () => {
    it("lets a demo account be cleared again even after a run where the flag was never flipped in between", async () => {
      // Arrange — simulates the trap: seed_demo is not transactional with
      // clear_demo and can fail before ever reaching its own final
      // `demo = true` write. Because clear_demo no longer resets `demo` to
      // false, an account that was ever legitimately seeded stays
      // demo=true no matter how the next seed/clear cycle goes.
      const admin = buildFakeAdmin({ demo: true });
      buildFakeDb();

      // Act — first clear.
      const first = await handleClearDemo(buildRequest(), FAKE_USER);
      // Nothing re-seeded and nothing flipped the flag between calls — the
      // account is still exactly demo=true, as it would be after a
      // seed_demo run that failed partway through.
      const secondDb = buildFakeDb();
      const second = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert — both calls succeed; the guard was re-checked (and passed)
      // both times, and neither call wrote accounts.demo.
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(secondDb.deleteCalls.length).toBeGreaterThan(0);
      expect(admin.accountsSelectCalls).toEqual([
        DEMO_ACCOUNT_ID,
        DEMO_ACCOUNT_ID,
      ]);
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });

    it("never becomes unclearable after a clear, unlike the naive guard-plus-flip design", async () => {
      // Arrange — the exact bad combination the trap warns against would
      // guard on demo===true AND still flip it false at the end, bricking
      // the account for every subsequent call. Assert the SECOND call still
      // sees demo=true and still succeeds.
      const admin = buildFakeAdmin({ demo: true });
      buildFakeDb();
      await handleClearDemo(buildRequest(), FAKE_USER);

      // Act — a second, independent clear attempt.
      buildFakeDb();
      const response = await handleClearDemo(buildRequest(), FAKE_USER);

      // Assert
      expect(response.status).toBe(200);
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });
  });

  describe("tenancy scoping", () => {
    it("uses the server-resolved accountId for every delete, never a value from the request body", async () => {
      // Arrange
      buildFakeAdmin({ demo: true });
      const db = buildFakeDb();

      // Act — the body carries a different, attacker-controlled accountId.
      const response = await handleClearDemo(
        buildRequest({ accountId: 999999 }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(200);
      expect(db.deleteCalls.length).toBeGreaterThan(0);
      expect(db.deleteCalls.some((c) => c.accountId === 999999)).toBe(false);
      expect(db.deleteCalls.every((c) => c.accountId === DEMO_ACCOUNT_ID)).toBe(
        true,
      );
    });
  });

  describe("request validation, unchanged", () => {
    it("returns 401 and never resolves an account when there is no authenticated user", async () => {
      // Arrange
      buildFakeAdmin({ demo: true });
      buildFakeDb();

      // Act
      const response = await handleClearDemo(buildRequest(), undefined);

      // Assert
      expect(response.status).toBe(401);
      expect(mockResolveAccountId).not.toHaveBeenCalled();
    });

    it("returns 405 for a non-POST/DELETE method", async () => {
      // Arrange
      buildFakeAdmin({ demo: true });
      buildFakeDb();

      // Act
      const response = await handleClearDemo(
        new Request("http://localhost/functions/v1/clear_demo", {
          method: "GET",
        }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(405);
    });
  });

  // The opt-in `releaseDemoFlag` request param — see the module docstring's
  // "TWO callers with opposite intent" section. These tests are the
  // decisive evidence for that contract; the earlier describe blocks above
  // already assert `accountsUpdateAttempts` stays empty for every
  // flag-omitted call, so this block focuses on what's NEW: the true case,
  // ordering, failure handling, and strict validation.
  describe("releaseDemoFlag opt-in", () => {
    it("clears data without releasing accounts.demo when releaseDemoFlag is omitted from the body", async () => {
      // Arrange — mirrors admin_reseed_demo_accounts's plain POST with no
      // JSON body at all (invokeDemoFunction.ts's clear_demo call before
      // this change), not just a body missing the key.
      const admin = buildFakeAdmin({ demo: true });
      const db = buildFakeDb();
      const bodylessRequest = new Request(
        "http://localhost/functions/v1/clear_demo",
        { method: "POST" },
      );

      // Act
      const response = await handleClearDemo(bodylessRequest, FAKE_USER);

      // Assert
      expect(response.status).toBe(200);
      expect(db.deleteCalls.length).toBeGreaterThan(0);
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });

    it("clears data AND releases accounts.demo when releaseDemoFlag is true, only after every delete succeeds", async () => {
      // Arrange — a single shared callOrder array lets us assert relative
      // ordering, not just that both things eventually happened.
      const callOrder: string[] = [];
      const admin = buildFakeAdmin({ demo: true, callOrder });
      const db = buildFakeDb({ callOrder });

      // Act
      const response = await handleClearDemo(
        buildRequest({ releaseDemoFlag: true }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(200);
      expect(db.deleteCalls.length).toBeGreaterThan(0);
      expect(admin.accountsUpdateAttempts).toEqual([{ demo: false }]);
      // The update must be the LAST entry — every delete recorded first.
      expect(callOrder.at(-1)).toBe("update:accounts");
      expect(callOrder.filter((c) => c === "update:accounts")).toHaveLength(1);
      expect(callOrder.slice(0, -1).every((c) => c.startsWith("delete:"))).toBe(
        true,
      );
    });

    it("does NOT release accounts.demo when a delete fails after releaseDemoFlag is true (no half-exit)", async () => {
      // Arrange — the second table in DELETE_ORDER fails; the flag release
      // must never run if any delete in the loop errors.
      const admin = buildFakeAdmin({ demo: true });
      buildFakeDb({ failTable: "reference_links" });

      // Act
      const response = await handleClearDemo(
        buildRequest({ releaseDemoFlag: true }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(500);
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });

    it("rejects a non-boolean releaseDemoFlag rather than coercing it, and performs zero deletes", async () => {
      // Arrange — a truthy STRING must not silently enable the release.
      const admin = buildFakeAdmin({ demo: true });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(
        buildRequest({ releaseDemoFlag: "true" }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(400);
      expect(db.from).not.toHaveBeenCalled();
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
      const body = await response.json();
      expect(body.message).toMatch(/releaseDemoFlag must be a boolean/i);
    });

    it("still refuses a non-demo account with zero deletes and zero flag writes, even when releaseDemoFlag is true", async () => {
      // Arrange — the tenancy guard must run and refuse BEFORE the flag is
      // ever considered, regardless of what the caller asked for.
      const admin = buildFakeAdmin({ demo: false });
      const db = buildFakeDb();

      // Act
      const response = await handleClearDemo(
        buildRequest({ releaseDemoFlag: true }),
        FAKE_USER,
      );

      // Assert
      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });

    it("leaves a reseeder-style clear (flag omitted) re-clearable indefinitely — the deadlock regression", async () => {
      // Arrange — simulates admin_reseed_demo_accounts calling clear_demo
      // repeatedly across refresh cycles, never releasing the flag.
      const admin = buildFakeAdmin({ demo: true });
      buildFakeDb();

      // Act — three consecutive reseeder-style clears.
      const first = await handleClearDemo(
        buildRequest({ releaseDemoFlag: false }),
        FAKE_USER,
      );
      buildFakeDb();
      const second = await handleClearDemo(
        buildRequest({ releaseDemoFlag: false }),
        FAKE_USER,
      );
      buildFakeDb();
      const third = await handleClearDemo(
        buildRequest({ releaseDemoFlag: false }),
        FAKE_USER,
      );

      // Assert — every call succeeds, the guard keeps re-passing (demo
      // stays true throughout because nothing ever released it), and the
      // account is never bricked the way an unconditional flip would brick
      // it.
      expect([first, second, third].map((r) => r.status)).toEqual([
        200, 200, 200,
      ]);
      expect(admin.accountsSelectCalls).toEqual([
        DEMO_ACCOUNT_ID,
        DEMO_ACCOUNT_ID,
        DEMO_ACCOUNT_ID,
      ]);
      expect(admin.accountsUpdateAttempts).toHaveLength(0);
    });
  });
});
