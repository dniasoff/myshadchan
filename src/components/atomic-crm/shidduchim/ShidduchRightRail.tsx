import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

import type { ShidduchSummary } from "../types";
import { TasksRailSummary } from "../entity360/tabs/TasksRailSummary";
import { ForwardResumeButton } from "./ForwardResumeButton";
import { SingleInputPanel } from "./SingleInputPanel";

/**
 * The shidduch's `rightRail` region (Story 5.7, AC 1): three compact,
 * read-only panels beside the tab content — never a second mutation
 * surface (`epic3-api-contract.md#11` Ruling 2). `EntityShow` supplies
 * exactly `{ record }` (`entity360/entityDescriptor.ts`'s
 * `rightRail?: ComponentType<{record}>`), so this and every panel it
 * composes reach the shidduch through that one prop — never a bespoke
 * `shidduchId` prop at THIS boundary (`SingleInputPanel`/
 * `ForwardResumeButton` still take a plain `shidduchimId`, exactly like
 * `ResumeTab`'s own siblings in `resumes/`, since they are not
 * `UniversalTabProps` consumers).
 *
 * Adding and completing a reminder happens in the shidduch's Tasks tab
 * (Story 3.8's `TasksTab.tsx`) — `TasksRailSummary` is mounted here
 * unmodified, exactly the read-only summary it already is; this file adds
 * no mutation affordance of its own (`ShidduchRightRail.guard.test.ts`
 * proves it, AC 7).
 */
export function ShidduchRightRail({
  record,
}: {
  record: ShidduchSummary;
}): ReactElement {
  const translate = useTranslate();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {translate("crm.entity360.rail.singleInput.heading", {
            _: "The single's input",
          })}
        </h3>
        <SingleInputPanel shidduchimId={record.id} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {translate("crm.entity360.rail.reminders.heading", {
            _: "Reminders",
          })}
        </h3>
        <TasksRailSummary targetType="shidduch" targetId={record.id} />
      </section>
      <section>
        <ForwardResumeButton shidduchimId={record.id} />
      </section>
    </div>
  );
}
