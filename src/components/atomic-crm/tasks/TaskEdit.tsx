import {
  EditBase,
  Form,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { DeleteButton } from "@/components/admin/delete-button";
import { SaveButton } from "@/components/admin/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TaskFormContent } from "./TaskFormContent";

/**
 * Deliberate, named exemption from UX-DR3 ("records live at URLs, not in
 * modals", AD-24) — recorded here per Story 3.13 AC 4, not silently skipped.
 * Four grounds, one sentence each:
 *
 * 1. UX-DR3 scopes the rule to "primary records"; a task is not one.
 * 2. The primary-record set is the set of entities with an `EntityDescriptor`
 *    and a 360 (`shidduchim`, `singles`, `shadchanim`, `references`); `tasks`
 *    is a registered resource but gets no descriptor through Epic 11.
 * 3. A task is a dependent row — it carries `target_type`/`target_id` and is
 *    reached from its target's Tasks tab or the global `/tasks` list, never
 *    as a subject in its own right.
 * 4. Routing this editor would need `buildEditPath("tasks", id)`, which
 *    throws (`requireEntityDescriptor` has no `tasks` entry by design); the
 *    only alternative — hand-building the path — is forbidden by the Epic 3
 *    API contract §4.
 *
 * `TaskEditSheet.tsx` is this dialog's mobile presentation of the same
 * `TaskFormContent`, chosen by `useIsMobile()` in `Task.tsx` — a second
 * responsive presentation of one form, not a second implementation.
 *
 * Reopening trigger: the first story that registers an `EntityDescriptor`
 * for `tasks` moves this editor to `/tasks/{id}/edit` (built with
 * `buildEditPath`) and removes `TaskEdit.tsx` from the AC 5 allowlist in
 * `misc/recordSurfaceDialogs.guard.test.ts`.
 */
export const TaskEdit = ({
  open,
  close,
  taskId,
}: {
  taskId: Identifier;
  open: boolean;
  close: () => void;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  return (
    <Dialog open={open} onOpenChange={close}>
      {open && taskId && (
        <EditBase
          id={taskId}
          resource="tasks"
          className="mt-0"
          mutationOptions={{
            onSuccess: () => {
              close();
              notify("resources.tasks.updated", {
                type: "info",
                undoable: true,
              });
            },
          }}
          redirect={false}
        >
          <DialogContent className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
            <Form className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>
                  {translate("resources.tasks.action.edit")}
                </DialogTitle>
              </DialogHeader>
              <TaskFormContent />
              <DialogFooter className="w-full sm:justify-between gap-4">
                <DeleteButton
                  mutationOptions={{
                    onSuccess: () => {
                      close();
                      notify("resources.tasks.deleted", {
                        type: "info",
                        undoable: true,
                      });
                    },
                  }}
                  redirect={false}
                />
                <SaveButton label="ra.action.save" />
              </DialogFooter>
            </Form>
          </DialogContent>
        </EditBase>
      )}
    </Dialog>
  );
};
