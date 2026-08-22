# Blind Hunter Review: Halachic shidduch eligibility enforcement

Invoke the `bmad-review-adversarial-general` skill. This is a whole-codebase audit, not a diff review.

Requirements to audit:

- The product must support legitimate standalone shadchanim, singles, and individuals granted access to a child/person, including a birth parent or trusted friend.
- The system must support only straight/opposite-sex shidduchim.
- A Kohen cannot be matched or permitted to marry a divorcee.
- These boundaries must be enforced server-side/database-side across every write and recommendation path, not only in forms.

Audit all relevant paths: schema/types, onboarding, single creation/editing/import, shidduch creation/editing, matching and suggestion logic, AI/inference, search, listings, public/share links, child grants, role/context switching, FakeRest/demo data, Supabase RPCs/functions, and workers. Trace both candidate metadata and all paths that can create or expose a match.

Prioritize findings that would permit an invalid shidduch, allow bypass through a non-UI path, or incorrectly block a permitted actor. For every finding give severity, exact file/line or symbol, concrete bypass/scenario, and a minimal remediation direction. Flag missing domain data (for example Kohen/divorce status) as a finding when it prevents enforceability. Do not modify files.

## Classified disposition

The actionable findings were triaged as `patch` and fixed:

- high: missing column grants, base-table conflict reads, MCP/raw-query bypasses, identity/catch search leakage, and FakeRest authorization gaps;
- medium: filtered summary counts and newly-created function ACLs.

The formatting failures in `canAccess.test.ts` and `supabase/functions/_shared/demoDataset.ts` are unrelated worktree changes and remain `defer`. Demo-seeding findings remain with the separate demo-data story.
