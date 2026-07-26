# Story 8.3: In-platform redting through a connection

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want to send a suggestion into a connected family's pipeline from inside the platform,
so that redting happens here instead of over WhatsApp with nothing recorded on either side.

## Position in Epic 8

**3rd of 5.** Depends on **8.2**'s `connections` table and the auto-linked `shadchanim` row it
creates on acceptance. Feeds **8.4**'s negative tests (which assert the write boundary this
story creates cannot be crossed) and **8.5** (which places the "Send a redt" action on the
Connection 360).

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

- [ ] **Task 1 — Schema** (AC: 1, 2, 5)
  - [ ] `supabase/schemas/01_tables.sql`: extend `inbox_items.source`'s check constraint to add
        `'shadchan'` (today: `('whatsapp', 'sms', 'email', 'photo', 'upload')`).
  - [ ] Add `connection_id bigint references public.connections(id)` to `inbox_items` (nullable).
        **This is a provenance foreign key, not a second RLS scoping axis** — `inbox_items`
        remains scoped by `account_id` alone (AD-1's "exactly one axis" is about which column
        RLS keys on, not about whether a row may carry an unrelated FK for attribution, exactly
        as `shidduchim.shadchan_id` already references another account-scoped table without
        being a second scope). State this explicitly in the migration comment to pre-empt a
        reviewer flagging an AD-1 violation.

