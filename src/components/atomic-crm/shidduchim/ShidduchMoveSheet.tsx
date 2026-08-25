import { useState } from "react";
import type { Identifier } from "ra-core";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { StateChip } from "../misc/StateChip";
import type { PipelineState } from "../types";
import { PipelineStateOptions } from "./PipelineStateOptions";
import { TerminalMoveConfirm } from "./TerminalMoveConfirm";
import type { PipelineStateOption } from "./useShidduchTransition";
import {
  classifySelection,
  useShidduchTransition,
} from "./useShidduchTransition";

export interface ShidduchMoveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: Identifier;
  currentState: PipelineState;
  name?: string | null;
}

/**
 * AC-8/AC-9: the two-tap Move surface. Tap 1 opens this bottom sheet (a
 * `Sheet side="bottom"` — the `sm:max-w-lg` cap already lives in
 * `components/ui/sheet.tsx`, no width class re-added at this call site); tap
 * 2 picks a destination. A legal, non-terminal destination moves
 * immediately and closes the sheet; a legal terminal destination
 * (`for_sure_not | yes | unsure | no`) opens `TerminalMoveConfirm` instead
 * of moving immediately; an illegal destination fires the existing warning
 * `notify()` via `move()` and the sheet stays open.
 */
export const ShidduchMoveSheet = ({
  open,
  onOpenChange,
  id,
  currentState,
  name,
}: ShidduchMoveSheetProps) => {
  const { options, pendingTo, move } = useShidduchTransition({
    id,
    currentState,
    name,
  });
  const [confirmState, setConfirmState] = useState<PipelineState | null>(null);

  const handleSelect = (option: PipelineStateOption) => {
    const outcome = classifySelection(option);
    if (outcome === "noop") return;
    if (outcome === "warn") {
      void move(option.state);
      return;
    }
    if (outcome === "confirm") {
      setConfirmState(option.state);
      return;
    }
    void move(option.state);
    onOpenChange(false);
  };

  const handleConfirm = (reason?: string) => {
    if (!confirmState) return;
    void move(confirmState, reason);
    setConfirmState(null);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* 7 state rows plus 2 group headings overflow a short or landscape
            phone, and a bottom-anchored sheet overflows UPWARD — off the top
            of the viewport, where the first options become unreachable. dvh,
            not vh, so mobile browser chrome is accounted for. */}
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{name ?? "This shidduch"}</SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              Currently <StateChip state={currentState} />
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <PipelineStateOptions
              options={options}
              pendingTo={pendingTo}
              onSelect={handleSelect}
            />
          </div>
        </SheetContent>
      </Sheet>
      <TerminalMoveConfirm
        toState={confirmState}
        name={name}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirm}
      />
    </>
  );
};
