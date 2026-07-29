/**
 * The STACK_ID lease — turns "please check `make stacks` first" into a check.
 *
 * `make start-supabase-e2e STACK_ID=2` unconditionally ran
 * `supabase stop --no-backup`, wiped `<workdir>/supabase` and booted a fresh
 * database. Run against an id another agent was mid-suite on, that destroyed
 * their database and exited 0 — silent, and the dangerous kind of silent: the
 * victim sees flaky assertions, not an error.
 *
 * The lease is a small JSON file inside the stack's own (gitignored) workdir,
 * written on acquire and removed on release. It is *paired with liveness*: a
 * lease alone would go stale the moment a run was killed, and a liveness probe
 * alone cannot tell "my own stack, restarting for a fresh database" (the whole
 * point of `start-supabase-e2e`) from "somebody else's stack". Together:
 *
 *   stack not running        -> granted, any stale lease is overwritten
 *   running, lease is yours  -> granted (the normal re-run for a fresh DB)
 *   running, lease is theirs -> refused, naming the holder
 *   running, no lease at all -> refused, holder unknown
 *
 * Identity comes from `STACK_OWNER`, falling back to the Claude session id and
 * then to user@host. That fallback is honest but coarse: several agents inside
 * one Claude session share a session id, so a wave's manifest must assign
 * `STACK_OWNER` next to `STACK_ID`. `make stacks` prints the holder so the
 * assignment is verifiable rather than assumed.
 *
 * Escape hatch: `STACK_TAKEOVER=1`. Explicit, loud, and in the shell history.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveStack } from "./stack-env.mjs";
import { isStackUp } from "./stack-probe.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Absolute path of a stack's lease file. */
export function leaseFile(stack) {
  return path.join(REPO_ROOT, stack.leasePath);
}

/**
 * Who is asking. `STACK_OWNER` first so a wave can name its agents; the
 * user@host tail keeps single-writer use (a human, CI) working unchanged,
 * because every invocation there resolves to the same owner.
 */
export function currentOwner(env = process.env) {
  const explicit = (env.STACK_OWNER ?? "").trim();
  if (explicit) return explicit;
  const session = (env.CLAUDE_CODE_SESSION_ID ?? "").trim();
  if (session) return `claude:${session}`;
  return `${os.userInfo().username}@${os.hostname()}`;
}

export function readLease(stack) {
  try {
    const parsed = JSON.parse(fs.readFileSync(leaseFile(stack), "utf8"));
    return typeof parsed?.owner === "string" ? parsed : null;
  } catch {
    // Absent or unreadable/corrupt: treat as no lease. The liveness probe, not
    // this file, is what stops a running stack being taken.
    return null;
  }
}

export function writeLease(stack, owner) {
  const file = leaseFile(stack);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ owner, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function releaseLease(stack) {
  fs.rmSync(leaseFile(stack), { force: true });
}

/**
 * The whole decision, as a pure function of the three inputs — kept free of
 * fs/docker so it can be tested exhaustively (scripts/stack-lease.test.mjs)
 * without booting a stack.
 */
export function leaseDecision({ lease, isUp, owner, takeover = false }) {
  if (takeover) return { granted: true, reason: "takeover" };
  if (!isUp) {
    return { granted: true, reason: lease ? "stale-lease" : "free" };
  }
  if (!lease) return { granted: false, reason: "running-unleased" };
  if (lease.owner === owner) return { granted: true, reason: "already-yours" };
  return { granted: false, reason: "held", holder: lease.owner };
}

function refusal(stack, decision, lease, owner) {
  const id = stack.index;
  const head =
    decision.reason === "held"
      ? `STACK_ID=${id} is already held by ${decision.holder}` +
        (lease?.acquiredAt ? ` (since ${lease.acquiredAt})` : "") +
        `; you are ${owner}.`
      : `STACK_ID=${id} is running but carries no lease, so its holder is unknown.`;

  return [
    `stack-lease: ${head}`,
    "",
    `  Starting it would run 'supabase stop --no-backup' and rebuild ${stack.workdir}/supabase,`,
    "  destroying that database mid-run. Refusing instead of doing it silently.",
    "",
    "  Pick a free id:        make stacks",
    `  Or release this one:   make stop-supabase-e2e STACK_ID=${id}`,
    `  Or take it anyway:     STACK_TAKEOVER=1 make start-supabase-e2e STACK_ID=${id}`,
    "",
    "  Parallel agents: assign STACK_OWNER alongside STACK_ID in the wave manifest —",
    "  agents in one Claude session otherwise share an identity and cannot be told apart.",
  ].join("\n");
}

async function acquire(stack, env) {
  const owner = currentOwner(env);
  const lease = readLease(stack);
  const decision = leaseDecision({
    lease,
    isUp: await isStackUp(stack),
    owner,
    takeover: Boolean(env.STACK_TAKEOVER),
  });

  if (!decision.granted) {
    throw new Error(refusal(stack, decision, lease, owner));
  }

  writeLease(stack, owner);
  console.log(
    `stack-lease: STACK_ID=${stack.index} acquired by ${owner} (${decision.reason}).`,
  );
}

function show(stack) {
  const lease = readLease(stack);
  console.log(
    lease
      ? `STACK_ID=${stack.index} ${lease.owner} since ${lease.acquiredAt ?? "?"}`
      : `STACK_ID=${stack.index} free`,
  );
}

async function main(argv) {
  const command = argv[0] ?? "show";
  const stackFlag = argv.indexOf("--stack");
  const stack = resolveStack(
    stackFlag === -1 ? process.env.STACK_ID : argv[stackFlag + 1],
  );

  if (command === "acquire") return acquire(stack, process.env);
  if (command === "release") return releaseLease(stack);
  if (command === "show") return show(stack);

  throw new Error(
    `unknown command ${JSON.stringify(command)} (acquire|release|show)`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
