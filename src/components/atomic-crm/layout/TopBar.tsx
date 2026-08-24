import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { ChevronDown, Search, Settings, Users } from "lucide-react";
import { Link } from "react-router";

import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useGlobalSearchDialog } from "../misc/useGlobalSearch";
import { useSelectedSingle } from "../singles/useSelectedSingle";
import type { Single } from "../types";
import { ContextSwitcher } from "./ContextSwitcher";

/**
 * The slim desktop top app-bar (foundation-plan §1): single-switcher pill +
 * theme toggle + refresh + user menu. Glass chrome, sticky.
 */
export const TopBar = () => (
  <header
    className="sticky top-[var(--banner-h,0px)] z-20 flex h-(--topbar-h) items-center
      justify-between gap-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]
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
      <GlobalSearchButton />
      <ThemeModeToggle />
      <RefreshButton />
      <UserMenu>
        <CanAccess resource="members" action="list">
          <UsersMenuItem />
        </CanAccess>
        <SettingsMenuItem />
      </UserMenu>
    </div>
  </header>
);

/**
 * Story 4.5 (AC-1): the desktop trigger for the shell's single
 * `GlobalSearch` dialog (`Layout.tsx` mounts the provider + dialog once).
 * The `(Cmd|Ctrl)+K` shortcut is a second, independent trigger for the same
 * dialog — owned by `GlobalSearch.tsx` itself, not duplicated here.
 */
export const GlobalSearchButton = () => {
  const translate = useTranslate();
  const { open } = useGlobalSearchDialog();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={translate("crm.global_search.trigger_label", {
        _: "Search",
      })}
      onClick={open}
    >
      <Search className="size-5" aria-hidden="true" />
    </Button>
  );
};

const singleLabel = (single: Single) =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `#${single.id}`;

/**
 * The app-bar single switcher. It drives the whole app: the selection lives in
 * `useSelectedSingle`, so picking a name here changes the dashboard too.
 *
 * It used to hold its own `useState` and its docstring said so — "purely a
 * display/selection affordance for now — it does not drive any other screen".
 * The dashboard held a second, independent selection, so this pill could read
 * "Yaakov" while the page below it showed Rivky's pipeline.
 */
export const SingleSwitcherPill = () => {
  const translate = useTranslate();
  const { singles: singleList, selected, setSelectedId } = useSelectedSingle();

  if (singleList.length === 0 || !selected) {
    return <span />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tour="single-switcher"
          aria-label={translate("crm.single_switcher.trigger_label", {
            name: singleLabel(selected),
            _: "Switch single: %{name}",
          })}
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
            onSelect={() => setSelectedId(single.id)}
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
