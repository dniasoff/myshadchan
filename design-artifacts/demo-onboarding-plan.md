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

---
---

# Demo / Onboarding — Stage B: the UX (onboarding choice + walkthrough + demo banner)

Stage A shipped the backend engine (migration + `seed_demo`/`clear_demo` edge
functions + `current_account_demo()` RPC). Stage B is the **frontend experience**
that drives them: a premium first-run choice screen, a clickable driver.js
walkthrough, and a full-width demo banner — all in the LOCKED "Quiet Luminance"
system, English-only, both themes, `make typecheck` clean, **no git commit, no
deploy** (local only; the orchestrator deploys migration+functions+frontend
together after this stage).

## B0. Ground truth established by reading the code (Stage B)

Load-bearing facts verified against the current frontend, not assumed:

- **The three backend contracts** (from `supabase/functions/seed_demo/index.ts`,
  `clear_demo/index.ts`, `02_functions.sql`):
  - `seed_demo` — `POST` (also accepts `PATCH`). Empty body. Guards: only seeds
    when the account has zero rows in `children/shadchanim/references/shidduchim`
    (else HTTP 200 `{ seeded:false, reason:"account_not_empty" }`), and requires
    an active membership (else 409). Success → `{ seeded:true, accountId,
    children, shadchanim, references, shidduchim, referenceLinks, interactions,
    tasks }` and sets `accounts.demo = true`.
  - `clear_demo` — `POST` (also accepts `DELETE`). Empty body. Wipes every tenant
    row in the caller's own account (tenancy-safe) and sets `accounts.demo =
    false`. Success → `{ cleared:true, accountId }`.
  - `current_account_demo()` — RPC, returns `boolean` (`false` when the caller has
    no account). This is the banner's single source of truth.
- **`Account.demo?: boolean`** already exists on the `Account` type
  (`src/components/atomic-crm/types.ts:265`). No type change needed there.
- **`CrmDataProvider` is structurally typed** — it is
  `ReturnType<typeof supabase getDataProvider>` (`providers/types.ts` re-exports
  from `providers/supabase/dataProvider.ts`). So the three new methods must be
  added to the **supabase provider object** (defines the type) AND the **fakerest
  provider object** (typed `: CrmDataProvider`, so it must implement them too, or
  `make typecheck` fails). Mirror the `salesUpdate` / `isInitialized` pattern.
- **The authenticated app shell is `Layout` (desktop) / `MobileLayout`
  (mobile)**, selected in `root/CRM.tsx` via `useIsMobile()` and passed to
  `<Admin layout=…>`. Every authenticated page renders inside one of these — this
  is the correct single mount point for both the OnboardingGate and the demo
  banner. `Layout` = fixed `Sidebar` (`fixed inset-y-0 start-0`, desktop-only) +
  a `md:ps-[var(--sidebar-w)]` column holding a `sticky top-0` `TopBar` + scroll
  `main`. `MobileLayout` = `children` + bottom `MobileNavigation`.
- **First-run routing today:** `StartPage` (the `loginPage`) only decides
  signed-out routing — `dataProvider.isInitialized()` (does ANY sales user exist,
  a global install-bootstrap check) → `/sign-up` for a brand-new install, else
  `LoginPage`. `FirstRunSetup` exists and does real writes (`accounts` name +
  first `children` row) but **is NOT wired into any route** (confirmed: only
  self-reference + a comment reference). Stage B is where it finally gets used —
  reached from the OnboardingChoice "own family" path (rendered inline, no new
  route needed; it `navigate("/")`s when done).
- **`useStore` (ra-core) is the CRM store** — already used in
  `ConfigurationContext.tsx`, backed by the `"CRM"` localStorage namespace
  (`crmStore.ts`). Use it for the onboarding/tour markers. It is per-browser, not
  per-account — acceptable for this stage.
- **`driver.js` is NOT installed** (`package.json`) — `npm install driver.js`.
- **Anchor host components** already read: `layout/navItems.ts` (`PRIMARY_NAV`,
  6 items), `layout/Sidebar.tsx` (`SidebarLink` renders each `<Link>`),
  `layout/TopBar.tsx` (`ChildSwitcherPill` trigger button),
  `shidduchim/ShidduchimList.tsx` (`ShidduchimActions` → `CreateButton
  label="Add a suggestion"`), `shidduchim/ShidduchimListContent.tsx` (the
  `DragDropContext` columns row), `shidduchim/ShidduchColumn.tsx` (first column
  `<section>`), `shidduchim/ShidduchCard.tsx` (first card),
  `dashboard/PipelineSnapshot.tsx` (the `<Card>`).

---

## B1. dataProvider methods (Stage A wiring)

Add three typed methods; mirror `salesUpdate` (edge fn via `functions.invoke`)
and `transitionShidduch` (rpc).

### B1a. Supabase provider — `providers/supabase/dataProvider.ts`

Add alongside `isInitialized` / `mergeContacts`:

```ts
async seedDemo(): Promise<{ seeded: boolean; reason?: string }> {
  const { data, error } = await getSupabaseClient().functions.invoke<{
    seeded: boolean; reason?: string;
  }>("seed_demo", { method: "POST" });
  if (error || !data) {
    console.error("seed_demo.error", error);
    throw new Error("Failed to load the demo data");
  }
  return data;
},
async clearDemo(): Promise<{ cleared: boolean }> {
  const { data, error } = await getSupabaseClient().functions.invoke<{
    cleared: boolean;
  }>("clear_demo", { method: "POST" });
  if (error || !data) {
    console.error("clear_demo.error", error);
    throw new Error("Failed to clear the demo data");
  }
  return data;
},
async currentAccountDemo(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("current_account_demo");
  if (error) {
    console.error("current_account_demo.error", error);
    return false; // fail-soft: no banner rather than a broken app
  }
  return data === true;
},
```

> `functions.invoke` returns the parsed JSON as `data`. `error` is a
> `FunctionsHttpError` on non-2xx; `seed_demo`'s `account_not_empty` no-op is a
> **200** so it comes back as `data.seeded === false` (not an error) — the UI
> handles that gracefully (already seeded → just refetch + move on).

### B1b. FakeRest provider — `providers/fakerest/dataProvider.ts`

Stubs so demos/tests don't break (add to the `dataProviderWithCustomMethod`
object, near `isInitialized`). A module-level `let fakeDemo = false;` makes the
stub self-consistent if anything reads it back:

```ts
seedDemo: async () => { fakeDemo = true; return { seeded: true }; },
clearDemo: async () => { fakeDemo = false; return { cleared: true }; },
currentAccountDemo: async () => fakeDemo,
```

### B1c. Type surface

No change to `providers/types.ts` (it re-exports `CrmDataProvider` from the
supabase provider, so adding the methods there updates the type automatically).
`make typecheck` will force the fakerest object to implement all three.

---

## B2. OnboardingGate — placement + decision logic

**New file:** `root/OnboardingGate.tsx`. It wraps the shell and either renders
its children (the normal app) or replaces them with the full-screen
OnboardingChoice.

**Mount:** wrap the ENTIRE return of both `Layout` and `MobileLayout` in
`<OnboardingGate>…</OnboardingGate>` (the gate replaces the shell, so it must sit
outside Sidebar/TopBar). Both layouts already call `useConfigurationLoader()`;
the gate adds its own data reads. (Placing it inside the layouts — rather than in
`CRM.tsx` — keeps it below the `<Admin>` providers so `useGetList`,
`useDataProvider`, `useStore` all work.)

**Reads (all in the gate):**
- `hasChildren` — `useGetList<Child>("children", { pagination:{page:1,perPage:1} })`
  → `total === 0` (or `data.length === 0`) means empty account.
- `demo` — `useQuery({ queryKey:["accountDemo"], queryFn:()=>dataProvider
  .currentAccountDemo() })`.
- `seen` — `const [seen] = useStore<boolean>("onboarding.seen", false)`.

**Decision (render OnboardingChoice when ALL hold):**
`childrenCount === 0 && demo === false && seen === false`.
While any read is pending → render `children` (avoid a flash; the shell shows its
own skeletons). Otherwise → `children`.

**Why `seen`, and how it interacts with Clear (critical):**
- Choosing EITHER onboarding option sets `onboarding.seen = true` → the choice
  never loops while the user is mid-setup (e.g. FirstRunSetup before the first
  child exists) or has demo data.
- The demo banner's **Clear** flow resets `onboarding.seen = false` (see B5) so
  that after wiping the account the user lands back on the OnboardingChoice — the
  one place `seen` is intentionally re-armed.

**Store keys (namespace `"onboarding"` / `"tour"`, all under the `"CRM"` store):**
| key | type | meaning | set by | reset by |
|---|---|---|---|---|
| `onboarding.seen` | boolean | choice made / dismissed | OnboardingChoice (both paths) | Clear flow (B5) |
| `onboarding.justSeeded` | boolean | seed just succeeded → auto-start tour | demo path (B3) | Tour on start |
| `tour.completed` | boolean | walkthrough finished/skipped → don't auto-repeat | Tour onDestroyed | Clear flow (B5) |

---

## B3. OnboardingChoice screen — `login/OnboardingChoice.tsx` (new)

Premium welcome echoing the `AuthLayout` aesthetic (centered, calm glass card on
an ambient-glow ground) but rendered INSIDE the authenticated app (no auth
routing). Reuse the exact atmosphere primitives:

- Root: `relative flex min-h-screen ... overflow-hidden bg-background p-6` with
  `style={{ backgroundImage: "var(--wash)" }}`, plus the `AuthBackdrop`
  blobs/vignette from `AuthLayout.tsx` (extract `AuthBackdrop` into a tiny shared
  file `login/AuthBackdrop.tsx` and import it in both, OR duplicate the ~30-line
  block — prefer extraction to stay DRY and under the file ceiling).
- Card: `ql-enter rounded-[20px] border p-7 sm:p-8 bg-[--glass-bg]
  border-[--glass-border] backdrop-blur-[var(--glass-blur)] shadow-lg`, widened
  to `max-w-lg` (two choices need more room than the auth `max-w-md`).
- Header: the `BrandLockup` (or the LedgerMark + wordmark used in FirstRunSetup)
  + a warm one-paragraph intro: *"Welcome to MyShadchan — a calm, private place
  to track every shadchan, suggestion and reference call for your family. How
  would you like to begin?"*

**Two choices** (stacked cards/buttons; PRIMARY visually dominant with the
`--accent-grad-from → --accent-grad-to` gradient + glow, per design-language):

1. **PRIMARY — "Explore with demo data" (recommended)**
   Sub-copy: *"We'll load a realistic sample family — two children, shadchanim,
   suggestions across the whole pipeline, reference calls and reminders — so you
   can see exactly how everything works. You can clear it and start fresh
   anytime."* A small "Recommended" pill.
   On click:
   - set `onboarding.seen = true`;
   - `setSeeding(true)` (button shows `Loader2` spinner + "Loading your sample
     family…"; disable both choices);
   - `await dataProvider.seedDemo()`;
   - on success: set `onboarding.justSeeded = true`, `tour.completed = false`,
     then **invalidate all queries** (`queryClient.invalidateQueries()` — use
     `useQueryClient`) so `children`/`accountDemo`/lists refetch. The gate
     re-evaluates: `demo` becomes `true` → children exist → it renders the shell.
     The Tour auto-start (B4) fires off `onboarding.justSeeded`.
   - on `{ seeded:false }` (account not actually empty): treat as success —
     invalidate + proceed (data is already there).
   - on throw: `notify` a friendly error, re-enable, leave `seen=true` so they
     can retry or pick the other path.

2. **SECONDARY — "Start with my own family"**
   Sub-copy: *"Name your family's record and add your first child. You can invite
   the demo later from Settings if you change your mind."* (No demo-later link
   required this stage; keep copy honest to what exists.)
   On click: set `onboarding.seen = true`, then render `<FirstRunSetup />` inline
   (swap local state `mode: "choice" | "own"`). FirstRunSetup already renders its
   own full-screen container, writes the account name + first child, and
   `navigate("/")`s when done — at which point `hasChildren` is true and the gate
   passes through to the shell. (No new route; FirstRunSetup stays a component.)

Respect `prefers-reduced-motion` (the `ql-enter` / blob drift already freeze via
`index.css`). Mobile: single column, generous spacing, buttons full-width.

---

## B4. Clickable walkthrough (driver.js) — `tour/` module (new)

`npm install driver.js`. New folder `src/components/atomic-crm/tour/`:

- **`tour.css`** — restyle the driver.js popover + overlay to Quiet Luminance in
  BOTH themes using tokens only. Target driver.js classes:
  `.driver-popover` → `background: var(--glass-bg)`, `border:1px solid
  var(--glass-border)`, `backdrop-filter: blur(var(--glass-blur))`,
  `border-radius:16px`, `box-shadow: var(--shadow-lg)` / glow, `color:
  var(--foreground)`; `.driver-popover-title` → `font-display`, semibold;
  `.driver-popover-description` → `text-muted-foreground` size; buttons
  (`.driver-popover-next-btn`) → primary gradient (`--accent-grad-from/to`) +
  `--primary-foreground`; `.driver-popover-prev-btn`/close → secondary/ghost;
  `.driver-popover-progress-text` → muted; the overlay
  (`.driver-overlay`/stage) → tuned so the dark scrim reads calm not harsh
  (`color-mix` on `--background`). Dark theme is the default via
  `@media (prefers-color-scheme)`/`.dark` — but since all values are tokens that
  already flip per theme, one rule set covers both. Import `./tour.css` from the
  tour module (or `App.tsx`).
- **`tourSteps.ts`** — the ordered step list (below), each `{ element:
  '[data-tour="…"]', popover: { title, description, side, align } }`. Plain,
  warm, non-technical copy (audience = a parent, not a developer).
- **`useTour.ts`** — a hook exposing `startTour()`. Builds the `driver({...})`
  instance with: `showProgress:true`, `allowClose:true`, `nextBtnText:"Next"`,
  `prevBtnText:"Back"`, `doneBtnText:"Done"`, `progressText:"{{current}} of
  {{total}}"`, `animate: !prefersReducedMotion`, `smoothScroll:
  !prefersReducedMotion`, `overlayClickBehavior:"close"`. `onDestroyed` (fires on
  Done AND Skip/close) → set `tour.completed = true`. Reads
  `window.matchMedia("(prefers-reduced-motion: reduce)")`.
- **Cross-route navigation.** The tour auto-starts on the dashboard (`/`) after
  seeding. Board anchors live on `/shidduchim`. Use `useNavigate()` inside
  `useTour` and, on the LAST dashboard step, a per-step
  `onNextClick: () => { navigate("/shidduchim"); requestAnimationFrame(() =>
  setTimeout(() => driverObj.moveNext(), reducedMotion ? 0 : 350)); }` so the
  board has mounted before the next element is highlighted. Keep board steps
  contiguous so only ONE navigation happens. The demo banner + sidebar are global
  (present on every route), so the closing steps need no return navigation.
  Guard each step: if `document.querySelector(step.element)` is missing at
  highlight time, driver.js skips gracefully — acceptable, but the single delayed
  navigation above makes it reliable in practice.

**Auto-start wiring:** a small `<TourAutostart/>` effect mounted in the shell
(e.g. inside `Layout`/`MobileLayout`, below the gate) reads
`onboarding.justSeeded`; when true AND `tour.completed` is false, it clears
`justSeeded`, waits one tick for the dashboard to render, and calls
`startTour()`. Also expose `startTour()` to the demo banner (B5) for the "Take
the tour" button (re-launchable regardless of `tour.completed`).

**Step list (auto-tour order) — targets + copy:**

| # | `data-tour` target | title | description (plain-language) |
|---|---|---|---|
| 1 | `demo-banner` | You're exploring a sample family | "Everything you see is realistic demo data — nothing here is real. This tour shows you around; you can clear the sample anytime from this banner." |
| 2 | `nav-dashboard` | Your dashboard | "Your calm home base — a snapshot of where every child's shidduchim stand, and what needs your attention." |
| 3 | `nav-pipeline` | The pipeline | "Every suggestion for a child, organized from a new redt all the way to a decision." |
| 4 | `nav-shadchanim` | Shadchanim | "Everyone redting for your family, and how responsive each one has been." |
| 5 | `nav-references` | References | "The people you call to check into a suggestion — with every call logged in one place." |
| 6 | `nav-reminders` | Reminders | "Follow-ups and calls you don't want to forget, so nothing slips." |
| 7 | `child-switcher` | Switch between children | "Redting for more than one child? Switch here — every screen updates to the child you pick." |
| 8 | `pipeline-snapshot` | Where things stand | "One glance shows how this child's suggestions are spread across the pipeline." |
| 9 | *(navigate → /shidduchim, then)* `pipeline-board` | The board | "Each column is a stage. Drag a card from one column to the next to move a suggestion along — that's how you record a decision." |
| 10 | `pipeline-column` | A stage | "This column holds every suggestion currently at this stage for the child." |
| 11 | `pipeline-card` | A suggestion | "Each card is one redt. Click it to see the full story — the shadchan, references, notes and reminders." |
| 12 | `add-suggestion` | Add a suggestion | "Got a new redt? Add it here and it lands at the start of the pipeline." |
| 13 | `demo-banner` | Ready when you are | "When you're ready to start with your own family, clear the sample from here — you'll get a fresh, empty account. Enjoy exploring!" |

> "State control" (brief) is covered by step 9's drag explanation (the board IS
> the state control) plus step 11 pointing at the card's detail. A
> `data-tour="state-control"` anchor is ALSO added to `ShidduchStateControl`
> (show drawer) so a future on-that-screen step can target it, but the
> auto-tour stays on the board route to avoid drawer/route fragility.

Settings nav (`nav-settings`) gets a `data-tour` anchor for completeness but is
omitted from the auto-tour to keep it tight; add a step only if it reads better.

---

## B5. Full-width demo banner — `layout/DemoBanner.tsx` (new)

**Visibility:** render when `dataProvider.currentAccountDemo()` is true (shared
`useQuery(["accountDemo"])` — same key the gate uses, so it's one fetch).
Mounted in BOTH `Layout` and `MobileLayout` as the FIRST element of the shell
(above sidebar/topbar / above `children`).

**Placement that pushes content down, never overlaps** (Sidebar is `fixed`,
TopBar is `sticky top-0` — so a naive banner would be overlapped). Design:
- Banner is `position: sticky; top: 0; z-40` and **in normal flow** as the first
  child of the layout root → it reserves its own height (pushes the column down)
  AND stays pinned on scroll.
- Introduce a CSS var `--banner-h` (default `0px`, e.g. on the layout root).
  When the banner renders, measure its height with a `ref` + `ResizeObserver`
  and set `--banner-h` on the layout root via inline style (handles the taller
  wrapped banner on mobile). Fallback constant (e.g. `44px`) before measure.
- Adjust the two chrome offsets to consume the var (both default to 0 → **zero
  layout change when no banner**, satisfying "don't disturb their layout"):
  - `Sidebar.tsx`: change `inset-y-0` → `bottom-0 top-[var(--banner-h,0px)]`.
  - `TopBar.tsx`: change `top-0` → `top-[var(--banner-h,0px)]`.
- Mobile: banner spans full width above `children`; `MobileNavigation` is a
  bottom bar (unaffected). No sidebar on mobile, so only the banner height
  matters — content already flows below it.

**Appearance (amber `--attention`, warm not alarming):** a soft
`--attention`-tinted surface (`color-mix(in oklch, var(--attention) …)` bg + a
subtle bottom border/glow), amber icon (`Sparkles` or `Info`), foreground text
with AA contrast in both themes. Left: text *"You're exploring demo data —
nothing here is real."* Right: two actions.

**Actions:**
1. **"Take the tour"** (secondary/ghost) → calls `startTour()` from `useTour`
   (re-launchable even if `tour.completed`).
2. **"Clear it & start fresh"** (primary) → opens a confirm dialog
   (`@/components/ui/alert-dialog` or `dialog`): title *"Clear the sample data?"*,
   body *"This deletes the demo family and everything in it, and gives you a
   fresh, empty account to start with. This can't be undone."*, cancel + a
   confirm button. On confirm:
   - `setClearing(true)` (spinner, disable);
   - `await dataProvider.clearDemo()`;
   - on success: reset client state so the user lands on the OnboardingChoice —
     set `onboarding.seen = false`, `tour.completed = false`, remove
     `onboarding.justSeeded`; then `queryClient.invalidateQueries()` (refetch
     `children` → empty, `accountDemo` → false). The gate re-evaluates:
     `childrenCount===0 && !demo && !seen` → OnboardingChoice renders. (A full
     `window.location.reload()` is an acceptable simpler fallback if query
     invalidation proves flaky, but prefer the reactive path.)
   - on throw: `notify` friendly error, re-enable, keep the banner.

**Mobile-responsive:** on narrow widths the banner stacks (text line, then the
two actions in a row); actions remain reachable; `ResizeObserver` keeps
`--banner-h` correct as it wraps.

**Anchor:** the banner root carries `data-tour="demo-banner"` (tour steps 1 & 13).

---

## B6. data-tour anchors — exact placement (no layout disturbance)

Additive `data-tour` attributes only; no structural/style changes.

- **`layout/navItems.ts`** — add a `tourId` field to `NavItem`
  (`"dashboard"|"pipeline"|"shadchanim"|"references"|"reminders"|"settings"`) on
  each of the 6 entries.
- **`layout/Sidebar.tsx`** — in `SidebarLink`, spread `data-tour={`nav-${item.tourId}`}`
  onto the `<Link>`. (Mobile parity: add the same to `MobileNavigation`'s links
  if the tour must run on mobile — optional; the auto-tour is primarily a desktop
  experience. At minimum ensure the anchors exist on whichever nav is visible.)
- **`layout/TopBar.tsx`** — `data-tour="child-switcher"` on the
  `DropdownMenuTrigger` `<button>` in `ChildSwitcherPill`.
- **`shidduchim/ShidduchimList.tsx`** — in `ShidduchimActions`, wrap the
  `CreateButton` in `<span data-tour="add-suggestion">…</span>` (CreateButton is
  an admin component; wrapping avoids modifying it).
- **`shidduchim/ShidduchimListContent.tsx`** — `data-tour="pipeline-board"` on
  the `<div className="flex gap-4 overflow-x-auto pb-5">` inside `DragDropContext`.
- **`shidduchim/ShidduchColumn.tsx`** — add optional prop `tourAnchor?: boolean`;
  when true, put `data-tour="pipeline-column"` on the `<section>`. Pass
  `tourAnchor={index === 0}` from the `PIPELINE_STATES.map` in
  `ShidduchimListContent`.
- **`shidduchim/ShidduchCard.tsx`** — add optional prop `tourAnchor?: boolean`;
  when true, `data-tour="pipeline-card"` on the card root. Pass
  `tourAnchor={index === 0}` from `ShidduchColumn`'s `shidduchim.map` (first card
  of the anchored first column). (If the first column is empty in demo data, the
  card step self-skips; acceptable. Demo data guarantees populated columns.)
- **`dashboard/PipelineSnapshot.tsx`** — `data-tour="pipeline-snapshot"` on the
  outer `<Card>`.
- **`shidduchim/ShidduchStateControl.tsx`** — `data-tour="state-control"` on the
  `<section>` (not in the auto-tour; anchor kept for future/re-launch use).

---

## B7. File-touch checklist (Stage B)

New files:
- `src/components/atomic-crm/root/OnboardingGate.tsx`
- `src/components/atomic-crm/login/OnboardingChoice.tsx`
- `src/components/atomic-crm/login/AuthBackdrop.tsx` (extracted from AuthLayout)
- `src/components/atomic-crm/layout/DemoBanner.tsx`
- `src/components/atomic-crm/tour/tour.css`
- `src/components/atomic-crm/tour/tourSteps.ts`
- `src/components/atomic-crm/tour/useTour.ts`
- `src/components/atomic-crm/tour/TourAutostart.tsx`

Edited files:
- `providers/supabase/dataProvider.ts` — add `seedDemo`/`clearDemo`/`currentAccountDemo`.
- `providers/fakerest/dataProvider.ts` — add the three stubs.
- `layout/Layout.tsx` — wrap in `<OnboardingGate>`, mount `<DemoBanner>` +
  `<TourAutostart>`, set `--banner-h` on root.
- `layout/MobileLayout.tsx` — same wrap/mount for mobile.
- `layout/Sidebar.tsx` — `data-tour` on nav links; `top-[var(--banner-h,0px)]`.
- `layout/TopBar.tsx` — `data-tour="child-switcher"`; `top-[var(--banner-h,0px)]`.
- `layout/navItems.ts` — add `tourId`.
- `layout/MobileNavigation.tsx` — optional `data-tour` parity.
- `login/AuthLayout.tsx` — import extracted `AuthBackdrop`.
- `shidduchim/ShidduchimList.tsx`, `ShidduchimListContent.tsx`,
  `ShidduchColumn.tsx`, `ShidduchCard.tsx`, `ShidduchStateControl.tsx` — anchors.
- `dashboard/PipelineSnapshot.tsx` — anchor.
- `package.json` / lockfile — `driver.js`.

Keep every file ≤ ~400 lines (the tour module split above respects this).

---

## B8. Local verification (the whole flow — critical)

Dev server `http://localhost:5173`. Local edge runtime serves
`seed_demo`/`clear_demo` (if functions are changed/relocated:
`docker restart supabase_edge_runtime_atomic-crm-demo`). Account 1
(`test@local.dev` / `testpass123`) currently has demo data + `demo=true`.

