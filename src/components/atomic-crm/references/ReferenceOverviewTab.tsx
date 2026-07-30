import { useRecordContext, useTranslate } from "ra-core";

import { OverviewTab } from "../entity360/tabs/OverviewTab";
import type { OverviewFact } from "../entity360/tabs/OverviewFactGrid";
import type { Reference } from "../types";

/**
 * The `overview` tab's content (Story 5.10, AC 4): the identity-fact block
 * that used to live in `ReferenceHeader`'s meta line — relationship, phone,
 * school, graduation year — through the shared `OverviewTab` +
 * `OverviewFactGrid` (contract §12 step 0), exactly like
 * `shidduchim`/`singles`/`shadchanim`'s own Overview tabs.
 * `ReferenceHeader` keeps only the contact-style identity block (name,
 * avatar, conversation-progress meter) in the shell's identity header
 * region — this tab is the one place the rest of it lives now, not a second
 * copy of the same facts.
 *
 * The "shown per single below when it differs" note travels with the
 * Relationship fact it always sat beside — it explains that
 * `reference_links.relationship_override` can differ per shidduch, which is
 * only relevant once a relationship value is on screen at all.
 */
export function ReferenceOverviewTab() {
  const record = useRecordContext<Reference>();
  const translate = useTranslate();
  if (!record) return null;

  const facts: OverviewFact[] = [
    { label: "Relationship", plain: record.relationship ?? null },
    { label: "Phone", plain: record.phone ?? null },
    { label: "School", plain: record.school ?? null },
    {
      label: "Graduation year",
      plain: record.grad_year ? String(record.grad_year) : null,
    },
  ];

  return (
    <OverviewTab facts={facts}>
      {record.relationship ? (
        <p className="text-xs text-muted-foreground">
          {translate("crm.references.header.relationshipNote", {
            _: "Shown per single below when it differs.",
          })}
        </p>
      ) : null}
    </OverviewTab>
  );
}
