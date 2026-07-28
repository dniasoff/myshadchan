import type { Identifier } from "ra-core";
import { CanAccess, useGetList, useTranslate, useUserMenu } from "ra-core";
import { ChevronDown, Settings, Users } from "lucide-react";
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

import type { Single } from "../types";
import { ContextSwitcher } from "./ContextSwitcher";

/**
 * The slim desktop top app-bar (foundation-plan §1): single-switcher pill +
 * theme toggle + refresh + user menu. Glass chrome, sticky.
 */
export const TopBar = () => (
  <header
    className="sticky top-[var(--banner-h,0px)] z-20 flex h-14 items-center
      justify-between gap-4 border-b border-[--glass-border] bg-[--glass-bg]
      px-4 shadow-sm backdrop-blur-[var(--glass-blur)] sm:px-6"
  >
    <div className="flex items-center gap-2">
      <SingleSwitcherPill />
      {/* Story 2.4: which context (household vs. shadchanus) is active —
          an independent axis from SingleSwitcherPill above. Renders
          nothing (AC-1) for a login with fewer than 2 contexts. */}
      <ContextSwitcher />
    </div>
    <div className="flex items-center gap-1">
      <ThemeModeToggle />
      <RefreshButton />
      <UserMenu>
        <CanAccess resource="members" action="list">
          <UsersMenuItem />
        </CanAccess>
        <CanAccess resource="configuration" action="edit">
          <SettingsMenuItem />
        </CanAccess>
      </UserMenu>
    </div>
  </header>
);

const singleLabel = (single: Single) =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `#${single.id}`;

/**
 * Self-contained single switcher, mirroring the local-state pattern in
 * ShidduchimList. Purely a display/selection affordance for now — it does
 * not drive any other screen.
 * TODO: hoist to a shared SingleContext once a second consumer needs the
 * selection (foundation-plan risk #3).
 */
const SingleSwitcherPill = () => {
  const { data: singleList } = useGetList<Single>("singles", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "first_name_en", order: "ASC" },
  });
  const [singleId, setSingleId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (singleId == null && singleList && singleList.length > 0) {
      setSingleId(singleList[0].id);
    }
  }, [singleList, singleId]);

  if (!singleList || singleList.length === 0) {
    return <span />;
  }

  const selected =
    singleList.find((single) => single.id === singleId) ?? singleList[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tour="single-switcher"
          className="inline-flex h-9 items-center gap-2 rounded-full border
            border-border bg-secondary px-3 text-sm font-semibold
            text-foreground outline-none transition-colors duration-[160ms]
            hover:bg-secondary/80
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>{singleLabel(selected)}</span>
          <ChevronDown
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {singleList.map((single) => (
          <DropdownMenuItem
            key={single.id}
            onSelect={() => setSingleId(single.id)}
          >
            {singleLabel(single)}
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
      <Link to="/members" className="flex items-center gap-2">
        <Users />
        {translate("resources.members.name", { smart_count: 2 })}
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
