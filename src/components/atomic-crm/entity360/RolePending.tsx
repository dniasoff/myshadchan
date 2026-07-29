import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

/**
 * AC 6(a) — the region `EntityShow` renders in place of BOTH the tab bar
 * and the tab content while `useViewerRole().isPending` is true. Because
 * this is the only thing `EntityShow` passes as `tabBar` in that window,
 * `Entity360Tabs`/`Entity360TabStrip` is never mounted at all: no
 * `tablist`, and 3.2's unknown-tab fallback (which only runs from inside
 * that component) cannot fire — so a deep link to a role-restricted tab
 * cannot be rewritten before the role resolves. Same shape as
 * `RecordPending.tsx`, the sibling pending state for the record fetch
 * itself.
 */
export function RolePending(): ReactElement {
  const translate = useTranslate();

  return (
    <div
      role="status"
      className="flex items-center justify-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground"
    >
      {translate("crm.entity360.role_pending", { _: "Loading your access…" })}
    </div>
  );
}
