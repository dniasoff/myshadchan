#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const WORKER_LIST_PAGE_SIZE = 100;

// Only a Worker with a committed, safe default-off gate may be created by
// this recovery path. A missing Worker outside this list is an incident.
export const SAFE_BOOTSTRAP_WORKERS = Object.freeze(["email"]);

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

function tableHeader(line) {
  const trimmed = line.trim();
  return (
    (trimmed.startsWith("[[") && trimmed.endsWith("]]")) ||
    (trimmed.startsWith("[") &&
      !trimmed.startsWith("[[") &&
      trimmed.endsWith("]"))
  );
}

function workerSlug(workerName) {
  return workerName.startsWith("myshadchan-")
    ? workerName.slice("myshadchan-".length)
    : workerName;
}

export function assertBootstrapAllowed(workerName) {
  assertNonEmpty(workerName, "Worker name");
  if (!SAFE_BOOTSTRAP_WORKERS.includes(workerSlug(workerName))) {
    throw new Error(
      `Refusing to bootstrap ${workerName}: no safe default-off bootstrap is configured; only ${SAFE_BOOTSTRAP_WORKERS.map((worker) => `myshadchan-${worker}`).join(", ")} is allowed`,
    );
  }
}

function apiFailure(status, operation) {
  const category =
    status === 401 || status === 403 ? "authentication/authorization" : "API";
  return new Error(
    `Cloudflare Worker ${operation} ${category} failed (HTTP ${status})`,
  );
}

async function lookupWorkerScript({
  accountPath,
  apiBase,
  apiToken,
  workerName,
  fetchImpl,
}) {
  const url = new URL(
    `${apiBase}/accounts/${accountPath}/workers/scripts/${encodeURIComponent(workerName)}`,
  );
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
  });
  if (response.status === 200) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }
  throw apiFailure(response.status, "lookup");
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

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiToken}`,
  };
  const accountPath = encodeURIComponent(accountId);
  let page = 1;
  let sawPagination = false;

  while (true) {
    const url = new URL(`${apiBase}/accounts/${accountPath}/workers/scripts`);
    if (page > 1) {
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(WORKER_LIST_PAGE_SIZE));
    }
    const response = await fetchImpl(url, { headers });

    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        `Cloudflare Worker list returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok || body?.success !== true) {
      throw apiFailure(response.status, "list");
    }
    if (!Array.isArray(body.result)) {
      throw new Error("Cloudflare Worker list returned an invalid result");
    }

    const resultInfo = body.result_info;
    if (body.result.some((entry) => workerEntryMatches(entry, workerName))) {
      return true;
    }
    if (!resultInfo) {
      if (sawPagination) {
        throw new Error(
          "Cloudflare Worker list returned partial pagination data",
        );
      }
      // The list endpoint's result_info is optional. Resolve a list miss with
      // the single-script endpoint so an unpaginated/partial list cannot
      // cause a false missing result.
      return lookupWorkerScript({
        accountPath,
        apiBase,
        apiToken,
        workerName,
        fetchImpl,
      });
    }
    if (
      !Number.isInteger(resultInfo.page) ||
      !Number.isInteger(resultInfo.total_pages) ||
      resultInfo.page !== page ||
      resultInfo.total_pages < 1 ||
      resultInfo.page > resultInfo.total_pages
    ) {
      throw new Error(
        "Cloudflare Worker list returned partial pagination data",
      );
    }
    if (page === resultInfo.total_pages) {
      return false;
    }
    sawPagination = true;
    page += 1;
  }
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
    if (skippingSecretsTable && tableHeader(line)) {
      skippingSecretsTable = false;
    }
    if (!skippingSecretsTable) {
      output.push(line);
    }
  }

  return output.join("\n");
}

export async function writeBootstrapConfig(workerName, sourcePath, targetPath) {
  assertBootstrapAllowed(workerName);
  const configText = await readFile(sourcePath, "utf8");
  await writeFile(targetPath, withoutRequiredSecretsTable(configText), "utf8");
}

async function main() {
  if (process.argv[2] === "--bootstrap-config") {
    const [workerName, sourcePath, targetPath] = process.argv.slice(3);
    assertNonEmpty(sourcePath, "Bootstrap source config");
    assertNonEmpty(targetPath, "Bootstrap target config");
    await writeBootstrapConfig(workerName, sourcePath, targetPath);
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
