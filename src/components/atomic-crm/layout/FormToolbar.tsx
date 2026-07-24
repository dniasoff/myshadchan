import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";

import { PRIMARY_CTA_CLASSNAME } from "../login/primaryCtaClassName";

/**
 * Shared form toolbar. The Save button uses the signature gradient primary
 * CTA (design-language §5.3, `PRIMARY_CTA_CLASSNAME`) so every form's primary
 * action reads the same as the hero/list CTAs ("Add a suggestion", "Add a
 * shadchan") — the sizing overlay (h-11 / rounded-xl / font-semibold) matches
 * those buttons. Cancel is matched in height so the pair aligns.
 */
export const FormToolbar = () => (
  <div
    role="toolbar"
    className="sticky flex pt-4 pb-4 md:pb-0 bottom-0 bg-linear-to-b from-transparent to-card to-10% flex-row justify-end gap-2"
  >
    <CancelButton className="h-11 cursor-pointer" />
    <SaveButton className={`h-11 rounded-xl font-semibold ${PRIMARY_CTA_CLASSNAME}`} />
  </div>
);
