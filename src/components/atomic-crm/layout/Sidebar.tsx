import { CanAccess, useTranslate } from "ra-core";
import { Link, useMatch } from "react-router";

import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { PRIMARY_NAV, type NavItem } from "./navItems";

/**
 * The desktop left sidebar (foundation-plan §1) — fixed, glass chrome
 * (design-language §1.2/§5.2), the 6 foundation destinations only.
 * Desktop-only: never mounted on mobile (see MobileLayout/MobileNavigation).
 */
export const Sidebar = () => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();

  return (
    <aside
      className="fixed inset-y-0 start-0 z-30 hidden w-[var(--sidebar-w)]
        flex-col border-e border-[--glass-border] bg-[--glass-bg]
        shadow-lg backdrop-blur-[var(--glass-blur)] md:flex"
    >
      <Link
        to="/"
        className="flex items-center gap-2 px-5 py-5 text-foreground no-underline"
      >
        <img
          className="[.light_&]:hidden h-7"
          src={darkModeLogo}
          alt={title}
        />
        <img
          className="[.dark_&]:hidden h-7"
          src={lightModeLogo}
          alt={title}
        />
        <span className="font-display text-lg font-bold tracking-tight">
          {title}
        </span>
      </Link>

      <nav
        aria-label={title}
        className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4"
      >
        {PRIMARY_NAV.map((item) => (
          <SidebarNavItem key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
};

const SidebarNavItem = ({ item }: { item: NavItem }) => {
  if (item.to === "/settings") {
    return (
      <CanAccess resource="configuration" action="edit">
        <SidebarLink item={item} />
      </CanAccess>
    );
  }
  return <SidebarLink item={item} />;
};

const SidebarLink = ({ item }: { item: NavItem }) => {
  const translate = useTranslate();
  const isDashboard = item.to === "/";
  const match = useMatch(isDashboard ? "/" : `${item.to}/*`);
  const isActive = !!match;
  const Icon = item.icon;
  // `smart_count: 2` resolves pluralized resource-name catalog entries
  // (e.g. "Shadchan |||| Shadchanim"); harmless no-op for plain keys.
  const label = translate(item.labelKey, {
    smart_count: 2,
    _: item.labelDefault,
  });

  return (
    <Link
      to={item.to}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex h-11 items-center gap-3 rounded-xl px-3",
        "font-medium outline-none transition-colors duration-[160ms]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isActive
          ? "bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-primary shadow-[0_0_24px_-8px_var(--glow-accent)]"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {isActive ? (
        <span
          className="absolute inset-y-1.5 start-0 w-1 rounded-full"
          style={{
            backgroundImage:
              "linear-gradient(var(--accent-grad-from), var(--accent-grad-to))",
          }}
          aria-hidden="true"
        />
      ) : null}
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
};
