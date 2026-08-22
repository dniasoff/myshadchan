# Edge Case Hunter Review: Halachic shidduch eligibility enforcement

Invoke the `bmad-review-edge-case-hunter` skill. This is a whole-codebase audit, not a diff review.

Requirements to audit:

- The product must support legitimate standalone shadchanim, singles, and individuals granted access to a child/person, including a birth parent or trusted friend.
- The system must support only straight/opposite-sex shidduchim.
- A Kohen cannot be matched or permitted to marry a divorcee.
- These boundaries must be enforced server-side/database-side across every write and recommendation path, not only in forms.

Walk every branch and boundary: male/female combinations, missing/null/unknown gender, edits after a match exists, divorce status changes, Kohen status changes, one-sided or contradictory profiles, imported/AI-generated records, child-grant roles, standalone shadchanus accounts, cross-account connections, direct REST/RPC calls, public listings/share links, stale cached summaries, FakeRest versus Supabase, and existing seeded data. Check whether access control and eligibility are kept separate so child grants do not widen matching authority.

Return only actionable unhandled edge cases with severity, exact file/line or symbol, why the state can occur, and a recommended fix. Do not modify files.

## Classified disposition

The actionable eligibility/access findings were triaged as `patch` and fixed: advisory-lock serialization, single visibility, reference and interaction scoping, account-update authorization, identity/catch filtering, MCP parity, and summary-count parity.

The demo seed atomicity, cleanup, lifecycle, and serialization findings are `defer` because that work belongs to the separate demo-data story. Cross-account shadchan attribution is fail-closed by the validated composite foreign keys; the migration does not silently rewrite existing data.
