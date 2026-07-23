# Demo / Onboarding — Stage A: the backend demo-data engine

Stage A ships the **backend engine** to load and clear realistic demo data in a
user's own account. It is three deliverables plus deploy config, all verified by
running them against the local DB:

1. A migration: `accounts.demo boolean not null default false` + a
   `public.current_account_demo()` RPC.
2. Edge function `seed_demo` — plants the curated dataset into the caller's
   (empty) account and sets `demo = true`.
3. Edge function `clear_demo` — wipes every tenant row in the caller's account
   (tenancy-safe) and sets `demo = false`.

Later stages (NOT this one): onboarding UI, clickable walkthrough, demo banner.

---

## 0. Ground truth established by reading the code

These are load-bearing facts the implementation depends on; verified in the
current schema/functions, not assumed.

- **Tenancy.** `public.current_account_id()` (SECURITY DEFINER, STABLE,
  `search_path=''`) returns the caller's account from the first **active**
  `account_members` row for `auth.uid()`, else NULL. RLS on every tenant table
  is `for all to authenticated using/with check (account_id = current_account_id())`.
  `set_account_id_default()` BEFORE-INSERT triggers populate `account_id` from
  `current_account_id()` on `children/shadchanim/references/shidduchim/resumes/
  reference_links/date_records/redts/shidduch_schools/tasks/interactions/
  identity_signals`. **Therefore every insert must run under the USER's JWT** so
  both the trigger and RLS resolve to the caller's account.
- **A fresh signup only gets a membership if it is the FIRST user.**
  `handle_new_user()` bootstraps an account + `parent_admin` membership **only
  when `account_members` is empty**. Every later signup gets NO membership →
  `current_account_id()` is NULL → it cannot seed. This is decisive for the
  verification plan (see §7): a brand-new local user will have NO account and
  seeding will fail with "no account context". The clean-account path for
  testing is therefore **clear + re-seed account 1**, or manually insert an
  `account_members` row for a new user.
- **Shidduch state machine (AD-4).** `create_shidduch(...)` is the sole INSERT
  path; it rejects any `p_initial_state` outside
  `new | look_into | not_sure | for_sure_not` (mirrored by the
  `enforce_shidduch_initial_state` BEFORE-INSERT trigger). Decision states
  `yes | unsure | no` are reached only via `transition_shidduch(p_id, p_from,
  p_to, p_close_reason)`, validated against `pipeline_transitions`. Legal edges
  (the whole graph):
  - `new → look_into | not_sure | for_sure_not`
  - `not_sure → look_into | for_sure_not`
  - `look_into → yes | unsure | no`
  So to seed a decision-state suggestion: **create as `look_into`, then
  `transition_shidduch(id,'look_into',<yes|unsure|no>, <close_reason>)`.**
  `create_shidduch` also writes the first `redts` row and (if a seminary is
  given) the first `shidduch_schools` row; `first_suggested_by/at`, `redt_date`
  and `shadchan_id` are DERIVED from `redts` by `refresh_shidduch_redt_summary`.
- **create_shidduch signature (positional order matters for the RPC call):**
  `(p_child_id bigint, p_shadchan_id bigint, p_name_en, p_name_he, p_parents_en,
  p_parents_he, p_seminary_en, p_seminary_he, p_shul_en, p_shul_he,
  p_location_en, p_location_he, p_age int, p_height text, p_origin text='manual',
  p_initial_state pipeline_state='new', p_visibility text='shared',
  p_redt_date date=NULL)`. Called from supabase-js as
  `.rpc('create_shidduch', { p_child_id, p_shadchan_id, p_name_en, p_seminary_en,
  p_parents_en, p_location_en, p_age, p_height, p_initial_state, p_redt_date })`
  (named args; omit the `_he` ones — Hebrew was removed from the UI). It returns
  `SETOF shidduchim`, i.e. supabase-js gives an **array**; take `[0].id`.
- **Reference linking + call log.** `link_reference_to_shidduch(p_reference_id,
  p_shidduchim_id, p_relationship_override)` creates the `reference_links` row
  (`call_status='not_started'`) **and** a `link_created` interaction; returns the
  link row. `log_reference_call(p_reference_link_id, p_call_status,
  p_what_they_said, p_source)` appends to `conversation_log`, sets `call_status`,
  `what_they_said`, and inserts a `call_logged` interaction. Both are the correct
  seed path for references-on-a-suggestion.
