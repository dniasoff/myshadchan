# Story 8.3: In-platform redting through a connection

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want to send a suggestion into a connected family's pipeline from inside the platform,
so that redting happens here instead of over WhatsApp with nothing recorded on either side.

## Position in Epic 8

**3rd of 5.** Depends on **8.2**'s connection workflow (accepted `connections` rows — table
from Epic 7 Story 7.4 — and the auto-linked `shadchanim` row acceptance creates). Feeds
**8.4**'s negative tests (which assert the write boundary this story creates cannot be
crossed) and **8.5** (which places the "Send a redt" action on the Connection 360).

## The key design decision: the shadchan never calls `create_shidduch()`

AD-4 requires **one** `createSuggestion()` service as the sole `INSERT` path into `shidduchim`,
and it already exists as `public.create_shidduch()` (`supabase/schemas/02_functions.sql`), called
directly by the household member from `inbox/InboxResolveDialog.tsx` today. That function derives
`account_id` from the **caller's own** `current_context_id()` — correct for a household member
filing their own capture, but a shadchan's `current_context_id()` is their **own** shadchanus
account, never the household's. Extending `create_shidduch()` to accept a foreign target account
would mean either trusting a client-supplied account id (a cross-tenant write vector) or
duplicating its entire validation surface behind a role branch — exactly the kind of divergent
second path AD-4 forbids.

**Resolution:** a shadchan's redt is inbound capture, like every other channel (AD-6: "every
channel converges on one `inbox_item`"). It lands as an `inbox_items` row scoped to the
**household's** account (written by a new, narrowly-scoped `SECURITY DEFINER` function, since the
shadchan cannot write there directly), and the household resolves it through the **same**
`InboxResolveDialog` → `create_shidduch()` path any WhatsApp forward goes through today — no
change to `create_shidduch()`'s security model, no second creation path. This is also the literal
reading of AD-7: "all inbound, including shadchan-originated, enters via the confirm step."

## Acceptance Criteria

1. **A shadchan can send a redt only through an accepted connection.** Calling the new redt
   function with a connection that is not `status = 'accepted'`, or where the caller is not an
   active member of that connection's `shadchanus_account_id`, is rejected and creates nothing.
2. **It arrives as an unfiled inbox item, attributed, never auto-filed.** The item lands in
   `inbox_items` with `source = 'shadchan'`, `account_id` = the connection's household, and
   `status = 'unresolved'` — indistinguishable in kind from any other channel's capture except
   for its source and attribution.
3. **The parent sees who sent it.** The inbox item's `sender` shows the connected shadchan's
   account name, and resolving it pre-fills (and locks) the `shadchan_id` field to the
   `shadchanim` row `Story 8.2` linked to that connection — the household cannot accidentally
   attribute the redt to a different book entry.
4. **It enters the family's confirm step, exactly like any other capture.** Resolving the item
   calls the existing `create_shidduch()` with `origin = 'shadchan'` (never `'channel'` or
   `'manual'` for a shadchan-sourced item) and the pipeline starts at `new`, same as every other
   origin — there is no fast path to `look_into` or beyond.
5. **The shadchan retains their own durable record of what they sent, without reading the
   household's data.** The redt also creates a connection-scoped conversation record (Epic 7
   `threads`) that the shadchan can read going forward — never the `inbox_items` row itself
   (household-scoped, unreachable to them per AD-20) and never the resulting `shidduchim` row's
   pipeline state.
6. **Verification — negative tests, at the database.**
   - A shadchan with no accepted connection to household A cannot create an inbox item in A.
   - A shadchan whose connection to household A has `status = 'ended'` cannot create a new one
     (existing items are untouched — ending a connection is not retroactive, per Story 8.2 Dev
     Notes).
   - Shadchan S2 (connected to household A via a different connection) cannot use S1's
     `connection_id` to redt into A even if S2 somehow learns the id.
   - The created `inbox_items` row is invisible to any household other than the connection's
     own (existing `inbox_items` RLS already guarantees this — the test asserts it still holds
     with the new `source` value and the new `connection_id` column present).

## Tasks / Subtasks

