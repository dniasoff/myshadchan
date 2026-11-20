#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 VERSION_ID WORKER_NAME MESSAGE" >&2
  exit 2
fi

version_id=$1
worker_name=$2
message=$3

if [[ -z "$version_id" || -z "$worker_name" || -z "$message" ]]; then
  echo "VERSION_ID, WORKER_NAME, and MESSAGE must be non-empty" >&2
  exit 2
fi

# The upload step supplies an opaque UUID. Refuse a caller-provided traffic
# suffix so this helper cannot silently turn the exact upload into "latest" or
# another version selector.
if [[ "$version_id" == *"@"* ]]; then
  echo "VERSION_ID must be the exact uploaded version id without a traffic suffix" >&2
  exit 2
fi

# Five attempts, with a maximum of 65 seconds of backoff (5+10+20+30). The
# first deploy is immediate; the visibility check is only entered after that
# exact deploy reports Cloudflare's confirmed eventual-consistency error.
retry_backoffs=${PROMOTE_RETRY_BACKOFFS:-0,5,10,20,30}
IFS=',' read -r -a backoffs <<< "$retry_backoffs"
if [[ "${#backoffs[@]}" -ne 5 ]]; then
  echo "PROMOTE_RETRY_BACKOFFS must contain exactly five non-negative seconds" >&2
  exit 2
fi
for delay in "${backoffs[@]}"; do
  if [[ ! "$delay" =~ ^[0-9]+$ ]]; then
    echo "PROMOTE_RETRY_BACKOFFS must contain exactly five non-negative seconds" >&2
    exit 2
  fi
done

run_wrangler() {
  if [[ -n "${WRANGLER_BIN:-}" ]]; then
    "$WRANGLER_BIN" "$@"
  else
    npx wrangler "$@"
  fi
}

version_is_visible() {
  local list_json
  local list_status=0
  list_json="$(run_wrangler versions list --json --name "$worker_name" 2>/dev/null)" || list_status=$?
  if ((list_status != 0)); then
    final_status=$list_status
    # Status 1 is reserved by the JSON probe for a valid list that does not
    # contain this id, so use a distinct status for a failed list command.
    if ((final_status == 1)); then
      final_status=3
    fi
    echo "::error::could not check visibility for worker $worker_name and uploaded version $version_id (wrangler versions list exit $list_status; final exit status $final_status)" >&2
    return "$final_status"
  fi

  VERSION_ID="$version_id" LIST_JSON="$list_json" node -e '
    let payload;
    try {
      payload = JSON.parse(process.env.LIST_JSON);
    } catch {
      process.exit(2);
    }
    const versions = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.items)
        ? payload.items
        : payload && Array.isArray(payload.versions)
          ? payload.versions
          : null;
    if (!versions) process.exit(2);
    process.exit(
      versions.some((version) => version && version.id === process.env.VERSION_ID)
        ? 0
        : 1,
    );
  '
  local parse_status=$?
  if ((parse_status == 2)); then
    echo "::error::wrangler versions list returned invalid JSON for worker $worker_name and uploaded version $version_id (final exit status 2)" >&2
    return 2
  fi
  return "$parse_status"
}

max_attempts=5
for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  if ((attempt > 1)); then
    delay=${backoffs[$((attempt - 1))]}
    if ((delay > 0)); then
      sleep_status=0
      sleep "$delay" || sleep_status=$?
      if ((sleep_status != 0)); then
        echo "::error::retry wait failed for worker $worker_name and uploaded version $version_id (exit $sleep_status; final exit status $sleep_status)" >&2
        exit "$sleep_status"
      fi
    fi

    visibility_status=0
    if version_is_visible; then
      :
    else
      visibility_status=$?
      if ((visibility_status == 1)); then
        if ((attempt == max_attempts)); then
          echo "::error::uploaded version $version_id never became visible for worker $worker_name within the bounded retry budget (final exit status 1)" >&2
          exit 1
        fi
        echo "::warning::uploaded version $version_id is not visible yet for worker $worker_name; waiting before exact promotion retry ($attempt/$max_attempts)" >&2
        continue
      fi
      # version_is_visible already reports the worker, exact id, and final
      # status for list/JSON failures. Do not turn those into a retry.
      exit "$visibility_status"
    fi
  fi

  deploy_output=""
  deploy_status=0
  deploy_output="$(run_wrangler versions deploy "${version_id}@100" --yes --message "$message" 2>&1)" || deploy_status=$?
  if ((deploy_status == 0)); then
    echo "Promoted uploaded version $version_id for worker $worker_name to 100% traffic."
    exit 0
  fi

  if [[ "$deploy_output" != *"[code: 100146]"* ]]; then
    echo "::error::promotion failed for worker $worker_name and uploaded version $version_id (exit $deploy_status; non-retryable Cloudflare error; final exit status $deploy_status)" >&2
    exit "$deploy_status"
  fi

  if ((attempt == max_attempts)); then
    echo "::error::promotion failed for worker $worker_name and uploaded version $version_id after $max_attempts exact attempts: Cloudflare [code: 100146] persisted (final exit status 1)" >&2
    exit 1
  fi

  echo "::warning::uploaded version $version_id is not available to promotion yet for worker $worker_name (Cloudflare [code: 100146]); retrying the exact version" >&2
done

echo "::error::promotion loop ended unexpectedly for worker $worker_name and uploaded version $version_id (final exit status 1)" >&2
exit 1
