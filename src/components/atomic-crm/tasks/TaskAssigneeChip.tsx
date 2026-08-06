import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ContextMember } from "../types";
import { assigneeRoleLabel } from "./assigneeLabel";

export interface TaskAssigneeChipProps {
  memberId: Identifier | null | undefined;
  /** The current context's active members, keyed by `members.id` — from
   * `useTaskAssignees()`, fetched ONCE per surface and shared across every
   * row's chip (never fetched per row). */
  assigneesById: Map<Identifier, ContextMember>;
  /** `> 1` active member — see AC-10. */
  isMultiMember: boolean;
  className?: string;
}

/**
 * The one assignee chip every surface renders (AC-10; F6 — Story 12.1
 * imports this directly for its own dashboard card rather than writing a
 * second chip). Deliberately a pure function of props: no data fetching, no
 * mutation hook, nothing that would make it unsafe to mount inside a
 * read-only surface like `TasksRailSummary.tsx`.
 *
 * Four states:
 * - `memberId` null, single-member household -> nothing (AC-10 keeps the
 *   chip out of the way of single-parent households).
 * - `memberId` null, multi-member household -> "Unassigned".
 * - `memberId` resolves to the caller (`is_self`) -> "You".
 * - `memberId` resolves to another active member -> their name + role.
 * - `memberId` set but absent from `assigneesById` (an archived member,
 *   AC-7) -> the "no longer in this household" state — never blank, never
 *   a crash.
 */
export const TaskAssigneeChip = ({
  memberId,
  assigneesById,
  isMultiMember,
  className,
}: TaskAssigneeChipProps) => {
  const translate = useTranslate();

  if (memberId == null) {
    if (!isMultiMember) return null;
    return (
      <Badge variant="outline" className={cn("font-normal", className)}>
        {translate("crm.tasks.assignee.unassigned", { _: "Unassigned" })}
      </Badge>
    );
  }

  const member = assigneesById.get(memberId);

  if (!member) {
    return (
      <Badge
        variant="outline"
        className={cn("font-normal text-muted-foreground italic", className)}
      >
        {translate("crm.tasks.assignee.former_member", {
          _: "No longer in this household",
        })}
      </Badge>
    );
  }

  if (member.is_self) {
    return (
      <Badge variant="secondary" className={cn("font-normal", className)}>
        {translate("crm.tasks.assignee.you", { _: "You" })}
      </Badge>
    );
  }

  const name =
    member.full_name ??
    translate("crm.tasks.assignee.unassigned", { _: "Unassigned" });

  return (
    <Badge variant="secondary" className={cn("font-normal", className)}>
      {name} · {assigneeRoleLabel(member.role, translate)}
    </Badge>
  );
};
