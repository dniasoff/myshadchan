import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";

import { PRIMARY_CTA_CLASSNAME } from "../login/primaryCtaClassName";

export interface FormToolbarProps {
  /** Forwarded to `SaveButton`'s `label`. Omitted, `SaveButton` falls back
   * to its own default ("ra.action.save") — every existing caller keeps
   * today's label unchanged. */
  saveLabel?: string;
}

/**
 * Shared form toolbar. The Save button uses the signature gradient primary
 * CTA (design-language §5.3, `PRIMARY_CTA_CLASSNAME`) so every form's primary
 * action reads the same as the hero/list CTAs ("Add a suggestion", "Add a
 * shadchan") — the sizing overlay (h-11 / rounded-xl / font-semibold) matches
 * those buttons. Cancel is matched in height so the pair aligns.
 *
 * The mobile offset is not cosmetic: `MobileNavigation` is `fixed bottom-0
 * z-50`, so a toolbar that sticks to `bottom-0` with no z-index spends the
 * whole scroll of the form painted BEHIND the bottom nav — Save is invisible
 * until the very last pixel of the page. `--mobile-nav-clearance` (the nav's
 * height plus the safe-area inset) lifts it clear; `z-30` keeps it above the
 * form yet still under the nav, so the two never fight for the same pixels.
 */
export const FormToolbar = ({ saveLabel }: FormToolbarProps = {}) => (
  <div
    role="toolbar"
    className="sticky z-30 flex pt-4 pb-4 md:pb-0 bottom-(--mobile-nav-clearance) md:bottom-0 bg-linear-to-b from-transparent to-card to-10% flex-row justify-end gap-2"
  >
    <CancelButton className="h-11 cursor-pointer" />
    <SaveButton
      label={saveLabel}
      className={`h-11 rounded-xl font-semibold ${PRIMARY_CTA_CLASSNAME}`}
    />
  </div>
);
