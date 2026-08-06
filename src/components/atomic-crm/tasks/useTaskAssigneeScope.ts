import { useStore } from "ra-core";

/** The two ways `/tasks` and `/reminders` can be scoped (AC-1, AC-2). */
export type TaskAssigneeScope = "everyone" | "mine";

/**
 * Persisted Everyone/Mine scope, shared by `/tasks` and `/reminders` under
 * ONE `useStore` key (Ruling 4 — a per-surface key would let the two
 * disagree about what "Mine" means, reproducing the contradiction this
 * story exists to fix). `root/crmStore.ts` persists every `useStore` key
 * into the app's single `"CRM"` localStorage namespace, so the choice
 * survives a reload without a second persistence mechanism — modelled on
 * `misc/useEntityListViewMode.ts`'s identical thin wrapper.
 *
 * Defaults to `"everyone"` — AC-1's fail-closed direction is showing too
 * much, not too little. A `"mine"` default reproduces the exact defect
 * `TasksListByDueDate.tsx` used to carry unconditionally.
 */
export function useTaskAssigneeScope(): [
  TaskAssigneeScope,
  (scope: TaskAssigneeScope) => void,
] {
  return useStore<TaskAssigneeScope>("tasks.assigneeScope", "everyone");
}