- [ ] **Task 2 — `redt_via_connection()`** (AC: 1, 2, 3, 5)
  - [ ] Add, `SECURITY DEFINER`, `SET search_path = ''`, following the `handle_new_user()`
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

      -- Epic 7 threads: mirror this redt into a connection-scoped thread so the
      -- shadchan retains their own record (AC-5, FR112). Insert shape depends on
      -- Epic 7's actual threads table — see Dev Notes "Thread mirroring depends
      -- on Epic 7".

      return v_row;
    end;
    $$;
    ```
    The membership check deliberately does **not** further restrict by `role = 'shadchan'` —
    matching the existing precedent that `create_shidduch()` does not role-gate beyond account
    membership either (see `supabase/schemas/02_functions.sql`, `create_shidduch`); any active
    member of the shadchanus account may act for it, consistent with how any active member of a
    household may currently create a shidduch for it.
  - [ ] `grant execute on function public.redt_via_connection to authenticated;` in
        `06_grants.sql`, matching the existing grant pattern for `create_shidduch`. **Never**
        grant to `anon` — sending a redt requires an authenticated, connected shadchan (AD-1).

- [ ] **Task 3 — Thread mirroring (depends on Epic 7)** (AC: 5)
  - [ ] Once Epic 7's `threads` table exists (AD-22: subject-scoped, explicit participants, one
        visibility value, scoped by `connection_id` for a cross-context conversation), extend
        `redt_via_connection()` to insert one thread row: `connection_id := p_connection_id`,
        participants = the calling shadchan + the household's active members, an initial message
        body = `p_raw_text`. **This is a hard dependency, not an optional enhancement** — without
        it, AC-5 cannot be met (the shadchan would have zero record of their own redt). If Epic 7
        has not landed when this story is implemented, land Tasks 1–2 and 4–7 and block Task 3 +
        AC-5's verification explicitly rather than skipping it silently.

- [ ] **Task 4 — Household-side resolve flow** (AC: 3, 4)
  - [ ] `inbox/inboxMeta.ts`: add a `shadchan` entry to `INBOX_SOURCE_META` (icon + label —
        reuse an existing Lucide icon already imported elsewhere for a person/handshake concept,
        do not add a new icon dependency for one entry).
  - [ ] `inbox/InboxResolveDialog.tsx`: the `origin` passed into `CreateShidduchInput` (currently
        hardcoded `"channel"` at the `onSubmit` handler, ~line 53) becomes
        `item.source === "shadchan" ? "shadchan" : "channel"`.
  - [ ] When `item.source === "shadchan"`: resolve the linked `shadchanim` row via
        `shadchanim.connection_id = item.connection_id` and pass it as the form's initial
        `shadchan_id`, **disabled** (not just defaulted) in `ShidduchInputs` for this case — the
        household must not be able to re-attribute a shadchan-sourced redt to a different book
        entry. `ShidduchInputs` needs a new optional prop (e.g. `lockedShadchanId`) — check its
        current prop shape before adding one; do not duplicate the component for this one
        difference.
  - [ ] `item.sender` (already rendered somewhere in the resolve dialog / inbox list per existing
        `INBOX_SOURCE_META` usage) needs no new plumbing — Task 2 already populates it with the
        shadchan's account name.

- [ ] **Task 5 — Types and dataProvider** (AC: 2, 3)
  - [ ] `types.ts`: `InboxItem.source` union gains `"shadchan"`; add `InboxItem.connection_id?:
        Identifier`.
  - [ ] `providers/supabase/dataProvider.ts`: add `redtViaConnection(input)` to the custom-methods
        overlay, mirroring `createShidduchViaRpc`'s shape exactly (destructure `{ data, error }`
        from `getSupabaseClient().rpc("redt_via_connection", {...})`, log+throw on error).
  - [ ] Mirror in `providers/fakerest/` (AD-10): extend the FakeRest `inbox_items` emulation and
        add a `redtViaConnection` fake that validates the same connection-status/membership
        rules in-memory (do not silently accept any input in demo mode — the guard rails are
        part of what a reviewer/demo user should be able to see fail correctly).

- [ ] **Task 6 — Shadchan-side compose UI** (AC: 1, 2, 3)
  - [ ] Add `shadchanim/RedtComposeDialog.tsx` (or an equivalent location under a shadchan-facing
        folder if Story 8.5 has already established `connections/` by the time this lands —
        check first): a form with `subject` and `raw_text` fields plus optional attachment
        upload, calling `dataProvider.redtViaConnection({ connectionId, subject, rawText,
        attachments })` on submit. **This story owns the dialog component; Story 8.5 owns where
        it is launched from** (a button on the Connection 360) — do not duplicate the dialog if
        8.5 lands first and already stubbed one; extend it.

- [ ] **Task 7 — Negative-test suite** (AC: 6)
  - [ ] New `supabase/tests/shadchan_redting.sql` + `.test.ts`, same `results`/`ids` temp-table
        convention as `supabase/tests/references_entity.sql`. Cover: (a) no accepted connection
        ⇒ rejected, no row; (b) ended connection ⇒ rejected; (c) S2 cannot use S1's
        `connection_id`; (d) the created `inbox_items` row is invisible to household C reading
        as themselves (re-run the existing cross-tenant `inbox_items` assertion pattern with a
        `source = 'shadchan'` row present, to prove the new column/value doesn't loosen anything).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (needs
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

### Thread mirroring depends on Epic 7

Story 8.4's AC ("a shadchan sees only the interaction and suggestion threads they are party to")
and FR112 ("a shadchan tracks their own conversations in their own context") are only satisfiable
if the shadchan has *some* connection-scoped record of what they sent — otherwise sending a redt
would give them literally nothing to look at afterward. That record is Epic 7's `threads`, not a
bespoke Epic-8 table (reuse, do not reinvent — `.claude/rules/coding-style.md` DRY). This is a
genuine cross-epic dependency that **epics.md does not currently state**: Epic 8's own coverage
row lists only "FR108–113, AD-4, AD-7", with no mention of AD-22 or Epic 7. Flagged to the epic
owner in the story-writing report.

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

- `create_shidduch()` signature and body: `supabase/schemas/02_functions.sql` (search
  `create_shidduch`) — confirms `account_id` is derived from the caller via
  `current_context_id()` (post-Epic-2 name for what is `current_account_id()` today) and is
  never a parameter; this story relies on that remaining true and does not touch the function.
- `inbox/InboxResolveDialog.tsx` (176 lines) already implements the confirm-step UI this story
  extends: it hardcodes `origin: "channel"` and collects `shadchan_id` from a form field today —
  both are the exact two lines Task 4 changes.
- `providers/supabase/dataProvider.ts:71-95` (`createShidduchViaRpc`) is the pattern Task 5's
  `redtViaConnection` follows.

### Dependencies

- **Story 8.2** (connections + the auto-linked `shadchanim` row) — hard prerequisite for
  Tasks 1–2.
- **Epic 7 Story 7.1** (thread model, AD-22) — hard prerequisite for Task 3 / AC-5. Not stated as
  a dependency anywhere in epics.md's Epic 8 section; see "Thread mirroring depends on Epic 7"
  above.
- **Epic 1** naming (`single_id`, `create_shidduch`'s renamed parameter) must have landed.

### Testing standard

SQL negative-test suite per `.claude/rules/testing.md` / `.claude/rules/security-triggers.md`.
Frontend changes (Task 4, 6) get Vitest component tests (AAA) covering: origin selection logic,
the locked `shadchan_id` field when `source === 'shadchan'`, and the compose dialog's submit path.

### Project Structure Notes

New: `supabase/tests/shadchan_redting.sql` + `.test.ts`,
`shadchanim/RedtComposeDialog.tsx` (relocate under `connections/` without ceremony if Story 8.5
lands first and that folder already exists — same component, just moved). Modified:
`inbox/inboxMeta.ts`, `inbox/InboxResolveDialog.tsx`, `shidduchim/ShidduchInputs.tsx` (new prop),
`types.ts`, both dataProviders.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
