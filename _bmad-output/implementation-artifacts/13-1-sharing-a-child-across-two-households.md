# Story 13.1: Sharing a child across two households

Status: **specification — not ready for dev.** Ten product questions are open (see "What still
needs a decision"), and the tenancy model does not currently support what this story asks for.
Nothing here should be built until the questions in §3 are answered and the architecture
amendment in §5 is accepted or rejected.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent whose child's other parent belongs to a different family,
I want to give that parent continuing access to our child's record — our child's, and nothing
else of mine —
so that both of us can look after this shidduch together, seeing the same notes, the same
references and the same conversations, without either household opening its front door to the
other.

## Position in Epic 13

**1st of 2.** Story 13.2 (someone leaves the household) is independent of this one and may be
built first; they are placed in this order because 13.1 is the larger question and 13.2's
answers are narrower once it is settled. Neither blocks the other, but **13.2 must know 13.1's
answer to one thing**: when a parent is removed from a household and keeps access to a child,
that "keeps access" *is* the grant this story defines. If 13.1 is deferred, 13.2's "the admin
chooses whether that person keeps access" reduces to "keeps their membership" — a much weaker
promise, and one that hands them the whole household rather than one child. That coupling is
recorded in 13.2 §"What this story cannot promise without 13.1".

## 1. What this is actually for

The framing that matters is **not** "divorce handling". It is **granting another household
continuing access to a specific child**, and the everyday version of it is proactive and
unremarkable:

- A father and mother who are no longer married, each in their own family now, both looking
  after the shidduch of a child they share.
- A step-parent in the new household who is genuinely doing the work and needs the record.
- A grandparent, an aunt, an older married sibling — someone outside the household who has taken
  this child's shidduch on.

All three are the same shape: **one child, two households, one live record.** Divorce is one
occasion for it, not the mechanism. A product that only offers this as part of a "family
breakdown" flow will not be reached for by the grandmother who is doing most of the calling, and
it will make the divorced father's first use of it feel like a status declaration. It is not a
status declaration. It is an access grant about one child.

**The settled decisions** (from the owner; do not re-litigate):

1. **Shared by default, with the option to sever.** Both households see the same live records
   and each other's updates. Either side may later cut the link, and takes a copy of what they
   could see at that moment.
2. **The household's initial admin can eject a parent, and chooses whether that person keeps
   access to the child.** Ejection and access are two separate outcomes of one decision.
3. **Access is per-child, never per-household.** The other parent sees their own child. Not the
   rest of the family, not the new spouse's children, not the household's shadchan book, not its
   reminders, not its inbox. This constraint is the entire reason the previous-marriage case is
   safe to offer at all.

## 2. What was established by investigation

Everything in this section was read out of the shipped schema and code at `1fbe0e9`. It is fact,
not proposal.

### 2.1 There is no "creator" of an account anywhere in the schema

`public.accounts` (`supabase/schemas/01_tables.sql:176-250`) has **no `created_by`, no
`creator_id`, no `founding_member_id`** — no column of any kind naming who made it. The nearest
thing in the product is `account_members.invited_by`, and it is derivable rather than stored:

- `add_persona()` provisions a new context at three sites
  (`02_functions.sql:775-780`, `:818-823`, `:842-847`) and **omits `invited_by` at all three**,
  so the provisioning member's row has `invited_by IS NULL`.
- Every subsequent member arrives through `accept_invite()`, which inserts
  `(account_id, user_id, role, invited_by, status)` copying `v_invite.invited_by`
  (`02_functions.sql:164-166`) — so an invited member's row has a non-null `invited_by`.

So **"arrived without a named inviter" (`invited_by is null`) is a better proxy for the founding
member than lowest id** — but it is a proxy, and it has two documented holes:

- The **platform-ops genesis seed** writes an `invites` row with `invited_by` null
  (`01_tables.sql:308-332`, the table's own comment: *"a service_role genesis seed (invited_by
  null) … gets the very first household its very first member"*). `accept_invite()` copies that
  null through. So a genesis-seeded household's first member *also* has `invited_by IS NULL`,
  and the derivation cannot distinguish it from a self-provisioned one. In practice this is
  fine — either way it is the founding member — but it means the predicate answers "arrived
  without an inviter", not "created this account".
- **Nothing enforces at-most-one such row.** No unique index, no constraint, no trigger. Two
  rows with `invited_by IS NULL` in one account are legal today.

`order by am.id limit 1` filtered to `role = 'parent_admin' and status = 'active'` agrees with
the `invited_by IS NULL` derivation in every household this codebase can currently produce, and
the repo already uses `order by id limit 1` as a **defensive tiebreak, explicitly not a primary
guarantee** (see `current_member_id()`'s comment, `02_functions.sql:290-315`).

**Recommendation, for the decision in §3.1:** if "the initial admin" is going to carry authority
over other people's access, it should be **recorded, not inferred** — a stored
`accounts.founding_member_id`, backfilled once from the derivation above, is honest about the
fact that this is a durable property of the household rather than an accident of row order. A
derived answer that silently changes when a row is archived is the wrong substrate for "who may
eject whom".

### 2.2 The tenancy model cannot express per-child cross-household access today

This is not a gap that a policy tweak closes. Four independent mechanisms each assume one account:

**a. One scoping axis, by architectural rule.** AD-1: *"every domain row is scoped by **exactly
one** of two axes — a non-null `account_id` … **or** a non-null `connection_id`. Never both,
never neither."* Every household table's RLS is `USING (account_id = public.current_context_id())`
(`05_policies.sql`, e.g. `"Singles scoped to account"` at `:260`). A row belongs to one account
and is readable by the members of that one account.

**b. The child's whole subtree is welded to the child's account by composite foreign key.**
`shidduchim`, `resumes`, `date_records`, `listings`, `listing_withdrawal_locks`, `share_links`
and `invites.target_single_id` each carry
`foreign key (account_id, single_id) references public.singles(account_id, id)`
(`01_tables.sql:1409-1410, 1469-1470, 1484-1485, 1520-1521, 1694-1695, 1703-1704, 1718-1719`).
Every row about a child carries that child's household's `account_id`, by constraint. A second
household cannot write a row about that child under its own `account_id` — the FK refuses it.
So co-editing is not "let the other account write here too"; it is "let a second account write
rows stamped with the first account's id", which no policy in the tree currently permits and
which `set_account_id_default()` (`02_functions.sql:461`) actively works against.

**c. One active context per login, server-held.** AD-19: `member_state.active_account_id`,
resolved by `current_context_id()`, and *"Accepted cost: one active context per user, not per
browser tab."* A parent who holds memberships in two households is only ever *in* one of them.
So "seeing my child from my own household" and "seeing my child by switching into theirs" are
materially different products, and the difference is visible to the user on every page load.

**d. Documents are unreachable across the boundary — the object key itself is account-scoped.**
Every storage policy on the private `documents` bucket compares
`(storage.foldername(name))[1]` to `public.current_context_id()::text`
(`07_storage.sql:144-170`, and the same shape for `attachments` and `entity-files`). The key
grammar is `{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`. A second
household cannot form a readable path for the child's resume PDF or photo **regardless of what
RLS says about the rows**, because the account id is baked into the object name. Any
cross-household document access must either go through a service-role Worker (the 9.5 pattern)
or duplicate the bytes under the second account's prefix. There is no third option.

### 2.3 `connections` is not the foundation, and reusing it would break AD-20's core promise

`public.connections` (`01_tables.sql:987-1030`) links **exactly one household and exactly one
shadchanus account**, by column name (`household_account_id`, `shadchanus_account_id`) and by
trigger: `enforce_connection_kinds()` (`02_functions.sql:3465-3489`) raises if the household side
is not `kind = 'household'` or the shadchanus side is not `kind = 'shadchanus'`. Two households
cannot be connected. That is not an oversight to relax — AD-20's whole point is that *"a shadchan
**cannot address a household row at all** — FR113 is structural, not policy-dependent."* The
`connection_id` axis exists so conversations can live **outside** both accounts. Story 13.1 needs
the opposite: a second account reaching **into** the first account's rows. Widening
`enforce_connection_kinds()` to admit household↔household would put a third meaning on a table
whose entire safety argument is that it has one.

**What is worth reusing is `connection_invites`' shape, not `connections`' scope.**
`connection_invites` (`01_tables.sql:1049-1065`) is the product's one worked example of a consent
handshake that crosses a tenant boundary: a token that is **never stored** (only its SHA-256
`token_hash`), a short expiry, `status ∈ pending|accepted|revoked|expired`, and one function per
verb — `create_connection_invite()` / `preview_connection_invite()` / `revoke_connection_invite()`
/ `accept_connection_invite()` (`02_functions.sql:4330-4520`). A grant to another household needs
exactly that handshake and should copy it rather than invent a second one.

### 2.4 `share_links` (Story 9.5) is per-child already — and is the wrong thing

`share_links` (`01_tables.sql:1261-1271`) is genuinely keyed to one `single_id`, genuinely
revocable, genuinely logged (`share_access_log`), and genuinely serves bytes across the account
boundary via the `share/` Worker's service-role key. It is the closest thing in the tree.

It is still not this. It grants a **bearer token to an anonymous reader** — the far side has no
identity, no login, and no account. It is **read-only**, it **expires**, and it is deliberately
**manager-scoped** because a row in it "contains the bearer token, and the Worker serves the
files to whoever presents it using the service-role key — not the reader's own rights"
(9-5 Dev Notes, "Why share links are manager-scoped, not household-scoped"). It shows a child to
a shadchan. It cannot make a second parent a participant in that child's record.

**What is worth reusing:** its per-child key, its revocation semantics (`revoked_at`, not a
delete), and its access log. **What must not be reused:** the bearer token — a co-parent is a
known, authenticated person, and giving them a URL-shaped credential instead of a membership
would make "who saw this" unanswerable and revocation cosmetic.

### 2.5 Shared-by-default does mean records added later — and this is the opposite of listings

Confirmed, and it falls out of the mechanism rather than being a choice: a grant is on the
**child**, and any read is evaluated against the child's subtree at query time. There is no
snapshot step and nothing to re-publish. A shidduch redt tomorrow, a reference called next month,
a note added tonight — all visible to the collaborating household the moment they exist.

State this explicitly in the build, because the product's *other* cross-boundary mechanism does
the exact opposite and a builder may copy it out of habit: AD-21's `listings` are a **snapshot**,
and *"an edit to the underlying record **never** propagates to a live listing on its own."*
A grant is live; a listing is a photograph. They must not be implemented with the same reflexes.

## 3. What still needs a decision — product calls, not engineering ones

These are listed for the owner. **None of them should be settled by whoever builds this.** Each
one changes what gets built, not merely how.

### 3.1 How is "the initial admin" identified — and should it be recorded rather than derived?

Established in §2.1: there is no creator field; `invited_by IS NULL` is the best available
derivation; nothing makes it unique. **Decision needed:** derive it at read time, or add a
stored `accounts.founding_member_id` backfilled once? And is "founding member" even the right
authority — or should ejection require *any* `parent_admin`, or two of them, or the agreement of
both? (Recommendation in §2.1: record it. But whether the founder is the right person to hold
this power is a product question with no technical answer.)

### 3.2 Can an ejection be undone, and can access be re-granted later?

The product's established posture is that severance is reversible in shape: `connections` keeps
ended rows and its unique index is partial (`where status = 'accepted'`) *specifically* so a pair
can reconnect later (`01_tables.sql:1032-1037`). But `remove_persona()`'s own guard comment
states plainly that **"there is no un-archive path today"** (`02_functions.sql:928-945`) — the
product has never built a reinstatement anywhere. **Decision needed:** is a re-grant a brand-new
grant (clean, no memory of the old one) or a reinstatement of the old one (with its history)? And
does the ejected party have to accept again?

### 3.3 What if the initial admin is the one leaving?

Nothing in the schema anticipates this. `guard_persona_removal()` refuses only the narrow case
of *"the account's last active member, with domain data"* (`02_functions.sql:946-981`) — a
founder leaving a household that still has another admin passes it silently, and today would
leave whatever authority §3.1 attaches to "founding member" pointing at an archived row.
**Decision needed:** does the authority transfer (to whom, chosen by whom?), lapse, or block the
departure?

### 3.4 If both are `parent_admin`, can the ejected party eject back first?

Today both hold identical rights: `is_owning_membership_role()` returns true for `parent_admin`
and `self_manager` alike (`02_functions.sql:586-591`), and there is no seniority anywhere. Two
parents in one household, both admins, each able to remove the other, is a race — and the loser
of a race is a person who has just lost access to their child's record. **Decision needed:**
does §3.1's authority make this asymmetric, is there a waiting period, is the other party told
before it takes effect, or is mutual ejection simply allowed and first-writer-wins?

### 3.5 Is the other party told — on grant, and on sever?

The product has a notification substrate (`message_notifications`, `fan_out_message_notifications()`,
the `cron/` Worker) but it is thread-scoped; nothing today notifies about an access change.
**Decision needed:** notify on grant (surely yes — they cannot use access they do not know about),
and on sever? The severance case is the hard one. Silent removal is how you find out by opening
the app and seeing your child gone, which is cruel. An emailed "your access to X has been
removed" arriving in the middle of the worst month of someone's life is also a decision, not a
default. **This one is worth thinking about as a person, not as a feature flag.**

### 3.6 View only, or edit?

The owner's framing says "collaborate" and "each other's updates", which reads as edit. But edit
across the boundary is materially harder (§2.2b — the composite FKs stamp every row with the
*owning* household's `account_id`) and materially riskier. **Decision needed, with a suggested
shape:** read-everything, write-some — where "some" is the collaborative surface (notes,
reminders, call logs, references) and "none" is the structural surface (the child's own identity
row, publication, share links, inviting the child to a login). If edit is in scope, the build
must answer who the author of a cross-household note *is* — `interactions.actor_member_id` is
resolved by `current_member_id()` from the caller's active context, which for a collaborator
resolves to a membership in the *other* household.

### 3.7 What does "a copy" mean for documents on sever?

Established in §2.2d: rows can be copied cheaply; **files cannot be copied by reference at all**,
because the object key contains the account id and every storage policy compares it to
`current_context_id()`. So there are exactly three possible answers and each is a real product
choice: (a) rows only, and the departing household loses the resume PDFs and photos; (b) rows
plus a full byte-level duplication into the receiving account's prefix, doubling storage for
every shared child and creating a second, divergent set of files from that moment; (c) an export
bundle (a download, not a live record) — for which the precedent exists in
`settings/exportFamilyData.ts`, though it is JSON-only and currently exports four resources with
no files at all. **Decision needed.**

### 3.8 Where does the shared child appear for the collaborating parent — and what does that do to contexts?

Not asked, but unavoidable, and probably the largest UX consequence in the story. AD-19 allows
one active context at a time. Two possibilities: the shared child appears **inside the
collaborator's own household**, listed alongside their own children and marked as shared (simple
to reach, but it puts a row belonging to another account into a list that is otherwise entirely
their own); or it appears via a **context switch** into the granting household, filtered to that
one child (structurally cleaner, but the switcher then lists something that is not really a
household of theirs, and every screen is a household they do not own). **Decision needed.** It
determines what almost every screen looks like.

### 3.9 Sharing a child shares everyone the child's shidduchim mention

Not asked, and it needs to be said out loud before this ships. A child's record is not only about
the child. Their shidduchim name a suggested person, that person's parents, their seminary, their
community. Their references are real people who spoke candidly on the understanding that one
family was listening. Granting a second household access to a child grants it access to all of
that. That is probably correct and probably unavoidable — you cannot co-parent a shidduch while
seeing half of it — but **it should be a decision that was made, not one that happened.**
Specifically:

- **`shidduchim.close_reason`** is the one column `authenticated` may not `SELECT` at all
  (`01_tables.sql:425-432`); it holds candid decision rationale and is reachable only through
  `shidduch_close_reason()`. Does a collaborator get it?
- **`medical_notes`** (Story 5.5's sensitive tier) and **`private_parent` photos** (Story 5.4)
  are deliberately narrower than account-wide. Does a collaborator get them?
- **Private threads** are participants-only by AD-22 resolution rule 1 (*"Private beats scope"*),
  so a collaborator would **not** see them without being added — which is the right default and
  should be confirmed as deliberate, not discovered.

### 3.10 What the collaborating household may *not* do — three specific powers

Each is currently gated on being the child's manager, and each would silently widen if a
collaborator were treated as one. **Recommendation: no to all three.** Confirm or overturn:

- **Publish the child** — AD-21: *"Only the **manager** of a single may publish that single's
  listing (FR103)."*
- **Mint a share link** — deliberately restricted to `parent_admin`/`self_manager` because the
  row contains a bearer token (§2.4).
- **Invite the child to their own login** — `create_invite()` with `target_single_id`
  (`02_functions.sql:1212`), which binds `singles.member_id` and is a one-time, unrepeatable act.

And one more, which is billing rather than dignity: **`ai_entitlement()` is per-account**
(`02_functions.sql:3394`). If the granting household pays and the collaborating one does not,
whose entitlement applies to AI work on the shared child? Today the question has no answer
because the situation cannot arise.

## 4. Acceptance Criteria

Written against the settled decisions in §1. Every AC marked **[BLOCKED: §3.x]** cannot be
finalised until that question is answered — the wording given is the shape it takes under the
recommendation in that section, and must be revisited if the owner decides otherwise.

1. **A parent can give another household access to one child, by name, from that child's own
   record.** **Given** I am a `parent_admin` or `self_manager` in a household with a child,
   **when** I choose to share that child, **then** I name the person by email, they receive an
   invitation, and nothing is shared until they accept it. Consent is required on both sides:
   the grant is an offer until it is taken up, exactly as `connection_invites` already works.
   **Failing looks like:** access appearing the moment the invitation is sent; or a token that
   is stored in plaintext anywhere (see §2.3 — the existing precedent stores only a SHA-256
   hash and returns the raw token once).

2. **The grant is about one child and reaches nothing else.** **Given** an accepted grant on
   child C in household H, **when** the collaborating parent looks at anything, **then** they
   see C's record and every record that hangs off it, and **no** other child of H, **no** other
   member of H, **no** part of H's shadchan book, inbox, reminders or tasks that is not about C,
   and **no** household-level setting of H. This is the constraint that makes the
   previous-marriage case safe, and it is asserted in the database, not in the client.
   **Failing looks like:** any query, view or RPC that returns a row of H's to the collaborator
   whose path to C cannot be named. The negative test is **one login, two households, active in
   the collaborating one** — never two disjoint users, which proves nothing about scoping
   [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md#13` — rule 3].

3. **Both households see the same live record, including everything added later.** **Given** an
   accepted grant, **when** either household adds a shidduch, logs a reference call, or writes a
   note about C, **then** the other household sees it without any republication step. There is
   no snapshot and no "share the new thing too" action. **Failing looks like:** a snapshot table,
   a `published_at` column, or anything else copied from AD-21's `listings` semantics — which are
   deliberately the opposite (§2.5).

4. **Either household can sever the link, and severing gives the leaving side a copy of what it
   could see.** **Given** an accepted grant, **when** either side severs it, **then** access ends
   immediately for the other, the grant row is marked ended rather than deleted (the
   `connections`/`share_links` precedent: `ended_at`/`revoked_at`, never a `DELETE`), and the
   severing side keeps a copy of what they could read at that moment.
   **[BLOCKED: §3.7]** — what "a copy" contains, and whether it includes document bytes, cannot
   be specified until that is answered.

5. **The household's founding admin can remove a parent from the household and separately decide
   whether that person keeps access to the child.** **Given** I hold that authority, **when** I
   remove someone, **then** I am asked one question — does this person keep access to C? — and
   both outcomes are reachable. Removing someone from the household and cutting them off from
   their child are **not** the same act and must never be collapsed into one.
   **[BLOCKED: §3.1, §3.3, §3.4]** — who holds the authority, what happens when it is the holder
   who leaves, and whether two admins can remove each other.

6. **Access is visible to everyone it affects.** **Given** child C is shared, **when** anyone in
   either household opens C's record, **then** the sharing is stated plainly on the record —
   who else can see this child, and since when. Nobody should be able to discover months later
   that a record they have been writing in was being read by someone they did not know about.
   The same standard the reference book already holds itself to (UX-DR9: *"Reuse awareness is
   mandatory"*) applies here for a stronger reason.

7. **A collaborator cannot publish, share out, or bind a login for a child that is not in their
   household.** **[BLOCKED: §3.10]** — recommendation is a flat refusal on all three, each
   enforced in the database rather than by hiding a button.

8. **Every cross-boundary read and write is enforced in Postgres.** **Given** any new access
   path this story creates, **when** it is exercised by a caller who should not have it, **then**
   it is refused by RLS or by a `SECURITY DEFINER` function's own check — never only by the
   client. Every RLS change carries a negative test proving the wrong caller sees nothing
   (epics.md, "Additional Requirements"). A story that widens the tenant boundary and tests only
   the happy path has not been tested.

9. **The one thing the interface must never do.** Nowhere in this flow does the app ask why. Not
   when granting, not when severing, not when ejecting. There is no reason field, no reason
   picker, and no "tell us what happened" step — for the same reason 13.2 forbids it, and it is
   worth stating in both stories rather than assuming it carries across. (See 13.2 §"The app does
   not ask why".)

## 5. The architecture amendment this story requires

This story cannot be built without amending the spine. Say so in the amendment, do not slip it
in as an implementation detail.

**A third scope axis, or an explicit second reachability clause.** AD-1 today: *"every domain row
is scoped by **exactly one** of two axes — a non-null `account_id` … **or** a non-null
`connection_id`. Never both, never neither."* A shared child's rows keep their single
`account_id` — the composite FKs (§2.2b) leave no choice — so what changes is not the *scoping*
column but the *reachability* rule: a row about child C becomes readable by a caller whose
active context holds an accepted grant on C, in addition to the members of C's own household.

The recommended shape, following the precedent the tree has already set three times
(`connection_is_active_for_caller()`, `thread_is_readable()`, `thread_visibility_permits()` —
`02_functions.sql:3661`, `:3781`, `:3721`):

- One new table recording the grant — per child, with a status lifecycle that ends rather than
  deletes, and a hashed-token invitation alongside it in the `connection_invites` shape (§2.3).
- **One** `STABLE SECURITY DEFINER` predicate — `single_is_shared_with_caller(p_single_id)` — that
  every affected policy calls. One function, never an inlined copy per policy, for the reason
  `can_moderate_note()`'s own comment gives: two copies of one predicate can answer differently
  for the same row (`02_functions.sql:1188-1195`).
- An explicit, enumerated list of which tables gain the second clause. Not "every table with a
  path to a single" — an enumerated list, in the amendment, that a reviewer can check against
  §3.9's sensitive-tier decisions.

**Cross-check against AD-20 before writing it.** AD-20's promise is that a shadchan cannot
address a household row *at all*. The new predicate must be provably incapable of granting a
shadchanus context anything: a grant is household→household, and the check must fail closed on a
`kind = 'shadchanus'` caller rather than merely never being given one. `enforce_connection_kinds()`
(`02_functions.sql:3465`) is the in-repo pattern for asserting account kind, and this story's
mirror-image of it should be written even though the columns make it look unnecessary.

**Documents need their own decision, separately.** §2.2d: rows and bytes are different problems.
Whichever answer §3.7 gives for severance, live access to a shared child's resume and photos has
the same shape — the object key names the owning account, so the only live cross-boundary read
path is a service-role Worker (the `share/` Worker precedent) or duplication. Do not assume the
row decision covers it.

## 6. Tasks / Subtasks

Deliberately not written as an implementation plan. Six of the nine acceptance criteria are
blocked on §3, and the table shape depends on §3.6 (view vs edit) and §3.8 (where the child
appears) in ways that change every subsequent task. Writing them now would produce a plan that
looks executable and is not — the failure mode `.claude/rules/parallel-ownership.md` records as
*"work every agent assumed another was doing"*, arriving early.

What is safe to record now is the **order in which the unknowns must fall**:

- [ ] **Decision pass (owner).** §3.1 → §3.3 → §3.4 (the authority chain — later answers depend
      on the first). Then §3.6 (view vs edit) and §3.8 (where it appears), which together fix the
      shape of everything else. Then §3.9 and §3.10 (what is excluded), §3.5 (notification), §3.7
      (what a copy is), §3.2 (reinstatement).
- [ ] **Architecture amendment (§5), reviewed and accepted or rejected**, before any schema is
      written. If it is rejected, this story does not have a smaller version — say so rather than
      building a weaker one.
- [ ] **Schema + RLS**, then the invitation handshake, then the surfaces. Migration safety
      applies with full force: this story adds a reachability clause to policies on tables that
      hold live production data, and `make check-migration-safety` is the only gate in the repo
      that runs a migration against a row (AGENTS.md, "The empty-table trap").
- [ ] **Security review is mandatory** — `.claude/rules/security-triggers.md` lists
      authorization, database queries, migrations and RLS policies, and this story is all four at
      once. It is the single largest widening of the tenant boundary since Epic 2.

## 7. Dev Notes

### Why this is not "just add a second account_id"

A `shared_with_account_id` column on `singles` would be the smallest-looking change and is the
one to refuse. It gives the child's row two owners, which contradicts AD-1's "exactly one axis"
directly rather than extending it; it has no lifecycle (no accepted/ended/revoked, so severance
is a `NULL` write and history is gone); it cannot express two collaborators; and it puts the
grant on the row being shared rather than on a record of the grant, so "who shared this, when,
and who accepted" is unanswerable. The tree already learned this once — `connections` is a table
with a status and an `ended_at`, not a column on `accounts`.

### The wording on screen matters more than usual here

Two households, one child, and the words the app chooses will be read by someone in the middle of
a hard year. Some specific things not to write:

- Not "co-parent access", which names a legal relationship the app has no business asserting.
  A grandmother is not a co-parent and the step-father may not want the word.
- Not "ex-spouse", "former partner", or any term for the relationship at all. The app knows one
  fact: this person has access to this child. That is the only thing it should say.
- Not "family breakdown", "separation", or "split" anywhere in the flow.
- "Sharing" and "access" are enough. The record says who can see this child. It does not say why.

### What "the same live records" costs, stated once

Shared-by-default means a note written in anger at 2am is visible to the other household at 2am.
There is no draft state, no delay, no per-note privacy on the shared surface beyond what AD-3 and
AD-22 already provide. That is the right default — a shared record that either side can quietly
edit out of the other's view is worse than no sharing — but it should be a known property, and
§3.9's private-thread confirmation is the escape valve that makes it liveable: a parent who needs
to say something privately still has private threads, which are participants-only and which a
collaborator does not join by default.

### Precedent index — read these before designing

| Question | Where the answer already exists |
| --- | --- |
| Consent handshake across a tenant boundary | `connection_invites` + its four functions, `02_functions.sql:4330-4520` |
| Ending a link without deleting it | `connections.status`/`ended_at` + the partial unique index, `01_tables.sql:1032-1037` |
| Per-child key, revocation, access log | `share_links` / `share_access_log`, `01_tables.sql:1261-1300` |
| One predicate, many policies | `thread_is_readable()`, `connection_is_active_for_caller()`, `can_moderate_note()` |
| Asserting account kind in a trigger | `enforce_connection_kinds()`, `02_functions.sql:3465` |
| Serving bytes across the boundary | the `share/` Worker, `workers/share/index.ts` |
| Exporting a household's records | `settings/exportFamilyData.ts` (JSON, four resources, no files) |

## 8. References

- `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`
  — AD-1 (one scoping axis), AD-2 (membership), AD-19 (server-side active context), AD-20
  (connections), AD-21 (listings are snapshots), AD-22 (thread visibility), AD-15 (data lifecycle).
- `supabase/schemas/01_tables.sql` — `accounts` (:176), `account_members` (:258), `singles` (:333),
  `shidduchim` (:395), `connections` (:987), `connection_invites` (:1049), `share_links` (:1261),
  and the composite `(account_id, single_id)` FKs (:1409, :1469, :1484, :1520, :1694, :1703, :1718).
- `supabase/schemas/02_functions.sql` — `current_context_id()` (:249), `add_persona()` (:707),
  `remove_persona()` (:982), `guard_persona_removal()` (:946), `accept_invite()` (:90),
  `enforce_connection_kinds()` (:3465), `thread_is_readable()` (:3781), `ai_entitlement()` (:3394).
- `supabase/schemas/05_policies.sql` — `"Singles scoped to account"` (:260),
  `"Singles visible to self"` (:277).
- `supabase/schemas/07_storage.sql` — the `documents` bucket and its `{account_id}/…` key grammar
  (:104-175).
- `_bmad-output/implementation-artifacts/9-5-revocable-share-links.md` — Dev Notes, "Why share
  links are manager-scoped, not household-scoped".
- `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md#D11` — *"One
  account = one household"*, the decision this story is the first real pressure on.

## Dev Agent Record

### Agent Model Used

_(not yet implemented)_

### Debug Log References

_(not yet implemented)_

### Completion Notes List

_(not yet implemented)_

### File List

_(not yet implemented)_
