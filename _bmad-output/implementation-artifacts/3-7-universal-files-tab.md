---
baseline_commit: 5a5ad53d9fd05b9f0e14b3f796bdbcbe87eafc87
---

# Story 3.7: Universal Files tab

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to attach files to any record,
so that documents live where they belong.

## Position in Epic 3

**Build order: contract §12 step 11** — the last universal tab, immediately before **3.11**, the
AD-24 conformance validator (`3-11-ad24-conformance-validator.md`; the contract calls it "3-15")
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md §12].
It is the heaviest new surface in the epic (bucket + table + view + policies + grants +
triggers + three dataProvider methods + FakeRest mirror), so it goes last, when the
vocabulary and the seams it builds on are already settled.

**Hard dependencies:**

| Depends on | For what |
|---|---|
| **3.9** | `ENTITY_TARGET_TYPES` / `EntityTargetType` in `src/components/atomic-crm/types.ts` (contract §8, §10), and the `single` entry it adds to `RESOURCE_FOR_TARGET` (`src/components/atomic-crm/reminders/reminderEntity.ts:21-25`), which this story reuses to map a target type to its resource name. |
| **3.5** | `current_member_id()` (server-set uploader, contract §10); `UniversalTabProps` in `src/components/atomic-crm/entity360/tabs/types.ts` (contract §8); the `?raw` DB-vocabulary guard test and its `PENDING_DB_WIDENINGS` constant, which this story extends. |
| **3.10** — `3-10-tab-vocabulary.md` (the contract calls it "3-13") | The `files` key in `TAB_KEYS` / `TAB_LABELS` (contract §3). This story does not add a key. |

**Explicitly NOT a dependency: 3.14** (`3-14-context-scope-lift-tasks-interactions.md`, the
`enforce_household_scope` lift). `entity_files`
is a new table and is **never attached** to `enforce_household_scope()`, so it works in a
`shadchanus` context from day one — see AC 2(f). Contract §8 rule 5 makes this a term, not
a preference; it is what closes the brief's §3-J question for files.

**Scope boundary.** A standalone, tested `FilesTab` plus its own bucket, table, summary
view and dataProvider methods. **Not mounted into any entity's tab bar** — Epic 5 does
that. Nothing in this story edits an existing entity folder.

## Storage on `main`: what already exists, and why a second bucket anyway

The previous revision of this story argued for a private `entity-files` bucket because the
`attachments` bucket was public, unscoped, and handed out permanent `getPublicUrl` links.
**All three of those statements are false on `main`.** The gap was closed before Epic 2
shipped. Present facts, each read directly:

- The bucket is **private**: `update storage.buckets set public = false where id = 'attachments';`
  [Source: supabase/schemas/07_storage.sql:19].
- The three inherited unscoped `Attachments 1mt4rzk_*` policies are **dropped**
  [Source: supabase/schemas/07_storage.sql:21-23] and replaced by three context-scoped ones —
  `bucket_id = 'attachments' and (storage.foldername(name))[1] = public.current_context_id()::text`
  for select, insert and delete [Source: supabase/schemas/07_storage.sql:25-44].
- Object keys are **account-prefixed and CSPRNG-random**: `` `${accountId}/${crypto.randomUUID()}${fileExt}` ``,
  with `accountId` resolved from the `current_context_id` RPC, never from client state
  [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:654-661, :697-702].
- Reads are **signed and expiring**, and a signing failure throws rather than degrading to
  anything permanent [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:712-721].
- **`getPublicUrl` has zero occurrences** across `src/`, `supabase/` and `workers/` (verified
  count: 0).
- The whole shape is regression-tested at the SQL level — bucket privacy, cross-tenant
  read/insert/delete denial, and the anon vector
  [Source: supabase/tests/context_rls_hardening.sql:68-251].

**So the justification is different, and narrower.** A second bucket is still the right call,
for three reasons that survive the corrected premise:

1. **Different lifetime owner.** `attachments` objects are owned by the row that references
   them through ra-core's `RAFile` shape (`{path, src, type}` written back onto the record by
   `uploadToBucket`) — today that is the member avatar
   [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:566-575]. `entity_files`
   objects are owned by a **first-class row in a polymorphic table** with its own lifecycle,
   purge trigger and grants. Mixing the two in one bucket means one prefix namespace with two
   incompatible cleanup rules.
2. **Different key grammar.** `attachments` keys are two segments (`{account_id}/{random}`);
   this story's keys are four (`{account_id}/{target_type}/{target_id}/{random}`) so that a
   target's objects can be enumerated and removed as a unit. Both are valid under a
   `foldername(name)[1]` predicate, but a single bucket with two grammars is a trap for the
   next person who writes a sweep.
3. **Different blast radius on change.** Every future change to entity-file handling (AD-9's
   eventual R2/Worker-proxy migration) can be made against a bucket the avatar path does not
   touch.

**What this story does NOT claim:** it is not a security fix, it does not harden anything,
and it does not "avoid inheriting" a gap. It adds a capability alongside an already-correct
one and copies that one's policy shape verbatim.

**What this story does NOT reach:** AD-9's end state is R2 behind a `share/` Worker that
proxy-streams bytes and writes `share_access_log`, with recipients never receiving even a
pre-signed URL [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9 — :98-101].
Supabase Storage + short-lived signed URLs is the pre-R2 realization of the same principle,
identical to what `attachments` does today. The Worker half is unowned Epic-9 work
(`workers/share/index.ts` is a 14-line stub), and this story does not open it.

## Acceptance Criteria

### AC 1 — A new private bucket with exactly three storage policies, and deliberately no UPDATE policy

A bucket `entity-files` is created with `public = false`. Its policies are added to
`supabase/schemas/07_storage.sql` by **copying the three `attachments` policies at
`07_storage.sql:25-44` with the bucket id swapped** — that file is the correct template, not
a counter-example:

```sql
create policy "Entity files readable within account" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'entity-files'
        and (storage.foldername(name))[1] = public.current_context_id()::text
    );
-- ...and the identical pair for insert (with check) and delete (using).
```

Both halves of the predicate are required: without `bucket_id` the folder predicate would
apply to every other bucket's objects.

**Exactly three policies: select, insert, delete. No UPDATE policy, and this is load-bearing.**
`supabase/tests/context_rls_hardening.sql:141-146` asserts
`not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('UPDATE','ALL'))`
— a **table-wide** tripwire, not a per-bucket one. Adding an UPDATE policy for `entity-files`
turns that existing test red. The tripwire's own comment
[Source: supabase/tests/context_rls_hardening.sql:126-139] explains why: an UPDATE policy scoped
only by bucket, without re-deriving the prefix check, is exactly the shape that lets a tenant
rename an object across the account boundary. No UPDATE is needed here — "replace" is
delete + upload (AC 4), not an object rename.

**Falsifiable:** drop the `bucket_id` half of any one predicate → AC 8's cross-context storage
check goes red. Add a fourth (UPDATE) policy → `context_rls_hardening` goes red.

### AC 2 — `entity_files`, a new polymorphic table at full four-value parity