- **Interactions RLS/grants.** `authenticated` has **select, insert, update
  (body, metadata only)** on `interactions` — **NO DELETE**. `identity_signals`
  is **select-only** for `authenticated` (written by SECURITY DEFINER sync
  triggers). Inserting a plain timeline note on a suggestion is allowed as
  `(target_type='shidduch', scope='shidduch', reference_link_id=NULL,
  target_id=<shidduch id>, kind='note', body=...)` — this satisfies both
  `interactions_scope_link_check` and the RLS `with check`.
- **The polymorphic purge trigger is the deletion backbone.**
  `purge_polymorphic_dependents('shidduch'|'reference')` runs BEFORE DELETE on
  `shidduchim` and `references` (SECURITY DEFINER) and deletes the
  `identity_signals`, `interactions`, and `tasks` rows whose
  `(account_id, target_type, target_id)` point at the deleted row. Combined with
  the composite `ON DELETE CASCADE` FKs (deleting a shidduch cascades its
  `redts / resumes / reference_links / shidduch_schools`; deleting a
  `reference_link` cascades its `interactions` via the `reference_link_id` FK),
  this is what lets `clear_demo` fully empty the account **without** the
  authenticated role ever needing DELETE on `interactions`/`identity_signals`.
- **tasks.** `target_type in ('contact','shadchan','shidduch','reference')`,
  `target_id NOT NULL`; `sync_task_target` keeps the legacy `contact_id` in
  lockstep (stays NULL for shidduch/reference targets). `authenticated` HAS
  delete on `tasks`. `type`/`text` are free text.
- **shadchanim.responsiveness** — frontend expects `'high' | 'medium' | 'low'`
  (`ResponsivenessLevel`). Use those exact tokens.
- **`references` is a reserved word** → always `public."references"`; PostgREST
  exposes it as the `references` resource (supabase-js `.from('references')`).
- **Edge-function pattern** (`functions/users/index.ts` + `_shared/*`):
  `verify_jwt=false` in `config.toml`; the function does its own
  `OptionsMiddleware → AuthMiddleware → UserMiddleware`. `supabaseAdmin`
  (service role) is available. `UserMiddleware` builds a user-scoped client from
  `SB_PUBLISHABLE_KEY` + the caller's `Authorization` header — that is exactly
  the client `seed_demo`/`clear_demo` must build to run inserts/RPCs AS the user.

### RLS / permission gaps to be aware of (flagged)

- **No gap blocks seeding as the user.** children/shadchanim/references/
  shidduchim(+RPCs)/reference_links/redts/shidduch_schools/tasks all have
  `for all` account-scoped policies and the authenticated role holds the needed
  INSERT/EXECUTE grants. Inserting a `kind='note'` interaction is permitted.
- **`clear_demo` must NOT try to `DELETE FROM interactions` or
  `identity_signals` with the user client** — authenticated has no such grant
  and the call would fail. It relies on the purge trigger + FK cascade instead
  (see §6). This is the single most important safety/behaviour note.
- **`accounts.demo` flip:** the accounts RLS is `for all` and authenticated has
  UPDATE, so the user client *could* set `demo` itself — but per the brief we set
  it with `supabaseAdmin`, filtered by the **server-resolved** `account_id`, so
  the flag write is explicit and never trusts the request body.
- **FORCE RLS is not yet applied** (only `ENABLE`). Fine here: the API roles are
  not table owners, so RLS still applies to `authenticated`. No action.

---

## 1. Migration — `accounts.demo` + `current_account_demo()`

### 1a. Schema edit — `supabase/schemas/01_tables.sql`

Add `demo` as the **last** column of `public.accounts` (append-at-end matches how
`db diff`/`pg_dump` order a new `ADD COLUMN`, avoiding a phantom diff):

```sql
create table public.accounts (
    id bigint generated by default as identity primary key,
    created_at timestamp with time zone not null default now(),
    name text not null default 'My Account',
    transparency_level text not null default 'shared',
    data_region text,
    stripe_customer_id text,
    subscription_status text,
    plan text,
    current_period_end timestamp with time zone,
    trial_end timestamp with time zone,
    -- Onboarding demo-data flag (Stage A). True while the account holds the
    -- seeded demo dataset; cleared by clear_demo. Drives the future demo banner.
    demo boolean not null default false
);
```

