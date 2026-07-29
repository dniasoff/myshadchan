import {
  BellRing,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

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