```sql
create table public.entity_files (
    id bigint generated by default as identity primary key,
    account_id bigint not null,
    created_at timestamp with time zone not null default now(),
    target_type text not null,
    target_id bigint not null,
    storage_path text not null,
    file_name text not null,
    mime_type text not null,
    size_bytes bigint not null,
    visibility text not null default 'shared',
    uploaded_by_member_id bigint,
    constraint entity_files_target_type_check check (
        target_type in ('reference', 'shidduch', 'shadchan', 'single')
    ),
    constraint entity_files_visibility_check check (
        visibility in ('shared', 'private_parent', 'private_single')
    ),
    -- A non-'shared' value is a statement about who in a household may see the
    -- file. A shadchan and a reference are not household members, so the value
    -- would describe nothing. Narrows the check above; it does not replace it.
    constraint entity_files_visibility_target_check check (
        visibility = 'shared' or target_type in ('shidduch', 'single')
    ),
    -- The two-phase upload's consistency guarantee, enforced by the database
    -- rather than by a test: account_id is trigger-assigned from
    -- current_context_id(), so if the caller switched context between the
    -- storage PUT and this INSERT, the row is rejected instead of being written
    -- with a path pointing into the other account's folder.
    constraint entity_files_storage_path_scope_check check (
        storage_path like account_id::text || '/%'
    )
);
```

(a) **Target vocabulary is at parity from creation.** All four values of
`ENTITY_TARGET_TYPES` are legal, matching contract §8's requirement that
`tasks_target_type_check` (`supabase/schemas/01_tables.sql:45-47`, today
`('shadchan','shidduch','reference')`), `interactions_target_type_check`
(`:458-459`, today `('reference','shidduch')`) and this constraint end up with the same four.
Because it starts at parity, **this story adds `entity_files_target_type_check` to the scanned
set of 3.5's `?raw` vocabulary guard and adds nothing to `PENDING_DB_WIDENINGS`.**

(b) **Visibility is the domain's existing vocabulary, and it is settable.** The three values
match `shidduchim_visibility_check`
[Source: supabase/schemas/01_tables.sql:304-306] after Epic 1 Story 1.3's
`private_child` → `private_single` rename — one AD-3 vocabulary, not a second. `epics.md`'s
own AC for this story requires *per-file visibility*
[Source: _bmad-output/planning-artifacts/epics.md:538-550], so the value must be **changeable
after upload**, which AC 6(e) delivers through a column-level UPDATE grant. Role-based
*enforcement* of `private_*` arrives with Epic 6's single-access work, exactly as for every
other visibility-carrying row; this story stores and exposes the value.

(c) **FKs and indexes.** `account_id → accounts(id) on delete cascade` (the shape every domain
table uses, e.g. `supabase/schemas/01_tables.sql:675`); `uploaded_by_member_id →
account_members(id) on delete set null` (the shape `interactions.actor_member_id` uses,
`:680`). Indexes: `entity_files_account_id_idx (account_id)` and
`entity_files_target_idx (account_id, target_type, target_id, created_at desc)` — the
`interactions_target_idx` shape **including its `created_at desc` tail**
[Source: supabase/schemas/01_tables.sql:729], because the tab lists newest-first.

(d) **RLS.** `alter table public.entity_files enable row level security;` plus one `for all`
policy scoped to `account_id = public.current_context_id()` in both `using` and `with check`,
copying `"Tasks scoped to account"` [Source: supabase/schemas/05_policies.sql:33-36].
**Not `FORCE ROW LEVEL SECURITY`.** AD-1 asks for it
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — :57-60],
but **no table in this repo has it** — the only artefact is the comment recording it as an
open gap [Source: supabase/schemas/01_tables.sql:85], and repo-wide FORCE RLS is tracked as
unowned work S2 with a designed-bypass list. A single forced table would diverge from the
other 22 and break the definer-function paths that rely on RLS being unforced. This story
follows the repo's shipped shape and does not unilaterally close S2.

(e) **Grants** [Source: supabase/schemas/06_grants.sql:693-700 for the pattern]:

```sql
revoke all on table public.entity_files from anon, authenticated;
grant select, insert, delete on table public.entity_files to authenticated;
grant all on table public.entity_files to service_role;

-- Only visibility is mutable after the fact. Every other column is a fact about
-- a stored object; changing one would desynchronise the row from the bucket.
-- Same column-level shape interactions uses (06_grants.sql:615-616).
grant update (visibility) on table public.entity_files to authenticated;

revoke all on sequence public.entity_files_id_seq from anon;
grant usage, select on sequence public.entity_files_id_seq to authenticated;
grant all on sequence public.entity_files_id_seq to service_role;
```

The sequence revoke is not optional — every domain table in `06_grants.sql` pairs its table
grant with one (e.g. `interactions_id_seq` at `:460-462`).

(f) **Two BEFORE INSERT triggers, and no third.**
`set_entity_files_account_id` → `public.set_account_id_default()` (the shape at
`supabase/schemas/04_triggers.sql:123-125`), and `set_entity_files_uploaded_by`, a new trigger
function that assigns `new.uploaded_by_member_id := public.current_member_id()` when the
client did not supply it. `current_member_id()` is 3.5's; there is **no existing
uploader-setting trigger to imitate** — `actor_member_id` on `interactions` is written inline
inside RPC bodies, not by a trigger, so this is the first one.

**No `validate_entity_files_household_scope` trigger is created.** `entity_files` is
deliberately outside the 13-table household-only set
[Source: supabase/schemas/04_triggers.sql:147-158 (the comment), :159-209 (the triggers)] so
that a shadchan can attach files in their own `shadchanus` context from day one, which is what
Epic 8.5 is built on. AC 8(c) asserts this positively; AC 8(d) asserts the catalog has no such
trigger, so a later "consistency" migration cannot silently add one.

**Falsifiable:** drop `entity_files_storage_path_scope_check` → AC 4's context-switch test goes
red. Drop `entity_files_visibility_target_check` → AC 8(e) goes red. Add the household-scope
trigger → AC 8(c) and 8(d) both go red.

### AC 3 — A summary view is the read surface

`public.entity_files_summary`, `with (security_invoker = on)` (AD-1: no definer views; the
shape every summary view in `03_views.sql` uses, e.g. `supabase/schemas/03_views.sql:202`),
selecting every `entity_files` column plus `uploaded_by_name` resolved through
`account_members.user_id = members.user_id`. Account scoping comes from base-table RLS via
`security_invoker`; the view declares none of its own.

Grants mirror the other views [Source: supabase/schemas/06_grants.sql:452-458]:
`revoke all ... from anon, authenticated; grant select ... to authenticated; grant all ... to service_role;`

`FilesTab` **lists** through `entity_files_summary` and **writes** through `entity_files`, per
AD-10's "list/summary resources route through a `*_summary` view"
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10 — :103-106].

**Falsifiable:** a member of account A queries `entity_files_summary` and gets zero of account
B's rows (AC 8(b)); removing `security_invoker = on` makes the view definer-owned and that
check goes red.

### AC 4 — All file I/O crosses the dataProvider seam, never `getSupabaseClient()` in a component

AD-10 exists to prevent *"components calling Supabase directly"*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10 — :103-106],
and there is no build-time swap seam for a bare helper module: `demo/App.tsx` selects the
FakeRest provider by **passing a different `dataProvider` to `<CRM>`**, and nothing else. So
three custom methods are added to the existing custom-methods overlay
[Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:84, :400, :538-559 — the
`getMyContexts` / `createInvite` / `revokeInvite` precedent]:

