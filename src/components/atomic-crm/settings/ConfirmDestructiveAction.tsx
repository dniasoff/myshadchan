import { useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslate } from "ra-core";

type ConfirmDestructiveActionProps = {
  /** Copy on the row's own small ghost button. */
  triggerLabel: string;
  /** Question the dialog asks — name the other party where there is one. */
  title: string;
  /** What actually happens, in the reader's terms. */
  description: string;
  /** Copy on the destructive confirm button. Deliberately NOT the same
   * string as `triggerLabel`: both are in the DOM once the dialog is open,
   * and two buttons with one accessible name are ambiguous to a screen
   * reader (and to `getByRole`). */
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
};

/**
 * A row-sized destructive action that asks first.
 *
 * Settings rows put irreversible actions ("End connection", "Cancel invite")
 * directly beside ordinary row content, where a phone-sized thumb reaches
 * them by accident — and neither has an undo. This is the confirm step
 * `connections/ConnectionEndAction.tsx` already gives the same action on the
 * Connection 360; it is re-implemented rather than imported because that one
 * is a full-width button that completes through `useRefresh()`, while a
 * Settings panel has to stay a small in-row control and complete through its
 * own `refetch()`.
 *
 * Lives in its own file because `ConnectionSection.tsx`, its only caller
 * today, is already past this repo's file-size ceiling
 * (`.claude/rules/coding-style.md`: grow the file count, not the file).
 */
export const ConfirmDestructiveAction = ({
  triggerLabel,
  title,
  description,
  confirmLabel,
  disabled = false,
  onConfirm,
}: ConfirmDestructiveActionProps): ReactElement => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleConfirm = async () => {
    setIsRunning(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      // The caller owns the error path (it already notifies); the dialog
      // only has to stop claiming to be busy, and stay open so the reader
      // can see the notification and try again.
      setIsRunning(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {translate("ra.action.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={isRunning}
              onClick={() => void handleConfirm()}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
