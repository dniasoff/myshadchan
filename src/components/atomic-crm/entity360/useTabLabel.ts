import { useTranslate } from "ra-core";

import { TAB_LABELS, tabLabelKey, type TabKey } from "./tabKeys";

/**
 * Resolves a tab's rendered label (contract §3 rule 2). Resolution is
 * exactly, and only:
 *
 *   override ?? translate(`crm.entity360.tab.${key}`, { _: TAB_LABELS[key] })
 *
 * i18n first, the canonical `TAB_LABELS` entry as the untranslated
 * fallback — never the other way round. `override` is reserved for a
 * genuine per-entity deviation from the canonical vocabulary
 * (`EntityTabDescriptor.label`, optional and normally absent); nothing
 * between the descriptor and this hook may synthesise an override out of
 * `TAB_LABELS` — doing so would make every tab an "override" and the
 * translation catalog would never be consulted.
 */
export function useTabLabel(key: TabKey, override?: string): string {
  const translate = useTranslate();
  return override ?? translate(tabLabelKey(key), { _: TAB_LABELS[key] });
}