```ts
uploadEntityFile(params: {
  targetType: EntityTargetType;
  targetId: Identifier;
  file: File;
  visibility?: EntityFileVisibility;
}): Promise<EntityFile>;

signEntityFileUrl(params: { storagePath: string; fileName: string }): Promise<string>;

deleteEntityFile(params: { id: Identifier; storagePath: string }): Promise<void>;
```

Implementations live in a new `src/components/atomic-crm/providers/supabase/entityFiles.ts`
(not in `dataProvider.ts`, which is already ~730 lines —
`.claude/rules/coding-style.md` file-size guidance), and are mirrored in
`src/components/atomic-crm/providers/fakerest/internal/entityFiles.ts` alongside the other
mirrored custom methods [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:693-694, :740-749].

**Ordering and failure handling in `uploadEntityFile`:**

1. Resolve the key. `{account_id}/{target_type}/{target_id}/{uuid}{ext}` where `account_id`
   comes from the `current_context_id` RPC, never from client state
   [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:654-661], `uuid` is
   `crypto.randomUUID()`, and `ext` is derived exactly as `:697-698` does. **No path segment is
   user-supplied** — the original file name is stored in the `file_name` column and re-attached
   at download time (AC 5), never placed in the key. This story deliberately drops the previous
   revision's `{uuid}_{file_name}` suffix: a name containing `/` would create an extra folder
   level, which is not a tenant escape (the predicate reads segment `[1]`) but is avoidable.
2. Upload the bytes with the Supabase storage client.
3. `dataProvider.create("entity_files", { data: { target_type, target_id, storage_path, file_name, mime_type, size_bytes, visibility } })`.
   `account_id` and `uploaded_by_member_id` are **not** sent — both are trigger-assigned.
4. **If step 3 fails, remove the uploaded object and rethrow.** No object without a row.

`deleteEntityFile` runs the reverse: `dataProvider.delete("entity_files", {id})` first, then
`storage.from("entity-files").remove([storagePath])`. **The row deletion is authoritative** —
the row's absence is what every other surface reads — and a failure of the second step is
logged, not surfaced as a failed delete. That asymmetry is deliberate and stated so nobody
"fixes" it into a two-call flow a user can interrupt halfway.

**Falsifiable:** with a stubbed storage client whose `create` rejects, assert `remove` was
called with the just-uploaded key and no `entity_files` row exists. With a stub that switches
the RPC's returned account id between step 1 and step 3, assert the insert is rejected by
`entity_files_storage_path_scope_check` (AC 2) and the object is removed.

### AC 5 — Signed URLs are minted per click and never persisted

`signEntityFileUrl` calls
`getSupabaseClient().storage.from("entity-files").createSignedUrl(storagePath, ENTITY_FILE_URL_TTL_SECONDS, { download: fileName })`
and throws on a signing error — the same idiom, including the throw, as
`src/components/atomic-crm/providers/supabase/dataProvider.ts:712-721`. The `download` option
is what restores the original file name to the browser without ever putting it in the object
key; it is supported by the installed storage client
[Source: node_modules/@supabase/storage-js/dist/index.d.mts:1209-1221].

`ENTITY_FILE_URL_TTL_SECONDS = 60`. Not the one-hour `ATTACHMENT_URL_TTL_SECONDS`
[Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:643]: that value exists
because an avatar URL is written onto a record and re-read; this one is minted at click time
and consumed immediately.

Two decidable checks, both behavioural:

(a) **Per-click minting.** With a stubbed provider, clicking download on the same row twice
calls `signEntityFileUrl` **twice**. An implementation that caches the URL in component state
or in the row fails this.

(b) **No URL ever lands in a row or in list state.** A `?raw` assertion, using the
`import.meta.glob(..., { query: "?raw" })` mechanism already proven in-repo
[Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20], reads
`supabase/schemas/01_tables.sql` and asserts the `create table public.entity_files` block
declares no column named `url` or ending in `_url`. **Prove it red first** by adding a
`url text` column to a scratch copy of the block (contract §13 rule 2).

The residual window is stated, not hidden: a signed URL is a bearer token with its own TTL and
**survives a context switch**; `ContextSwitcher` only invalidates React Query caches. A 60-second
TTL bounds it. Closing it entirely is AD-9's Worker proxy-stream, which is out of scope here.

**Not an AC, deliberately:** a repo-wide `getPublicUrl` scan. `getPublicUrl` has **zero**
occurrences repo-wide, so such an assertion cannot fail today and is not coverage — the
previous revision's AC 4(a) was exactly that. It is kept as a **regression tripwire** in Task 5
instead, where its vacuity is honest.

### AC 6 — `FilesTab` lists, uploads, replaces, deletes and sets visibility, per target

`src/components/atomic-crm/entity360/tabs/FilesTab.tsx` takes **exactly** `UniversalTabProps`
(`{ targetType: EntityTargetType; targetId: Identifier }`, contract §8) — no extra props, no
per-entity variants — and sits beside `ActivityTab.tsx` / `NotesTab.tsx`.

(a) **List.** `useGetList("entity_files_summary", { filter: { target_type, target_id }, sort: { field: "created_at", order: "DESC" } })`.
Each row shows file name, MIME type, human-formatted size, uploader name and date.

(b) **Upload.** A file picker plus an upload action calling `uploadEntityFile`.

**Neither `@/components/admin/file-input.tsx` nor `@/components/admin/file-field.tsx` is
reused, and both exclusions are verified, not assumed.** `file-input.tsx` calls `useInput`
[Source: src/components/admin/file-input.tsx:132], which requires a `source` prop and a
surrounding react-hook-form context; `FilesTab` is a list plus an action, with no form and no
record field to bind to. `file-field.tsx` renders an `<a href>` from a **URL held in the
record** [Source: src/components/admin/file-field.tsx:4 (`useFieldValue`), :26-31], and AC 5
forbids storing one. The previous revision listed reuse of `file-input.tsx` as an acceptance
condition while conceding in its own task list that it might not work; that contradiction is
removed. `react-dropzone` is already a dependency if drag-and-drop is wanted, but it is not
required by this AC.

(c) **Replace** = `deleteEntityFile` then `uploadEntityFile`, sharing one UI action, carrying
the previous row's `visibility` forward. No in-place object rename (AC 1).

(d) **Delete** = `deleteEntityFile`.

(e) **Visibility control.** A per-row control offering `shared / private_parent /
private_single`, issuing `dataProvider.update("entity_files", { data: { visibility } })` — the
only column the grant permits (AC 2(e)). **The control is rendered only when `targetType` is
`shidduch` or `single`**, matching `entity_files_visibility_target_check`; for `shadchan` and
`reference` targets the row shows no control and stays `'shared'`. This is what makes
`epics.md`'s "per-file visibility" real rather than a column that is `'shared'` forever.

(f) **Empty, loading and error states all render** (UX-DR11
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187]),
same treatment as 3.5/3.6.

(g) **Framework-layer strings go through the `i18nProvider`** with an `_:` English fallback
(contract §13 rule 6). No hardcoded English label map inside `entity360/`.

**Falsifiable:** render with a stubbed provider returning `[]` → the empty state is present and
no row is; return two rows → both render with uploader and formatted size; make `getList`
reject → the error state renders and the upload control is still reachable; render with
`targetType: "reference"` → `await expect.element(screen.getByRole("combobox", { name: /visibility/i })).not.toBeInTheDocument()`.

### AC 7 — Deleting a parent leaves no rows, and the byte cleanup is at the layer that can actually do it

