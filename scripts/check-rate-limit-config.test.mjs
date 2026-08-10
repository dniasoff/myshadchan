import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runRateLimitConfigCheck,
  parseWranglerRatelimits,
  parseRateLimitConfigs,
  parseMiddlewareWiring,
  collectWorkerSourceFiles,
} from "./check-rate-limit-config.mjs";

// External review Finding 4 — proves this guard actually bites: every
// fixture is built fresh under a temp directory (never the real repo tree),
// so this test also proves it against a REALISTIC minimal tree, not just
// unit-tests the three parsers in isolation.
//
// Finding 4 repair round 2 (migration-guard-integrity.md): every one of
// those fixture-only tests stayed green for months while the guard was
// completely broken against the ACTUAL repository — `indexTs:
// "workers/parse/index.ts"` no longer matched anything once the wiring
// moved to `workers/parse/registerParseMiddleware.ts`, and nothing in this
// file would ever have caught that, because nothing here ever pointed the
// guard at the real tree. The `"real repository tree"` describe block below
// is what closes that gap: it is the one test in this file that would have
// failed the moment the guard broke, and it is what makes a future green
// run here mean something about the real tree, not just about fixtures this
// file invented.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-rate-limit-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeFixture(relPath, content) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

const RATE_LIMIT_TS = `
export interface RateLimitConfig {
  readonly limit: number;
  readonly periodSeconds: number;
}

export const AI_WORKER_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 20,
  periodSeconds: 10,
};

export const PARSE_USER_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  periodSeconds: 60,
};

export const SHARE_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  periodSeconds: 60,
};

export const INGEST_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 50,
  periodSeconds: 60,
};
`;

function parseWranglerToml({ ipLimit = 20, ipPeriod = 10 } = {}) {
  return `
name = "myshadchan-parse"
main = "index.ts"

[[ratelimits]]
name = "PARSE_IP_RATE_LIMITER"
namespace_id = "1101"
simple = { limit = ${ipLimit}, period = ${ipPeriod} }

[[ratelimits]]
name = "PARSE_USER_RATE_LIMITER"
namespace_id = "1102"
simple = { limit = 10, period = 60 }
`;
}

const PARSE_INDEX_TS = `
import {
  AI_WORKER_IP_RATE_LIMIT,
  PARSE_USER_RATE_LIMIT,
  createRateLimitMiddleware,
} from "../shared/rateLimit";

app.use(
  "*",
  createRateLimitMiddleware<ParseEnvContext>({
    limiterName: "parse-ip",
    config: AI_WORKER_IP_RATE_LIMIT,
    getBinding: (env) => env.PARSE_IP_RATE_LIMITER,
    deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
  }),
);
app.use(
  "*",
  createRateLimitMiddleware<ParseEnvContext>({
    limiterName: "parse-user",
    config: PARSE_USER_RATE_LIMIT,
    getBinding: (env) => env.PARSE_USER_RATE_LIMITER,
    deriveKey: (c) => deriveCallerKey(c.req.header("Authorization")),
  }),
);
`;

async function writeParseFixture(wranglerTomlContent) {
  await writeFixture("workers/shared/rateLimit.ts", RATE_LIMIT_TS);
  await writeFixture("workers/parse/wrangler.toml", wranglerTomlContent);
  await writeFixture("workers/parse/index.ts", PARSE_INDEX_TS);
  // The "ai" worker is also always read by runRateLimitConfigCheck — give it
  // a trivially-consistent fixture so tests can focus on the "parse" side
  // without every case having to duplicate an unrelated ai/ tree.
  await writeFixture(
    "workers/ai/wrangler.toml",
    `
[[ratelimits]]
name = "AI_IP_RATE_LIMITER"
namespace_id = "1201"
simple = { limit = 20, period = 10 }
`,
  );
  await writeFixture(
    "workers/ai/index.ts",
    `
import { AI_WORKER_IP_RATE_LIMIT, createRateLimitMiddleware } from "../shared/rateLimit";
app.use(
  "*",
  createRateLimitMiddleware<AiEnvContext>({
    limiterName: "ai-ip",
    config: AI_WORKER_IP_RATE_LIMIT,
    getBinding: (env) => env.AI_IP_RATE_LIMITER,
    deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
  }),
);
`,
  );
  // Story 15.4 widened runRateLimitConfigCheck's WORKERS list from two to
  // four. Every worker in that list is always read, so "share" and "ingest"
  // need trivially-consistent fixtures here for the same reason "ai" does —
  // without them every case in this file dies on ENOENT before it can assert
  // anything about "parse".
  for (const { dir, binding, config, limiter, limit } of [
    {
      dir: "share",
      binding: "SHARE_IP_RATE_LIMITER",
      config: "SHARE_IP_RATE_LIMIT",
      limiter: "share-ip",
      limit: 30,
    },
    {
      dir: "ingest",
      binding: "INGEST_IP_RATE_LIMITER",
      config: "INGEST_IP_RATE_LIMIT",
      limiter: "ingest-ip",
      limit: 50,
    },
  ]) {
    await writeFixture(
      `workers/${dir}/wrangler.toml`,
      `
[[ratelimits]]
name = "${binding}"
namespace_id = "1501"
simple = { limit = ${limit}, period = 60 }
`,
    );
    await writeFixture(
      `workers/${dir}/index.ts`,
      `
import { ${config}, createRateLimitMiddleware } from "../shared/rateLimit";
app.use(
  "*",
  createRateLimitMiddleware<${dir === "share" ? "ShareEnvContext" : "IngestEnvContext"}>({
    limiterName: "${limiter}",
    config: ${config},
    getBinding: (env) => env.${binding},
    deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
  }),
);
`,
    );
  }
}

