import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { useRecordContext, useResourceContext } from "ra-core";
import type { Identifier } from "ra-core";
import { Link, useNavigate, useParams } from "react-router";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { buildTabPath } from "./entityPaths";
import { isTabKey, type TabKey } from "./tabKeys";
import { useTabLabel } from "./useTabLabel";

export interface Entity360TabsProps {
  /**
   * `label` is OPTIONAL and is the caller's *override*, not a resolved
   * string: this component renders `useTabLabel(key, label)`. `EntityShow`
   * forwards `tab.label` verbatim, including `undefined` — it must not fill
   * it in from `TAB_LABELS` (contract §2 rule 8, §3 rule 2).
   */
  tabs: { key: TabKey; label?: string; render: () => ReactNode }[];
}

interface ActiveTabResolution {
  activeKey: TabKey | undefined;
  shouldReplace: boolean;
}

/**
 * Pure, and the whole of the resolution logic — AC 5 (`tabParam` undefined
 * -> first tab, no navigation), AC 6 (`tabParam` unknown -> first tab,
 * `replace`) and AC 7 (`tabs` empty -> nothing, no navigation) are three
 * branches of this one function, so they cannot drift apart from each
 * other. "Unknown" covers both a `tabParam` that fails `isTabKey` (a
 * retired or invented segment) and one that passes `isTabKey` but is not in
 * THIS entity's `tabs` (filtered out by 3.4's role check, or never declared
 * at all).
 */
function resolveActiveTab(
  tabs: { key: TabKey }[],
  tabParam: string | undefined,
): ActiveTabResolution {
  if (tabs.length === 0) {
    return { activeKey: undefined, shouldReplace: false };
  }
  if (tabParam !== undefined) {
    const isKnownTab =
      isTabKey(tabParam) && tabs.some((tab) => tab.key === tabParam);
    if (isKnownTab) {
      return { activeKey: tabParam as TabKey, shouldReplace: false };
    }
  }
  // tabParam undefined -> AC 5 (no replace); tabParam set but unknown -> AC 6.
  return { activeKey: tabs[0].key, shouldReplace: tabParam !== undefined };
}

/** A separate (capitalised) component, not an inline call inside `.map()`,
 * so `useTabLabel` — a hook — is called from something the rules-of-hooks
 * lint can recognise as a component, once per rendered trigger. */
function TabLabel({
  tabKey,
  override,
}: {
  tabKey: TabKey;
  override?: string;
}): ReactElement {
  return <>{useTabLabel(tabKey, override)}</>;
}

interface ResolvedTabs {
  resource: string | undefined;
  recordId: Identifier | undefined;
  activeKey: TabKey | undefined;
}

/**
 * Shared resolution + URL-sync core behind `Entity360TabStrip`,
 * `Entity360TabPanel` and `Entity360Tabs`. `Entity360`'s `tabBar` and
 * `children` regions land in different branches of the shell's own render
 * tree — `children` shares the content/rail row with `rightRail` (Epic 3
 * API contract §1 rule 5), `tabBar` does not — so one component instance
 * cannot supply both regions at once; the strip and the panel below are two
 * components built on this one hook instead. Only one of them may run the
 * unknown-tab redirect (`ownsRedirect`): `EntityShow` always mounts the
 * strip and the panel together, and running the effect from both would call
 * `navigate` twice for the same transition.
 */
function useResolvedTabs(
  tabs: { key: TabKey }[],
  { ownsRedirect }: { ownsRedirect: boolean },
): ResolvedTabs {
  const resource = useResourceContext();
  const record = useRecordContext();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const { activeKey, shouldReplace } = resolveActiveTab(tabs, tabParam);
  const recordId = record?.id;

  // AC 6 — re-evaluated on every location change, never a mount-only effect:
  // a back-navigation after a context switch (3.4) can land back on a tab
  // the viewer no longer has. `shouldReplace`/`activeKey` are recomputed
  // every render from `resolveActiveTab(tabs, tabParam)`, so they alone
  // already retrigger this effect on a `tabParam` change — `tabParam` is
  // listed too as a direct, honest dependency of the effect body, not
  // because omitting it changes behaviour.
  useEffect(() => {
    if (
      !ownsRedirect ||
      !shouldReplace ||
      !resource ||
      recordId == null ||
      activeKey === undefined
    ) {
      return;
    }
    navigate(buildTabPath(resource, recordId, activeKey), { replace: true });
  }, [
    ownsRedirect,
    shouldReplace,
    resource,
    recordId,
    activeKey,
    tabParam,
    navigate,
  ]);

  return { resource, recordId, activeKey };
}

