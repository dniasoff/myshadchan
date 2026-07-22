import {
  BellRing,
  BookUser,
  Check,
  Home,
  Moon,
  MoreHorizontal,
  Plus,
  Settings,
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

import { PRIMARY_NAV } from "./navItems";

const findNavItem = (to: string) => {
  const item = PRIMARY_NAV.find((navItem) => navItem.to === to);
  if (!item) throw new Error(`Nav item not found: ${to}`);
  return item;
};

const pipelineItem = findNavItem("/shidduchim");
const shadchanimItem = findNavItem("/shadchanim");
const referencesItem = findNavItem("/references");
const remindersItem = findNavItem("/reminders");
const settingsItem = findNavItem("/settings");

/**
 * Mobile bottom nav (foundation-plan §3): 5-slot glass bar — Home, Pipeline,
 * a raised center capture button, Shadchanim, and a "More" menu holding
 * References / Reminders / Settings / theme. Paths & labels are pulled from
 * `PRIMARY_NAV` (single source of truth shared with the desktop Sidebar).
 */
export const MobileNavigation = () => {
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
    matchPath(`${referencesItem.to}/*`, location.pathname) ||
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
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch
        justify-around border-t border-[--glass-border] bg-[--glass-bg]
        pb-[env(safe-area-inset-bottom)] shadow-lg
        backdrop-blur-[var(--glass-blur)]"
    >
      <NavigationButton
        href="/"
        Icon={Home}
        label={translate("ra.page.dashboard")}
        isActive={currentPath === "/"}
      />
      <NavigationButton
        href={pipelineItem.to}
        Icon={pipelineItem.icon}
        label={translate(pipelineItem.labelKey, {
          smart_count: 2,
          _: pipelineItem.labelDefault,
        })}
        isActive={currentPath === pipelineItem.to}
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
      />
      <MoreButton isActive={currentPath === "more"} />
    </nav>
  );
};

const NavigationButton = ({
  href,
  Icon,
  label,
  isActive,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
}) => (
  <Button
    asChild
    variant="ghost"
    className={cn(
      "flex h-full w-16 flex-col items-center justify-center gap-1 rounded-none px-1",
      isActive ? "text-primary" : "text-muted-foreground",
    )}
  >
    <Link to={href}>
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
              transition-transform duration-[160ms] ease-[--ease-spring]
              active:scale-[0.97]
              focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-7" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="mb-2">
          <DropdownMenuItem asChild>
            <Link to="/shidduchim/create">Add a suggestion</Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            Log a call (coming soon)
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            Scan a resume (coming soon)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const MoreButton = ({ isActive }: { isActive: boolean }) => {
  const translate = useTranslate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
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
        <DropdownMenuItem asChild>
          <Link to={referencesItem.to} className="flex items-center gap-2">
            <BookUser className="size-4" aria-hidden="true" />
            {translate(referencesItem.labelKey, {
              smart_count: 2,
              _: referencesItem.labelDefault,
            })}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={remindersItem.to} className="flex items-center gap-2">
            <BellRing className="size-4" aria-hidden="true" />
            {translate(remindersItem.labelKey, {
              _: remindersItem.labelDefault,
            })}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={settingsItem.to} className="flex items-center gap-2">
            <Settings className="size-4" aria-hidden="true" />
            {translate(settingsItem.labelKey, {
              _: settingsItem.labelDefault,
            })}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
 */
const ThemeMenuItems = () => {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <DropdownMenuItem onClick={() => setTheme("light")}>
        <Sun className="size-4" aria-hidden="true" />
        Light
        <Check className={cn("ms-auto", theme !== "light" && "hidden")} />
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme("dark")}>
        <Moon className="size-4" aria-hidden="true" />
        Dark
        <Check className={cn("ms-auto", theme !== "dark" && "hidden")} />
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setTheme("system")}>
        System
        <Check className={cn("ms-auto", theme !== "system" && "hidden")} />
      </DropdownMenuItem>
    </>
  );
};
