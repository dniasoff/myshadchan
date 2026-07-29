/**
 * `make stacks` — which test stacks are up, and which STACK_IDs are free.
 *
 * A STACK_ID is an exclusive lease on a port block and a database. Nothing
 * enforces that lease at runtime, so an agent about to run tests needs a way
 * to see which ids are already taken before it picks one; picking a busy id is
 * the same collision this whole mechanism removes, just re-created by hand.
 */

import { execFileSync } from "node:child_process";
import net from "node:net";

import { MAX_STACK_INDEX, resolveStack } from "./stack-env.mjs";

function runningContainers() {
  try {
    return execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    // No docker, or the daemon is down: report ports only rather than failing.
    return [];
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

async function main() {
  const containers = runningContainers();

  const rows = await Promise.all(
    Array.from({ length: MAX_STACK_INDEX + 1 }, async (_, index) => {
      const stack = resolveStack(index);
      const db = containers.includes(`supabase_db_${stack.projectId}`);
      const app = await isPortOpen(stack.ports.app);
      return { stack, db, app };
    }),
  );

  console.log(
    ["STACK_ID", "SUPABASE", "APP", "API", "DB", "STUDIO", "MAILPIT", "WORKDIR"]
      .map((h, i) => h.padEnd([9, 10, 6, 7, 7, 8, 9, 0][i]))
      .join(""),
  );

  for (const { stack, db, app } of rows) {
    // Stack 0 is what an unset STACK_ID resolves to.
    const id = stack.index === 0 ? "0 *" : String(stack.index);
    console.log(
      [
        id.padEnd(9),
        (db ? "running" : "-").padEnd(10),
        (app ? "up" : "-").padEnd(6),
        String(stack.ports.api).padEnd(7),
        String(stack.ports.db).padEnd(7),
        String(stack.ports.studio).padEnd(8),
        String(stack.ports.inbucket).padEnd(9),
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
}

main();
