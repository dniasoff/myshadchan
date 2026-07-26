# Story 11.1: Server-side entitlement on inference

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want every AI-calling Worker route to re-check entitlement against the server's own
authority immediately before it spends any inference budget,
so that a modified client cannot spend AI budget it hasn't paid for.

## Position in Epic 11

**1st of 3.** 11.2 (resume auto-parse) and 11.3 (diligence dossier) each add the first real
inference routes to `workers/parse` and `workers/ai`; both are required to sit behind the
single gate this story builds, not a second one. No story in this epic may add a route to
either worker that spends inference without going through `requireAiEntitlement`.

**Reuses, does not replace:** `public.ai_entitlement()` (`supabase/schemas/02_functions.sql`,
~line 2087) already exists and is already the single server-authoritative answer to "may
this account spend inference?" — built for a prior pass of this product (comments there call
it "E4"). It is `SECURITY INVOKER` and `STABLE`, resolves the caller's account/context itself,
and returns the unentitled default rather than raising when the caller has none. The client
already calls it today (`useAiEntitlement` → `dataProvider.aiEntitlement()` →
`.rpc("ai_entitlement")`, `providers/supabase/dataProvider.ts:606-615`) to decide what to
render. **That call is a UI hint only — nothing today calls it from a Worker before spending
tokens**, because `workers/ai/index.ts` and `workers/parse/index.ts` currently contain only a
`/health` route (`createWorkerApp("ai")` / `createWorkerApp("parse")`, no other routes). That
gap is this story's entire scope. **Do not touch `ai_entitlement()`'s SQL, the `subscription`/
`ai_usage` tables, or `useAiEntitlement.ts`** — all four stay exactly as they are.

**Post-Epic-1/2 world:** by the time this story lands, `ai_entitlement()`'s body reads
`current_context_id()` in place of `current_account_id()` (Epic 2, AD-19 — `current_account_id()`
is deleted, not wrapped). This story never edits that function; it only calls it by name, so it
is unaffected by the rewrite either way. Epic 1's renames (`children`→`singles`, `sales`→
`members`) touch neither `ai_entitlement()`, `subscription`, nor `ai_usage` — none of the three
is a fork fossil or a misdescriptive name (AD-23).

## Acceptance Criteria

1. **A shared Hono middleware exists:** `requireAiEntitlement` in a new
   `workers/shared/aiEntitlementGate.ts`. For any request whose path is not `/health`:
   - Missing `Authorization` header → `401` with `fail("missing Authorization header")`; no
     Supabase call is made and no downstream handler runs.
   - Header present → a caller-scoped Supabase client is built (AC-2) and
     `.rpc("ai_entitlement")` is called under the caller's own identity (never service-role).
   - An RPC error (including the permission-denied Postgres returns to an `anon`-role caller,
     since `anon` holds no `EXECUTE` grant on `ai_entitlement()` — `06_grants.sql:600-602`) **or**
     `data.is_entitled !== true` → `402` with `fail("not entitled")`; downstream never runs.
   - `data.is_entitled === true` → the full entitlement payload and the caller-scoped client
     are attached to the request context (AC-2) and `next()` runs.
   - `/health` is reachable with **no** `Authorization` header on both workers (unchanged
     behavior).
2. **One caller-scoped client constructor, reused, never duplicated — and never rebuilt or
   re-fetched downstream.** `createCallerClient(authHeader: string, env: BaseEnv):
   SupabaseClient` in the same file: a Supabase client built with `env.SUPABASE_ANON_KEY`
   (never `SUPABASE_SERVICE_ROLE_KEY`) with `global.headers.Authorization` set to the
   forwarded header verbatim, `auth: { persistSession: false }`. Both workers' `Hono` apps
   declare a typed `Variables` map (`{ supabaseCaller: SupabaseClient; aiEntitlement:
   AiEntitlementInfo }`); on success `requireAiEntitlement` calls `c.set("supabaseCaller",
   client)` and `c.set("aiEntitlement", data)` with the **same** client and the **same** RPC
   response it just used to decide entitlement. A route handler added by 11.2 or 11.3 reads
   both via `c.get(...)` — it never constructs a second caller-scoped client and never issues
   a second `ai_entitlement()` call in the same request (wasteful and, per AD-16/AD-17, a
   margin concern in its own right).
3. **`SUPABASE_ANON_KEY` joins `BaseEnv`** (`workers/shared/env.ts`), alongside the existing
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. `workers/ai/wrangler.toml` and
   `workers/parse/wrangler.toml`'s secrets comments list it.
