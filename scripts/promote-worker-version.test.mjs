import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(scriptsDirectory, "promote-worker-version.sh");
const validVersion = "123e4567-e89b-12d3-a456-426614174000";

function makeWranglerStub(directory) {
  const stubPath = path.join(directory, "wrangler-stub.sh");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
set -euo pipefail

read_count() {
  if [[ -f "$1" ]]; then
    cat "$1"
  else
    printf '0'
  fi
}

increment_count() {
  local file=$1
  local count
  count=$(read_count "$file")
  count=$((count + 1))
  printf '%s' "$count" > "$file"
  printf '%s' "$count"
}

if [[ "$1" != "versions" ]]; then
  exit 91
fi

if [[ "$2" == "list" ]]; then
  list_count=$(increment_count "$LIST_COUNT_FILE")
  if [[ "\${STUB_LIST_MISSING_ONCE:-0}" == "1" && "$list_count" == "1" ]]; then
    printf '%s\n' '{"items":[]}'
  else
    printf '{"items":[{"id":"%s"}]}\n' "$EXPECTED_VERSION"
  fi
  exit 0
fi

if [[ "$2" == "deploy" ]]; then
  deploy_count=$(increment_count "$DEPLOY_COUNT_FILE")
  printf '%s\n' "$3" >> "$DEPLOY_ARGS_FILE"
  case "\${STUB_MODE:-success}" in
    100146)
      if ((deploy_count <= STUB_FAILURES)); then
        printf '%s\n' 'temporary provider detail with super-secret-token [code: 100146]' >&2
        exit 1
      fi
      ;;
    other-error)
      printf '%s\n' 'permanent provider detail with super-secret-token [code: 10000]' >&2
      exit 7
      ;;
  esac
  printf '%s\n' 'promoted'
  exit 0
fi

exit 92
`,
  );
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function runPromotion({
  mode,
  failures = 0,
  listMissingOnce = false,
  version = validVersion,
}) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "promote-worker-version-"),
  );
  const countFile = path.join(directory, "deploy-count");
  const listCountFile = path.join(directory, "list-count");
  const deployArgsFile = path.join(directory, "deploy-args");
  const stub = makeWranglerStub(directory);
  const result = spawnSync(
    "bash",
    [helperPath, version, "myshadchan-ai", "CI deploy test"],
    {
      cwd: scriptsDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_BIN: stub,
        EXPECTED_VERSION: version,
        DEPLOY_COUNT_FILE: countFile,
        LIST_COUNT_FILE: listCountFile,
        DEPLOY_ARGS_FILE: deployArgsFile,
        STUB_MODE: mode,
        STUB_FAILURES: String(failures),
        STUB_LIST_MISSING_ONCE: listMissingOnce ? "1" : "0",
        PROMOTE_RETRY_BACKOFFS: "0,0,0,0,0",
      },
    },
  );
  const deployCount = existsSync(countFile)
    ? Number(readFileSync(countFile, "utf8"))
    : 0;
  const listCount = existsSync(listCountFile)
    ? Number(readFileSync(listCountFile, "utf8"))
    : 0;
  const deployArgs = existsSync(deployArgsFile)
    ? readFileSync(deployArgsFile, "utf8").trim().split("\n").filter(Boolean)
    : [];
  rmSync(directory, { recursive: true, force: true });
  return { result, deployCount, listCount, deployArgs, version };
}

function runWithVersion(version) {
  return spawnSync(
    "bash",
    [helperPath, version, "myshadchan-ai", "CI deploy test"],
    {
      cwd: scriptsDirectory,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_BIN: "/bin/true" },
    },
  );
}

describe("promote-worker-version.sh", () => {
  it.each([
    ["latest", "latest selector"],
    ["", "empty input"],
    [`${validVersion}@100`, "traffic suffix"],
    [` ${validVersion}`, "leading whitespace"],
    ["not-a-uuid", "non-UUID text"],
  ])("rejects %s (%s) before invoking Wrangler", (version) => {
    const result = runWithVersion(version);

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "VERSION_ID must be a concrete UUID",
    );
  });

  it("accepts a valid UUID and promotes it", () => {
    const { result, deployArgs, version } = runPromotion({ mode: "success" });

    expect(result.status).toBe(0);
    expect(deployArgs).toEqual([`${version}@100`]);
  });

  it("retries the exact uploaded version after 100146 and then succeeds", () => {
    const { result, deployCount, deployArgs, version } = runPromotion({
      mode: "100146",
      failures: 2,
    });

    expect(result.status).toBe(0);
    expect(deployCount).toBe(3);
    expect(deployArgs).toEqual([
      `${version}@100`,
      `${version}@100`,
      `${version}@100`,
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain("latest");
  });

  it("fails after the bounded retry budget when 100146 persists", () => {
    const { result, deployCount, deployArgs, version } = runPromotion({
      mode: "100146",
      failures: 5,
    });

    expect(result.status).toBe(1);
    expect(deployCount).toBe(5);
    expect(deployArgs).toEqual(Array(5).fill(`${version}@100`));
    expect(`${result.stdout}${result.stderr}`).toContain("final exit status 1");
  });

  it("fails immediately for a different provider error without logging secrets", () => {
    const { result, deployCount, listCount } = runPromotion({
      mode: "other-error",
    });

    expect(result.status).toBe(7);
    expect(deployCount).toBe(1);
    expect(listCount).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "super-secret-token",
    );
  });

  it("polls for the exact version before the retry after 100146", () => {
    const { result, deployCount, listCount, deployArgs, version } =
      runPromotion({
        mode: "100146",
        failures: 1,
        listMissingOnce: true,
      });

    expect(result.status).toBe(0);
    expect(deployCount).toBe(2);
    expect(listCount).toBe(2);
    expect(deployArgs).toEqual([`${version}@100`, `${version}@100`]);
  });
});