### 1b. RPC — `supabase/schemas/02_functions.sql`

Add, in the shidduchim-domain function block, in exact pg_dump form
(SQL language, STABLE, SECURITY DEFINER, `search_path=''` — mirrors
`current_account_id` so no phantom diff):

```sql
-- Reads the demo flag for the caller's account so the SPA can show the demo
-- banner (later stage) without a bespoke query. SECURITY DEFINER + search_path
-- '' like current_account_id; returns false when the caller has no account.
CREATE OR REPLACE FUNCTION "public"."current_account_demo"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_account_id()),
    false
  );
$$;
```

### 1c. Grants — `supabase/schemas/06_grants.sql`

```sql
revoke all on function public.current_account_demo() from public, anon;
grant execute on function public.current_account_demo() to authenticated;
grant execute on function public.current_account_demo() to service_role;
```

### 1d. Generate + apply + verify no drift

```bash
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff -f add_account_demo_flag
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local   # must report NO schema changes
```

The generated migration should contain the `alter table ... add column demo`,
the `create or replace function ... current_account_demo`, and the three grants.
If `db diff` still shows the function afterwards, the body/whitespace doesn't
match pg_dump — re-dump with
`npx supabase db dump --local --schema public` and copy the exact text.

### 1e. Optional (recommended) frontend type touch — `src/.../types.ts`

Add `demo?: boolean;` to the `Account` type so a later stage can read
`current_account_demo()`/`accounts.demo` type-safely. Trivial; keeps
`make typecheck` honest. No other frontend change in Stage A.

---

## 2. Edge function `seed_demo` — `supabase/functions/seed_demo/index.ts`

**Shape** (mirror `users/index.ts`):

```
Deno.serve → OptionsMiddleware → AuthMiddleware → UserMiddleware((req, user) => …)
```

Accept `POST` (and/or `PATCH`); else `405`.

**Steps inside the handler:**

1. **Resolve account server-side** with `supabaseAdmin` (never from the body):
   ```ts
   const { data: membership } = await supabaseAdmin
     .from("account_members")
     .select("account_id")
     .eq("user_id", user.id).eq("status", "active")
     .order("id").limit(1).maybeSingle();
   if (!membership) return createErrorResponse(409, "No active account for user");
   const accountId = membership.account_id;
   ```
2. **Guard — only seed an empty account.** Count children for `accountId` via
   `supabaseAdmin`:
   ```ts
   const { count } = await supabaseAdmin
     .from("children").select("id", { count: "exact", head: true })
     .eq("account_id", accountId);
   if ((count ?? 0) > 0)
     return json({ seeded: false, reason: "account_not_empty" }); // idempotent no-op (HTTP 200)
   ```
3. **Build a user-scoped client** (like `UserMiddleware`) so RLS +
   `current_account_id()` + the account_id-default triggers all resolve to the
   caller's account:
   ```ts
   const authHeader = req.headers.get("Authorization")!;
   const db = createClient(
     Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_PUBLISHABLE_KEY")!,
     { global: { headers: { Authorization: authHeader } } });
   ```
4. **Plant the dataset with `db`** (order below; §5 has the full data). Any
   error → return `createErrorResponse(500, …)` (no partial rollback exists;
   the guard + the clear function make re-runs safe). Every insert omits
   `account_id` (trigger sets it). Check `error` after each call and throw.
5. **Flip the flag with `supabaseAdmin`**, scoped to the resolved id:
   ```ts
   await supabaseAdmin.from("accounts").update({ demo: true }).eq("id", accountId);
   ```
6. **Return a summary** count object:
   `{ seeded: true, accountId, children: 2, shadchanim: 5, references: 4,
   shidduchim: 12, tasks: 4, interactions: <n> }`.

**Insert / RPC order** (each with the user client `db`):

1. `db.from('children').insert([...]).select('id, gender')` → keep `girlId`,
   `boyId`.
2. `db.from('shadchanim').insert([...]).select('id, name')` → map name→id.
3. `db.from('references').insert([...]).select('id, name_en')` → map name→id.
   (`*_norm` + `identity_signals` auto-populate via triggers.)
