import {
  Check,
  Home,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";

import { useTheme } from "@/components/admin/use-theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { buildNewPath } from "../entity360/entityPaths";
import { useGlobalSearchDialog } from "../misc/useGlobalSearch";
import { ContextMenuItems } from "./ContextSwitcher";
import { MOBILE_MENU_ITEM_CLASSNAME } from "./menuItemClassName";
import {
  PRIMARY_NAV,
  SHADCHANUS_NAV,
  useActiveNav,
  type NavItem,
} from "./navItems";

const findNavItem = (nav: NavItem[], to: string): NavItem => {
  const item = nav.find((navItem) => navItem.to === to);
  if (!item) throw new Error(`Nav item not found: ${to}`);
  return item;
};

const pipelineItem = findNavItem(PRIMARY_NAV, "/shidduchim");
const shadchanimItem = findNavItem(PRIMARY_NAV, "/shadchanim");
const inboxItem = findNavItem(PRIMARY_NAV, "/inbox_items");
const tasksItem = findNavItem(PRIMARY_NAV, "/tasks");
const remindersItem = findNavItem(PRIMARY_NAV, "/reminders");
const settingsItem = findNavItem(PRIMARY_NAV, "/settings");

/**
 * Whether `pathname` is inside a nav item's section. `"/"` has to match
 * exactly (every path is "inside" it otherwise); everything else matches its
 * own detail routes too, so `/shidduchim/12` still lights the Shidduchim
 * slot.
 */
const matchesNavItem = (item: NavItem, pathname: string) =>
  item.to === "/"
    ? matchPath("/", pathname) !== null
    : matchPath(`${item.to}/*`, pathname) !== null;

/**
 * Mobile bottom nav (Story 8.1, AC-2): the top-level export follows the
 * active context via `useActiveNav()` — never a hardcoded `PRIMARY_NAV`
 * import — and dispatches to whichever surface-specific bar matches. Each
 * bar calls its own hooks internally (Rules of Hooks: this dispatcher must
 * not call `useLocation()`/`useTranslate()` conditionally on their behalf).
 */
export const MobileNavigation = () => {
  const nav = useActiveNav();
  return nav === SHADCHANUS_NAV ? (
    <ShadchanusMobileNavigation nav={nav} />
  ) : (
    <HouseholdMobileNavigation />
  );
};

/**
 * The household bottom nav (foundation-plan §3): 5-slot glass bar — Home,
 * Shidduchim, a raised center capture button, Shadchanim, and a "More" menu
 * holding Inbox / Tasks / Reminders / Settings, then the context switcher
 * (Story 4.4 NFR-14 — re-homed from an interim `SettingsPageMobile` mount),
 * then theme. Paths & labels are pulled from `PRIMARY_NAV` (single source of
 * truth shared with the desktop Sidebar). RULING 7: references has no entry
 * here — no nav slot, no "More" item.
 */
const HouseholdMobileNavigation = () => {
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (matchPath(`${pipelineItem.to}/*`, location.pathname)) {
    currentPath = pipelineItem.to;
  } else if (matchPath(`${shadchanimItem.to}/*`, location.pathname)) {
    currentPath = shadchanimItem.to;
  } else if (
    matchPath(inboxItem.to, location.pathname) ||
    matchPath(tasksItem.to, location.pathname) ||
    matchPath(remindersItem.to, location.pathname) ||
    matchPath(settingsItem.to, location.pathname)
  ) {
    currentPath = "more";
  } else {
    currentPath = false;
  }

  return (
    <nav
      aria-label={translate("crm.navigation.label")}
      className="fixed inset-x-0 bottom-0 z-50 flex min-h-(--mobile-nav-h)
        items-stretch justify-around border-t border-(--glass-border)
        bg-(--glass-bg) pb-[env(safe-area-inset-bottom)] shadow-lg
        backdrop-blur-[var(--glass-blur)]"
    >
      <NavigationButton
        href="/"
        Icon={Home}
        label={translate("ra.page.dashboard")}
        isActive={currentPath === "/"}
        tourId="dashboard"
      />
      <NavigationButton
        href={pipelineItem.to}
        Icon={pipelineItem.icon}
        label={translate(pipelineItem.labelKey, {
          smart_count: 2,
          _: pipelineItem.labelDefault,
        })}
        isActive={currentPath === pipelineItem.to}
        tourId={pipelineItem.tourId}
      />
      <CreateButton />
      <NavigationButton
        href={shadchanimItem.to}
        Icon={shadchanimItem.icon}
        label={translate(shadchanimItem.labelKey, {
          smart_count: 2,
          _: shadchanimItem.labelDefault,
        })}
        isActive={currentPath === shadchanimItem.to}
        tourId={shadchanimItem.tourId}
      />
      <MoreButton
        isActive={currentPath === "more"}
        quickLinks={[inboxItem, tasksItem, remindersItem, settingsItem]}
      />
    </nav>
  );
};

/** Bar slots in the shadchanus nav; everything past this goes in "More". */
const SHADCHANUS_BAR_SLOTS = 3;

/**
 * The shadchanus bottom nav (Story 8.1, AC-1/AC-2): a 4-slot bar — the first
 * three `SHADCHANUS_NAV` destinations, then "More" holding the rest, the
 * context switcher and theme. No raised center create button: there is no
 * taskable target in a shadchanus account yet, see the story's Dev Notes
 * "Why no Tasks or Reminders". Context switching and the theme toggle stay
 * reachable here rather than disappearing for a shadchan who also holds a
 * household context — `SettingsPageMobile.tsx`'s own comment records that
 * this "More" menu is mobile's only entry point for both (Story 4.4 NFR-14).
 *
 * Every slot is derived from the `nav` array the dispatcher already resolved,
 * the way `Sidebar.tsx` does it — never a hand-picked subset. The previous
 * version hardcoded three items and an EMPTY "More", so when `SHADCHANUS_NAV`
 * grew from 3 entries to 6, `/shidduchim`, `/singles` and `/shadchanim`
 * became unreachable on a phone: the routes exist (`root/routeManifest.ts`
 * registers all three for `contextKind: "shadchanus"`) and the desktop
 * sidebar links to them, but no mobile surface did. Slicing the array cannot
 * drift that way again.
 */
const ShadchanusMobileNavigation = ({ nav }: { nav: NavItem[] }) => {
  const location = useLocation();
  const translate = useTranslate();

  const barItems = nav.slice(0, SHADCHANUS_BAR_SLOTS);
  const overflowItems = nav.slice(SHADCHANUS_BAR_SLOTS);

  const activeItem = nav.find((item) =>
    matchesNavItem(item, location.pathname),
  );
  let currentPath: string | false = false;
  if (activeItem) {
    currentPath = barItems.includes(activeItem) ? activeItem.to : "more";
  }

  return (
    <nav
      aria-label={translate("crm.navigation.label")}
      className="fixed inset-x-0 bottom-0 z-50 flex min-h-(--mobile-nav-h)
        items-stretch justify-around border-t border-(--glass-border)
        bg-(--glass-bg) pb-[env(safe-area-inset-bottom)] shadow-lg
        backdrop-blur-[var(--glass-blur)]"
    >
      {barItems.map((item) => (
        <NavigationButton
          key={item.to}
          href={item.to}
          Icon={item.icon}
          // `smart_count: 2` resolves pluralized resource-name catalog
          // entries (e.g. "Shadchan |||| Shadchanim"); harmless no-op for
          // plain keys — same call shape as `Sidebar.tsx`.
          label={translate(item.labelKey, {
            smart_count: 2,
            _: item.labelDefault,
          })}
          isActive={currentPath === item.to}
          tourId={item.tourId}
        />
      ))}
      <MoreButton
        isActive={currentPath === "more"}
        quickLinks={overflowItems}
      />
    </nav>
  );
};

const NavigationButton = ({
  href,
  Icon,
  label,
  isActive,
  tourId,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
  tourId?: string;
}) => (
  <Button
    asChild
    variant="ghost"
    className={cn(
      "flex h-full w-16 flex-col items-center justify-center gap-1 rounded-none px-1",
      isActive ? "text-primary" : "text-muted-foreground",
    )}
  >
    <Link
      to={href}
      // The only cues otherwise are `text-primary` and the `aria-hidden` dot
      // below — nothing a screen reader or voice control can hear. Matches
      // `Sidebar.tsx`'s own `aria-current` on the desktop nav.
      aria-current={isActive ? "page" : undefined}
      data-tour={tourId ? `nav-${tourId}` : undefined}
    >
      <span className="relative">
        <Icon className="size-6" aria-hidden="true" />
        {isActive ? (
          <span
            className="absolute -bottom-1.5 start-1/2 size-1 -translate-x-1/2 rounded-full"
            style={{
              backgroundColor: "var(--primary)",
              boxShadow: "0 0 8px -1px var(--glow-accent)",
            }}
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="text-[11px] font-medium">{label}</span>
    </Link>
  </Button>
);

const CreateButton = () => {
  const translate = useTranslate();

  return (
    <div className="flex w-16 items-center justify-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={translate("ra.action.create")}
            className="grid size-14 -translate-y-3 place-items-center rounded-full
              text-primary-foreground outline-none
              bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
              shadow-[0_8px_24px_-6px_var(--glow-accent-strong)]
              transition-transform duration-[160ms] ease-(--ease-spring)
              active:scale-[0.97]
              focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-7" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="mb-2">
          <DropdownMenuItem asChild className={MOBILE_MENU_ITEM_CLASSNAME}>
            <Link to={buildNewPath("shidduchim")}>Add a suggestion</Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled className={MOBILE_MENU_ITEM_CLASSNAME}>
            Scan a resume (coming soon)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

/**
 * Story 8.1 (AC-1): `quickLinks` is the household bar's Inbox/Tasks/
 * Reminders/Settings row — parametrized rather than hardcoded so the
 * shadchanus bar can reuse this exact dropdown for its generic contents
 * (context switcher + theme) with an empty quick-link list, instead of a
 * second hand-rolled "More" menu that could drift from this one.
 */
const MoreButton = ({
  isActive,
  quickLinks,
}: {
  isActive: boolean;
  quickLinks: NavItem[];
}) => {
  const translate = useTranslate();
  // Story 4.5 (AC-1): mobile has no keyboard shortcut, so this dropdown item
  // is the only trigger for the shell's single GlobalSearch dialog.
  const { open: openGlobalSearch } = useGlobalSearchDialog();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-current={isActive ? "true" : undefined}
          data-tour="nav-more"
          className={cn(
            "flex h-full w-16 flex-col items-center justify-center gap-1 rounded-none px-1",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="size-6" aria-hidden="true" />
          <span className="text-[11px] font-medium">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mb-2">
        <DropdownMenuItem
          onSelect={openGlobalSearch}
          className={cn("flex items-center gap-2", MOBILE_MENU_ITEM_CLASSNAME)}
        >
          <Search className="size-4" aria-hidden="true" />
          {translate("crm.global_search.trigger_label", { _: "Search" })}
        </DropdownMenuItem>
        {quickLinks.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.to} asChild>
              <Link
                to={item.to}
                data-tour={`nav-${item.tourId}`}
                className={cn(
                  "flex items-center gap-2",
                  MOBILE_MENU_ITEM_CLASSNAME,
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {translate(item.labelKey, { _: item.labelDefault })}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <ContextMenuItems withSectionLabel />
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Inline theme switch (Light/Dark/System), not the shared `<ThemeModeToggle>`
 * trigger button — that trigger is `hidden` below the `sm` breakpoint (it
 * assumes a desktop top-bar host) and nesting its own DropdownMenu inside
 * this one would be fragile. Reuses the same `useTheme()` hook instead.
 * `ContextMenuItems` above follows the same inline-items precedent, for the
 * same reason (Story 4.4).
 */
const ThemeMenuItems = () => {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <DropdownMenuItem
        onClick={() => setTheme("light")}
        className={MOBILE_MENU_ITEM_CLASSNAME}
      >
        <Sun className="size-4" aria-hidden="true" />
        Light
        <Check className={cn("ms-auto", theme !== "light" && "hidden")} />
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => setTheme("dark")}
        className={MOBILE_MENU_ITEM_CLASSNAME}
      >
        <Moon className="size-4" aria-hidden="true" />
        Dark
        <Check className={cn("ms-auto", theme !== "dark" && "hidden")} />
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => setTheme("system")}
        className={MOBILE_MENU_ITEM_CLASSNAME}
      >
        System
        <Check className={cn("ms-auto", theme !== "system" && "hidden")} />
      </DropdownMenuItem>
    </>
  );
};