4. **Both workers wire the gate globally, before any business route.**
   `workers/ai/index.ts` and `workers/parse/index.ts` each call
   `app.use("*", requireAiEntitlement)` directly after `createWorkerApp(...)` and before any
   route this or a later story adds — so 11.2's and 11.3's routes inherit the gate with zero
   extra code in their own handlers.
5. **A single client-side call surface.** `callAiWorker<T>(url: string, body: unknown):
   Promise<T>` in `src/components/atomic-crm/providers/commons/aiWorkerClient.ts`: reads the
   current session via `getSupabaseClient().auth.getSession()`, `POST`s `body` as JSON with
   `Authorization: Bearer <access_token>` and `Content-Type: application/json`, parses the
   `{success,data?,error?}` envelope, returns `data` on success, and throws
   `new Error(error ?? "AI request failed")` on `success:false` or on a thrown/network
   failure. No other module in `src/` performs a `fetch()` against a Worker URL — 11.2 and
   11.3 both route through this one function.
6. **Local dev can reach both workers.** `VITE_PARSE_WORKER_URL` and `VITE_AI_WORKER_URL` are
   added to `.env.development` and `.env.e2e`, pointing at the local `wrangler dev` ports for
   `workers/parse` and `workers/ai` (`8788`/`8789` — pick two free, unused local ports and use
   them consistently across both files; document the choice in a comment).
