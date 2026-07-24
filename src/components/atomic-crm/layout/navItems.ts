import {
  BellRing,
  BookUser,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
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
 * The 6 foundation nav destinations, in display order. Deliberately excludes
 * the legacy CRM resources (Contacts, Companies, Deals, Tags) — this is a
 * shidduchim app, not a general CRM (foundation-plan §2).
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
    to: "/shidduchim",
    labelKey: "crm.navigation.pipeline",
    labelDefault: "Pipeline",
    icon: KanbanSquare,
    tourId: "pipeline",
  },
  {
    to: "/inbox_items",
    labelKey: "crm.navigation.inbox",
    labelDefault: "Inbox",
    icon: Inbox,
    tourId: "inbox",
  },
  {
    to: "/shadchanim",
    labelKey: "resources.shadchanim.name",
    labelDefault: "Shadchanim",
    icon: Users,
    tourId: "shadchanim",
  },
  {
    to: "/references",
    labelKey: "resources.references.name",
    labelDefault: "References",
    icon: BookUser,
    tourId: "references",
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
