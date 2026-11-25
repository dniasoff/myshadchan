import { useEffect, useRef } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { PipelineState } from "../types";
import { getPipelineStateDef, isTerminalPipelineState } from "./pipelineStates";

export interface ShidduchMoveBackConfirmProps {
  move: { from_state: PipelineState; to_state: PipelineState } | null;
  name?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const MoveBackCopy = ({
  move,
  name,
}: Pick<ShidduchMoveBackConfirmProps, "move" | "name">) => {
  if (!move) return null;
  const from = getPipelineStateDef(move.to_state)?.label ?? move.to_state;
  const to = getPipelineStateDef(move.from_state)?.label ?? move.from_state;
  return (
    <>
      <p>
        Move {name ?? "this suggestion"} back from {from} to {to}?
      </p>
      {move.from_state === "new" ? (
        <p>Going back to New hides this suggestion from the child.</p>
      ) : null}
      {isTerminalPipelineState(move.to_state) &&
      move.from_state === "look_into" ? (
        <p>The close note saved for this suggestion will be cleared.</p>
      ) : null}
      <p>Only one step will be reversed. The history stays on the record.</p>
    </>
  );
};

/** Confirmation is a dialog on desktop and a bottom sheet on a phone. */
export const ShidduchMoveBackConfirm = ({
  move,
  name,
  busy = false,
  onCancel,
  onConfirm,
}: ShidduchMoveBackConfirmProps) => {
  const isMobile = useIsMobile();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fromLabel = move
    ? (getPipelineStateDef(move.from_state)?.label ?? move.from_state)
    : "";

  useEffect(() => {
    if (move) cancelRef.current?.focus();
  }, [move]);

  const actions = (
    <>
      <Button
        ref={cancelRef}
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={onCancel}
        disabled={busy}
      >
        Cancel
      </Button>
      <Button
        type="button"
        className="min-h-11"
        onClick={onConfirm}
        disabled={busy}
      >
        {busy ? "Moving…" : `Back to ${fromLabel}`}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={move !== null} onOpenChange={(open) => !open && onCancel()}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Are you sure?</SheetTitle>
            <SheetDescription>
              This will move the suggestion back one step.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4 text-sm">
            <MoveBackCopy move={move} name={name} />
          </div>
          <SheetFooter>{actions}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={move !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            This will move the suggestion back one step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <MoveBackCopy move={move} name={name} />
        </div>
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