(a) **Rows: enforced in Postgres.** `purge_polymorphic_dependents()`
[Source: supabase/schemas/02_functions.sql:1799-1817] gains a fourth delete:

```sql
delete from public.entity_files
where account_id = old.account_id and target_type = v_target_type and target_id = old.id;
```

It is wired today only to `references` and `shidduchim`
[Source: supabase/schemas/04_triggers.sql:109-111, :118-120]; **3.5 adds the triggers on
`public.singles` and `public.shadchanim`** (contract §8 rule 3), and this story inherits all
four. Because the function takes its target type as `TG_ARGV[0]`, the edit is one statement and
covers every parent at once.

(b) **Bytes: at the dataProvider seam, because SQL cannot do it.** Verified on the local stack:
`storage.objects` carries a BEFORE-DELETE **statement-level** trigger
`protect_objects_delete → storage.protect_delete()`, which raises
`'Direct deletion from storage tables is not allowed. Use the Storage API instead.'`
(SQLSTATE `42501`) unless `storage.allow_delete_query` is set
[Source: supabase/tests/context_rls_hardening.sql:180-190, which documents and works around
exactly this]. And even with the guard lifted, deleting the catalog row does **not** reclaim
the object bytes — only the Storage API does. So the purge trigger cleans rows and nothing
else.

Byte cleanup is therefore a `ResourceCallbacks.beforeDelete` entry
[Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:566-575 for the
`lifeCycleCallbacks` shape] registered for each of the four parent resources, generated from
`ENTITY_TARGET_TYPES` via `RESOURCE_FOR_TARGET`
[Source: src/components/atomic-crm/reminders/reminderEntity.ts:21-25, gaining its `single`
entry in 3.9]. The callback reads the target's `entity_files` rows — still present at that
point — and calls `storage.from("entity-files").remove(paths)`
[Source: node_modules/@supabase/storage-js/dist/index.d.mts:1506-1512].

(c) **The residual limitation is named, not hidden.** A parent deleted by any path that does
not go through the SPA's dataProvider (a `service_role` job, a psql session, a future edge
function) leaves the rows correctly purged and the **bytes orphaned**. This story does not
build a sweeper. **Written trigger for the follow-up:** the first of (i) AD-9's R2/Worker
migration, which replaces this storage layer wholesale, or (ii) the first non-SPA writer of
`entity_files`. Whichever lands first owns an orphan sweep.

**Deviation from contract §8 rule 3, stated rather than silently taken:** the contract says
3.7 *"extends the function to cover `entity_files` and to delete the storage objects."* The
first half is done here; the second half is not implementable inside that function, for the two
verified reasons in (b). The contract's assertion — *"deleting a single or a shadchan leaves
zero `tasks` / `interactions` / `entity_files` rows for it"* — is met in full by (a).

**Falsifiable:** `db` project — insert a shidduch, an `entity_files` row for it, delete the
shidduch, assert zero `entity_files` rows remain; repeat for a `single` and a `shadchan` (which
also proves 3.5's two new triggers are wired). `app` project — `dataProvider.delete("singles",
{id})` with a stubbed storage client issues exactly one `remove()` carrying every path the
target owned.

### AC 8 — Negative tests: one login, two contexts, active in one

The previous revision's "two accounts, one user each" passes trivially and never exercises
`current_context_id()`'s active-context resolution — the thing that actually regresses
(contract §13 rule 3). A new `supabase/tests/entity_files.sql` + `entity_files.test.ts` pair,
modelled on `references_entity.test.ts`'s harness
[Source: supabase/tests/references_entity.test.ts:21-28] with `bailIfDbUnreachable`
[Source: supabase/tests/dbSuiteHelpers.ts:15]. The storage half is **not new harness work**:
`context_rls_hardening.sql:77-88` already inserts into `storage.objects` under a set
`request.jwt.claims`, and `:221-244` already demonstrates the `storage.allow_delete_query`
dance. The context-switching half uses `public.set_active_context()`
[Source: supabase/schemas/02_functions.sql:249], as `context_resolution.sql:228-232` does.

**Arrange:** one `auth.users` row `u1` with active memberships in household account A and
household account B, active in A; plus a `shadchanus` account C with a `shadchan`-role
membership for `u1`. One `entity_files` row and one `entity-files` storage object per account.

Required checks:

- (a) **Storage, active in A:** `u1` reads its own object under A's prefix (1 row); reads
  **zero** rows for B's object; an INSERT under B's prefix raises; a DELETE of B's object (with
  `storage.allow_delete_query` set, so the statement guard is not what denies it) leaves B's
  object intact, while `u1` deleting its own A object succeeds — the positive control that
  proves the denial is RLS and not a broken delete path.
- (b) **Table, active in A:** `u1` reads exactly one `entity_files` row, and **zero** rows
  filtered on B's `account_id`. After `set_active_context(B)`, the **same login** reads exactly
  B's row and zero of A's. This is the check the previous revision could not make.
- (c) **Shadchanus positive:** with C active, `insert into public.entity_files (target_type,
  target_id, storage_path, file_name, mime_type, size_bytes)` with `target_type = 'shadchan'`
  and `storage_path` prefixed with C's account id **succeeds** — proving
  `enforce_household_scope()` is not attached. (`target_id` needs no real parent row:
  `entity_files` is polymorphic and carries no FK on it, by the same design as
  `interactions.target_id`, which the purge function's own comment states outright:
  *"interactions/tasks/identity_signals are polymorphic, so no FK cascades them"*
  [Source: supabase/schemas/02_functions.sql:1792-1798].) Contrast control: `insert into public.singles`
  under C still **raises** `'account % is not a household-kind account'`
  [Source: supabase/schemas/02_functions.sql:387-402].
- (d) **Catalog:** no trigger named `validate_entity_files_household_scope` exists on
  `public.entity_files`, and `pg_class.relrowsecurity` is true for it.
- (e) **Constraint:** inserting a `reference`-targeted row with `visibility = 'private_parent'`
  raises; the same row with `'shared'` succeeds.
- (f) **Constraint:** inserting a row whose `storage_path` does not begin with the
  trigger-assigned `account_id` raises `entity_files_storage_path_scope_check`.
- (g) **anon:** `anon` reads zero `entity_files` rows and zero `entity_files_summary` rows, and
  holds no privilege on either.

Every check is written so that reverting the corresponding policy/constraint to something
permissive turns it red, and that must be **demonstrated by hand once** on the local stack
before the file is committed — the standard `context_rls_hardening.sql:21-25` already sets for
this suite.

## Tasks / Subtasks

- [x] **Task 1 — Storage: bucket + three policies** (AC 1)
  - [x] Append the `entity-files` bucket and its **three** policies to
        `supabase/schemas/07_storage.sql`, copying `:25-44` with the bucket id swapped.
        Do not add an UPDATE policy (AC 1).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_entity_files_bucket`.
        `db diff` produces DDL, and a bucket is a **row** in `storage.buckets`, so verify
        empirically whether the insert appears; if it does not, add
        `insert into storage.buckets (id, name, public) values ('entity-files','entity-files',false) on conflict do nothing;`
        to the generated migration by hand. Check the file, do not assume either way.
        Verified: the bucket insert did NOT appear in the diff (migra diffs schema, not
        data); added it by hand at the top of the migration.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
  - [x] Re-run `npm run test:unit:db` and confirm `context_rls_hardening`'s
        "no UPDATE-applicable policy exists on storage.objects" check is still green.
        Confirmed green, and additionally demonstrated red-then-green by hand: adding a
        fourth (UPDATE) `entity-files` storage policy turns that exact check red; removing
        it restores green (full suite: 449/449).

