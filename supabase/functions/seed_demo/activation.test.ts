import { beforeEach, describe, expect, it, vi } from "vitest";

const adminFrom = vi.hoisted(() => vi.fn());
const activationRpc = vi.hoisted(() => vi.fn());

vi.mock("../_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: (...args: [string]) => adminFrom(...args),
  },
}));

vi.mock("jsr:@supabase/supabase-js@2", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => activationRpc(...args),
  }),
}));

vi.mock("../_shared/authentication.ts", () => ({
  AuthMiddleware: (_req: Request, next: (req: Request) => unknown) =>
    next(_req),
  UserMiddleware: (
    _req: Request,
    next: (req: Request, user?: unknown) => unknown,
  ) => next(_req),
}));

vi.mock("../_shared/cors.ts", () => ({
  corsHeaders: {},
  OptionsMiddleware: (_req: Request, next: (req: Request) => unknown) =>
    next(_req),
}));

vi.mock("../_shared/utils.ts", () => ({
  createErrorResponse: (status: number, message: string) =>
    new Response(JSON.stringify({ error: message, message }), { status }),
}));

vi.mock("../_shared/resolveDemoAccount.ts", () => ({
  findUnfinishedDemoRun: vi.fn(),
  resolveAccountId: vi.fn(),
  userScopedClient: vi.fn(),
}));

vi.mock("./assets/manifest.ts", () => ({
  DEMO_SHARE_ASSET_KEY: "demo.pdf",
  getAssetBytes: vi.fn(),
}));

import { activateDemoRunWithReconciliation } from "./index.ts";

type QueryResult = { data: unknown; error: { message: string } | null };

function query(result: () => QueryResult) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve(result());
  return builder;
}

function arrangeReads(options: { loseRun?: boolean; loseRoot?: boolean } = {}) {
  let runReads = 0;
  let rootReads = 0;
  adminFrom.mockImplementation((table: string) => {
    if (table === "demo_runs") {
      return query(() => {
        runReads += 1;
        if (options.loseRun && runReads === 1) {
          return { data: null, error: { message: "run response lost" } };
        }
        return {
          data: {
            id: 7,
            root_account_id: 42,
            status: "active",
            operation: null,
            lease_token: null,
          },
          error: null,
        };
      });
    }
    if (table === "demo_run_accounts") {
      return query(() => ({
        data: { account_id: 42, is_root: true },
        error: null,
      }));
    }
    if (table === "accounts") {
      return query(() => {
        rootReads += 1;
        if (options.loseRoot && rootReads === 1) {
          return { data: null, error: { message: "root response lost" } };
        }
        return {
          data: { id: 42, name: "Demo household", demo: true },
          error: null,
        };
      });
    }
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  activationRpc.mockResolvedValue({
    data: null,
    error: { message: "activation response lost" },
  });
});

describe("activateDemoRunWithReconciliation", () => {
  it("retries an exact run read after its response is lost", async () => {
    arrangeReads({ loseRun: true });

    await expect(
      activateDemoRunWithReconciliation(7, "lease", "Demo household"),
    ).resolves.toBeUndefined();
  });

  it("retries an exact root read after its response is lost", async () => {
    arrangeReads({ loseRoot: true });

    await expect(
      activateDemoRunWithReconciliation(7, "lease", "Demo household"),
    ).resolves.toBeUndefined();
  });
});