- [x] **Task 1 — Schema** (AC: 1, 2, 5)
  - [x] `supabase/schemas/01_tables.sql`: extend `inbox_items.source`'s check constraint to add
        `'shadchan'` (today: `('whatsapp', 'sms', 'email', 'photo', 'upload')`).
  - [x] Add `connection_id bigint references public.connections(id)` to `inbox_items` (nullable).
        **This is a provenance foreign key, not a second RLS scoping axis** — `inbox_items`
        remains scoped by `account_id` alone (AD-1's "exactly one axis" is about which column
        RLS keys on, not about whether a row may carry an unrelated FK for attribution, exactly
        as `shidduchim.shadchan_id` already references another account-scoped table without
        being a second scope). State this explicitly in the migration comment to pre-empt a
        reviewer flagging an AD-1 violation.

- [x] **Task 2 — `redt_via_connection()`** (AC: 1, 2, 3, 5)
  - [x] Add, `SECURITY DEFINER`, `SET search_path = ''`, following the `handle_new_user()`
        precedent cited in Story 8.2 Dev Notes for the cross-account write:
    ```sql
    create or replace function public.redt_via_connection(
        p_connection_id bigint,
        p_subject text,
        p_raw_text text,
        p_attachments jsonb default null
    ) returns public.inbox_items
        language plpgsql
        set search_path = ''
        security definer
    as $$
    declare
      v_connection public.connections;
      v_shadchan_name text;
      v_row public.inbox_items;
    begin
      select * into v_connection from public.connections
        where id = p_connection_id and status = 'accepted';
      if v_connection is null then
        raise exception 'connection % is not an active connection', p_connection_id;
      end if;

      if not exists (
        select 1 from public.account_members am
        where am.account_id = v_connection.shadchanus_account_id
          and am.user_id = auth.uid() and am.status = 'active'
      ) then
        raise exception 'caller is not an active member of this connection''s shadchanus context';
      end if;

      select name into v_shadchan_name from public.accounts
        where id = v_connection.shadchanus_account_id;

      insert into public.inbox_items (
        account_id, source, subject, raw_text, sender, attachments, status, connection_id
      ) values (
        v_connection.household_account_id, 'shadchan', p_subject, p_raw_text,
        v_shadchan_name, p_attachments, 'unresolved', p_connection_id
      )
      returning * into v_row;

      -- Task 3: mirror this redt into a connection-scoped thread (Epic 7 shape)
      -- so the shadchan retains their own record (AC-5, FR112).

      return v_row;
    end;
    $$;
    ```
    The membership check deliberately does **not** further restrict by `role = 'shadchan'` —
    matching the existing precedent that `create_shidduch()` does not role-gate beyond account
    membership either (see `supabase/schemas/02_functions.sql`, `create_shidduch`); any active
    member of the shadchanus account may act for it, consistent with how any active member of a
    household may currently create a shidduch for it.
  - [x] `grant execute on function public.redt_via_connection to authenticated;` in
        `06_grants.sql`, matching the existing grant pattern for `create_shidduch`. **Never**
        grant to `anon` — sending a redt requires an authenticated, connected shadchan (AD-1).

