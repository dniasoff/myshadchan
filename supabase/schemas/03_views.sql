--
-- Views
-- This file declares all views in the public schema.
--

-- Dedupe "catch" count per shidduch (E3): how many OTHER suggestions in the same
-- account look like the same person ("you've come across this person before").
-- Feeds the board card's calm "Suggested before" chip via
-- shidduchim_summary.catch_count below, so the board reads catches in the SAME
-- single query as the cards -- never an N+1 lookup per card.
--
-- The gate mirrors match_identity() (02_functions.sql) EXACTLY: a name match
-- (exact normalized OR Hebrew/English variant key) corroborated by at least one
-- non-name signal (parents / seminary / shul / location). A name match alone
-- NEVER counts -- that is the false-merge this whole design forbids. Shidduchim
-- carry no phone signal, so match_identity's phone branch is moot here; the full
-- evidence for the review panel comes from catch_shidduch(), which calls
-- match_identity() directly. security_invoker keeps the identity_signals RLS
-- (account scope, PRV-2) applying to the caller.
create or replace view public.shidduchim_catch_summary with (security_invoker = on) as
select
    a.target_id as shidduchim_id,
    a.account_id,
    count(distinct b.target_id) as catch_count
from public.identity_signals a
    join public.identity_signals b
        on b.account_id = a.account_id
        and b.target_type = 'shidduch'
        and b.target_id <> a.target_id
        and (
            (a.name_en_norm is not null and b.name_en_norm = a.name_en_norm)
            or (a.name_he_norm is not null and b.name_he_norm = a.name_he_norm)
            or (a.name_en_key is not null and b.name_en_key = a.name_en_key)
            or (a.name_he_key is not null and b.name_he_key = a.name_he_key)
        )
        and (
            (a.parents_norm is not null and b.parents_norm = a.parents_norm)
            or (a.seminary_norm is not null and b.seminary_norm = a.seminary_norm)
            or (a.shul_norm is not null and b.shul_norm = a.shul_norm)
            or (a.location_norm is not null and b.location_norm = a.location_norm)
        )
where a.target_type = 'shidduch'
group by a.target_id, a.account_id;

-- Board list/detail read path for the shidduchim pipeline (AD-10). Joins the
-- shadchan ("via {shadchan}")
-- and the single so the board card needs a single fetch. security_invoker
-- so the base-table RLS still applies to the caller. catch_count (E3) is a
-- 1:1 left join onto the pre-aggregated catch summary above, so it adds no row
-- multiplication and the board's "Suggested before" chip costs no extra query.
create or replace view public.shidduchim_summary with (security_invoker = on) as
select
    s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    -- Story 6.3 (AC 4/AC 7): free-text decision rationale can carry candid
    -- content, so it always reads NULL for a `single` caller — even on an
    -- otherwise fully visible suggestion. Postgres RLS is row-scoped (a
    -- policy decides whether a row comes back at all, never which columns
    -- do), so this one-column-on-an-otherwise-visible-row redaction lives in
    -- this security_invoker view's CASE, not in 05_policies.sql (Dev Notes,
    -- "Why close_reason redaction happens in a view, not a policy"). Same
    -- ordinal position as before — `create or replace view` can only append
    -- columns, never reorder them (the COLUMN-ORDER TRAP this file's own
    -- shadchan_stats comment already names).
    case
        when public.current_member_role() = 'single' then null
        else s.close_reason
    end as close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name as shadchan_name,
    sh.name_he as shadchan_name_he,
    c.first_name_en as single_first_name_en,
    c.first_name_he as single_first_name_he,
    c.last_name_en as single_last_name_en,
    c.last_name_he as single_last_name_he,
    count(distinct rl.id) as nb_references,
    count(distinct r.id) as nb_redts,
    coalesce(max(cat.catch_count), 0) as catch_count
from public.shidduchim s
    left join public.shadchanim sh on sh.id = s.shadchan_id
    left join public.singles c on c.id = s.single_id
    left join public.reference_links rl on rl.shidduchim_id = s.id
    left join public.redts r on r.shidduchim_id = s.id
    left join public.shidduchim_catch_summary cat on cat.shidduchim_id = s.id
group by s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;

