/**
 * Renders `supabase/config.e2e.toml` into one stack's port block.
 *
 * Usage: node scripts/stack-config.mjs [outFile] [--stack N]
 *        (STACK_ID from the environment when --stack is absent; stdout when
 *        outFile is absent)
 *
 * Line-oriented rewriting rather than a TOML round-trip, deliberately: the
 * committed config carries comments that document why each block is set the
 * way it is, and a parse/serialise cycle would drop them. For stack 0 the
 * substitutions are all identity, so the output is byte-identical to the input
 * — asserted in scripts/stack-env.test.mjs, which is the guarantee that an
 * unset STACK_ID still boots exactly the stack it always did.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveStack } from "./stack-env.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_CONFIG = path.join(REPO_ROOT, "supabase", "config.e2e.toml");

/**
 * Every port-bearing key, keyed by the TOML section it must appear in. A
 * bare `port = …` means nothing without its section — `[api]` and `[db]` both
 * have one — so the section is half the key.
 */
const PORT_KEYS = [
  { section: "api", key: "port", port: "api" },
  { section: "db", key: "port", port: "db" },
  { section: "db", key: "shadow_port", port: "shadow" },
  { section: "db.pooler", key: "port", port: "pooler" },
  { section: "studio", key: "port", port: "studio" },
  { section: "inbucket", key: "port", port: "inbucket" },
  { section: "analytics", key: "port", port: "analytics" },
  { section: "analytics", key: "vector_port", port: "vector" },
];

/** Keys carrying the app origin, which moves with the Vite port. */
const APP_URL_KEYS = [
  { section: "auth", key: "site_url" },
  { section: "auth", key: "additional_redirect_urls" },
];

const PROJECT_ID_KEY = { section: "", key: "project_id" };

/** Ports any stack may legitimately own — used by the leftover sweep below. */
const MANAGED_PORT_RANGE = { min: 54340, max: 54439 };

export function renderStackConfig(source, stack) {
  const seen = new Set();
  let section = "";

  const lines = source.split("\n").map((line) => {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      return line;
    }

    // Commented-out settings are documentation, not configuration.
    if (/^\s*#/.test(line)) return line;

    const assignment = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(
      line,
    );
    if (!assignment) return line;

    const [, indent, key, operator, value] = assignment;

    if (section === PROJECT_ID_KEY.section && key === PROJECT_ID_KEY.key) {
      seen.add("project_id");
      return `${indent}${key}${operator}"${stack.projectId}"`;
    }

    const portKey = PORT_KEYS.find(
      (k) => k.section === section && k.key === key,
    );
    if (portKey) {
      seen.add(`${section}.${key}`);
      return `${indent}${key}${operator}${stack.ports[portKey.port]}`;
    }

    const appKey = APP_URL_KEYS.find(
      (k) => k.section === section && k.key === key,
    );
    if (appKey) {
      seen.add(`${section}.${key}`);
      // Rewrite the port inside whatever URL shape the value happens to be
      // (a bare string, or a TOML array of them).
      return `${indent}${key}${operator}${value.replace(
        /(localhost|127\.0\.0\.1):5\d{3}/g,
        `$1:${stack.ports.app}`,
      )}`;
    }

    return line;
  });

  const expected = [
    "project_id",
    ...PORT_KEYS.map((k) => `${k.section}.${k.key}`),
    ...APP_URL_KEYS.map((k) => `${k.section}.${k.key}`),
  ];
  const missing = expected.filter((name) => !seen.has(name));

  if (missing.length > 0) {
    throw new Error(
      `supabase/config.e2e.toml no longer contains: ${missing.join(", ")}. ` +
        `Every stack-scoped setting must be rewritten or stacks silently share it — ` +
        `update PORT_KEYS / APP_URL_KEYS in scripts/stack-config.mjs.`,
    );
  }

  assertNoUnmanagedPorts(lines, stack);

  return lines.join("\n");
}

/**
 * Fails on any port left inside the managed range that this stack does not own.
 * Without it, a port added to config.e2e.toml later would keep its stack-0
 * value in every stack and collide across agents — the exact class of bug this
 * whole mechanism removes, reintroduced by an unrelated edit.
 */
function assertNoUnmanagedPorts(lines, stack) {
  const owned = new Set(Object.values(stack.ports));
  const strays = [];
  let section = "";

  for (const line of lines) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (/^\s*#/.test(line)) continue;

    for (const match of line.matchAll(/\b(\d{5})\b/g)) {
      const port = Number(match[1]);
      if (port < MANAGED_PORT_RANGE.min || port > MANAGED_PORT_RANGE.max)
        continue;
      if (owned.has(port)) continue;
      strays.push(`[${section || "root"}] ${line.trim()}`);
    }
  }

  if (strays.length > 0) {
    throw new Error(
      `unshifted port(s) left in the rendered config for stack ${stack.index}:\n` +
        strays.map((s) => `  ${s}`).join("\n") +
        `\nAdd them to PORT_KEYS in scripts/stack-config.mjs.`,
    );
  }
}

function main(argv) {
  const stackFlag = argv.indexOf("--stack");
  const stackId = stackFlag === -1 ? process.env.STACK_ID : argv[stackFlag + 1];
  const consumed = stackFlag === -1 ? [] : [stackFlag, stackFlag + 1];
  const positional = argv.filter((arg, i) => !consumed.includes(i));

  const stack = resolveStack(stackId);
  const rendered = renderStackConfig(
    fs.readFileSync(SOURCE_CONFIG, "utf8"),
    stack,
  );

  if (positional.length === 0) {
    process.stdout.write(rendered);
    return;
  }

  fs.writeFileSync(positional[0], rendered);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`stack-config: ${error.message}`);
    process.exit(1);
  }
}
