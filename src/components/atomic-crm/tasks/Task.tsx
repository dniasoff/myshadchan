import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import {
  useDeleteWithUndoController,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { formatDueMoment } from "../misc/formatDueMoment";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Task as TData } from "../types";
import { TaskAssigneeChip } from "./TaskAssigneeChip";
import { TaskEdit } from "./TaskEdit";
import { TaskEditSheet } from "./TaskEditSheet";
import { useTaskAssignees } from "./useTaskAssignees";
import { useIsMobile } from "@/hooks/use-mobile";

export const Task = ({ task }: { task: TData }) => {
  const isMobile = useIsMobile();
  const { taskTypes } = useConfigurationContext();
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();
  // `TasksIterator.tsx`/`TasksListFilter.tsx` (out of this story's
  // ownership manifest) render one `Task` per row with no shared assignee
  // map threaded down, so this reads `useTaskAssignees()` directly rather
  // than growing that prop-drilling chain — react-query dedupes the
  // identical `context_members` query across every mounted row into ONE
  // network request, so this stays "one fetch per surface" in effect even
  // though the hook is called per component instance (AC-10).
  const { assigneesById, isMultiMember } = useTaskAssignees();
  const isUnresolvedAssignee =
    task.member_id != null && !assigneesById.has(task.member_id);

  const [openEdit, setOpenEdit] = useState(false);

  const handleCloseEdit = () => {
    setOpenEdit(false);
  };

  const [update, { isPending: isUpdatePending, isSuccess, variables }] =
    useUpdate();
  const { handleDelete } = useDeleteWithUndoController({
    record: task,
    redirect: false,
    mutationOptions: {
      onSuccess() {
        notify("resources.tasks.deleted", {
          undoable: true,
        });
      },
    },
  });

  const handleEdit = () => {
    setOpenEdit(true);
  };

  const handleCheck = () => () => {
    update("tasks", {
      id: task.id,
      data: {
        done_date: task.done_date ? null : new Date().toISOString(),
      },
      previousData: task,
    });
  };

  useEffect(() => {
    // We do not want to invalidate the query when a tack is checked or unchecked
    if (
      isUpdatePending ||
      !isSuccess ||
      variables?.data?.done_date != undefined
    ) {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] });
  }, [queryClient, isUpdatePending, isSuccess, variables]);

  const labelId = `checkbox-list-label-${task.id}`;

  return (
    <>
      <div className="flex items-start justify-between">
        {/*
         * No onClick on this wrapper. It used to toggle the task done on
         * mobile, and every interactive child bubbled into it — so tapping
         * "Reassign" (below) fired the toggle as well as the edit, and a
         * tap on the checkbox itself fired the mutation twice. A <div> with
         * onClick and no role/tabIndex/key handler is unreachable by
         * keyboard besides.
         *
         * The tap target lives on the checkbox instead, as the transparent
         * `before:` hit extension `entity360/tabs/TasksTab.tsx` already
         * uses: the box stays visually 16px (enlarging it would turn a
         * reading list into a form) while the tappable area is 44px. Gated
         * `md:before:hidden` for the same reason it is there — above md the
         * rows tighten, and a 44px box on a ~28px row overlaps its
         * neighbour, with the LOWER row winning the seam.
         */}
        <div className="flex items-start gap-2 flex-1">
          {/* `aria-label`, not `id` + a `<label htmlFor>`. Radix renders this
           * as `<button role="checkbox">`, and a `<label for>` names form
           * controls only — it does not name a button. The id was sitting
           * here with no label pointing at it, so a screen reader announced
           * "checkbox, unchecked" with no way to know which task it
           * completes. Confirmed by resolving the accessible name in a real
           * browser, which returned empty. */}
          <Checkbox
            id={labelId}
            aria-label={translate("crm.tasks.completeLabel", {
              _: "Mark done: %{task}",
              task: task.text,
            })}
            checked={!!task.done_date}
            onCheckedChange={handleCheck()}
            disabled={isUpdatePending}
            className="relative mt-1 before:absolute before:-inset-3.5 before:content-[''] md:before:hidden"
          />
          <div className={`flex-grow ${task.done_date ? "line-through" : ""}`}>
            {/* 16px body on a phone, the same responsive step this file's
                own dropdown items below already take. */}
            <div className="text-base md:text-sm">
              {task.type && task.type !== "none" && (
                <>
                  <span className="font-semibold">
                    {(() => {
                      const matchedTaskType = taskTypes.find(
                        (taskType) => taskType.value === task.type,
                      );
                      return matchedTaskType
                        ? matchedTaskType.label
                        : task.type;
                    })()}
                  </span>
                  &nbsp;
                </>
              )}
              {task.text}
            </div>
            {/* Shared with `ReminderCard` — the same `due_date` used to read
                `7/24/2026, 2:00:00 PM` here and `24 Jul, 2:00 PM` in the
                reminders hub. */}
            <div className="text-base md:text-sm text-muted-foreground">
              {translate("resources.tasks.fields.due_short")}
              &nbsp;
              {task.due_date ? formatDueMoment(task.due_date) : null}
            </div>
            {/* AC-10: the assignee, visible on every row once the household
                has more than one active member. AC-7: an archived assignee
                stays completable and gets a Reassign affordance here, on
                the row — never on the chip itself, which stays a pure,
                surface-agnostic display component (F6). */}
            <div className="mt-1 flex items-center gap-2">
              <TaskAssigneeChip
                memberId={task.member_id}
                assigneesById={assigneesById}
                isMultiMember={isMultiMember}
              />
              {/* Reassign is sized for a finger on a phone. It sits beside
               * the assignee name in a dense row, so the transparent halo
               * the checkboxes use would overlap its neighbour — a real
               * min-height row is the right shape here. */}
              {isUnresolvedAssignee && (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline md:min-h-0"
                  onClick={handleEdit}
                >
                  {translate("crm.tasks.assignee.reassign", {
                    _: "Reassign",
                  })}
                </button>
              )}
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              // Was `h-5 pr-0! size-8` — three declarations setting height
              // twice, resolved by class order into a 20px-tall tap target.
              // One declaration, at the 44px floor.
              className="size-11 shrink-0 cursor-pointer"
              aria-label={translate("resources.tasks.actions.title")}
            >
              <MoreVertical className="size-5 md:size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_tomorrow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_next_week")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleEdit}
            >
              {translate("ra.action.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleDelete}
            >
              {translate("ra.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isMobile ? (
        <TaskEditSheet
          taskId={task.id}
          open={openEdit}
          onOpenChange={setOpenEdit}
        />
      ) : (
        <TaskEdit taskId={task.id} open={openEdit} close={handleCloseEdit} />
      )}
    </>
  );
};