4. For each **girl-pipeline** suggestion (child = `girlId`):
   `db.rpc('create_shidduch', { p_child_id: girlId, p_shadchan_id, p_name_en,
   p_parents_en, p_seminary_en, p_location_en, p_age, p_height,
   p_initial_state, p_redt_date })` → `shidduchId = data[0].id`.
   If the target state is a decision state, `p_initial_state:'look_into'` then
   `db.rpc('transition_shidduch', { p_id: shidduchId, p_from:'look_into',
   p_to:<yes|unsure|no>, p_close_reason })`.
5. Same for **boy-pipeline** suggestions (child = `boyId`).
6. Optional realism: one or two `db.rpc('add_redt', { p_shidduchim_id,
   p_shadchan_id, p_redt_date })` to show a suggestion redt by a 2nd shadchan.
7. Reference diligence: `db.rpc('link_reference_to_shidduch', { p_reference_id,
   p_shidduchim_id })` → `linkId = data[0].id`; then
   `db.rpc('log_reference_call', { p_reference_link_id: linkId,
   p_call_status:'answered', p_what_they_said:<note>, p_source:'manual' })`.
8. Plain timeline notes:
   `db.from('interactions').insert({ target_type:'shidduch', scope:'shidduch',
   target_id: shidduchId, reference_link_id: null, kind:'note', body:<text> })`.
9. Reminders: `db.from('tasks').insert([...])` with `text, type, due_date,
   target_type, target_id`.

> supabase-js orders `.rpc` args by name, so pass named params; positional
> defaults for the omitted `_he`/origin/visibility args apply automatically.

---

## 3. Edge function `clear_demo` — `supabase/functions/clear_demo/index.ts`

Same `Options→Auth→User` shape. Accept `POST` (and/or `DELETE`); else `405`.

**Critical tenancy safety:** resolve `accountId` from the **caller's own active
`account_members` row** (identical block to §2 step 1) — never from the request
body. Every delete is filtered `.eq('account_id', accountId)`. Because the user
client is itself RLS-bound to `current_account_id()`, a delete can only ever
touch the caller's account; the explicit `account_id` filter is defense-in-depth
so the function can never become a blanket wipe.

**Deletes (user client `db`, FK-safe order):**

```
1. tasks                (authenticated has delete)
2. reference_links      (cascades its call_logged/link_created interactions via reference_link_id FK)
3. redts
4. shidduch_schools
5. resumes
6. date_records
7. shidduchim           (purge trigger removes its note interactions + identity_signals + tasks)
8. references           (purge trigger removes its interactions + identity_signals)
9. shadchanim
10. children
```

Each: `await db.from(<table>).delete().eq('account_id', accountId)` (check
`error`, throw on failure). `interactions` and `identity_signals` are **not**
deleted directly (no grant) — the purge trigger on `shidduchim`/`references`
(steps 7–8) and the `reference_link_id` cascade (step 2) remove every one of
them. There is nothing left in the account after step 10.

**Then flip the flag with `supabaseAdmin`:**
```ts
await supabaseAdmin.from("accounts").update({ demo: false }).eq("id", accountId);
```
Return `{ cleared: true, accountId }`.

> Why this order is safe even though FKs would cascade anyway: doing
> `reference_links / redts / schools / resumes` before `shidduchim`, and all
> shidduch-side rows before `references`, means no delete ever hits a
> not-yet-removed dependent, and the trigger-driven purge of the polymorphic
> tables happens exactly once per parent. Deleting `children` last is required —
> `shidduchim.child_id` / `date_records.child_id` are `ON DELETE CASCADE` from
> children, so children must go after their shidduchim/date_records.

---

## 4. Deploy config — `supabase/config.toml`

Append (both do their own JWT verification, exactly like `users`):

```toml
[functions.seed_demo]
verify_jwt = false
[functions.clear_demo]
verify_jwt = false
```

After writing the functions, reload the local edge runtime so they load:
`docker restart supabase_edge_runtime` (or `npx supabase functions serve`).

---

## 5. The curated realistic dataset (concrete values)

Frum/yeshivish Lakewood family. **All English.** Ages target 2026. `redt_date`
values are expressed as day-offsets from "today" (compute in TS:
`new Date(Date.now() - N*864e5).toISOString().slice(0,10)`).

