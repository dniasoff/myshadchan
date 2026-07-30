#!/usr/bin/env bash
# ===========================================================================
# Shared retry helper for the two post-`db push` Supabase Management API
# auth-config PATCH steps in .github/workflows/deploy.yml (Story 6.6):
# "Enable the invite-signup Auth Hook" and "Push auth mailer config". Both
# PATCH the same scoped endpoint from the same post-migration window, so the
# retry logic exists here once rather than as two inline copies of the same
# curl invocation.
#
#   scripts/ci/patch-supabase-auth-config.sh <payload-file> <error-message>
#
# Reads SUPABASE_PROJECT_ID and SUPABASE_ACCESS_TOKEN from the environment —
# both already exported by deploy.yml. SUPABASE_API_BASE defaults to
# https://api.supabase.com and is overridable so a test can point this
# script at a local stub responder without touching the real project.
#
# Behaviour:
#   - PATCHes {SUPABASE_API_BASE}/v1/projects/$SUPABASE_PROJECT_ID/config/auth
#     with the JSON payload at <payload-file>.
#   - The response BODY is captured to a temp file and NEVER printed on
#     success — a successful PATCH to /config/auth returns the whole auth
#     config (242 keys, including an unmasked smtp_pass and
#     external_google_secret) and GitHub does not know to mask values it was
#     never told about. This is the scripted equivalent of the callers'
#     former `-o /dev/null` / `-o /tmp/...` handling.
#   - 2xx -> success, exit 0.
#   - 5xx, 429, or a curl transport failure (curl's own non-zero exit — DNS,
#     TLS, timeout, connection refused) -> transient. Retried up to 3
#     attempts total, with a 5s then 15s backoff.
#   - Any other 4xx -> terminal. Fails immediately, no retry: on this
#     endpoint a 4xx is a real alarm (e.g. "custom SMTP was removed from the
#     project" for the mailer step's payload), and retrying it would delay
#     that alarm behind two backoffs and print it three times. Exits
#     non-zero, echoing <error-message> UNCHANGED and the first 2000 bytes
#     of the response body — the same message and body a caller printed
#     inline before this script existed.
#   - If every attempt was transient, exits non-zero after the last one with
#     <error-message> plus the attempt count, and the first 2000 bytes of
#     the last response body.
# ===========================================================================
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <payload-file> <error-message>" >&2
    exit 2
fi

payload_file=$1
error_message=$2

: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"

if [ ! -f "$payload_file" ]; then
    echo "::error::${error_message} — payload file not found: ${payload_file}" >&2
    exit 2
fi

api_base="${SUPABASE_API_BASE:-https://api.supabase.com}"
url="${api_base}/v1/projects/${SUPABASE_PROJECT_ID}/config/auth"

max_attempts=3
backoffs=(5 15)

body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
    http_code=$(curl -sS -o "$body_file" -w '%{http_code}' -X PATCH "$url" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary "@${payload_file}") && curl_exit=0 || curl_exit=$?

    if [ "$curl_exit" -eq 0 ] && [ "${http_code:0:1}" = "2" ]; then
        exit 0
    fi

    # A 4xx other than 429 is terminal, not transient — see the header
    # comment. 429 falls through to the retry branch below with the 5xx set.
    if [ "$curl_exit" -eq 0 ] && [ "${http_code:0:1}" = "4" ] && [ "$http_code" != "429" ]; then
        echo "::error::${error_message}"
        head -c 2000 "$body_file" >&2
        exit 1
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
        sleep "${backoffs[$((attempt - 1))]}"
    fi
    attempt=$((attempt + 1))
done

echo "::error::${error_message} (after ${max_attempts} attempts)"
head -c 2000 "$body_file" >&2
exit 1
