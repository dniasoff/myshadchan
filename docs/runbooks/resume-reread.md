# Resume re-read ledger

Migration `20261113150000_ai_reread_attempts.sql` adds the empty,
service-role-only `ai_reread_attempts` idempotency/quota ledger and its claim,
atomic-apply and release RPCs. It does not rewrite existing resume content,
parse attempts or usage rows; the worker changes only a resume's additional
sections and schema marker through the atomic apply RPC's compare-and-set.

## Provider retries and model tuning

The extractor gives each Gemini request a 24-second per-attempt timeout and a
75-second overall provider budget. It retries only HTTP 429/500/502/503/504
and per-attempt timeouts, with bounded jittered backoff. A later success is
still one ledger unit. Exhaustion returns the static busy outcome; if any
attempt timed out, the existing timeout outcome wins even if a later attempt
returns a permanent 4xx or another transient error; that later status remains
in the privacy-safe diagnostics. The fallback model is used only after
transient exhaustion, never after a permanent primary response. The primary
has at most 3 provider requests total, including its one legacy JSON-recovery
request; the fallback has at most 1 provider request and no recovery, so one
read can make at most 4 provider requests. When enough budget remains to start
the fallback, that one request is the only fallback request. A successful HTTP
response that contains invalid JSON is not retried; the existing one-shot
primary recovery remains separate from transient retrying.

The default model remains `gemini-flash-latest`. Optional Worker vars can be
set under `[vars]` in `workers/parse/wrangler.toml`, then deployed with the
normal Worker release process:

```toml
GEMINI_MODEL = "gemini-flash-latest"
GEMINI_FALLBACK_MODEL = "gemini-2.5-flash"
GEMINI_THINKING_BUDGET = "0"
```

Model ids must match `gemini-[a-z0-9.-]{1,60}`; invalid values are ignored and
logged with a static configuration marker. `GEMINI_FALLBACK_MODEL` is unset by
default and is tried once only after the primary exhausts transient attempts.
`GEMINI_THINKING_BUDGET` accepts `-1` or an integer from `0` through `24576`.
Unset or `-1` sends no thinking configuration. A set budget is sent only for
model ids containing `flash`; other model ids ignore it. Keep these vars out of
secrets and redeploy the parse Worker after changing them.

Rollback is a forward, approved database operation: drop the three new RPCs,
the partial index and `ai_reread_attempts`. No existing data is changed by the
migration, so rollback has no data backfill. Do not manually edit an applied
migration or run this rollback against production without the deploy owner.