### 5.1 Children (2) — the Stern family, Lakewood

| field | Girl | Boy |
|---|---|---|
| first_name_en | Rivky | Yaakov |
| last_name_en | Stern | Stern |
| gender | female | male |
| dob | 2006-04-18 | 2003-09-02 |
| community | Lakewood | Lakewood |
| status | active | active |

(Rivky ≈ 20, seminary graduate; Yaakov ≈ 22, learning in BMG.)

### 5.2 Shadchanim (5)

| # | name | location | responsiveness |
|---|---|---|---|
| S1 | Mrs. Leah Feldman | Lakewood, NJ | high |
| S2 | Rabbi Shmuel Weiss | Lakewood, NJ | medium |
| S3 | Mrs. Chaya Rosenberg | Monsey, NY | high |
| S4 | Mrs. Sarah Greenberg | Brooklyn, NY | low |
| S5 | Rabbi Yosef Kanarek | Passaic, NJ | medium |

### 5.3 Rivky's pipeline — boys suggested (7, one per state)

`p_child_id = girlId`, `p_seminary_en` = the boy's yeshiva/beis medrash.

| name_en | parents_en | seminary_en (yeshiva) | location_en | age | height | shadchan | redt (days ago) | target state | path |
|---|---|---|---|---|---|---|---|---|---|
| Ahron Klein | R' Moshe & Esther Klein | Beth Medrash Govoha (BMG) | Lakewood, NJ | 23 | 5'11" | S1 | 4 | **new** | create `new` |
| Yisroel Meir Friedman | R' Dovid & Rochel Friedman | Mir (Yerushalayim) | Yerushalayim | 24 | 5'10" | S2 | 12 | **look_into** | create `look_into` |
| Shmuel Brog | R' Aryeh & Devora Brog | Ner Yisroel (Baltimore) | Baltimore, MD | 22 | 5'9" | S3 | 9 | **not_sure** | create `not_sure` |
| Naftali Schwartz | R' Yaakov & Bracha Schwartz | Yeshiva Chaim Berlin | Brooklyn, NY | 25 | 6'0" | S4 | 20 | **for_sure_not** | create `for_sure_not` |
| Eliezer Katz | R' Chaim & Miriam Katz | Yeshiva Gedolah of Philadelphia | Philadelphia, PA | 23 | 5'10" | S1 | 30 | **yes** | create `look_into` → transition `yes` |
| Yosef Mandel | R' Shloime & Faigy Mandel | Yeshiva Torah Vodaas | Brooklyn, NY | 24 | 5'8" | S5 | 25 | **unsure** | create `look_into` → transition `unsure` |
| Binyomin Reiss | R' Zev & Leah Reiss | Beth Medrash Govoha (BMG) | Lakewood, NJ | 22 | 5'11" | S2 | 40 | **no** | create `look_into` → transition `no`, close_reason "Different hashkafa — not the right fit." |

Optional extra redt: `add_redt(Eliezer Katz shidduch, S3, redt 18 days ago)` so
the "yes" card shows it was redt by two shadchanim (latest = S3).

### 5.4 Yaakov's pipeline — girls suggested (5, several states)

`p_child_id = boyId`, `p_seminary_en` = the girl's seminary.

| name_en | parents_en | seminary_en | location_en | age | height | shadchan | redt (days ago) | target state | path |
|---|---|---|---|---|---|---|---|---|---|
| Esther Malka Weiss | R' Shmuel & Rivka Weiss | Bais Yaakov of Lakewood | Lakewood, NJ | 19 | 5'4" | S3 | 3 | **new** | create `new` |
| Devora Leah Gross | R' Aryeh & Sarah Gross | Bais Yaakov of Yerushalayim (BJJ) | Monsey, NY | 20 | 5'6" | S1 | 10 | **look_into** | create `look_into` |
| Chana Rosen | R' Dovid & Miriam Rosen | Bais Yaakov of Baltimore | Baltimore, MD | 18 | 5'2" | S4 | 15 | **for_sure_not** | create `for_sure_not` |
| Shira Feldman | R' Yosef & Chava Feldman | Michlalah (Yerushalayim) | Passaic, NJ | 19 | 5'5" | S5 | 28 | **yes** | create `look_into` → transition `yes` |
| Bracha Gold | R' Menachem & Rochel Gold | Bais Yaakov of Lakewood | Lakewood, NJ | 20 | 5'7" | S2 | 35 | **no** | create `look_into` → transition `no`, close_reason "Ages didn't work out." |

