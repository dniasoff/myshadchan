/**
 * Per-agent test-stack allocation — the single source of truth for every
 * host-global resource the test stacks used to hard-code.
 *
 * Why this exists: `supabase/config.e2e.toml` pins one project id and one
 * fixed port block, `playwright.config.ts` pinned one Vite port, and the
 * database suites pinned one `postgresql://…:54322/postgres`. Two agents
 * running tests against the same checkout therefore shared one database, and
 * `resetDb()` (an `auto: true` Playwright fixture) truncates it before every
 * e2e test — so one agent wiped the other's rows mid-assertion. Disjoint file
 * ownership does not help with that: the collision is in the runtime, not in
 * the tree. See `.claude/rules/parallel-ownership.md`, "Running tests in
 * parallel".
 *
 * The allocation is a pure function of `STACK_ID`:
 *
 *   stack N  ->  supabase ports [54340 + 10N .. 54349 + 10N]
 *                docker project id `atomic-crm-e2e[-N]`
 *                supabase workdir `.supabase-e2e[-N]`
 *                vite dev server 5175 + N
 *                vite dep cache `node_modules/.vite[-N]`
 *
 * Stack 0 is exactly today's allocation, digit for digit, so an unset
 * `STACK_ID` changes nothing anywhere. `scripts/stack-env.test.mjs` asserts
 * that as a byte-for-byte comparison against the committed
 * `supabase/config.e2e.toml`, so the default path cannot drift silently.
 */

import { pathToFileURL } from "node:url";

/** Highest addressable stack. Ten stacks * ten ports = 54340..54439. */
export const MAX_STACK_INDEX = 9;

/** Start of the e2e port block (`[db] shadow_port` in config.e2e.toml). */
const E2E_PORT_BASE = 54340;

/** Width of one stack's port block. Every port below is BASE + offset. */
const PORTS_PER_STACK = 10;

/** Offsets inside a stack's block, as laid out by supabase/config.e2e.toml. */
const PORT_OFFSETS = {
  shadow: 0,
  api: 1,
  db: 2,
  studio: 3,
  inbucket: 4,
  analytics: 7,
  vector: 8,
  pooler: 9,
};

/** Vite dev-server port for the e2e app (`--mode e2e`). */
const APP_PORT_BASE = 5175;

/** Vitest's own browser-mode default (`browser.api.port`). */
const VITEST_BROWSER_PORT_BASE = 63315;

/**
 * Vite's own default `cacheDir`. Stack 0 keeps it verbatim; every other stack
 * gets `-N` appended.
 *
 * This is a host-global that isolating the ports alone does *not* cover, and it
 * was the last thing making concurrent runs fail. Vite writes its optimised
 * dependency chunks here and rewrites `_metadata.json` with a fresh hash on
 * every re-optimisation; the browser then requests
 * `node_modules/.vite/deps/chunk-<hash>.js`. When several servers share one
 * directory, each re-optimisation deletes the chunks the *other* servers'
 * already-loaded pages are still asking for, and those pages 404. Measured with
 * five concurrent stacks on one shared cache: one stack lost all 8 of its tests
 * to `The file does not exist at "node_modules/.vite/deps/chunk-*.js"`, and the
 * victim moved between runs. With one cache per stack the same five run clean.
 */
const CACHE_DIR_BASE = "node_modules/.vite";

/**
 * The *dev* stack's database (supabase/config.toml), which is what
 * `npm run test:unit:db` has always talked to when nothing sets
 * SUPABASE_DB_URL. Unrelated to the e2e block above — kept here so the
 * fallback lives next to the thing it is a fallback for.
 */
export const DEV_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Normalises a raw STACK_ID into an integer index, or throws.
 *
 * Deliberately strict: a stack id is an exclusive allocation of ports and a
 * database, so a value we cannot map exactly must fail loudly. Hashing a free
 * -form name into a slot was considered and rejected — a hash collision hands
 * two agents the same database, which is precisely the failure this module
 * exists to remove, except silent.
 */
export function parseStackId(raw) {
  const text = String(raw).trim();

  if (!/^\d+$/.test(text)) {
    throw new Error(
      `STACK_ID must be an integer between 0 and ${MAX_STACK_INDEX}, got ${JSON.stringify(raw)}. ` +
        `It allocates an exclusive port block and database; free-form names are refused ` +
        `rather than hashed into a slot, because a collision would silently share a database.`,
    );
  }

  const index = Number(text);

  if (index > MAX_STACK_INDEX) {
    throw new Error(
      `STACK_ID ${index} is out of range (0..${MAX_STACK_INDEX}). Ports would run past ` +
        `${E2E_PORT_BASE + (MAX_STACK_INDEX + 1) * PORTS_PER_STACK - 1}.`,
    );
  }

  return index;
}

/**
 * Resolves every stack-scoped resource for a raw STACK_ID value.
 *
 * `undefined`, `null` and `""` all mean "unset" and resolve to stack 0 with
 * `isExplicit: false`. Callers use `isExplicit` to decide whether STACK_ID
 * outranks an inherited env var: when an agent asks for stack N, a stale
 * `VITE_SUPABASE_URL` or `SUPABASE_DB_URL` in the environment must not be
 * able to re-point its writes at another agent's database.
 */