-- The reference book's list read path (AD-10, mirrors shidduchim_summary).
-- Every count the list row shows comes from here, so the
-- list never N+1-fetches links, interactions and tasks per reference.
-- security_invoker keeps base-table RLS — including the join-to-parent
-- visibility on interactions — applying to the caller.
create or replace view public.references_summary with (security_invoker = on) as
select
    r.id,
    r.account_id,
    r.created_at,
    r.name_en,
    r.name_he,
    r.relationship,
    r.phone,
    r.school,
    r.grad_year,
    r.name_norm_en,
    r.name_norm_he,
    r.phone_norm,
    count(distinct rl.shidduchim_id) as linked_shidduchim_count,
    count(distinct rl.id) filter (
        where rl.call_status in ('answered', 'they_will_call_back')
    ) as contacted_count,
    max(i.created_at) filter (where i.kind = 'call_logged') as last_conversation_at,
    count(distinct t.id) filter (where t.done_date is null) as open_task_count
from public."references" r
    left join public.reference_links rl on rl.reference_id = r.id
    left join public.interactions i on i.target_type = 'reference' and i.target_id = r.id
    left join public.tasks t on t.target_type = 'reference' and t.target_id = r.id
group by r.id;

-- One row per reference<->shidduch conversation. Serves BOTH renderings of the
-- same data: the per-shidduch call-log cards on a reference's detail page, and
-- the repeat-recognition panel ("you've spoken to them about N other singles").
-- effective_relationship resolves the per-link override against the reference's
-- own default, so the same person can read "shul rabbi" on one card and "family
-- friend" on another.
create or replace view public.reference_links_summary with (security_invoker = on) as
select
    rl.id,
    rl.account_id,
    rl.created_at,
    rl.reference_id,
    rl.shidduchim_id,
    rl.resume_id,
    rl.call_status,
    rl.what_they_said,
    rl.conversation_log,
    rl.relationship_override,
    coalesce(rl.relationship_override, r.relationship) as effective_relationship,
    coalesce(jsonb_array_length(rl.conversation_log), 0) as conversation_log_count,
    r.name_en as reference_name_en,
    r.name_he as reference_name_he,
    r.phone as reference_phone,
    s.name_en as shidduch_name_en,
    s.name_he as shidduch_name_he,
    s.pipeline_state as shidduch_pipeline_state,
    s.visibility as shidduch_visibility,
    s.single_id,
    c.first_name_en as single_first_name_en,
    c.first_name_he as single_first_name_he
from public.reference_links rl
    left join public."references" r on r.id = rl.reference_id
    left join public.shidduchim s on s.id = rl.shidduchim_id
    left join public.singles c on c.id = s.single_id;

-- Per-single pipeline counts (E6). One row per single with the single's own
-- fields plus a total suggestion count and an "open" (still-in-triage) count,
-- so the roster card shows "N in pipeline" without an N+1 fetch. Mirrors the
-- other summary views: account-scoped by base-table RLS via security_invoker,
-- single-column join (singles.id is a global identity PK). "Open" is the
-- three active triage states (new/look_into/not_sure); the terminal states
-- (for_sure_not/yes/unsure/no, per pipelineStates.ts) are excluded so the count
-- reflects work still in flight, not the single's whole history.
create or replace view public.singles_summary with (security_invoker = on) as
select
    c.id,
    c.account_id,
    c.created_at,
    c.first_name_en,
    c.first_name_he,
    c.last_name_en,
    c.last_name_he,
    c.gender,
    c.dob,
    c.community,
    c.status,
    c.member_id,
    count(s.id) as total_shidduchim,
    count(s.id) filter (
        where s.pipeline_state in ('new', 'look_into', 'not_sure')
    ) as open_shidduchim
from public.singles c
    left join public.shidduchim s on s.single_id = c.id
group by c.id;

