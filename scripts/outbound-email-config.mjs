#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mirror workers/email/index.ts's account allowlist parser at the deploy
 * boundary. The deploy is stricter about workflow-command control characters:
 * they are not valid secret data even though the Worker trims each item.
 */
export function validOutboundEmailAccountIds(value) {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (/[\r\n%]/u.test(value)) return false;

  const ids = new Set();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!/^[1-9]\d*$/u.test(trimmed)) return false;
    const id = Number(trimmed);
    if (!Number.isSafeInteger(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

export function normalizeOutboundEmailEnabled(value) {
  return value === "true" ? "true" : "false";
}

/** Escape GitHub Actions command data before embedding it in a workflow command. */
export function escapeWorkflowCommandData(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function main() {
  const accountIds = process.env.OUTBOUND_EMAIL_ACCOUNT_IDS ?? "";
  if (!validOutboundEmailAccountIds(accountIds)) {
    throw new Error(
      "OUTBOUND_EMAIL_ACCOUNT_IDS must be a comma-separated list of unique positive account ids",
    );
  }

  // The shell consumes these lines without printing them. The third line is
  // safe to use as GitHub Actions command data; the second remains unchanged
  // for the Wrangler --var override so Worker-side trimming is preserved.
  process.stdout.write(
    [
      normalizeOutboundEmailEnabled(process.env.OUTBOUND_EMAIL_ENABLED),
      accountIds,
      escapeWorkflowCommandData(accountIds),
    ].join("\n") + "\n",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid email configuration";
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
