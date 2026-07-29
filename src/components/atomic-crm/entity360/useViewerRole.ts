import { pickActiveRole } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import type { MemberRole } from "../types";

export interface ViewerRole {
  role: MemberRole | undefined;
  isPending: boolean;
}

/**
 * Resolves the viewer's role in the *active* context (Epic 3 API contract
 * §6 rule 1) — the ONE role source inside `entity360/`
 * (`roleSource.guard.test.ts` proves `useMyContexts` appears nowhere else
 * under this directory, and that the legacy per-login admin flag and the
 * auth-identity hook appear nowhere at all). Never that legacy flag on
 * `public.members` — it is a global, per-login column with no relationship
 * to `account_members.role`, and reading it here would make `self_manager`
 * and `single` unreachable across a multi-context login (Dev Notes, "Why
 * `useViewerRole` reads `my_contexts()`").
 *
 * `useMyContexts` is the one `["myContexts"]` React Query cache
 * (`root/useMyContexts.ts`); a context switch invalidates every query
 * before navigating (`layout/ContextSwitcher.tsx`), so this hook needs no
 * cache of its own, and — above all — never writes the role to
 * `localStorage`.
 *
 * Deliberately has NO `?? contexts[0]` fallback: `layout/ContextSwitcher
 * .tsx`'s identical-looking fallback is display-only (it names a pill); a
 * login with no active membership has no role here and must fail closed.
 */
export function useViewerRole(): ViewerRole {
  const { data, isPending } = useMyContexts();
  return { role: pickActiveRole(data), isPending };
}
