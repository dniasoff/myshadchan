# Glossary — MyShadchan

Domain vocabulary. The product, the schema and the UI all use these words; an
implementer cannot read the contract without them.

## The process

| Term | Meaning |
|---|---|
| **shidduch** *(pl. shidduchim)* | A match, and by extension a specific suggestion being explored. The central object of the product. |
| **redt** *(verb and noun)* | To suggest a match. "Mrs. Feldman redt Dovid for Rivky." A *redt* is one such act, with a date and an author; a suggestion may be redt more than once, by different people. |
| **shadchan** *(pl. shadchanim)* | A matchmaker. In Phase 1 also a first-class user with their own context. |
| **single** | The person being redt for. Your own child, or yourself. **Not** "child": the term must hold for a widow, a divorcee or an independent adult managing their own shidduchim. |
| **reference** | Someone spoken to about a suggested person — a rebbi, a neighbour, a chavrusa. Reusable across suggestions, but always consulted *about* a particular suggestion. |
| **diligence** | The work of speaking to references about a suggestion and recording what they said. |
| **resume** | The document describing a single, circulated to shadchanim. Both your own single and a suggested person have one. |
| **catch** | The system recognising that a person now being suggested has been suggested — or dated — before. |

## The pipeline

Seven canonical states. A decision state is reachable only from *look-into*.

| State | Meaning |
|---|---|
| **new** | Just arrived, not yet triaged. |
| **look-into** | Being actively explored. The only state a decision can be made from. |
| **not-sure** | Held, undecided. |
| **for-sure-not** | A gut set-aside, made **without** a full look. Deliberately distinct from *no*. |
| **yes** | Pursuing. |
| **unsure** | A decision was reached, but it is genuinely undecided. |
| **no** | Refused **after** investigation. Distinct from *for-sure-not*. |

The distinction between **for-sure-not** and **no** is load-bearing: one records that
you never looked, the other that you looked and declined. Collapsing them loses the
history that makes a later catch meaningful.

## Identity and access

| Term | Meaning |
|---|---|
| **persona** | What a login *does*: single, parent, or shadchan. One login may hold all three, and may gain or lose them over a lifetime. |
| **context** | The container a persona works in. Two kinds: a **household** (a family: its singles, pipeline, references) and a **shadchanus** (a shadchan's own book and connections). An account *is* a context. |
| **active context** | The one context a login is currently working in. Server-held, explicitly chosen, never inferred. |
| **member** | A login's membership of a context, carrying a role. |
| **connection** | An explicitly accepted link between one household and one shadchanus. Its own scope: conversation rows belong to the connection, not to either side. |
| **helper** | Someone a family brings in to assist, with less access than a parent. |
| **self-manager** | A single who runs their own process, with no parent involved. |
| **dignity floor** | The minimum a single always sees about their own process, which cannot be switched off. |
| **listing** | An opt-in, published, narrow profile of a shadchan or a single. The only anonymously readable data in the product. |

## Words we deliberately do not use

- **"child"** for the person being redt for — false for a widow, divorcee or independent adult. Use **single**.
- **"contact", "company", "deal", "lead"** — CRM-fork vocabulary with no meaning here.
- **"match score", "compatibility"** — the product never judges compatibility.
- **"pool", "directory of families"** — the product has neither, and the privacy claim depends on that staying true.
