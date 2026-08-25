import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import type { PipelineState } from "../types";
import { getPipelineStateDef } from "./pipelineStates";

export interface TerminalMoveConfirmProps {
  /** The terminal destination pending confirmation, or null when closed. */
  toState: PipelineState | null;
  name?: string | null;
  onCancel: () => void;
  /** Only fired on an explicit confirm — never on Cancel, never on the tap
   * that opened this dialog (AC-9). `reason` is the optional "Why?" text,
   * forwarded verbatim as `transitionShidduch`'s existing 4th argument. */
  onConfirm: (reason?: string) => void;
}

/**
 * AC-9: the friction step every one of the five irreversible edges
 * (for_sure_not | yes | unsure | no) goes through before
 * `dataProvider.transitionShidduch` is ever called. There is no Undo —
 * `PIPELINE_TRANSITIONS` has zero reverse edges — so this dialog states that
 * plainly rather than implying one exists.
 *
 * A bottom sheet (`components/ui/sheet.tsx`), not `components/ui/dialog.tsx`:
 * this is a confirmation step, not a record surface, so UX-DR3's dialog
 * guard (`misc/recordSurfaceDialogs.guard.test.ts`) never has to know about
 * it — and it keeps the same sheet language `ShidduchMoveSheet` (this
 * confirm step's own caller) already opened, rather than switching
 * mid-flow to a centred modal.
 */
export const TerminalMoveConfirm = ({
  toState,
  name,
  onCancel,
  onConfirm,
}: TerminalMoveConfirmProps) => {
  const [reason, setReason] = useState("");
  const label = toState ? (getPipelineStateDef(toState)?.label ?? toState) : "";

  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel();
  };

  const handleConfirm = () => {
    const trimmed = reason.trim();
    onConfirm(trimmed.length > 0 ? trimmed : undefined);
    setReason("");
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <Sheet open={toState !== null} onOpenChange={handleOpenChange}>
      {/* The reason field is a textarea, so on a phone the keyboard opens over
          this sheet — and a bottom sheet with `h-auto` and no scroller has no
          way back to its own Confirm/Cancel once that happens. dvh, never vh:
          vh ignores the mobile browser chrome the keyboard sits under. */}
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Move {name ?? "this shidduch"} to {label}?
          </SheetTitle>
          <SheetDescription>
            {label} is a final stage — there is no way to undo this move.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-1.5 px-4">
          <label
            htmlFor="terminal-move-reason"
            className="text-xs font-medium text-muted-foreground"
          >
            Why? (optional)
          </label>
          <Textarea
            id="terminal-move-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="A short note for the record — optional"
          />
        </div>
        {/* Cancel stays LAST — in this column footer that is the bottom, the
            thumb-nearest position, which is where the harmless choice belongs
            when the other one cannot be undone. And the confirm is
            deliberately not `variant="destructive"`: the terminal set includes
            `yes`, and a red "Confirm — move to Yes" reads as a warning about a
            happy outcome. The irreversibility is stated in words above. */}
        <SheetFooter>
          <Button type="button" onClick={handleConfirm}>
            Confirm — move to {label}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
