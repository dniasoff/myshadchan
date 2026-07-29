/**
 * `make stacks` — which test stacks are up, who holds them, and which
 * STACK_IDs are free.
 *
 * A STACK_ID is an exclusive lease on a port block and a database.
 * `scripts/stack-lease.mjs` now refuses to start a stack somebody else holds,
 * and this is where you read the holder it will name — before picking an id,
 * and when a refusal tells you one is taken.
 */

import { MAX_STACK_INDEX, resolveStack } from "./stack-env.mjs";
import { isPortOpen, runningContainers } from "./stack-probe.mjs";
import { readLease } from "./stack-lease.mjs";

/** Owner strings can be arbitrarily long; keep the table readable. */
function shortOwner(owner) {
  return owner.length > 22 ? `${owner.slice(0, 21)}…` : owner;
}

async function main() {
  const containers = runningContainers();

  const rows = await Promise.all(
    Array.from({ length: MAX_STACK_INDEX + 1 }, async (_, index) => {
      const stack = resolveStack(index);
      const db = containers.includes(`supabase_db_${stack.projectId}`);
      const app = await isPortOpen(stack.ports.app);
      return { stack, db, app, lease: readLease(stack) };
    }),
  );

  console.log(
    [
      "STACK_ID",
      "SUPABASE",
      "APP",
      "API",
      "DB",
      "STUDIO",
      "MAILPIT",
      "HOLDER",
      "WORKDIR",
    ]
      .map((h, i) => h.padEnd([9, 10, 6, 7, 7, 8, 9, 24, 0][i]))
      .join(""),
  );

  for (const { stack, db, app, lease } of rows) {
    // Stack 0 is what an unset STACK_ID resolves to.
    const id = stack.index === 0 ? "0 *" : String(stack.index);
    // A lease with nothing running is stale — the next acquire overwrites it,
    // so say so rather than showing a holder who has already gone.
    const holder = !lease ? "-" : db || app ? shortOwner(lease.owner) : "stale";
    console.log(
      [
        id.padEnd(9),
        (db ? "running" : "-").padEnd(10),
        (app ? "up" : "-").padEnd(6),
        String(stack.ports.api).padEnd(7),
        String(stack.ports.db).padEnd(7),
        String(stack.ports.studio).padEnd(8),
        String(stack.ports.inbucket).padEnd(9),
        holder.padEnd(24),
        db || app ? stack.workdir : "",
      ].join(""),
    );
  }

  const free = rows.filter((r) => !r.db && !r.app).map((r) => r.stack.index);
  console.log(
    free.length > 0
      ? `\nfree: ${free.join(", ")}   (make start-supabase-e2e STACK_ID=<n>)`
      : "\nfree: none — every stack is in use (make stop-stacks)",
  );
  console.log("* stack 0 is what an unset STACK_ID resolves to.");
  console.log(
    "HOLDER comes from the lease file; set STACK_OWNER to name yourself in it.",
  );
}

main();