/**
 * `Entity360`'s `tabBar` region alone: the strip of links, never the active
 * tab's rendered subtree. Split from `Entity360TabPanel` so `EntityShow` can
 * place the strip in `tabBar` and the panel in `children` — two separate
 * regions (contract §1 rule 5) — see `EntityShow.tsx`'s own doc comment for
 * why the two cannot come from a single `<Entity360Tabs/>` instance. Owns
 * the unknown-tab redirect effect (`ownsRedirect: true` — see
 * `useResolvedTabs`).
 */
export function Entity360TabStrip({
  tabs,
}: Entity360TabsProps): ReactElement | null {
  const { resource, recordId, activeKey } = useResolvedTabs(tabs, {
    ownsRedirect: true,
  });

  // AC 7 — an empty `tabs` array (or a record/resource not yet available)
  // renders nothing: no strip, no navigation.
  if (!resource || recordId == null || activeKey === undefined) {
    return null;
  }

  return (
    <Tabs value={activeKey}>
      {/*
       * Wraps; it does not scroll. `overflow-x-auto` was the previous
       * treatment and it failed twice over on a 12-tab entity like a
       * shidduch. The visible failure was cosmetic and specific: per CSS
       * Overflow §3, an `overflow-x` other than `visible` forces the
       * unspecified `overflow-y` to compute to `auto` as well, so the
       * strip grew a SECOND, vertical scrollbar — on Linux, a stepper with
       * up/down arrows — sitting on top of the last tab. The failure that
       * actually mattered was that the overflowing tabs were simply gone:
       * a horizontal scroll region inside a vertically-scrolling page is
       * close to undiscoverable with a mouse, so "Discussions" existed and
       * could not be found.
       *
       * `h-auto` is load-bearing — `TabsList`'s own `h-9` would clip the
       * second row to nothing — and `flex-none` on the triggers cancels
       * the primitive's `flex-1`, which in a wrapping container stretches
       * a short final row across the full width.
       */}
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            className="flex-none"
            asChild
          >
            <Link to={buildTabPath(resource, recordId, tab.key)}>
              <TabLabel tabKey={tab.key} override={tab.label} />
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * `Entity360`'s `children` region alone: the active tab's rendered subtree,
 * never the strip (see `Entity360TabStrip`). Deliberately NOT wrapped in
 * shadcn's `Tabs`/`TabsContent` — that primitive links a panel to its
 * trigger through a shared Radix context/`baseId`, and the strip and the
 * panel are now, structurally, two separate subtrees of `Entity360`
 * (contract §1 rule 5's whole point: the right rail sits beside the panel,
 * not beside the strip, so the two cannot share one DOM position, let alone
 * one Radix root). A plain `role="tabpanel"` reproduces the accessible
 * semantics that still apply without pretending the two halves share a
 * root; the one thing lost is the `aria-controls`/`aria-labelledby`
 * cross-reference between trigger and panel, which nothing in this
 * codebase reads. Never runs the redirect effect (`ownsRedirect: false` —
 * `Entity360TabStrip` owns it).
 */
export function Entity360TabPanel({
  tabs,
}: Entity360TabsProps): ReactElement | null {
  const { activeKey } = useResolvedTabs(tabs, { ownsRedirect: false });

  if (activeKey === undefined) {
    return null;
  }
  const activeTab = tabs.find((tab) => tab.key === activeKey);
  if (!activeTab) {
    return null;
  }

  // AC 4 — only the active tab's `render()` is invoked; the others'
  // subtrees never exist.
  return (
    <div role="tabpanel" className="flex-1 pt-4 outline-none">
      {activeTab.render()}
    </div>
  );
}

/**
 * AD-24's URL-driven tab strip + active panel, together, in one element
 * (Epic 3 API contract §6) — a thin composition of `Entity360TabStrip` and
 * `Entity360TabPanel` for a caller that wants both in a single region (as
 * this file's own test fixtures do). **`EntityShow` does not use this
 * component**: it needs the strip and the panel in `Entity360`'s two
 * separate regions (`tabBar` and `children`), which is exactly what one
 * merged element cannot express — see `Entity360TabStrip` / `Entity360TabPanel`
 * above, and `EntityShow.tsx`'s own doc comment.
 */
export function Entity360Tabs({
  tabs,
}: Entity360TabsProps): ReactElement | null {
  return (
    <>
      <Entity360TabStrip tabs={tabs} />
      <Entity360TabPanel tabs={tabs} />
    </>
  );
}