### 5.5 References (4)

| # | name_en | relationship | phone | school | grad_year |
|---|---|---|---|---|---|
| R1 | Rabbi Avrohom Stein | Rebbe (BMG) | 732-555-0142 | Beth Medrash Govoha | — |
| R2 | Mrs. Devora Klein | Seminary teacher | 845-555-0177 | Bais Yaakov of Lakewood | — |
| R3 | Mrs. Shaindy Berger | Neighbor | 732-555-0198 | — | — |
| R4 | Yaakov Lerner | Chavrusa / friend | 718-555-0165 | Beth Medrash Govoha | — |

### 5.6 Reference links + call logs (2)

- **R1 Rabbi Avrohom Stein → Eliezer Katz** (Rivky's "yes"):
  `link_reference_to_shidduch(R1, EliezerKatz)`, then
  `log_reference_call(link, 'answered', "Top bochur in his shiur — serious about
  learning, excellent middos. Well-respected family. Gave a very strong
  recommendation.", 'manual')`.
- **R2 Mrs. Devora Klein → Devora Leah Gross** (Yaakov's "look_into"):
  `link_reference_to_shidduch(R2, DevoraLeahGross)`, then
  `log_reference_call(link, 'answered', "Knew her well in seminary — mature,
  responsible, wonderful family. Would be a great fit for a learning boy.",
  'manual')`.

(Each produces a `call_logged` interaction + a populated `conversation_log`;
`link_reference_to_shidduch` also emits a `link_created` interaction.)

### 5.7 Timeline notes — direct `interactions` inserts (3)

`(target_type:'shidduch', scope:'shidduch', target_id:<id>, kind:'note', body)`

- **Eliezer Katz:** "Parents sound very interested. Waiting to hear back after
  they check into our side. References so far are excellent."
- **Yisroel Meir Friedman:** "Redt by Rabbi Weiss — learning in Mir, supposed to
  be an outstanding bochur. Need to call references this week."
- **Devora Leah Gross:** "Seminary teacher gave a glowing report. Planning to
  set up a call between the parents."

### 5.8 Reminders — `tasks` (4)

| text | type | due (days) | target_type | target_id |
|---|---|---|---|---|
| Call Mrs. Feldman to follow up on Eliezer Katz | Call | **−2 (overdue)** | shidduch | Eliezer Katz |
| Call Rabbi Stein back about the Katz family | Call | **−1 (overdue)** | reference | R1 |
| Follow up with Mrs. Rosenberg re: Esther Malka Weiss | Follow up | +2 | shidduch | Esther Malka Weiss |
| Confirm the date for Shira Feldman | Follow up | +4 | shidduch | Shira Feldman |

`due_date` = `new Date(Date.now() + N*864e5).toISOString()`. `sales_id` is set by
the `set_sales_id_default` trigger; `account_id` by `set_account_id_default`;
`contact_id` stays NULL for shidduch/reference targets.

**Totals:** 2 children, 5 shadchanim, 4 references, **12 shidduchim** (7 girl +
5 boy) across all 7 states, 2 reference_links w/ call logs, ≥5 interactions
(2 call_logged + 2 link_created + 3 notes), 4 tasks, 12+ redts (auto), plus
`shidduch_schools` auto-rows.

---

## 6. Tenancy-safety argument for `clear_demo` (why it can only wipe the caller)

1. `accountId` comes from the caller's own `account_members` (server-resolved),
   never the body.
2. The delete client is the **user-scoped** client → RLS restricts every
   statement to `current_account_id()` regardless of the WHERE clause.
3. Every statement additionally filters `.eq('account_id', accountId)` (belt +
   braces) — no unfiltered/blanket delete exists in the code.
4. `interactions`/`identity_signals` are never targeted directly (no grant); the
   SECURITY-DEFINER purge trigger removes them but only for the row being
   deleted, whose `account_id` it re-checks. No cross-tenant reach is possible.
5. `TRUNCATE` (the one op that bypasses RLS) is revoked from `authenticated`
   (06_grants.sql) and is not used.

---

## 7. Verification (Execute + Review — the whole point)

1. Apply migration (§1d). Restart edge runtime after writing functions
   (`docker restart supabase_edge_runtime`).
2. `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase status --output json` →
   grab `ANON_KEY` (a.k.a. publishable key) + API URL.
3. Get a user JWT (password grant):
   `POST {API}/auth/v1/token?grant_type=password` with `apikey: <anon>` and
   `{ "email":"test@local.dev", "password":"testpass123" }` → `access_token`.
4. **Account-1 already has manual seed data** → `seed_demo`'s empty-account guard
   will (correctly) no-op. To exercise seeding: **`clear_demo` account 1 first**,
   then `seed_demo`. (Creating a brand-new local user will NOT work — per §0
   `handle_new_user` gives later signups no membership, so `current_account_id()`
   is NULL and seeding fails; if a clean *separate* account is wanted, insert an
   `accounts` row + an `account_members(user_id, account_id, status='active')`
   row via psql, and sign that user in.)
5. Invoke `clear_demo` then `seed_demo`:
   `curl -X POST {API}/functions/v1/clear_demo -H "Authorization: Bearer <jwt>" -H "apikey: <anon>"`
   then the same for `seed_demo`.
6. Verify in psql (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`):
   ```sql
   -- resolve the test user's account first, then assert against it
   select count(*) filter (where gender='female'), count(*) filter (where gender='male')
     from children where account_id = :acct;                    -- 1, 1
   select pipeline_state, count(*) from shidduchim where account_id=:acct
     group by 1 order by 1;                                      -- all 7 states present, 12 total
   select count(*) from shadchanim where account_id=:acct;      -- 5
   select count(*) from "references" where account_id=:acct;    -- 4
   select count(*) from reference_links where account_id=:acct; -- 2 (with conversation_log)
   select kind, count(*) from interactions where account_id=:acct group by 1;
   select text, due_date, target_type from tasks where account_id=:acct order by due_date;
   select demo from accounts where id=:acct;                    -- true
   select public.current_account_demo();                        -- true (run as the user via PostgREST/rpc)
   ```
   Confirm **no rows land in any other account** (`select account_id, count(*)
   from shidduchim group by 1`).
7. Invoke `clear_demo` again → re-query: every tenant table for `:acct` is empty,
   `accounts.demo = false`, `current_account_demo()` → false.
8. Sign in in the browser as the seeded user; screenshot the **dashboard** and
   the **board** (7 columns populated) to show the realistic data live.
9. `make typecheck` must pass (only touched types: optional `Account.demo`).

---

## 8. Security-review bar (this diff touches auth + DB + a destructive fn)

- Destructive `clear_demo`: account resolved server-side from membership only;
  per-statement `account_id` filter; user-scoped RLS client; no TRUNCATE; no
  body-supplied ids. (§6.)
- `seed_demo`: empty-account guard prevents clobbering existing data; all writes
  under the user JWT so nothing escapes the caller's account; service role used
  **only** for the `demo` flag, filtered by the resolved id.
- Both functions authenticate exactly like `users` (`Auth`+`User` middleware,
  `verify_jwt=false`); no new anon surface; `current_account_demo` is
  SECURITY DEFINER but only reads the caller's own account and is revoked from
  anon/public.
- English-only respected across all seeded content and code.

## 9. File-touch checklist

- `supabase/schemas/01_tables.sql` — add `demo` column to `accounts`.
- `supabase/schemas/02_functions.sql` — add `current_account_demo()`.
- `supabase/schemas/06_grants.sql` — grants for `current_account_demo()`.
- `supabase/migrations/<ts>_add_account_demo_flag.sql` — generated; verify.
- `supabase/functions/seed_demo/index.ts` — new.
- `supabase/functions/clear_demo/index.ts` — new.
- (optional shared) `supabase/functions/_shared/*` — reuse as-is; if a
  user-scoped-client helper is extracted, add `_shared/userClient.ts`.
- `supabase/config.toml` — register both functions.
- `src/components/atomic-crm/types.ts` — optional `Account.demo?: boolean`.
- Do **not** git commit; local only.