-- Per-shadchan productivity stats (E5). One row per shadchan, keyed on the
-- shadchan's id, mirroring the "Suggestions from this shadchan" list which
-- filters shidduchim by shadchan_id (the latest-redt provenance, FR18) — so the
-- tile totals match the list beneath them. Counts:
--   nb_suggestions   = shidduchim currently attributed to this shadchan
--   nb_progressed    = of those, any that moved past 'new'
--   nb_reached_yes   = of those, any that reached the 'yes' decision
--   last_redt_date   = the most recent redt_date among shidduchim currently
--                      attributed to this shadchan (Story 5.9, RULING 8) —
--                      "last time this shadchan was the CURRENT redter of
--                      something", the same current-attribution scoping as
--                      the three counts above, NOT "the last time this
--                      shadchan redt anything ever" (a redt later superseded
--                      by a different shadchan is invisible here, same as it
--                      already is to nb_suggestions).
--   nb_open_singles  = distinct singles, among those shidduchim, still in an
--                      active triage state (new/look_into/not_sure) —
--                      "how many singles", not "how many shidduchim"; reuses
--                      singles_summary's own "open" predicate verbatim
--                      (:172-190 above), not a second definition of open.
-- A "led to dates" metric is deliberately omitted: date_records carries no
-- shadchan linkage, so there is no honest field to count. Zero new joins:
-- both new columns come off the same shidduchim row already joined here —
-- do NOT join redts, which would silently fan out (inflate) the three
-- existing counts, none of which is `distinct`. account-scoped by base-table
-- RLS via security_invoker. New columns are appended at the end, never
-- inserted mid-list: `create or replace view` can only add trailing columns.
create or replace view public.shadchan_stats with (security_invoker = on) as
select
    sh.id,
    sh.account_id,
    count(s.id) as nb_suggestions,
    count(s.id) filter (where s.pipeline_state <> 'new') as nb_progressed,
    count(s.id) filter (where s.pipeline_state = 'yes') as nb_reached_yes,
    max(s.redt_date) as last_redt_date,
    count(distinct s.single_id) filter (
        where s.pipeline_state in ('new', 'look_into', 'not_sure')
    ) as nb_open_singles
from public.shadchanim sh
    left join public.shidduchim s on s.shadchan_id = sh.id
group by sh.id;

