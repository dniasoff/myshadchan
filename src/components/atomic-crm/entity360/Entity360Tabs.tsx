import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { useRecordContext, useResourceContext } from "ra-core";
import { Link, useNavigate, useParams } from "react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

/**
 * AD-24's URL-driven tab strip + active panel (Epic 3 API contract §6).
 * Reads resource and record from context — never from props (contract §4/§6
 * rule 4) — and the active key from the URL's `:tab` param. Renders BOTH
 * the tab strip and the active tab's panel; a 360 using this component
 * leaves `Entity360`'s `children` region undefined, which renders nothing
 * (contract §1 rule 2), preserving the AD-24 region order.
 *
 * Built on shadcn's `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`
 * (`@/components/ui/tabs`), driven controlled: `value` is the resolved
 * active key, and each `TabsTrigger` wraps a `<Link>` via Radix's
 * `asChild` (`@radix-ui/react-primitive`'s `Primitive.button` merges its
 * props onto the single child when `asChild` is set), so the rendered
 * trigger is a real anchor — middle-click, "open in new tab" and "copy
 * link address" all work, and a tab click is an ordinary history `push`
 * (the browser's own anchor navigation, intercepted by `<Link>`).
 */
export function Entity360Tabs({
  tabs,
}: Entity360TabsProps): ReactElement | null {
  const resource = useResourceContext();
  const record = useRecordContext();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const { activeKey, shouldReplace } = resolveActiveTab(tabs, tabParam);
  const recordId = record?.id;

  // AC 6 — re-evaluated on every location change (tabParam is part of the
  // dependency list, not just the derived booleans), never a mount-only
  // effect: a back-navigation after a context switch (3.4) can land back on
  // a tab the viewer no longer has.
  useEffect(() => {
    if (
      !shouldReplace ||
      !resource ||
      recordId == null ||
      activeKey === undefined
    ) {
      return;
    }
    navigate(buildTabPath(resource, recordId, activeKey), { replace: true });
  }, [shouldReplace, resource, recordId, activeKey, tabParam, navigate]);

  // AC 7 — an empty `tabs` array (or a record/resource not yet available)
  // renders nothing: no strip, no panel, no error.
  if (!resource || recordId == null || activeKey === undefined) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.key === activeKey);

  return (
    <Tabs value={activeKey}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key} asChild>
            <Link to={buildTabPath(resource, recordId, tab.key)}>
              <TabLabel tabKey={tab.key} override={tab.label} />
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
      {/* AC 4 — only the active tab's `render()` is invoked; the others'
          subtrees never exist. */}
      {activeTab ? (
        <TabsContent value={activeTab.key} className="pt-4">
          {activeTab.render()}
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
