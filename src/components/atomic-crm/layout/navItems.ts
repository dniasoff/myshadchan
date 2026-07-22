import {
  BellRing,
  BookUser,
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
  },
  {
    to: "/shidduchim",
    labelKey: "crm.navigation.pipeline",
    labelDefault: "Pipeline",
    icon: KanbanSquare,
  },
  {
    to: "/shadchanim",
    labelKey: "resources.shadchanim.name",
    labelDefault: "Shadchanim",
    icon: Users,
  },
  {
    to: "/references",
    labelKey: "resources.references.name",
    labelDefault: "References",
    icon: BookUser,
  },
  {
    to: "/reminders",
    labelKey: "crm.navigation.reminders",
    labelDefault: "Reminders",
    icon: BellRing,
  },
  {
    to: "/settings",
    labelKey: "crm.settings.title",
    labelDefault: "Settings",
    icon: Settings,
  },
];
