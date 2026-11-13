#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
}

function workerEntryMatches(entry, workerName) {
  if (typeof entry === "string") {
    return entry === workerName;
  }
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return [entry.id, entry.name, entry.script, entry.worker_name].includes(
    workerName,
  );
}

/**
 * Check the account's Worker list without exposing the API response body.
 * Cloudflare returns both string and object forms for this endpoint across
 * API versions, so accept the documented identifiers without guessing on
 * any other response shape.
 */
export async function workerExists({
  accountId,
  apiToken,
  workerName,
  fetchImpl = globalThis.fetch,
  apiBase = CLOUDFLARE_API_BASE,
}) {
  assertNonEmpty(accountId, "Cloudflare account id");
  assertNonEmpty(apiToken, "Cloudflare API token");
  assertNonEmpty(workerName, "Worker name");
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable");
  }

  const response = await fetchImpl(
    `${apiBase}/accounts/${encodeURIComponent(accountId)}/workers/scripts`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
    },
  );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Cloudflare Worker list returned invalid JSON (HTTP ${response.status})`,
    );
  }

  if (!response.ok || body?.success !== true) {
    const category =
      response.status === 401 || response.status === 403
        ? "authentication/authorization"
        : "API";
    throw new Error(
      `Cloudflare Worker list ${category} failed (HTTP ${response.status})`,
    );
  }
  if (!Array.isArray(body.result)) {
    throw new Error("Cloudflare Worker list returned an invalid result");
  }

  return body.result.some((entry) => workerEntryMatches(entry, workerName));
}

/**
 * Make a one-time bootstrap config from the committed config. The only
 * removed table is [secrets], so committed vars (including the email
 * fail-closed defaults) and bindings remain authoritative. This lets
 * `wrangler deploy` create the script resource without bundling secrets;
 * the next atomic `versions upload --secrets-file` supplies them.
 */
export function withoutRequiredSecretsTable(configText) {
  const lines = configText.split("\n");
  const output = [];
  let skippingSecretsTable = false;

  for (const line of lines) {
    if (!skippingSecretsTable && /^\s*\[secrets\]\s*$/.test(line)) {
      skippingSecretsTable = true;
      continue;
    }
    if (skippingSecretsTable && /^\s*\[[^\]]+\]\s*$/.test(line)) {
      skippingSecretsTable = false;
    }
    if (!skippingSecretsTable) {
      output.push(line);
    }
  }

  return output.join("\n");
}

export async function writeBootstrapConfig(sourcePath, targetPath) {
  const configText = await readFile(sourcePath, "utf8");
  await writeFile(targetPath, withoutRequiredSecretsTable(configText), "utf8");
}

async function main() {
  if (process.argv[2] === "--bootstrap-config") {
    const [sourcePath, targetPath] = process.argv.slice(3);
    assertNonEmpty(sourcePath, "Bootstrap source config");
    assertNonEmpty(targetPath, "Bootstrap target config");
    await writeBootstrapConfig(sourcePath, targetPath);
    return;
  }

  const workerName = process.argv[2];
  assertNonEmpty(workerName, "Worker name argument");
  const exists = await workerExists({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    workerName,
  });
  process.stdout.write(`${exists}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`::error::${message}`);
    process.exitCode = 1;
  });
}
