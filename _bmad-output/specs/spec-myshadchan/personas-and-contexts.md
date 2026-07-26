# Personas, Contexts & Family Shapes

The identity model. Every onboarding path, every RLS policy and every isolation test
derives from this. Governed by **AD-2** (membership), **AD-19** (active context) and
**AD-20** (connection scope) in the architecture spine.

## The three personas

A login may hold **any combination**, including all three, and may gain or lose them
over a lifetime without re-registering.

| Persona | Means | Provisions |
|---|---|---|
| **single** | I am looking for a shidduch for myself | A household (if none) **and a `singles` row pointing at me** |
| **parent** | I am looking for a shidduch for my children | A household, then prompts to add my singles |
| **shadchan** | I am a matchmaker | A **separate shadchanus context** |

Onboarding asks *"are you a single, a parent, a shadchan?"* as a **multi-select**.

### Personas change over a lifetime

A single marries and becomes a parent. A parent is widowed or divorced and becomes a
single again. A parent whose children are settled becomes a shadchan. Therefore:

- personas are added and removed from settings, not fixed at signup;
- adding one provisions its context on demand;
- **removing one archives, never deletes** — past suggestions, references, threads and
  decisions stay intact and auditable;
- entitlement, listings and connections must tolerate a persona being switched off.

## The two context types

| Context | Holds | Never holds |
|---|---|---|
| **household** | My singles, my pipeline, my references, my diligence, my tasks | Another family's data |
| **shadchanus** | My book, my connections, my redts, my conversations | Any household domain row |

**Why they are separate:** a shadchan works across many families. If their book lived
inside a household account, that family's account would contain other families' data —
which is precisely what the no-pooling wedge forbids.

**One active at a time.** A login holding both switches between them explicitly; the
active context is a server-side row, and exactly one context is readable at any moment.

## The connection — a third scope

A household and a shadchanus link through an explicitly accepted **connection**, which
either side may end. There is no directory-driven or automatic linkage.

Conversation rows scope by the **connection**, not by either account. The consequence is
the point: a shadchan holds no household membership, so **they cannot address a household
row at all**. The privacy promise is structural, not a policy that must never be got wrong.

A suggestion redted through a connection still belongs to the **household** — only the
conversation belongs to the connection.

## The six canonical family shapes

Each is an onboarding provisioning path **and** an RLS isolation test case.

| # | Shape | Notes |
|---|---|---|
| 1 | **One self-managing single** | Independent, widowed or divorced. Both a member and a `singles` row in their own household. |
| 2 | **One parent** | Managing their singles. |
| 3 | **Two parents** | Co-managing one household. |
| 4 | **Any of the above + helpers** | Helpers see less than parents. |
| 5 | **Any of the above + singles with their own logins** | The single sees the same screens, filtered. |
| 6 | **Any of the above where a member is also a shadchan** | Second context, switched explicitly. |

**Note shape 1 + 2 combined:** a widow managing both herself and her children is *one*
household containing a `singles` row for herself and rows for each child. "Self-seeker"
is not a separate account type.

## Out of scope this phase

- **Extended family as first-class participants** — a grandparent or sibling running the
  process, rather than assisting as a helper.
- **A single belonging to more than one household** — e.g. divorced parents each running
  their own. This would break the "a single belongs to one household" assumption and
  needs an explicit rule on who owns their record and their listing.

## Roles within a context

`parent_admin` · `single` · `helper` · `self_manager` · `shadchan`

All are active. `shadchan` grants access **solely through a connection**, never through
household membership.