1. **Banner** — sign in as `test@local.dev` → the full-width **demo banner**
   shows at the very top, pushing sidebar+topbar down (no overlap). Screenshot
   light + dark → `…/scratchpad/demoux-banner-{light,dark}.png`.
2. **Tour** — click "Take the tour" → step through; screenshot a couple of steps
   showing the highlighted element + the Quiet-Luminance popover →
   `demoux-tour-{step1,board}.png`. Confirm popover glass/indigo styling + both
   themes, and that reduced-motion disables animation.
3. **Clear** — click "Clear it & start fresh" → confirm dialog → confirm →
   account empties, banner disappears, the **OnboardingChoice** screen appears →
   `demoux-onboarding-choice.png`.
4. **Re-seed** — click "Explore with demo data" → spinner → data + banner return,
   **tour auto-starts** → `demoux-reseeded.png`.
5. `make typecheck` passes. **Do NOT git commit.** LOOK at every screenshot.

Notes: `seed_demo`'s empty guard means re-seeding a non-empty account no-ops
(200 `seeded:false`) — the UI treats that as success. `handle_new_user` only
grants a membership to the FIRST signup, so brand-new local users have no account
and can't seed — always test via clear+re-seed on account 1.

---

## B9. Security / rules bar (Stage B)

- Touches auth-adjacent flows + a destructive action (Clear) → the destructive
  path is fully server-guarded by Stage A (`clear_demo` resolves the account
  server-side, RLS-scoped, per-statement `account_id` filter). The frontend only
  invokes it behind an explicit confirm dialog. Flag SECURITY-REVIEWER per
  `.claude/rules/security-triggers.md` (auth + destructive DB call).
- No new user-input surface beyond the confirm click (empty request bodies).
- `current_account_demo` fails soft (no banner) on error — never blocks the app.
- English-only across all copy; tokens-only styling; both themes AA; files ≤400
  lines; `make typecheck` green; **no git commit, no deploy**.
