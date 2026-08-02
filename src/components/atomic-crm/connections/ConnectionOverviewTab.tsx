import { useRecordContext, useTranslate } from "ra-core";

import { OverviewTab } from "../entity360/tabs/OverviewTab";
import type { OverviewFact } from "../entity360/tabs/OverviewFactGrid";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import type { Connection } from "../types";

/**
 * The `overview` tab's content (Story 8.5). The household name and
 * accepted/ended status already render in the identity header
 * (`ConnectionIdentityHeader`), so this tab carries only the facts left
 * outside it: which side proposed the connection, and — once ended — when
 * and (implicitly, by which account ended it, shown as the same side
 * language) it ended. Mirrors `ShadchanOverviewTab`'s "what's left outside
 * the header" shape.
 */
export function ConnectionOverviewTab() {
  const record = useRecordContext<Connection>();
  const translate = useTranslate();

  if (!record) return null;

  const proposedByHousehold =
    String(record.proposed_by_account_id) ===
    String(record.household_account_id);

  const facts: OverviewFact[] = [
    {
      label: translate("crm.connections.overview.proposedBy", {
        _: "Proposed by",
      }),
      plain: proposedByHousehold
        ? translate("crm.connections.overview.proposedByHousehold", {
            _: "The family",
          })
        : translate("crm.connections.overview.proposedByShadchan", {
            _: "You",
          }),
    },
    {
      label: translate("crm.connections.overview.endedAt", { _: "Ended" }),
      plain: record.ended_at ? formatTimelineDate(record.ended_at) : null,
    },
  ];

  return <OverviewTab facts={facts} />;
}