- [x] **Task 3 — Thread mirroring** (AC: 5)
  - [x] Epic 7 has necessarily landed by this story's turn (pinned order; 8.2 already builds on
        7.4's `connections` table). Inside `redt_via_connection()`'s transaction:
        1. Create the thread via `public.create_thread(p_subject_type := 'relationship',
           p_connection_id := p_connection_id, p_participant_member_ids := <household's active
           member ids>)` (`02_functions.sql`) — the ONE thread-creation function (7.1's, widened
           by 7.4 to accept `p_connection_id`), never a second bespoke `insert into
           public.threads`. It is `SECURITY DEFINER` and plain `plpgsql`-callable from inside
           this function's own body (`select public.create_thread(...) into v_thread`); it
           already inserts the creator (the calling shadchan, via `current_member_id()`) as a
           participant, so `p_participant_member_ids` only needs the household's ACTIVE
           `account_members` ids (`select id from public.account_members where account_id =
           v_connection.household_account_id and status = 'active'`) — that satisfies AC-5's
           "own durable record" for the shadchan and gives the household side the same thread
           from the start (open by default, per 7.2's `default_thread_visibility`).
        2. There is no `create_message()`/`send_message()` RPC anywhere in the shipped schema —
           `public.messages` grants `insert` directly to `authenticated`, gated only by its own
           RLS ("Messages insertable by an existing participant", `05_policies.sql`), so the
           initial message (`thread_id := v_thread.id, connection_id := p_connection_id,
           account_id := null, sender_member_id := current_member_id(), body := p_raw_text`) is
           necessarily a **direct** `insert into public.messages`, mirroring the exact shape a
           client insert would use — not a fallback path, the only path. Say so in a code
           comment so a reviewer does not go looking for a message-creation function to reuse.
        Without the mirror, AC-5 fails: the shadchan would have zero record of their own redt.

- [x] **Task 4 — Household-side resolve flow** (AC: 3, 4)
  - [x] `inbox/inboxMeta.ts`: add a `shadchan` entry to `INBOX_SOURCE_META` (icon + label —
        reuse an existing Lucide icon already imported elsewhere for a person/handshake concept,
        do not add a new icon dependency for one entry). The label goes through the
        `i18nProvider` (AD-18), key added to both `providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts` — the shipped second catalogue is French (Story 8.1 Dev Notes).
  - [x] `inbox/InboxResolveDialog.tsx`: the `origin` passed into `CreateShidduchInput` (hardcoded
        `"channel"` in the `onSubmit` handler today) becomes
        `item.source === "shadchan" ? "shadchan" : "channel"`. `shidduchim`'s existing
        `origin` check constraint already allows `'shadchan'` — no schema change for AC-4.
  - [x] When `item.source === "shadchan"`: resolve the linked `shadchanim` row via
        `shadchanim.connection_id = item.connection_id` and pass it as the form's initial
        `shadchan_id`, **disabled** (not just defaulted) in `ShidduchInputs` for this case — the
        household must not be able to re-attribute a shadchan-sourced redt to a different book
        entry. `ShidduchInputs` needs a new optional prop (e.g. `lockedShadchanId`) — check its
        current prop shape before adding one; do not duplicate the component for this one
        difference.
  - [x] `item.sender` (already rendered somewhere in the resolve dialog / inbox list per existing
        `INBOX_SOURCE_META` usage) needs no new plumbing — Task 2 already populates it with the
        shadchan's account name.

- [x] **Task 5 — Types and dataProvider** (AC: 2, 3)
  - [x] `types.ts`: `InboxItem.source` union gains `"shadchan"`; add `InboxItem.connection_id?:
        Identifier`.
  - [x] `providers/supabase/dataProvider.ts`: add `redtViaConnection(input)` to the
        custom-methods overlay, mirroring `createShidduchViaRpc` (same file) exactly
        (destructure `{ data, error }` from
        `getSupabaseClient().rpc("redt_via_connection", {...})`, log+throw on error).
  - [x] Mirror in `providers/fakerest/` (AD-10): extend the FakeRest `inbox_items` emulation and
        add a `redtViaConnection` fake that validates the same connection-status/membership
        rules in-memory (do not silently accept any input in demo mode — the guard rails are
        part of what a reviewer/demo user should be able to see fail correctly).

- [x] **Task 6 — Shadchan-side compose UI** (AC: 1, 2, 3)
  - [x] Add `connections/RedtComposeDialog.tsx` (the `connections/` folder exists since Story
        8.1): a form with `subject` and `raw_text` fields plus optional attachment upload,
        calling `dataProvider.redtViaConnection({ connectionId, subject, rawText,
        attachments })` on submit. **This story owns the dialog component; Story 8.5 owns where
        it is launched from** (a button on the Connection 360). All labels/placeholders/errors
        through the `i18nProvider` (AD-18), keys in both `englishCrmMessages.ts` and
        `frenchCrmMessages.ts`.
        **Deviation**: no working attachment-upload control is wired — see Completion Notes.

- [x] **Task 7 — Negative-test suite** (AC: 6)
  - [x] New `supabase/tests/shadchan_redting.sql` + `.test.ts`, same `results`/`ids` temp-table
        convention as `supabase/tests/references_entity.sql`. Cover: (a) no accepted connection
        ⇒ rejected, no row; (b) ended connection ⇒ rejected; (c) S2 cannot use S1's
        `connection_id`; (d) the created `inbox_items` row is invisible to household C reading
        as themselves — write this cross-tenant assertion in this suite (no `inbox_items` SQL
        suite exists at Epic 8's point in the sequence; Epic 10 adds the general one later),
        with a `source = 'shadchan'` row present, to prove the new column/value doesn't loosen
        anything.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db` (needs
        `make start`), plus scoped `prettier --check` on this story's changed files.

## Dev Notes

### Why the shadchan never sees the household's chosen single

`inbox_items.child_id`/`single_id` is nullable by design (unlike `shidduchim.single_id`, which is
`NOT NULL`) — precisely because a channel-sourced capture arrives before anyone has said which
single it concerns. `redt_via_connection()` deliberately leaves it null: the shadchan describes
the candidate in free text (`p_subject`/`p_raw_text`), exactly as a forwarded WhatsApp message
does today, and the household resolves "which of my singles is this for" during the existing
confirm step. This also sidesteps a real access problem: the shadchan has no read path into the
household's `singles` table (AD-20), so they could not supply a valid `single_id` even if the
column were writable.

### Thread mirroring rides Epic 7, not a bespoke table

Story 8.4's AC ("a shadchan sees only the interaction and suggestion threads they are party to")
and FR112 ("a shadchan tracks their own conversations in their own context") are only satisfiable
if the shadchan has *some* connection-scoped record of what they sent — otherwise sending a redt
would give them literally nothing to look at afterward. That record is Epic 7's `threads`
(7.1's model, 7.4's `connection_id` axis), never a bespoke Epic-8 table (reuse, do not
reinvent — `.claude/rules/coding-style.md` DRY). Note for the epic owner (repeated in the
story-writing report): epics.md's coverage row for Epic 8 lists only "FR108–113, AD-4, AD-7" —
the AD-22/Epic-7 dependency this story rides is real but unstated there.

### Architecture citations

- **AD-4**: "One `createSuggestion()` service = the sole INSERT path... a connected shadchan
  redts into a household by calling the same `createSuggestion()`... The resulting suggestion is
  owned by the household; only the conversation about it is connection-scoped (AD-20)." This
  story's resolution (shadchan → `inbox_items` → household member → `create_shidduch()`) is what
  makes "the same `createSuggestion()`" literally true: there is still exactly one code path that
  ever inserts into `shidduchim`, and this story adds no second one.
- **AD-6**: "every inbound creates an `inbox_item` (unfiled), then flows through
  `createSuggestion()` only after human review/confirm... Channel-derived identity is untrusted →
  may create only an unfiled `inbox_item`." A shadchan's redt is treated as exactly this kind of
  untrusted channel input with respect to *which single it concerns* — trusted only for its own
  attribution (the connection proves who sent it), never for filing decisions.
- **AD-7**: "all inbound, including shadchan-originated, enters via the confirm step" — literal
  textual basis for Task 4.
- **AD-1**: `inbox_items.connection_id` is a plain FK, not a second scoping axis (see Task 1).

### Current-state grounding

- `create_shidduch()` (`supabase/schemas/02_functions.sql`) derives `account_id` from the
  caller via `current_context_id()` (post-Epic-2 name for what is `current_account_id()`
  today) — never a parameter; this story relies on that remaining true and does not touch the
  function.
- `inbox/InboxResolveDialog.tsx` (176 lines) already implements the confirm-step UI this story
  extends: it hardcodes `origin: "channel"` and collects `shadchan_id` from a form field today —
  both are the exact two things Task 4 changes.
- `createShidduchViaRpc` in `providers/supabase/dataProvider.ts` is the pattern Task 5's
  `redtViaConnection` follows.

### Dependencies

- **Story 8.2** (the connection workflow + the auto-linked `shadchanim` row) — hard
  prerequisite for Tasks 1–2.
- **Epic 7 Stories 7.1/7.4** (thread model + the `connection_id` scope axis, AD-22) — hard
  prerequisite for Task 3 / AC-5; guaranteed landed by the pinned epic order. Unstated in
  epics.md's Epic 8 coverage row — see "Thread mirroring rides Epic 7" above.
- **Epic 1** naming (`single_id`, `create_shidduch`'s renamed parameter) must have landed.

### Testing standard

SQL negative-test suite per `.claude/rules/testing.md` / `.claude/rules/security-triggers.md`.
Frontend changes (Task 4, 6) get Vitest component tests (AAA) covering: origin selection logic,
the locked `shadchan_id` field when `source === 'shadchan'`, and the compose dialog's submit path.

### Project Structure Notes

New: `supabase/tests/shadchan_redting.sql` + `.test.ts`, `connections/RedtComposeDialog.tsx`
(+ `.test.tsx`). Modified: `inbox/inboxMeta.ts`, `inbox/InboxResolveDialog.tsx`,
`shidduchim/ShidduchInputs.tsx` (new prop), `types.ts`, both dataProviders,
`providers/commons/englishCrmMessages.ts` / `frenchCrmMessages.ts` (new inbox-source label +
compose-dialog copy).

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (dispatched as the `developer` role, STACK_ID=1, STACK_OWNER=8-3-in-platform-redting).

### Debug Log References

- `redt_via_connection()`'s Task 3 code block as given (`select public.create_thread(...) into
  v_thread;`) reproducibly raised `invalid input syntax for type bigint` against
  `create_thread()`'s own composite return value, isolated with a throwaway `pg_temp` function
  against a minimal fixture (a real household + shadchanus + accepted connection). `create_thread()`
  itself always succeeded (its row is visible, serialized, inside the error text) — the failure is
  specifically in assigning a composite-returning **named-parameter** call via `select … into` on
  this Postgres version. Fix: plain PL/pgSQL assignment (`v_thread := public.create_thread(...);`),
  confirmed working in the same isolated repro and in the full function. Documented inline at the
  call site so a future reader does not "fix" it back to `select … into`.
- Confirmed the negative-test suite is load-bearing, not decorative: mutated the AC-1 membership
  check (`if not exists (...)` → `if false`) via a throwaway migration, re-ran
  `shadchan_redting.sql` — exactly one check failed (AC-6(c), the one that names this exact
  invariant) — then reverted the mutation and the throwaway migration and reset the local DB.
- `supabase db diff --local` did not re-emit `redt_via_connection`'s grant/revoke statements for
  the brand-new function (matching this repo's known gap for views' `security_invoker`/grants —
  see the generated migration's own comment) — hand-added, then verified `db diff --local` clean
  twice more.
- The FakeRest integration test (`dataProvider.redtViaConnection.test.ts`) initially asserted
  against the seed `db` object directly after constructing the provider; `ra-data-fakerest` does
  not keep that reference live once `createDataProvider()` runs, so post-construction reads/writes
  against the raw `db` silently went stale (mirrors the existing convention in
  `dataProvider.threadsConnectionAxis.test.ts`, which reads/writes exclusively through the
  `dataProvider` itself for this reason). Rewrote every post-condition assertion to go through
  `dataProvider.getList`/`getOne`/`endConnection`.

### Completion Notes List

- All 6 ACs implemented and covered by the new `supabase/tests/shadchan_redting.sql` suite (20
  checks, all passing) plus FakeRest parity tests
  (`providers/fakerest/dataProvider.redtViaConnection.test.ts`,
  `providers/fakerest/internal/redting.test.ts`) and component tests
  (`connections/RedtComposeDialog.test.tsx`).
- **Deviation from Task 1's literal text**: `connection_id`'s `references public.connections(id)`
  could not be declared inline on `inbox_items`' `CREATE TABLE` — `connections` is declared
  *later* in `01_tables.sql` (line ~860 vs. `inbox_items`' ~529), so an inline FK would fail at
  schema-load time. Followed the file's own existing precedent
  (`shadchanim_connection_id_fkey`, same file): the column is declared plain `bigint` in the
  `CREATE TABLE`, and the FK is added via a deferred `alter table … add constraint …` placed
  immediately after `connections` exists (right next to `shadchanim_connection_id_fkey`, since
  both are connection-derived provenance FKs). Functionally identical outcome, same NOT NULL/
  cascade posture the story asked for (none — a `connections` row is never deleted).
- **Deviation from Task 6's literal text**: `RedtComposeDialog.tsx` does **not** wire a working
  attachment-upload control, though the RPC/dataProvider method both accept `attachments` end to
  end. Investigated the `attachments` storage bucket's RLS (`07_storage.sql`, outside this
  story's declared file set): every policy scopes strictly to `current_context_id()` (the
  *uploader's own* active account), with no connection-axis carve-out — an object a shadchan
  uploaded under their own account id would be permanently unreadable by the household reading
  under theirs. Shipping an upload control against that policy would produce links that silently
  never resolve for the recipient, which is worse than omitting the control. The dialog always
  sends `attachments: null`; the capability is real (RPC parameter, dataProvider parameter, both
  mirrors) so wiring a real upload UI later is additive, not a schema change. Flagged for the
  epic owner / Story 8.4-8.5: closing this needs a `07_storage.sql` policy change (connection-
  scoped read) that is out of this story's scope.
- `ShidduchInputs`'s `lockedShadchanId` lock is a native `<fieldset disabled>` around the
  existing `ReferenceInput`/`AutocompleteInput` pair, not a new prop on `AutocompleteInput`
  itself: `@/components/admin/autocomplete-input` (a mutable dependency this story does not own)
  plumbs no `disabled`/`readOnly` prop through to its popover trigger today, and the native
  fieldset-disable cascade reaches that trigger without needing one.
- `InboxResolveDialog.tsx`'s locked-shadchan lookup (`useGetList("shadchanim", {filter:
  {connection_id: item.connection_id}}, {enabled: ...})`) gates the `<Form>` mount behind its own
  `isPending` — React Hook Form's `defaultValues` are captured once, at mount, so rendering the
  form before the async lookup resolves would either show it briefly unlocked or need a second
  `setValue`/reset call; waiting is simpler and matches AC-3's "cannot be changed here" literally
  from the first paint.
- `INBOX_SOURCE_META`'s existing five entries stayed plain literal strings (their pre-existing,
  never-localized shape) rather than being converted to i18n keys — `InboxList.tsx` (outside this
  story's declared file set) renders `meta.label` verbatim with no `translate()` call, so turning
  the map's values into i18n *keys* would have shown a raw key string there. Instead
  `InboxResolveDialog.tsx` (a file this story owns) calls
  `translate(\`crm.inbox.source_${item.source}\`, { _: meta.label })` for every source, so the new
  `shadchan` entry gets real English/French catalogue copy while the other five keep rendering
  their unchanged literal text everywhere, including in French (no regression, no scope creep
  into `InboxList.tsx`).
- Could not extend `supabase/tests/migration-data-safety/fixture.sql` to seed an `inbox_items`
  row (outside this story's declared file set — `supabase/tests/shadchan_redting.sql`/`.test.ts`
  are the only `supabase/tests/` paths owned here). Not believed to be load-bearing: the
  migration only ADDS a nullable column and WIDENS a check constraint (adds an allowed value) —
  neither drops, narrows nor renames anything, so no pre-existing row of any shape can be broken
  by it, unlike the `invites` fixture-blindness precedent (a narrowing change the fixture missed).
  `make check-migration-safety` passed. Flagging for the epic owner in case a future story wants
  the fixture widened anyway, defense-in-depth.
- Real gate output (see agent's final report to the orchestrator for full transcripts):
  `make typecheck` clean, `make lint` clean (ESLint + Prettier), `npx vitest run` — 250 files /
  2897 tests passed (includes the new suites), `make build` succeeded, `npx prettier --check .`
  clean on every file this story touched (16 pre-existing, unrelated warnings on doc/workflow
  files confirmed present on the pre-story baseline via `git stash`), `make test STACK_ID=1` —
  same 250/2897 passing against that stack's database, `supabase db diff --local` clean twice,
  `make check-migration-safety STACK_ID=1` PASSED. Two of the four CI guard scripts
  (`check-suppressions.mjs`: 4 eslint-disable vs. budget 3; `check-retired-names.mjs`: six
  `adminRouteBuilders.tsx` matches) fail identically on the pre-story baseline commit (verified
  via `git stash`) — neither guard's failing lines are in any file this story touched; the other
  two (`check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`) pass.

### File List

**Modified:**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/06_grants.sql`
- `src/components/atomic-crm/inbox/inboxMeta.ts`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx`
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `registry.json`

**New:**
- `supabase/migrations/20260802144600_shadchan_redting.sql`
- `supabase/tests/shadchan_redting.sql`
- `supabase/tests/shadchan_redting.test.ts`
- `src/components/atomic-crm/connections/RedtComposeDialog.tsx`
- `src/components/atomic-crm/connections/RedtComposeDialog.test.tsx`
- `src/components/atomic-crm/providers/fakerest/internal/redting.ts`
- `src/components/atomic-crm/providers/fakerest/internal/redting.test.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.redtViaConnection.test.ts`

## Change Log

- Implemented all 7 tasks / all 6 ACs. `redt_via_connection()` (SECURITY DEFINER) lands a
  connected shadchan's redt as an unfiled `inbox_items` row on the connection's household and
  mirrors it into a connection-scoped `threads`/`messages` record via `create_thread()`. Household
  side resolves through the existing `InboxResolveDialog` → `create_shidduch()` confirm step with
  `origin: 'shadchan'` and a locked `shadchan_id`. Shadchan side gets `RedtComposeDialog.tsx`
  (Story 8.5 wires the launch point). Full Supabase + FakeRest dataProvider parity. SQL negative-
  test suite (20 checks) proves AC-6(a)-(d), one denial proven by mutation. Status → review.