describe("runRateLimitConfigCheck", () => {
  it("passes when every wired limiter's numbers agree across wrangler.toml and rateLimit.ts", async () => {
    // Arrange
    await writeParseFixture(parseWranglerToml());

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(failures).toEqual([]);
  });

  it("fails when wrangler.toml's limit drifts from the TypeScript config's limit", async () => {
    // Arrange — Cloudflare would enforce 99, but the app code still thinks
    // it's 20. This is exactly the drift Finding 4 describes: every existing
    // test only exercised the TS side, so nothing caught it.
    await writeParseFixture(parseWranglerToml({ ipLimit: 99 }));

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.some(
        (f) =>
          f.includes("PARSE_IP_RATE_LIMITER") &&
          f.includes("limit=99") &&
          f.includes("limit=20"),
      ),
    ).toBe(true);
  });

  it("fails when wrangler.toml's period drifts from the TypeScript config's periodSeconds", async () => {
    // Arrange — Retry-After would tell callers to wait 10s, but Cloudflare
    // is actually enforcing a 30s window.
    await writeParseFixture(parseWranglerToml({ ipPeriod: 30 }));

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(
      failures.some(
        (f) =>
          f.includes("PARSE_IP_RATE_LIMITER") &&
          f.includes("period=30") &&
          f.includes("periodSeconds=10"),
      ),
    ).toBe(true);
  });

  it("fails when index.ts wires a config export that no longer exists in rateLimit.ts", async () => {
    // Arrange
    await writeParseFixture(parseWranglerToml());
    await writeFixture(
      "workers/parse/index.ts",
      PARSE_INDEX_TS.replaceAll(
        "AI_WORKER_IP_RATE_LIMIT",
        "RENAMED_IP_RATE_LIMIT",
      ),
    );

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(failures.some((f) => f.includes('"RENAMED_IP_RATE_LIMIT"'))).toBe(
      true,
    );
  });

  it("fails when index.ts wires a binding name that wrangler.toml no longer declares", async () => {
    // Arrange — a renamed or removed [[ratelimits]] block.
    await writeParseFixture(parseWranglerToml());
    await writeFixture(
      "workers/parse/index.ts",
      PARSE_INDEX_TS.replace(
        "env.PARSE_IP_RATE_LIMITER",
        "env.RENAMED_BINDING",
      ),
    );

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(failures.some((f) => f.includes('"RENAMED_BINDING"'))).toBe(true);
  });

  it("reports (rather than silently passing) when no file under the worker directory has a createRateLimitMiddleware call", async () => {
    // Arrange — rate limiting removed, or the call shape changed enough that
    // this guard's parser can no longer see it anywhere under
    // workers/parse/. Either way this must be loud, not a silent green.
    await writeParseFixture(parseWranglerToml());
    await writeFixture(
      "workers/parse/index.ts",
      "export function createParseApp() { return app; }",
    );

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert
    expect(
      failures.some((f) => f.includes("found no createRateLimitMiddleware")),
    ).toBe(true);
  });

  it("still finds the wiring when it lives in a differently-named or newly-added file, not index.ts", async () => {
    // Arrange — this is the exact shape of the real Finding-4 regression:
    // workers/parse/index.ts's two createRateLimitMiddleware calls moved to
    // workers/parse/registerParseMiddleware.ts. index.ts itself now has none.
    await writeParseFixture(parseWranglerToml());
    await writeFixture(
      "workers/parse/index.ts",
      "export function createParseApp() { return registerParseMiddleware(app); }",
    );
    await writeFixture(
      "workers/parse/registerParseMiddleware.ts",
      PARSE_INDEX_TS,
    );

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert — the guard is layout-robust: it scans every non-test .ts file
    // under workers/parse/, so relocating the wiring to a new file name
    // does not break it.
    expect(failures).toEqual([]);
  });

  it("ignores wiring-shaped text inside a .wrangler build/cache directory", async () => {
    // Arrange — a build artifact could plausibly contain a stale or
    // duplicated copy of the wiring call; it must never be read as a source
    // of truth.
    await writeParseFixture(parseWranglerToml());
    await writeFixture(
      "workers/parse/.wrangler/tmp/bundled-index.ts",
      PARSE_INDEX_TS.replaceAll(
        "PARSE_USER_RATE_LIMIT",
        "RENAMED_IN_BUILD_ARTIFACT",
      ),
    );

    // Act
    const failures = runRateLimitConfigCheck(tempRoot);

    // Assert — still clean: the real wiring in workers/parse/index.ts is
    // untouched, and the .wrangler copy (which would otherwise fail on the
    // renamed, non-existent config) is never read.
    expect(failures).toEqual([]);
  });
});

