# Resume re-read ledger

Migration `20261113150000_ai_reread_attempts.sql` adds the empty,
service-role-only `ai_reread_attempts` idempotency/quota ledger and its claim,
atomic-apply and release RPCs. It does not rewrite existing resume content,
parse attempts or usage rows; the worker changes only a resume's additional
sections and schema marker through the atomic apply RPC's compare-and-set.

## Provider retries and model tuning

The extractor gives each primary Gemini request a 30-second per-attempt timeout
and an 80-second overall provider budget. It retries only HTTP
429/500/502/503/504 and per-attempt timeouts, with bounded jittered backoff. A
later success is still one ledger unit. Exhaustion returns the static busy
outcome; if any attempt timed out, the existing timeout outcome wins even if a
later attempt returns a permanent 4xx or another transient error; that later
status remains in the privacy-safe diagnostics. When a fallback is configured,
the primary deadline reserves 25 seconds for it and therefore allows at most
two 30-second attempts before the fallback. The fallback gets one attempt of up
to 45 seconds, capped at the remaining overall budget minus a one-second
margin. The fallback has no retries or JSON recovery. The primary has at most
3 provider requests total, including its one legacy JSON-recovery request; the
fallback has at most 1 provider request, so one read can make at most 4 provider
requests. A successful HTTP response that contains invalid JSON is not retried;
the existing one-shot primary recovery remains separate from transient
retrying.

HTTP 400 is not retried or passed to the fallback and is logged only with the
static `bad_request` reason. If any attempt timed out, that timeout outcome
still takes precedence over a later permanent or network failure.

The code default remains `gemini-flash-latest` when the vars are absent. The
live parse Worker sets these vars under `[vars]` in
`workers/parse/wrangler.toml`:

```toml
GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_THINKING_LEVEL = "low"
GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite"
```

This avoids relying on the unstable `gemini-flash-latest` alias in production.
The primary `gemini-3.6-flash` is explicitly limited to `low` thinking to avoid
spending the whole request budget reasoning before returning the structured
extraction. The fallback `gemini-3.5-flash-lite` has no explicit thinking
override and uses its model default.
Review Google's [model deprecations table](https://aistudio.google.com/docs/deprecations)
quarterly; a model that is not served for this key or route returns 404 and
activates the one-shot fallback when configured. `GEMINI_THINKING_BUDGET` remains
unset because Gemini 3.x uses `thinkingLevel` instead.

The deploy workflow runs `wrangler versions upload` from `workers/parse/` with
the committed `wrangler.toml`; its `--secrets-file` supplies secrets only and
does not replace `[vars]`. The following `wrangler versions deploy` promotes
that uploaded version, with no `--var` override, so both model vars reach the
serving Worker. The bootstrap path derives a config only for a missing Worker
and strips the required-secrets table; it preserves `[vars]` and is not the
steady-state path.

Model ids must match `gemini-[a-z0-9.-]{1,60}`; invalid values are ignored and
logged with a static configuration marker. `GEMINI_FALLBACK_MODEL` is unset by
default and is tried once only after transient exhaustion or a primary 404.
`GEMINI_THINKING_LEVEL` applies to the primary model and
`GEMINI_FALLBACK_THINKING_LEVEL`, when set, applies to the fallback. Each
accepts only `minimal`, `low`, `medium`, or `high`, and is sent as
`generationConfig.thinkingConfig.thinkingLevel` only for Gemini 3.x model ids.
The older `GEMINI_THINKING_BUDGET` path remains for Gemini 2.5 Flash models.
Keep these vars out of secrets and redeploy the parse Worker after changing
them.

After a successful extraction, the Worker emits one `parse.extract.shape` line
containing counts only: raw versus kept fixed fields, references, learning
history, additional sections, privacy-filter drops, the allow-listed model and
finish reason, and prompt/candidate/thought token counts. It never logs resume
text, reference values, provider bodies, keys or paths. A `MAX_TOKENS` finish
reason with nonzero thought tokens indicates that Gemini consumed the output
budget while thinking; compare the raw and kept counts before changing the
prompt or normalizer.

To roll back model selection and thinking controls, remove `GEMINI_MODEL`,
`GEMINI_THINKING_LEVEL`, and `GEMINI_FALLBACK_MODEL` from `[vars]` and redeploy;
extraction then returns to the code default and has no fallback.
Do not set `GEMINI_THINKING_BUDGET` unless a model-specific decision approves
its semantics.

Rollback of the ledger is a forward, approved database operation: drop the three new RPCs,
the partial index and `ai_reread_attempts`. No existing data is changed by the
migration, so rollback has no data backfill. Do not manually edit an applied
migration or run this rollback against production without the deploy owner.
