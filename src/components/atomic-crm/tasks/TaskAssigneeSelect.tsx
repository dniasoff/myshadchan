import { useEffect } from "react";
import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { assigneeRoleLabel } from "./assigneeLabel";
import { useTaskAssignees } from "./useTaskAssignees";

const UNASSIGNED_VALUE = "__unassigned__";

export interface TaskAssigneeSelectProps {
  /**
   * `null` = explicitly Unassigned; a `members.id` = that member;
   * `undefined` = nothing chosen yet — shown as a placeholder, never
   * highlighting "Unassigned". `TasksTab.tsx`'s create form relies on this
   * third state to omit `member_id` from the payload entirely (AC-11).
   */
  value: Identifier | null | undefined;
  onChange: (memberId: Identifier | null) => void;
  id?: string;
  className?: string;
  ariaLabel?: string;
  /** ReminderCreateSheet (AC-3): a reminder you create for yourself must
   * stay a one-tap flow — once the roster loads, auto-select the caller's
   * own row UNLESS `value` has already been set (by the user or by a prior
   * run of this same effect). */
  defaultToSelf?: boolean;
}

/**
 * The one assignee picker every write surface shares (AC-3): Unassigned +
 * the active members of the caller's current context, each labelled with
 * their name and role, "(you)" on the caller's own row. Sourced from
 * `context_members` — never `useGetList("members")`, which carries no
 * account scoping and would offer every member of every household the
 * caller can see.
 *
 * A plain controlled component (`value`/`onChange`), not a react-admin
 * `Input` — `ReminderCreateSheet.tsx` and `TasksTab.tsx` hold their form
 * state as plain `useState`, not react-hook-form, so this has to work
 * without a form context. `TaskFormContent.tsx` (the one react-hook-form
 * surface) wires it up with `useController` instead of duplicating this
 * component in a form-bound flavour.
 */
export const TaskAssigneeSelect = ({
  value,
  onChange,
  id,
  className,
  ariaLabel,
  defaultToSelf = false,
}: TaskAssigneeSelectProps) => {
  const translate = useTranslate();
  const { assignees, isPending } = useTaskAssignees();

  const selfMember = assignees.find((member) => member.is_self);

  useEffect(() => {
    if (defaultToSelf && value === undefined && selfMember) {
      onChange(selfMember.id);
    }
  }, [defaultToSelf, value, selfMember, onChange]);

  const stringValue =
    value === undefined
      ? undefined
      : value === null
        ? UNASSIGNED_VALUE
        : String(value);

  const handleChange = (next: string) => {
    onChange(next === UNASSIGNED_VALUE ? null : Number(next));
  };

  return (
    <Select
      value={stringValue}
      onValueChange={handleChange}
      disabled={isPending}
    >
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue
          placeholder={translate("crm.tasks.assignee.label", {
            _: "Assignee",
          })}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>
          {translate("crm.tasks.assignee.unassigned", { _: "Unassigned" })}
        </SelectItem>
        {assignees.map((member) => (
          <SelectItem key={String(member.id)} value={String(member.id)}>
            {member.full_name ??
              translate("crm.tasks.assignee.unassigned", {
                _: "Unassigned",
              })}
            {member.is_self
              ? ` (${translate("crm.tasks.assignee.you", { _: "You" })})`
              : ""}
            {" · "}
            {assigneeRoleLabel(member.role, translate)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
