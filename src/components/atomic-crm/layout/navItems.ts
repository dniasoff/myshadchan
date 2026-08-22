import {
  BellRing,
  Handshake,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import type { MyContext } from "../types";

/**
 * One nav item shared by the desktop Sidebar and the mobile bottom nav, so
 * labels/paths/icons never drift between the two surfaces (foundation-plan §1).
 */
export interface NavItem {
  to: string;
  /** i18n key passed to `translate()`; falls back to `labelDefault`. */
  labelKey: string;
  labelDefault: string;
  icon: LucideIcon;
  /** Suffixed onto `data-tour="nav-"` so the walkthrough can anchor to it. */
  tourId: string;
}

/**
 * The 7 foundation nav destinations, in display order (Story 4.4). Deliberately
 * excludes every generic CRM resource — this is a shidduchim app, not a general
 * CRM (foundation-plan §2). `references` is also deliberately absent: RULING 7
 * (`entity360/ad24Conformance.ts`'s `NO_BROWSE_SURFACE_ENTITIES`) — a reference
 * exists only within a shidduch's context, so it gets no nav entry, no list, no
 * dashboard tile and no tour step. It keeps its own full 360 at
 * `/references/{id}`, reachable from inside a shidduch's record, just never
 * from primary nav.
 */
export const PRIMARY_NAV: NavItem[] = [
  {
    to: "/",
    labelKey: "ra.page.dashboard",
    labelDefault: "Dashboard",
    icon: LayoutDashboard,
    tourId: "dashboard",
  },
  {
    to: "/inbox_items",
    labelKey: "crm.navigation.inbox",
    labelDefault: "Inbox",
    icon: Inbox,
    tourId: "inbox",
  },
  {
    to: "/shidduchim",
    labelKey: "crm.navigation.shidduchim",
    labelDefault: "Shidduchim",
    icon: KanbanSquare,
    tourId: "pipeline",
  },
  {
    to: "/shadchanim",
    labelKey: "resources.shadchanim.name",
    labelDefault: "Shadchanim",
    icon: Users,
    tourId: "shadchanim",
  },
  {
    to: "/tasks",
    labelKey: "crm.navigation.tasks",
    labelDefault: "Tasks",
    icon: ListChecks,
    tourId: "tasks",
  },
  {
    to: "/reminders",
    labelKey: "crm.navigation.reminders",
    labelDefault: "Reminders",
    icon: BellRing,
    tourId: "reminders",
  },
  {
    to: "/settings",
    labelKey: "crm.settings.title",
    labelDefault: "Settings",
    icon: Settings,
    tourId: "settings",
  },
];

/**
 * The active context's `kind` — `"household"` or `"shadchanus"`
 * (`root/types.ts`'s `MyContext`). Re-exported so `layout/RequireContextKind.tsx`
 * and `root/routeManifest.ts`'s `contextKind` field share the exact same
 * type as `useMyContexts()` returns — never a second, hand-written literal
 * union that could drift from it.
 */
export type ContextKind = MyContext["kind"];

/**
 * The shadchanus-context nav set. Shadchanus accounts own their own singles,
 * suggestions, and shadchan book, so those account-scoped surfaces stay
 * available alongside connections. Household-only inbox/tasks/reminders
 * remain excluded.
 */
export const SHADCHANUS_NAV: NavItem[] = [
  {
    to: "/",
    labelKey: "ra.page.dashboard",
    labelDefault: "Dashboard",
    icon: LayoutDashboard,
    tourId: "dashboard",
  },
  {
    to: "/connections",
    labelKey: "crm.navigation.connections",
    labelDefault: "Connections",
    icon: Handshake,
    tourId: "connections",
  },
  {
    to: "/shidduchim",
    labelKey: "crm.navigation.shidduchim",
    labelDefault: "Shidduchim",
    icon: KanbanSquare,
    tourId: "pipeline",
  },
  {
    to: "/singles",
    labelKey: "resources.singles.name",
    labelDefault: "Singles",
    icon: Users,
    tourId: "singles",
  },
  {
    to: "/shadchanim",
    labelKey: "resources.shadchanim.name",
    labelDefault: "Shadchanim",
    icon: Users,
    tourId: "shadchanim",
  },
  {
    to: "/settings",
    labelKey: "crm.settings.title",
    labelDefault: "Settings",
    icon: Settings,
    tourId: "settings",
  },
];

/**
 * The active context's `kind`, read over `useMyContexts()` (AD-19: server-held
 * state, never a URL param or local state). `undefined` while the query is
 * still pending or has errored, AND whenever no row carries
 * `is_active: true` — callers (this hook's own `useActiveNav()` and
 * `layout/RequireContextKind.tsx`) treat both the same way: default to
 * household behavior / render children rather than flashing shadchanus
 * chrome, or redirecting away, for a context the server does not consider
 * active.
 *
 * Review fix (Story 8.1, F4): delegates to `pickActiveContext()`
 * (`providers/commons/roleAuthority.ts`) — the repo's one canonical
 * active-context selector, already used by `useViewerRole()` and both
 * authProviders' `canAccess` — instead of a fourth hand-rolled copy of "find
 * the active row". The previous version fell back to `contexts[0]` when no
 * row was active, copying `layout/ContextSwitcher.tsx`'s own `?? contexts[0]`
 * fallback — but that fallback is documented there as a **display-only**
 * choice ("only ever names a pill — it is not an authority decision"),
 * never meant to feed a nav-set or route-guard decision. `my_contexts()`
 * (`supabase/schemas/02_functions.sql`) can genuinely mark zero rows active
 * (`current_context_id()` returns NULL whenever `member_state
 * .active_account_id` no longer names a currently-active membership, e.g. a
 * membership archived in the account that was active while the login still
 * holds another) — in that state the server already fails closed (RLS
 * returns nothing; `pickActiveRole()` returns `undefined`), and this hook
 * must match it exactly rather than arbitrarily borrowing an unordered row.
 */
export function useActiveContextKind(): ContextKind | undefined {
  const { data: contexts } = useMyContexts();
  return pickActiveContext(contexts)?.kind;
}

/**
 * AC-2: the nav set the user sees follows the active context, not a
 * hardcoded list. The one place that maps context kind -> nav array — both
 * `Sidebar.tsx` (desktop) and `MobileNavigation.tsx` (mobile) call this
 * instead of importing `PRIMARY_NAV` directly, so the two surfaces can never
 * drift on which array a given context kind gets.
 */
export function useActiveNav(): NavItem[] {
  const kind = useActiveContextKind();
  return kind === "shadchanus" ? SHADCHANUS_NAV : PRIMARY_NAV;
}