describe("collectWorkerSourceFiles", () => {
  it("excludes test files, .d.ts files, and build/dependency directories", async () => {
    // Arrange
    await writeFixture("workers/parse/index.ts", "// real source");
    await writeFixture("workers/parse/index.test.ts", "// test file");
    await writeFixture("workers/parse/index.spec.ts", "// spec file");
    await writeFixture("workers/parse/types.d.ts", "// ambient declarations");
    await writeFixture(
      "workers/parse/.wrangler/tmp/bundle.ts",
      "// build output",
    );
    await writeFixture(
      "workers/parse/node_modules/pkg/index.ts",
      "// dependency",
    );
    await writeFixture("workers/parse/nested/helper.ts", "// nested source");

    // Act
    const files = collectWorkerSourceFiles(
      path.join(tempRoot, "workers/parse"),
    );

    // Assert
    const relative = files.map((f) => path.relative(tempRoot, f)).sort();
    expect(relative).toEqual(
      ["workers/parse/index.ts", "workers/parse/nested/helper.ts"].sort(),
    );
  });
});

describe("runRateLimitConfigCheck against the real repository tree", () => {
  it("passes against the actual checked-out tree, not just synthetic fixtures", () => {
    // Arrange — REPO_ROOT is this file's own repository, resolved from its
    // own location rather than assumed. No fixtures, no tmpdir: this is the
    // one test in the suite that would have caught the real Finding-4
    // regression (a hardcoded `indexTs` that stopped matching once the
    // wiring moved to registerParseMiddleware.ts), because it is the only
    // test that ever points the guard at the real files.

    // Act
    const failures = runRateLimitConfigCheck(REPO_ROOT);

    // Assert
    expect(failures).toEqual([]);
  });

  it("actually finds wiring in both real worker directories (not vacuously empty)", () => {
    // Arrange / Act
    const parseFiles = collectWorkerSourceFiles(
      path.join(REPO_ROOT, "workers/parse"),
    ).map((f) => path.relative(REPO_ROOT, f));
    const aiFiles = collectWorkerSourceFiles(
      path.join(REPO_ROOT, "workers/ai"),
    ).map((f) => path.relative(REPO_ROOT, f));

    const parseWiring = parseFiles.flatMap((f) =>
      parseMiddlewareWiring(readFileSync(path.join(REPO_ROOT, f), "utf8")),
    );
    const aiWiring = aiFiles.flatMap((f) =>
      parseMiddlewareWiring(readFileSync(path.join(REPO_ROOT, f), "utf8")),
    );

    // Assert — a guard that silently found zero calls but still reported no
    // failures would be validating nothing. Pin down that it actually saw
    // both limiters for both workers.
    expect(parseWiring.length).toBeGreaterThanOrEqual(2);
    expect(aiWiring.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseWranglerRatelimits", () => {
  it("extracts name, limit and period from a [[ratelimits]] block", () => {
    // Arrange
    const text = parseWranglerToml({ ipLimit: 42, ipPeriod: 10 });

    // Act
    const result = parseWranglerRatelimits(text);

    // Assert
    expect(result).toEqual([
      { name: "PARSE_IP_RATE_LIMITER", limit: 42, period: 10 },
      { name: "PARSE_USER_RATE_LIMITER", limit: 10, period: 60 },
    ]);
  });

  it("returns an empty array when there are no [[ratelimits]] blocks", () => {
    // Arrange / Act / Assert
    expect(parseWranglerRatelimits('name = "myshadchan-cron"\n')).toEqual([]);
  });
});

describe("parseRateLimitConfigs", () => {
  it("extracts every exported RateLimitConfig by name", () => {
    // Arrange / Act
    const result = parseRateLimitConfigs(RATE_LIMIT_TS);

    // Assert
    expect(result).toEqual({
      AI_WORKER_IP_RATE_LIMIT: { limit: 20, periodSeconds: 10 },
      PARSE_USER_RATE_LIMIT: { limit: 10, periodSeconds: 60 },
      SHARE_IP_RATE_LIMIT: { limit: 30, periodSeconds: 60 },
      INGEST_IP_RATE_LIMIT: { limit: 50, periodSeconds: 60 },
    });
  });
});

describe("parseMiddlewareWiring", () => {
  it("extracts the (config, binding) pair from every createRateLimitMiddleware call", () => {
    // Arrange / Act
    const result = parseMiddlewareWiring(PARSE_INDEX_TS);

    // Assert
    expect(result).toEqual([
      {
        configName: "AI_WORKER_IP_RATE_LIMIT",
        bindingName: "PARSE_IP_RATE_LIMITER",
      },
      {
        configName: "PARSE_USER_RATE_LIMIT",
        bindingName: "PARSE_USER_RATE_LIMITER",
      },
    ]);
  });
});