export function resolveStack(raw) {
  const isExplicit =
    raw !== undefined && raw !== null && String(raw).trim() !== "";
  const index = isExplicit ? parseStackId(raw) : 0;

  const base = E2E_PORT_BASE + index * PORTS_PER_STACK;
  const port = (name) => base + PORT_OFFSETS[name];
  const suffix = index === 0 ? "" : `-${index}`;
  const appPort = APP_PORT_BASE + index;
  const workdir = `.supabase-e2e${suffix}`;

  return {
    index,
    isExplicit,
    suffix,
    projectId: `atomic-crm-e2e${suffix}`,
    workdir,
    logTag: `supabase-e2e${suffix}`,
    // Playwright writes traces/screenshots here; two concurrent runs sharing
    // one directory overwrite each other's artifacts. "test-results" for
    // stack 0 is Playwright's own default.
    outputDir: `test-results${suffix}`,
    // Vite's optimised-dependency cache. See CACHE_DIR_BASE above: sharing it
    // is not a slowdown, it is a hard failure for every server but the last one
    // to re-optimise.
    cacheDir: `${CACHE_DIR_BASE}${suffix}`,
    // Where `scripts/stack-lease.mjs` records who holds this stack. Inside the
    // supabase workdir (already per-stack and gitignored) but *beside*
    // `<workdir>/supabase`, which `make start-supabase-e2e` wipes on every run.
    leasePath: `${workdir}/.stack-lease.json`,
    ports: {
      shadow: port("shadow"),
      api: port("api"),
      db: port("db"),
      studio: port("studio"),
      inbucket: port("inbucket"),
      analytics: port("analytics"),
      vector: port("vector"),
      pooler: port("pooler"),
      app: appPort,
      vitestBrowser: VITEST_BROWSER_PORT_BASE + index,
    },
    supabaseUrl: `http://127.0.0.1:${port("api")}`,
    dbUrl: `postgresql://postgres:postgres@127.0.0.1:${port("db")}/postgres`,
    studioUrl: `http://127.0.0.1:${port("studio")}`,
    mailpitUrl: `http://127.0.0.1:${port("inbucket")}`,
    appUrl: `http://localhost:${appPort}`,
  };
}

/**
 * The database URL the database suites (`supabase/tests/**`) must use.
 *
 * With STACK_ID set it is that stack's database and nothing else can override
 * it. With STACK_ID unset the behaviour is byte-identical to what every suite
 * hard-coded before: `SUPABASE_DB_URL` if present, else the dev stack.
 */
export function dbUrlFromEnv(env = process.env) {
  const stack = resolveStack(env.STACK_ID);
  return stack.isExplicit ? stack.dbUrl : (env.SUPABASE_DB_URL ?? DEV_DB_URL);
}

/**
 * The Supabase API URL the e2e fixtures must use — same precedence rule as
 * `dbUrlFromEnv`, and for the same reason: `resetDb()` truncates whatever this
 * points at.
 */
export function supabaseUrlFromEnv(env = process.env) {
  const stack = resolveStack(env.STACK_ID);
  return stack.isExplicit
    ? stack.supabaseUrl
    : (env.VITE_SUPABASE_URL ?? stack.supabaseUrl);
}

/** Flat KEY=value pairs, for `eval "$(node scripts/stack-env.mjs --shell)"`. */
export function shellVars(stack) {
  return {
    STACK_ID: String(stack.index),
    STACK_SUFFIX: stack.suffix,
    STACK_PROJECT_ID: stack.projectId,
    STACK_WORKDIR: stack.workdir,
    STACK_LOG_TAG: stack.logTag,
    STACK_CACHE_DIR: stack.cacheDir,
    STACK_LEASE_PATH: stack.leasePath,
    STACK_API_PORT: String(stack.ports.api),
    STACK_DB_PORT: String(stack.ports.db),
    STACK_STUDIO_PORT: String(stack.ports.studio),
    STACK_INBUCKET_PORT: String(stack.ports.inbucket),
    STACK_APP_PORT: String(stack.ports.app),
    VITE_SUPABASE_URL: stack.supabaseUrl,
    SUPABASE_DB_URL: stack.dbUrl,
    E2E_APP_URL: stack.appUrl,
    E2E_MAILPIT_URL: stack.mailpitUrl,
  };
}

function main(argv) {
  const args = argv.filter((arg) => arg !== "--shell" && arg !== "--json");
  const stack = resolveStack(args[0] ?? process.env.STACK_ID);

  if (argv.includes("--json")) {
    console.log(JSON.stringify(stack, null, 2));
    return;
  }

  // Single-quoted values; every value produced above is a port number, an
  // ASCII identifier or a URL, none of which can contain a single quote.
  console.log(
    Object.entries(shellVars(stack))
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
  );
}

// Run as a CLI only when invoked directly, never when imported (the database
// suites, the Playwright config and the Vitest config all import it).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`stack-env: ${error.message}`);
    process.exit(1);
  }
}