-- Story 3.6 (AC 5): resolves a note's author identity server-side, in one
-- query, so NotesTab never re-derives "may I edit this" in TypeScript.
-- security_invoker keeps interactions' own RLS (05_policies.sql) applying
-- to the caller through this view -- a caller reads exactly the rows their
-- SELECT policy already lets them read, nothing wider.
--
-- Every column of public.interactions is listed EXPLICITLY, never `i.*`:
-- `i.*` makes `supabase db diff` unstable the moment the base table gains a
-- column, per this project's own migration-hygiene rule.
--
-- author_name: LEFT JOIN account_members -> members, both on identity keys
-- that survive a persona archive/re-add round-trip (account_members.id is
-- NOT one of them -- see can_moderate_note()'s own comment,
-- 02_functions.sql, "Why authorship joins on user_id"). Under
-- security_invoker, members' own SELECT policy (:18-29 above) still applies:
-- an author who no longer holds an ACTIVE membership of this row's account
-- yields author_name = null through the LEFT JOIN, never an error and never
-- a leaked name.
--
-- can_moderate: mirrors the UPDATE policy's moderation clause EXACTLY --
-- `kind not in ('note', 'single_input') or (kind = 'note' and
-- can_moderate_note(...))`, character for character the clause 05_policies.sql
-- ANDs into `"Interactions updatable by author or owning role"`, in both its
-- `using` and its `with check` halves. This column is a UI affordance: the
-- one thing it must never do is advertise an action the database will refuse.
-- Any edit to that policy clause has to be made here in the same commit.
--
-- Calling can_moderate_note() unconditionally (the Story 3.6 shape) reported
-- `can_moderate = false` for a non-note row (call_logged, status_change,
-- merge, link_created, link_removed) authored or actively owned by someone
-- else, even though the UPDATE policy's escape lets ANY account member update
-- it -- harmless while only NotesTab reads this view (it filters to
-- kind = 'note'), but a live lie the day AC 8's own written trigger for
-- revisiting moves ActivityTab onto this view.
--
-- STALE-COMMENT CORRECTION (Epic 6). The text here used to describe the
-- Story 5.7 review-fix shape, `kind not in ('note', 'single_input') or
-- can_moderate_note(...)`, which put `single_input` in the SAME bucket as
-- `note`. Story 6.4 decided `single_input` is APPEND-ONLY -- no role updates
-- it, not an owning-role member, not a parent_admin, not its own author (see
-- that policy's comment, and the story's Dev Notes "Append-only -- decided,
-- against a shipped nuance"). The policy was rewritten; this column was not,
-- and the comment kept asserting a mirror that no longer held. The
-- consequence was live: `can_moderate_note()` returns true for a row's
-- AUTHOR, so a single reading back her own submitted input was told
-- `can_moderate = t` on a row every UPDATE path refuses -- an edit button the
-- database answers with 0 rows affected. Both the predicate and this
-- paragraph are the correction. A view that drifts from a policy is not
-- self-announcing: only a check that asserts the two AGREE catches it, which
-- is what (g3) in supabase/tests/interaction_note_authorship.sql now does.
--
-- Why the visibility half of the UPDATE policy still needs no mirroring here:
-- a row this view returns has already passed a SELECT policy, and the general
-- SELECT policy's account-scope and target-visibility conjuncts are preserved
-- byte-identical in the UPDATE policy -- so on the "any member may update"
-- branch the UPDATE policy's own visibility conjunct is guaranteed to hold
-- too, and can_moderate can be `true` outright there.
--
-- That argument covers the visibility conjuncts ONLY. It deliberately does
-- NOT extend to the UPDATE policy's `current_member_role() <> 'single'`
-- conjunct, because Story 6.4 broke its premise: `interactions` now carries
-- TWO permissive SELECT policies, and the second (`"Single reads own input"`)
-- is NOT byte-identical to UPDATE's predicate -- it is the one path by which
-- a `single`-role caller sees any row at all. The reason can_moderate is
-- nonetheless correct for that caller today is narrower and worth writing
-- down: `"Single reads own input"` restricts a single to `kind =
-- 'single_input'` rows they authored, and on `single_input` the clause above
-- already evaluates to false -- so the role conjunct has nothing left to
-- decide. That is a coincidence of the current carve-out, not a standing
-- guarantee. If a later story widens what a `single` may READ to any other
-- kind (Story 6.5's self-manager parity work is the live candidate), this
-- column starts over-reporting for that role the moment it does, and
-- `and public.current_member_role() <> 'single'` has to be ANDed in here.
create or replace view public.interactions_summary with (security_invoker = on) as
select
    i.id,
    i.account_id,
    i.created_at,
    i.target_type,
    i.target_id,
    i.scope,
    i.reference_link_id,
    i.actor_member_id,
    i.kind,
    i.body,
    i.metadata,
    i.deleted_at,
    nullif(btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '') as author_name,
    (i.kind not in ('note', 'single_input') or (i.kind = 'note' and public.can_moderate_note(i.actor_member_id))) as can_moderate
from public.interactions i
    left join public.account_members am on am.id = i.actor_member_id
    left join public.members m on m.user_id = am.user_id;

-- Story 3.7 (AC 3): the Files tab's read surface. FilesTab LISTS through this
-- view and WRITES through public.entity_files directly (AD-10). security_invoker
-- keeps entity_files' own RLS (05_policies.sql) applying to the caller through
-- this view — account scoping comes entirely from the base table, the view
-- declares none of its own.
--
-- Every column of public.entity_files is listed EXPLICITLY, never `ef.*`
-- (migration-hygiene rule, AGENTS.md: `ef.*` makes `supabase db diff`
-- unstable the moment the base table gains a column).
--
-- uploaded_by_name: the same user_id-keyed join interactions_summary uses
-- above for author_name, so a persona archive/re-add round-trip does not
-- strand an uploader's name (account_members.id is not one of the identity
-- keys that survive it).
create or replace view public.entity_files_summary with (security_invoker = on) as
select
    ef.id,
    ef.account_id,
    ef.created_at,
    ef.target_type,
    ef.target_id,
    ef.storage_path,
    ef.file_name,
    ef.mime_type,
    ef.size_bytes,
    ef.visibility,
    ef.uploaded_by_member_id,
    nullif(btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '') as uploaded_by_name
from public.entity_files ef
    left join public.account_members am on am.id = ef.uploaded_by_member_id
    left join public.members m on m.user_id = am.user_id;
