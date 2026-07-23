import type { Identifier } from "ra-core";
import { CanAccess, useGetList, useTranslate, useUserMenu } from "ra-core";
import { ChevronDown, FileText, Import, Settings, User, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ChangelogPage } from "../misc/ChangelogPage";
import { ImportPage } from "../misc/ImportPage";
import type { Child } from "../types";

/**
 * The slim desktop top app-bar (foundation-plan §1): child-switcher pill +
 * theme toggle + refresh + user menu. Glass chrome, sticky.
 */
export const TopBar = () => (
  <header
    className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4
      border-b border-[--glass-border] bg-[--glass-bg] px-4 shadow-sm
      backdrop-blur-[var(--glass-blur)] sm:px-6"
  >
    <ChildSwitcherPill />
    <div className="flex items-center gap-1">
      <ThemeModeToggle />
      <RefreshButton />
      <UserMenu>
        <ProfileMenuItem />
        <CanAccess resource="sales" action="list">
          <UsersMenuItem />
        </CanAccess>
        <CanAccess resource="configuration" action="edit">
          <SettingsMenuItem />
        </CanAccess>
        <ImportFromJsonMenuItem />
        <ChangelogMenuItem />
      </UserMenu>
    </div>
  </header>
);

const childLabel = (child: Child) =>
  [child.first_name_en, child.last_name_en].filter(Boolean).join(" ") ||
  `#${child.id}`;

/**
 * Self-contained child switcher, mirroring the local-state pattern in
 * ShidduchimList. Purely a display/selection affordance for now — it does
 * not drive any other screen.
 * TODO: hoist to a shared ChildContext once a second consumer needs the
 * selection (foundation-plan risk #3).
 */
const ChildSwitcherPill = () => {
  const { data: childList } = useGetList<Child>("children", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "first_name_en", order: "ASC" },
  });
  const [childId, setChildId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (childId == null && childList && childList.length > 0) {
      setChildId(childList[0].id);
    }
  }, [childList, childId]);

  if (!childList || childList.length === 0) {
    return <span />;
  }

  const selected = childList.find((child) => child.id === childId) ?? childList[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full border
            border-border bg-secondary px-3 text-sm font-semibold
            text-foreground outline-none transition-colors duration-[160ms]
            hover:bg-secondary/80
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>{childLabel(selected)}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {childList.map((child) => (
          <DropdownMenuItem
            key={child.id}
            onSelect={() => setChildId(child.id)}
          >
            {childLabel(child)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Moved from the legacy Header (foundation-plan §1) — reused, not duplicated.

const UsersMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<UsersMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/sales" className="flex items-center gap-2">
        <Users />
        {translate("resources.sales.name", { smart_count: 2 })}
      </Link>
    </DropdownMenuItem>
  );
};

const ProfileMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ProfileMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/profile" className="flex items-center gap-2">
        <User />
        {translate("crm.profile.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const SettingsMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<SettingsMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/settings" className="flex items-center gap-2">
        <Settings />
        {translate("crm.settings.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const ImportFromJsonMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ImportFromJsonMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ImportPage.path} className="flex items-center gap-2">
        <Import />
        {translate("crm.header.import_data")}
      </Link>
    </DropdownMenuItem>
  );
};

const ChangelogMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ChangelogMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ChangelogPage.path} className="flex items-center gap-2">
        <FileText />
        {translate("crm.changelog.title")}
      </Link>
    </DropdownMenuItem>
  );
};