7. **Verification — tests, all passing under `npm run test:unit:workers` and the `app` project:**
   - `workers/shared/aiEntitlementGate.test.ts`: missing header → 401; RPC error → 402;
     `is_entitled:false` → 402; `is_entitled:true` → `next()` invoked (assert via a downstream
     stub route mounted in the test only); `/health`-shaped path bypasses the gate with no
     header.
   - `workers/ai/index.test.ts` and `workers/parse/index.test.ts` each gain: a test that an
     unentitled `POST` to an arbitrary undefined path (e.g. `/probe`) still returns `402` (not
     Hono's own 404) — proving the middleware runs ahead of routing for every path, including
     one no route has claimed yet; the existing `GET /health` test is unaffected and still
     passes.
   - The gate test also asserts that on the entitled path, a downstream stub route can read
     both `c.get("supabaseCaller")` and `c.get("aiEntitlement")` and that the latter equals the
     mocked RPC response verbatim (proves the stash, not just that `next()` ran).
   - `aiWorkerClient.test.ts`: attaches the bearer token from a mocked `getSession()`; on
     `success:false` throws with the server's `error` string; on a rejected `fetch` the
     rejection propagates.
8. **No second entitlement decision.** `grep -rn '"ai_entitlement"' workers/ src/components/
   atomic-crm/` returns exactly the existing client call site
   (`providers/supabase/dataProvider.ts:607`) plus this story's one new call inside
   `aiEntitlementGate.ts` — no Worker re-implements the plan/status check, caches a copy of
   it, or introduces a second SQL function.

## Tasks / Subtasks

- [ ] **Task 1 — The shared gate** (AC: 1, 2, 3)
  - [ ] Add `SUPABASE_ANON_KEY: string` to `BaseEnv` in `workers/shared/env.ts`.
  - [ ] Create `workers/shared/aiEntitlementGate.ts`: `createCallerClient(authHeader, env)`
        (per AC-2), an exported `AiEntitlementVariables` type
        (`{ supabaseCaller: SupabaseClient; aiEntitlement: AiEntitlementInfo }`, importing
        `AiEntitlementInfo` type-only from `../../src/components/atomic-crm/types` — a
        type-only cross-boundary import is fine, see Dev Notes "The src/workers type
        boundary"), and `requireAiEntitlement` as a Hono `MiddlewareHandler<{ Bindings:
        BaseEnv; Variables: AiEntitlementVariables }>` using `workers/shared/envelope.ts`'s
        `fail()` for both error responses and `c.set(...)` on success (AC-2). Skip the check
        when `c.req.path === "/health"` (do not rely on Hono registration order — check the
        path explicitly, so the gate's own behavior is provable in isolation without depending
        on where each worker happens to register it).
  - [ ] Update `workers/ai/wrangler.toml` and `workers/parse/wrangler.toml`'s secrets comment
        block to list `SUPABASE_ANON_KEY` alongside the two existing secrets.

- [ ] **Task 2 — Wire it into both workers** (AC: 4)
  - [ ] `workers/ai/index.ts`: `createWorkerApp` currently returns a plain `Hono<{ Bindings }>`
        with no `Variables`; since `app.use()`'s bindings/variables generics must match across
        calls, either (a) widen `createWorkerApp<Bindings, Variables>` to accept an optional
        `Variables` generic (defaulting to `{}`), or (b) reassign the app's type locally in
        `workers/ai/index.ts` via `app.use("*", requireAiEntitlement)` if Hono's inference
        already widens it — try (b) first (Hono infers `Variables` from the middleware passed
        to `app.use`, no `createApp.ts` change needed in most Hono 4.x versions); fall back to
        (a) only if `tsc` disagrees. Add the `app.use("*", requireAiEntitlement);` line right
        after `const app = createWorkerApp<AiEnv>("ai")` and before `export default app`.
        Leave a one-line comment pointing 11.3 at where its route goes (after this line, so it
        can `c.get("supabaseCaller")` / `c.get("aiEntitlement")`).
  - [ ] `workers/parse/index.ts`: identical change, pointing 11.2 at its route.

- [ ] **Task 3 — Client call surface** (AC: 5, 6)
  - [ ] Create `src/components/atomic-crm/providers/commons/aiWorkerClient.ts` with
        `callAiWorker<T>()` per AC-5, importing `getSupabaseClient` from
        `../supabase/supabase`.
  - [ ] Add `VITE_PARSE_WORKER_URL` / `VITE_AI_WORKER_URL` to `.env.development` and
        `.env.e2e` per AC-6.

- [ ] **Task 4 — Tests** (AC: 7)
  - [ ] `workers/shared/aiEntitlementGate.test.ts`, following the `vi.mock("@supabase/
        supabase-js", () => ({ createClient: () => ({ ... }) }))` pattern already used in
        `workers/shared/forAccount.test.ts` — mock `.rpc()` to return each of the five cases
        in AC-7's first bullet. Mount a tiny local Hono app in the test
        (`new Hono<{ Bindings: BaseEnv; Variables: AiEntitlementVariables }>().use("*",
        requireAiEntitlement).all("*", (c) => c.json(ok({ caller: !!c.get("supabaseCaller"),
        entitlement: c.get("aiEntitlement") })))`) so the test does not depend on either
        production worker's other routes, and asserts the stashed values on the entitled path.
  - [ ] Add the two new cases to `workers/ai/index.test.ts` and `workers/parse/index.test.ts`
        (mock the RPC to return `is_entitled:false`, request `POST /probe`, assert `402`).
  - [ ] `aiWorkerClient.test.ts` (new, `providers/commons/`): mock `getSupabaseClient` and
        global `fetch` for the three cases in AC-7's third bullet.

- [ ] **Task 5 — Final verification** (AC: 8)
  - [ ] Run the AC-8 grep; confirm exactly the two expected call sites.
  - [ ] `make typecheck && npm run lint && npm run test:unit:workers` and the `app` project's
        tests for the one new file (`npx vitest --config vitest.config.ts --project app
        aiWorkerClient`). `npx prettier --config ./.prettierrc.json --check` over every file
        this story creates or touches.

## Dev Notes

### Why a second, Worker-side check when the client already asks

`useAiEntitlement`'s own doc comment already states the requirement this story closes:
"before real inference is spent, the (future) AI edge functions re-run the SAME function
server-side" (`references/useAiEntitlement.ts:14-18`). The client-side call decides what to
*render* (an upsell card vs. the real panel); it proves nothing about what a modified client
can *send*. A browser calling `fetch("<parse-worker-url>/parse", ...)` directly, bypassing the
React app entirely, would reach `workers/parse` with no entitlement check at all today. AD-8
("assistive-only, traced, cost-cached") and AD-17 ("fail-closed on the paid AI paths") both
assume this gate exists at the Worker boundary; it does not yet.
[Source: ARCHITECTURE-SPINE.md#AD-8, #AD-17]

### Why the caller's own JWT, not `forAccount()`

AD-7 mandates `forAccount(accountId, env)` — a **service-role** client that injects/asserts
`account_id` — as "the only way a Worker touches a tenant table," because the service role
bypasses RLS and an unscoped call would be a leak. That rule is about the service-role path.
This story adds a **second, RLS-respecting** path: forwarding the caller's own JWT to a client
built with the **anon key**, so PostgREST verifies the JWT itself, sets `role=authenticated`
and `auth.uid()`, and Postgres RLS (`current_context_id()`, AD-19) scopes every row exactly as
it would for the SPA. `ai_entitlement()`'s own comment anticipates this exact pattern: "works
identically for the SPA (authenticated JWT) and an edge function that forwards the user's JWT"
(`02_functions.sql:2082-2086`). Never conflate the two clients: `forAccount()` stays reserved
for writes the human's own grant does not cover (e.g. `ai_usage`, still `service_role`-only —
see 11.2). [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-7, #AD-19]

### Why a missing/invalid header still gets a clean 402, not a 500

An `anon`-role RPC call to `ai_entitlement()` fails with a Postgres permission error, because
`anon` holds no `EXECUTE` grant on it (`06_grants.sql:600-602`, "revoke all on function
public.ai_entitlement() from public, anon"). The middleware's job is to turn that expected,
specific failure into the same calm `402` an unentitled *authenticated* caller gets — never a
raw database error surfacing to a client. This mirrors the fail-closed convention already used
client-side (`dataProvider.ts:608-613`: any RPC error → `UNENTITLED_AI`).

### Hono ordering — why the middleware checks the path itself

`createWorkerApp()` (`workers/shared/createApp.ts`) registers `/health` via `app.get(...)`
*before* this story's `app.use("*", requireAiEntitlement)` runs. Relying on that registration
order to keep `/health` ungated would be fragile and non-obvious to a future reader; the
middleware instead checks `c.req.path === "/health"` explicitly (AC-1), so the exemption is
visible in one place and independent of where each worker chooses to mount the gate.

### Why the gate stashes state on context instead of each route re-deriving it

11.2 needs the entitlement payload's `resumes_used`/`resumes_limit` numbers (not just the
boolean) to enforce its own monthly cap, and both 11.2 and 11.3 need a caller-scoped client to
read/write the caller's own tenant rows. Re-deriving either downstream would mean either a
second `ai_entitlement()` RPC call per request (wasted inference-adjacent cost — margin matters
under the $2/mo model, AD-16) or a second, subtly-different client construction. Hono's typed
context (`c.set`/`c.get`) is the standard way to pass request-scoped state from a middleware to
the handlers behind it; this story pays that one-time typing cost so 11.2/11.3 do not each
invent their own answer.

### The `src/` ↔ `workers/` type boundary

`workers/shared/aiEntitlementGate.ts` imports `AiEntitlementInfo` from
`src/components/atomic-crm/types.ts` **as a type only** (`import type`). This is safe and
deliberate: every export in `types.ts` is itself `import type`-only at its own top
(`types.ts:1-10`), so the import is erased entirely at build time by both Vite (SPA) and
Wrangler's esbuild (Workers) — zero runtime coupling, no risk of pulling `react`/`ra-core`
code into a Worker bundle. The rule for this epic: a **type-only** cross-boundary import is
always fine; a **value** import is fine only when the source module's own import chain is
provably framework-free (see 11.3's Dev Notes for the one case that needs it). Never import
anything that transitively reaches `react`, `ra-core`, or a `@/`-aliased path into `workers/`.

### Project Structure Notes

New files: `workers/shared/aiEntitlementGate.ts` (+ `.test.ts`),
`src/components/atomic-crm/providers/commons/aiWorkerClient.ts` (+ `.test.ts`). Touched:
`workers/shared/env.ts`, `workers/ai/index.ts`, `workers/ai/index.test.ts`,
`workers/ai/wrangler.toml`, `workers/parse/index.ts`, `workers/parse/index.test.ts`,
`workers/parse/wrangler.toml`, `.env.development`, `.env.e2e`. No `supabase/schemas/*` change,
no migration — this story is Worker- and client-side only. Follows the existing `workers/`
Consistency Convention: JSON envelope `{success,data?,error?,meta?}`
[Source: ARCHITECTURE-SPINE.md#Consistency-Conventions, "Worker API / validation"].

### Testing standard

AAA, descriptive names, no shared mutable state between tests (`.claude/rules/testing.md`).
Mock `@supabase/supabase-js` at the module level exactly as `workers/shared/forAccount.test.ts`
already does — do not hit a real Supabase instance from a Worker unit test. `npm run
test:unit:workers` is plain Node (no Workers runtime, no browser) per `vitest.config.ts`'s
`"workers"` project; `aiWorkerClient.test.ts` belongs to the `"app"` project instead (it lives
under `src/`, runs in a real browser per that project's config) — run it with
`npx vitest --config vitest.config.ts --project app`, not `test:unit:workers`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-11.1]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-13, #Constraints "Never fabricate"]
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-7, #AD-8, #AD-17, #AD-19, #Consistency-Conventions]
- [Source: supabase/schemas/02_functions.sql — `ai_entitlement()`, ~2064-2142]
- [Source: supabase/schemas/06_grants.sql:597-602 — `ai_entitlement()` grants]
- [Source: src/components/atomic-crm/references/useAiEntitlement.ts]
- [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:606-615]
- [Source: workers/shared/forAccount.ts, forAccount.test.ts — client-mocking pattern]
- [Source: workers/shared/createApp.ts, envelope.ts, env.ts]
- [Source: design-artifacts/gap-analysis-v3.md §7 — "AI diligence dossier | inference + the
  entitlement gate (built)"; confirms the DB-side gate predates this epic and only the
  Worker-side re-check is missing]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
