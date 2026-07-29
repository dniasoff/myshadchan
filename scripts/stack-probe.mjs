/**
 * "Is this stack actually up?" — the liveness half of the STACK_ID lease.
 *
 * Split out of stack-status.mjs so stack-lease.mjs can ask the same question
 * the same way. A lease that disagreed with `make stacks` about whether a stack
 * is running would be worse than no lease at all.
 */

import { execFileSync } from "node:child_process";
import net from "node:net";

/** Names of every running container, or [] when docker is absent/down. */
export function runningContainers() {
  try {
    return execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    // No docker, or the daemon is down: fall back to port probing rather than
    // failing — a wrong "not running" here would hand out a held stack.
    return [];
  }
}

export function isPortOpen(port) {
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

/**
 * True when anything of this stack is alive: its Supabase database container,
 * its API port, or its Vite app port. Deliberately generous — every one of
 * those means someone is mid-run, and destroying their database is the failure
 * this check exists to prevent.
 */
export async function isStackUp(stack, containers = runningContainers()) {
  if (containers.includes(`supabase_db_${stack.projectId}`)) return true;
  const [api, app] = await Promise.all([
    isPortOpen(stack.ports.api),
    isPortOpen(stack.ports.app),
  ]);
  return api || app;
}