- [x] **Task 2 — Schema: table, view, triggers, policy, grants** (AC 2, AC 3)
  - [x] `01_tables.sql`: the table, its four constraints, the two FKs, the two indexes.
  - [x] `03_views.sql`: `entity_files_summary` with `security_invoker = on`.
  - [x] `04_triggers.sql`: `set_entity_files_account_id` and `set_entity_files_uploaded_by`.
        Add **no** `validate_entity_files_household_scope`.
  - [x] `02_functions.sql`: the `set_entity_files_uploaded_by()` trigger function, in exact
        `pg_dump` form — `CREATE OR REPLACE FUNCTION "public"."name"() RETURNS "trigger" LANGUAGE "plpgsql" SET "search_path" TO '' AS $$…$$;`
        — modelled byte-for-byte on `supabase/schemas/02_functions.sql:201-203`'s header shape.
        A lowercase/unquoted header produces a phantom `db diff` (AGENTS.md). Confirmed
        `db diff` is clean ("No schema changes found") after applying.
  - [x] `05_policies.sql`: `enable row level security` + the `for all` policy.
  - [x] `06_grants.sql`: table grants, the `grant update (visibility)` line, the sequence
        revoke/grants, and the view grants. **Hand-fix required and applied:** `migra`'s
        diff omitted `entity_files_summary`'s grants entirely and omitted the `revoke all`
        half of `entity_files`'s own grants — verified empirically (`information_schema`
        query) that applying the raw generated migration left `authenticated` without
        SELECT on the view and with extra TRUNCATE/REFERENCES/TRIGGER on the table (both
        from this database's pre-existing `alter default privileges ... to authenticated`
        firing at `create table`/`create view` time, which `migra`'s snapshot diff does not
        anticipate). Added the exact `06_grants.sql` statements to the migration by hand and
        re-verified the resulting grants match the schema exactly after a full `db reset`.
  - [x] Extend 3.5's `?raw` DB-vocabulary guard to scan `entity_files_target_type_check`. Do
        **not** add it to `PENDING_DB_WIDENINGS` — it ships at parity. `PENDING_DB_WIDENINGS`
        is now `[]`; the guard's own "before" test was rewritten (see Completion Notes) so it
        keeps proving a real red run rather than depending on the table not existing yet.
  - [x] `db diff -f add_entity_files_table`, hand-check, `migration up --local`. (Generated as
        one combined migration together with Tasks 1 and 3 — `db diff` produces one diff per
        invocation regardless of which of this story's schema edits are already staged, so a
        single `add_entity_files` migration captures the bucket, table, view, triggers,
        policies, grants and the purge-function edit together.)

