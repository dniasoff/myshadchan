import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { TaskAssigneeScope } from "./useTaskAssigneeScope";

export interface TaskScopeToggleProps {
  scope: TaskAssigneeScope;
  onChange: (scope: TaskAssigneeScope) => void;
}

/**
 * The Everyone/Assigned-to-me control shared by `/tasks` and `/reminders`
 * (AC-2). A controlled two-button segmented toggle, modelled on
 * `misc/EntityListViewToggle.tsx` — it never reads or writes the persisted
 * scope itself, so it unit-tests with only a translate context, no store
 * required.
 */
export const TaskScopeToggle = ({ scope, onChange }: TaskScopeToggleProps) => {
  const translate = useTranslate();
  const everyoneLabel = translate("crm.tasks.assignee.everyone", {
    _: "Everyone",
  });
  const mineLabel = translate("crm.tasks.assignee.mine", {
    _: "Assigned to me",
  });
  const groupLabel = translate("crm.tasks.assignee.scope_group", {
    _: "Task scope",
  });

  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border p-0.5"
    >
      {/* gap-1.5, not gap-0.5: these two 44px targets sat 2px apart, and
          this is the primary filter on both /tasks and /reminders. The height
          floor itself comes from ui/button.tsx's `sm` size. */}
      <Button
        type="button"
        size="sm"
        variant={scope === "everyone" ? "secondary" : "ghost"}
        aria-pressed={scope === "everyone"}
        onClick={() => onChange("everyone")}
      >
        {everyoneLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={scope === "mine" ? "secondary" : "ghost"}
        aria-pressed={scope === "mine"}
        onClick={() => onChange("mine")}
      >
        {mineLabel}
      </Button>
    </div>
  );
};