- [x] **Task 3 — Purge** (AC 7)
  - [x] Add the `entity_files` delete to `purge_polymorphic_dependents()`
        (`02_functions.sql:1799-1817`), preserving the exact `pg_dump` header.
  - [x] `db diff`, hand-check, `migration up --local`. (Part of the one combined migration —
        see Task 2's last subtask.)

- [x] **Task 4 — dataProvider: three methods + FakeRest mirror + byte cleanup** (AC 4, AC 7(b))
  - [x] `providers/supabase/entityFiles.ts` — `uploadEntityFile`, `signEntityFileUrl`,
        `deleteEntityFile`, `removeEntityFileObjects`.
  - [x] Wire them into the custom-methods overlay
        (`providers/supabase/dataProvider.ts:84-559`) and add the four `beforeDelete`
        `ResourceCallbacks` entries to `lifeCycleCallbacks` (`:566-593`).
  - [x] `providers/fakerest/internal/entityFiles.ts` — the AD-10 mirror: an in-memory blob map
        with `URL.createObjectURL` previews, wired at
        `providers/fakerest/dataProvider.ts:693-749`.
  - [x] Add `entity_files: EntityFile[]` to the `Db` interface
        (`providers/fakerest/dataGenerator/types.ts:22-44`) and seed it empty in
        `dataGenerator/index.ts`. **The demo build must not crash on this tab.** Verified via
        a real-FakeRest-provider round-trip test in `FilesTab.test.tsx` (upload → list →
        persisted row), not merely "does not crash".
  - [x] Add `EntityFile` and `EntityFileVisibility` to `src/components/atomic-crm/types.ts`
        (this story owns them; contract §10 assigns `EntityTargetType` to 3.9 and
        `Interaction` to 3.5, and neither covers these). Also added `EntityFileSummary`
        (the `entity_files_summary` row shape, `EntityFile` + `uploaded_by_name`).

- [x] **Task 5 — `FilesTab.tsx`** (AC 5, AC 6)
  - [x] Build per AC 6, calling only `useDataProvider()` / `useGetList` — no
        `getSupabaseClient()` import anywhere under `entity360/`.
  - [x] `FilesTab.test.tsx` (`app` project): list with rows, empty, loading, error;
        upload happy path; upload with a failing row-create (object removed); replace;
        delete; per-click signing (AC 5(a)); visibility control present for `shidduch`,
        absent for `reference`. Also covers `single` (present) and `shadchan` (absent), the
        replace call-order assertion (delete before upload), and one real-FakeRest round trip.
  - [x] The AC 5(b) schema-shape guard, **proven red once** against a scratch block carrying a
        `url text` column. Also proven red for a column merely ending in `_url`.
  - [x] **Regression tripwire, explicitly not coverage:** an `import.meta.glob`-based scan
        asserting `getPublicUrl` appears in no `src/` file. It passes vacuously today (0 hits
        repo-wide) and exists only so a future reintroduction is caught. Do not count it toward
        this story's coverage and do not present it as an acceptance criterion.

- [x] **Task 6 — The negative suite** (AC 8)
  - [x] `supabase/tests/entity_files.sql` + `entity_files.test.ts`, all seven check groups,
        modelled on `context_rls_hardening.sql` (storage + JWT claims) and
        `context_resolution.sql` (`set_active_context`).
  - [x] Demonstrate each check red by loosening the thing it names, then restore. Record which
        ones were demonstrated in the Completion Notes. **All seven groups demonstrated red
        then green by hand** on the local stack (see Completion Notes for the exact toggle
        used per group).

## Dev Notes

### Path convention — the whole security boundary, in one line

Bucket `entity-files`, object name `{account_id}/{target_type}/{target_id}/{uuid}{ext}`.

Only the **first** segment is read by the storage RLS predicate
(`(storage.foldername(name))[1]`, plus the `bucket_id` guard). The remaining three are
addressing, not security: they let a target's objects be enumerated and removed as a unit
(AC 7(b)). **No segment is user-supplied.** The client does send the full key on upload, so the
`with check` on the insert policy — not client honesty — is what enforces the first segment,
and `entity_files_storage_path_scope_check` (AC 2) is what stops the *row* from disagreeing
with the *object* if the caller's context changed mid-upload.

### Reuse and non-reuse, both deliberate

**Reuse:** the three `attachments` policies at `07_storage.sql:25-44` as the literal template
(bucket id swapped); the `createSignedUrl`-and-throw idiom at `dataProvider.ts:712-721`; the
account-prefixed CSPRNG key derivation at `:697-702`; `current_member_id()` from 3.5;
`RESOURCE_FOR_TARGET` from `reminders/reminderEntity.ts:21-25`; the `Tasks scoped to account`
policy shape (`05_policies.sql:33-36`); the `inbox_items` grant block (`06_grants.sql:693-700`);
the column-level update grant shape (`:615-616`).

**Non-reuse:** `uploadToBucket` (`dataProvider.ts:663-731`) — it writes ra-core's `RAFile`
shape back onto a record (`fi.path`, `fi.src`, `fi.type`) and belongs to the `attachments`
lifecycle; `entity_files` rows are the durable reference here and no URL is ever written
anywhere. Pointing `uploadToBucket` at the new bucket would work and would still be wrong: it
would produce a stored `src` (a URL with a one-hour life) on a row that AC 5 says must never
hold one. `admin/file-input.tsx` and `admin/file-field.tsx` — see AC 6(b) for the verified
reasons.

### Household scope — settled, not deferred

`enforce_household_scope()` (`02_functions.sql:387-402`) is attached to 13 tables
(`04_triggers.sql:159-209`). `entity_files` is **not** the fourteenth. That is a decision made
in the contract (§8 rule 5), not a question left for the developer, and AC 8(c)/8(d) pin it
from both directions. Nothing in this story touches `enforce_household_scope()` or renames any
existing trigger — the comment at `04_triggers.sql:147-158` is explicit that renaming any
`validate_*` trigger is a migration-time insert outage, because Postgres fires same-event
BEFORE triggers in alphabetical name order and those names are chosen to sort after every
`set_*`.

### Testing standard

`app` project for `FilesTab.test.tsx` — **`vitest-browser-react` in real Chromium with
`TestMemoryRouter` from `ra-core`** [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12, :60-75].
There is no React Testing Library in this repo: `@testing-library/*` is not a dependency and
`screen.queryByText` has zero hits in `src/`. Negative assertions use
`await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`. AAA structure,
descriptive test names, no `waitForTimeout`, ≥80% coverage on new code
[Source: .claude/rules/testing.md].

`db` project for `entity_files.sql`. Cross-tenant negatives are **one login with memberships
in two accounts**, never two disjoint users.

Validation commands: `npm run typecheck`, `npx vitest run`, `npm run test:unit:db`,
`npm run lint`, `npm run build` (equivalently `make typecheck` / `make test` / `make lint` /
`make build`) [Source: package.json:6-17].

Every `npx supabase` invocation must be prefixed `DBUS_SESSION_BUS_ADDRESS=/dev/null` or it
hangs on the keyring.

**Security review required** — this story adds storage RLS, a new domain table, new
policies, new grants and a migration
[Source: .claude/rules/security-triggers.md — "File system operations", "Database queries or
migrations", "Supabase RLS policies"].

### Migration workflow

Declarative schema first (`supabase/schemas/` is the source of truth), then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f <name>`, hand-check the
generated file, then `migration up --local`. `02_functions.sql` edits must preserve exact
`pg_dump` form or the next `db diff` produces a phantom diff (AGENTS.md). Rehearse the whole
sequence against a freshly reset local database (`npx supabase db reset --local` + seed +
`npm run test:unit:db`) before it goes anywhere near production.

### Project Structure Notes

- `src/components/atomic-crm/entity360/tabs/FilesTab.tsx` (beside `ActivityTab.tsx`,
  `NotesTab.tsx` — `entity360/` does not exist on `main`; 3.1 creates it).
- `src/components/atomic-crm/providers/supabase/entityFiles.ts` (new).
- `src/components/atomic-crm/providers/fakerest/internal/entityFiles.ts` (new, AD-10 mirror).
- `supabase/tests/entity_files.sql` + `entity_files.test.ts` (new).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:538-550] — Story 3.7's epic-level AC
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — §8 (universal tab props, target-type vocabulary, purge, the `entity_files` scope ruling), §10 (ownership), §12 (build order), §13 (test shapes)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — :57-60] — one scoping axis, RLS on `current_context_id()`, no `anon` grants, `security_invoker` views
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9 — :98-101] — recipients never get a raw URL; R2 + Worker proxy-stream is the end state, out of scope here
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10 — :103-106] — the dataProvider is the only CRUD seam; summary views for lists; keep FakeRest in sync
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23 — :172-176] — *single*, *shidduch*, *shadchan*, *reference*; never "child"
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24 — :177-180] — one shell, one route convention, one descriptor
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-172] — UX-DR4 shared tab vocabulary (Files is one of the six) and UX-DR5's per-entity matrix
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187] — UX-DR11 empty/loading/error, light and dark, 375px
- [Source: supabase/schemas/07_storage.sql:19, :21-23, :25-44] — the private `attachments` bucket and the three context-scoped policies this story copies
- [Source: supabase/schemas/01_tables.sql:45-47, :304-306, :675, :680, :729, :85] — the `tasks` target check, the visibility vocabulary, the FK shapes, the target-index shape, the FORCE-RLS gap comment
- [Source: supabase/schemas/02_functions.sql:201, :249, :387-402, :1799-1817] — `current_context_id()`, `set_active_context()`, `enforce_household_scope()`, `purge_polymorphic_dependents()`
- [Source: supabase/schemas/04_triggers.sql:123-125, :147-158, :159-209] — the `set_*_account_id` shape, the trigger-naming warning, the 13 household-only tables
- [Source: supabase/schemas/05_policies.sql:33-36] — the `for all` account-scoped policy shape
- [Source: supabase/schemas/06_grants.sql:452-458, :460-462, :615-616, :693-700] — view grants, sequence revoke, column-level update grant, the `inbox_items` table-grant block
- [Source: supabase/tests/context_rls_hardening.sql:21-25, :68-251] — the storage-RLS harness, the `storage.allow_delete_query` mechanics, and the no-UPDATE-policy tripwire this story must not break
- [Source: supabase/tests/references_entity.test.ts:21-28, supabase/tests/dbSuiteHelpers.ts:15] — the `db`-project runner shape
- [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:84, :400, :538-559, :566-593, :643, :654-661, :663-731] — the custom-methods overlay, `lifeCycleCallbacks`, the TTL constant, `getCurrentAccountId`, `uploadToBucket`
- [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:693-749, providers/fakerest/dataGenerator/types.ts:22-44] — the AD-10 mirror seam and the `Db` collection list
- [Source: src/components/admin/file-input.tsx:132, src/components/admin/file-field.tsx:26-31] — why neither is reused
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the only in-repo `?raw` precedent
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12, :60-75] — the browser-mode test idiom
- [Source: src/components/atomic-crm/reminders/reminderEntity.ts:21-25] — `RESOURCE_FOR_TARGET`, widened by 3.9
- [Source: node_modules/@supabase/storage-js/dist/index.d.mts:1209-1221, :1506-1512] — `createSignedUrl(path, expiresIn, { download })` and `remove(paths)`
- [Source: 3-5-universal-activity-tab.md] — `current_member_id()`, `UniversalTabProps`, the `?raw` vocabulary guard, the `singles`/`shadchanim` purge triggers
- [Source: 3-9-recordlink-primitive.md] — `ENTITY_TARGET_TYPES` / `EntityTargetType`, the widened `RESOURCE_FOR_TARGET`
- [Source: .claude/rules/security-triggers.md, .claude/rules/testing.md, .claude/rules/coding-style.md, .claude/rules/english-only.md, .claude/rules/typescript.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (bmad-dev-story workflow, single-agent execution — dispatched directly, not
through the multi-agent harness).

### Debug Log References

- `STACK_ID=2 STACK_OWNER=3-7 make start-supabase-e2e STACK_ID=2` — isolated Supabase stack
  (db port 54362), used for all schema/migration/db-test work in this story.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-2 --local -f add_entity_files`
  — generated `supabase/migrations/20260729070301_add_entity_files.sql`.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db reset --workdir .supabase-e2e-2 --local`
  — full replay of all migrations from scratch, used to validate the hand-fixed migration
  end-to-end (not just against the already-migrated stack).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-2 --local`
  (no `-f`) after the reset — reported "No schema changes found".
- `STACK_ID=2 STACK_OWNER=3-7 npm run test:unit:db` — 449/449 passed (13 files, 1 new:
  `entity_files.test.ts`, 21 checks including its own sanity check).
- `STACK_ID=2 STACK_OWNER=3-7 npx vitest --project app run` — 853/853 passed (111 files).
- `npm run typecheck`, `npm run lint`, `npx prettier --check .` — all clean on every file this
  story touched (remaining prettier warnings are pre-existing, unrelated files: CI workflow
  YAML, doc `.mdx`, `.lintstagedrc`).
- `npm run build` — succeeded (pre-existing chunk-size warning, unrelated to this story).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null STACK_ID=2 STACK_OWNER=3-7 make stop-supabase-e2e STACK_ID=2`
  — stack released at the end of the session.

### Completion Notes List

**AC 1 — storage bucket + 3 policies.** Shipped exactly as specified. `db diff` genuinely
omitted the bucket-row insert (migra diffs schema, not `storage.buckets` data), confirmed
empirically and added by hand to the migration, matching the story's own prediction.

**AC 1 tripwire, demonstrated by hand:** adding a fourth (UPDATE) `entity-files` storage
policy turns `context_rls_hardening.sql`'s table-wide "no UPDATE-applicable policy exists on
storage.objects" check red (1 failed / 21); removing it restores green. This is the one
cross-story tripwire the story calls out by name, and it fires exactly as predicted.

**AC 2/3 — table, view, triggers, grants: a real migra gap, not merely the anticipated bucket
gap.** Hand-checking the generated migration against `information_schema.role_table_grants`
surfaced two additional, unanticipated omissions beyond the story's own bucket-insert
warning:
1. `entity_files`'s table grant lacked its `revoke all on table ... from anon, authenticated`
   half. This database's `alter default privileges ... grant all on tables to authenticated`
   (an earlier migration) fires the moment `CREATE TABLE entity_files` runs *on the real
   target database* — something migra's snapshot-based diff does not simulate — so
   `authenticated` ended up with TRUNCATE/REFERENCES/TRIGGER in addition to the intended
   SELECT/INSERT/DELETE. TRUNCATE bypassing RLS is exactly the class of gap this codebase's
   own grants file repeatedly calls out as dangerous.
2. `entity_files_summary`'s grants (select for authenticated, all for service_role) were
   **entirely absent** from the generated migration — migra emitted zero ACL statements for
   the new view. Applying the migration as generated left `authenticated` unable to `SELECT`
   the view its own `FilesTab` reads through.

Both were caught by hand-checking the *actual resulting privilege state* after applying the
migration (not just eyeballing the generated SQL), fixed by copying the exact `06_grants.sql`
statements into the migration, and reverified via a full `supabase db reset` (all migrations
replayed from scratch) followed by `db diff` reporting "No schema changes found" and a direct
`information_schema` query confirming `entity_files`/`entity_files_summary` grants match the
schema exactly. `entity_files_id_seq`'s sequence grants matched the schema on the first try —
its `authenticated=rwU` (extra UPDATE beyond the intended `usage, select`) is not a defect: it
is byte-identical to the already-shipped `inbox_items_id_seq`'s real grants (verified by
direct comparison), i.e. the accepted, pre-existing shape the story's own AC copies.

**`PENDING_DB_WIDENINGS` guard, restructured, not just narrowed.** The pre-existing
`pendingDbWidenings.test.ts` had a "before" test whose own docstring said it depended on
`entity_files` not existing yet ("the table for entity_files does not exist yet, so it cannot
supply that same fixture shape"). Once this story creates the table for real, that test would
have started silently proving nothing (its synthetic fixture text, built by prepending the
now-real `TABLES_SQL`, would match the REAL constraint text first via regex, never reaching
the appended fake narrow one). Rewrote it into the same "revert-the-migration fixture" shape
the `tasks_target_type_check` / `interactions_target_type_check` tests already use, and added
a new, fully synthetic-source test that exercises the actual `findOffendingConstraints`
top-level function (not just its two helpers) independent of the real schema's current
content — so the guard keeps a genuine, demonstrable red run rather than depending on
transient repo state.

**AC 5(a)/6 — a real accessibility-role collision, found and fixed during testing, not
theorized.** `<input type="file">` is exposed with ARIA role "button" by the browser/Playwright
accessibility tree, identical to the visible trigger `<Button>` sitting next to it — so
`getByRole("button", { name: "Upload a file" })` matched two elements (`FilesTab.test.tsx`
failed with a genuine Playwright "strict mode violation" on first run, not a flake). Fixed by
marking the raw file inputs `aria-hidden="true"` + `tabIndex={-1}` (the visible `Button` is
the real, sole accessible affordance; the input is triggered programmatically and should never
have had its own identity in the accessibility tree) — `getByLabelText` still finds the input
for `.upload()` since aria-label matching there does not depend on the accessibility-tree
role/name computation the same way `getByRole` does. Both are real production-code
improvements, not test-only workarounds.

**Task 6 (AC 8) — all seven check groups demonstrated red then green by hand**, per the
story's own requirement, on the local (stack 2) database:
- (a) storage — loosened the "Entity files writable within account" INSERT policy's `with
  check` to `true`: the "INSERT under B's prefix raises" check went red (insert unexpectedly
  succeeded); restored.
- (b) table — loosened "Entity files scoped to account" to `using (true) with check (true)`:
  all three (b) checks went red; restored.
- (c)/(d) — attached a simulated `validate_entity_files_household_scope` trigger (calling the
  real `enforce_household_scope()`): both the shadchanus-positive insert (c) and the
  no-such-trigger catalog check (d) went red together, exactly as AC 8(c)/(d)'s "pin it from
  both directions" language intends; dropped the trigger to restore.
- (e) — dropped `entity_files_visibility_target_check`: the private_parent-on-reference
  rejection check went red (insert unexpectedly succeeded); restored.
- (f) — dropped `entity_files_storage_path_scope_check`: the mismatched-prefix rejection check
  went red; restored.
- (g) — granted `select` to `anon` on both `entity_files` and `entity_files_summary`: all four
  (g) checks went red (SELECT unexpectedly succeeded / a privilege now exists); restored.

Full suite reconfirmed green (449/449) after every restore.

**Deviation from contract §8 rule 3, as the contract itself anticipates (AC 7):** the
contract's own text says the second half — "and to delete the storage objects" — is not
implementable inside `purge_polymorphic_dependents()`, for the reasons AC 7(b) states
(`storage.protect_delete()`'s statement-level guard, and row deletion not reclaiming bytes
even with it lifted). Implemented exactly as the contract prescribes: SQL purges the four
parent types' `entity_files` rows; byte cleanup is four `beforeDelete` `ResourceCallbacks`
entries in `providers/supabase/dataProvider.ts`, generated from `ENTITY_TARGET_TYPES` via
`RESOURCE_FOR_TARGET` rather than four hand-written entries. The residual orphan-bytes
limitation (a parent deleted outside the SPA's dataProvider) is stated in code comments on
`purge_polymorphic_dependents()` and in AC 7(c)'s own text, not hidden.

**Not implemented / explicitly out of scope, stated rather than silently skipped:**
- No dedicated test file for `providers/fakerest/internal/entityFiles.ts` — the dispatch's own
  path-ownership list does not include one (unlike `providers/supabase/entityFiles.test.ts`,
  which is listed), and several other FakeRest `internal/` modules in this repo also ship
  without a dedicated test file. Coverage comes instead from `FilesTab.test.tsx`'s one
  real-FakeRest-provider round-trip test (upload → list → persisted row with the correct
  `target_type`/`target_id`), which does exercise the module end-to-end.
- No cascade-cleanup mirror added to the FakeRest provider for parent-record deletes (i.e.,
  FakeRest does not emulate `purge_polymorphic_dependents()`'s row cleanup for entity_files on
  a demo-mode `singles`/`shadchanim`/`references`/`shidduchim` delete). This is consistent with
  the FakeRest provider's existing behaviour for `tasks`/`interactions` (neither is cleaned up
  on a FakeRest parent delete today either) — adding it only for `entity_files` would be new,
  undirected scope, not a regression this story introduces.
- A single combined migration (`add_entity_files.sql`) captures Tasks 1–3 together rather than
  three separate `db diff` invocations. `db diff` diffs the declarative schema files against
  whatever migrations have already landed — since all three tasks' schema edits were written
  before the first `db diff` ran, one invocation captured all of them together. Functionally
  equivalent; noted as a deviation from the task list's literal three-invocation phrasing.

**Something in the contract believed to be wrong, or at least incomplete:** contract §13 rule
2's "prove it red first" guidance, and the story's own AC 5(b)/Task 5 instructions, are
followed faithfully — but the migra-diff gaps found in AC 2/3 above are a *process* risk the
contract and story don't call out at all (only the bucket-row gap is anticipated). Worth
recording for future stories touching `06_grants.sql`+a brand-new table/view in the same
migration: **always hand-verify the actual post-migration `information_schema` grant state**,
not just that the generated SQL "looks plausible" — a generated migration can be syntactically
fine and still leave the database in a materially different privilege state than the
declarative schema describes, silently, because of this database's own default-privilege
customization interacting with fresh `CREATE TABLE`/`CREATE VIEW` statements in a way the diff
tool's snapshot comparison does not model.

### File List

**Schema (declarative source of truth):**
- `supabase/schemas/01_tables.sql` — `entity_files` table (4 constraints), 2 FKs, 2 indexes.
- `supabase/schemas/02_functions.sql` — `set_entity_files_uploaded_by()`; extended
  `purge_polymorphic_dependents()` with the fourth (`entity_files`) delete.
- `supabase/schemas/03_views.sql` — `entity_files_summary` (`security_invoker = on`).
- `supabase/schemas/04_triggers.sql` — `set_entity_files_account_id`,
  `set_entity_files_uploaded_by`.
- `supabase/schemas/05_policies.sql` — `entity_files` RLS + the `for all` account-scoped policy.
- `supabase/schemas/06_grants.sql` — `entity_files` / `entity_files_summary` /
  `entity_files_id_seq` grants, including the column-level `grant update (visibility)`.
- `supabase/schemas/07_storage.sql` — the `entity-files` bucket insert + its three storage
  policies (select/insert/delete, no update).

**Migration:**
- `supabase/migrations/20260729070301_add_entity_files.sql` (new) — generated via `db diff`,
  then hand-fixed for the bucket-row insert and the grant gaps recorded above.

**Database tests:**
- `supabase/tests/entity_files.sql` (new) — AC 8, all seven check groups.
- `supabase/tests/entity_files.test.ts` (new) — the `db`-project runner.

**TypeScript types:**
- `src/components/atomic-crm/types.ts` — `EntityFileVisibility` (aliases `ShidduchVisibility`),
  `EntityFile`, `EntityFileSummary`.
- `src/components/atomic-crm/entity360/pendingDbWidenings.ts` — `PENDING_DB_WIDENINGS` now `[]`.
- `src/components/atomic-crm/entity360/pendingDbWidenings.test.ts` — restructured the
  `entity_files_target_type_check` "before" test into the revert-fixture shape; added a
  synthetic-source `findOffendingConstraints` red-proof; added the "parses the real
  entity_files_target_type_check values" green test.

**Supabase dataProvider:**
- `src/components/atomic-crm/providers/supabase/entityFiles.ts` (new) — `uploadEntityFile`,
  `signEntityFileUrl`, `deleteEntityFile`, `removeEntityFileObjects`,
  `ENTITY_FILE_URL_TTL_SECONDS`.
- `src/components/atomic-crm/providers/supabase/entityFiles.test.ts` (new).
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — wired the three custom
  methods; added the four `beforeDelete` `ResourceCallbacks` entries to `lifeCycleCallbacks`,
  generated from `ENTITY_TARGET_TYPES` via `RESOURCE_FOR_TARGET`.

**FakeRest dataProvider (AD-10 mirror):**
- `src/components/atomic-crm/providers/fakerest/internal/entityFiles.ts` (new) — the
  in-memory blob-URL mirror of the three Supabase methods, plus `removeEntityFileObjects`.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — wired the three custom
  methods (resolving account id + uploader membership), `entity_files_summary` list/getOne
  enrichment (`uploaded_by_name`).
- `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts` — `entity_files:
  EntityFile[]` on `Db`.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` — seeds it `[]`.

**UI:**
- `src/components/atomic-crm/entity360/tabs/FilesTab.tsx` (new) — the universal Files tab.
- `src/components/atomic-crm/entity360/tabs/FilesTab.test.tsx` (new).
- `src/components/atomic-crm/entity360/tabs/FilesTab.guard.test.ts` (new) — the AC 5(b)
  schema-shape guard + the `getPublicUrl` regression tripwire.

**i18n:**
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — `entity360.files.*`.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — `entity360.files.*`
  (French).

**Not touched:** `registry.json` (regenerates automatically via the `make commit` pre-commit
hook when the tree is quiet at commit time; not hand-edited).

## Change Log

- 2026-07-29 — Story 3.7 implemented end-to-end: `entity-files` storage bucket + 3 policies,
  `entity_files` table/view/triggers/policy/grants at full four-value target-type parity,
  `purge_polymorphic_dependents()` extended, the three-method dataProvider seam (Supabase +
  FakeRest mirror), `FilesTab.tsx`, and the full AC 8 negative suite (all 7 groups
  demonstrated red then green by hand). All gates green: `make typecheck`, `make lint`,
  `npx prettier --check .`, `npx vitest run` (app: 853/853, db: 449/449), `make build`,
  `db diff` clean. Two migra-diff gaps found and hand-fixed beyond the story's own
  anticipated bucket-row gap (see Completion Notes): `entity_files_summary`'s missing view
  grants, and `entity_files`'s missing `revoke all` (leaving TRUNCATE reachable to
  `authenticated`). Status → review.
