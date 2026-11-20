import { Button } from "@/components/ui/button";

import { moveLabel, SHIDDUCH_UNDO_MS } from "./useShidduchUndo";
import type { ShidduchUndoState } from "./useShidduchUndo";

export const UndoBar = ({
  move,
  remaining,
  busy,
  undo,
  onUndoFocus,
  onUndoBlur,
}: Pick<
  ShidduchUndoState,
  "move" | "remaining" | "busy" | "undo" | "onUndoFocus" | "onUndoBlur"
>) => {
  if (!move || remaining === 0) return null;

  const progress = Math.max(
    0,
    Math.min(100, (remaining / SHIDDUCH_UNDO_MS) * 100),
  );

  return (
    <div
      className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            Moved to {moveLabel(move.to)}.
          </p>
          <p className="text-xs text-muted-foreground">
            Undo is available for 10 seconds.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          aria-label={`Undo move to ${moveLabel(move.to)}`}
          data-shidduch-undo-button="true"
          disabled={busy || remaining === 0}
          onFocus={() => onUndoFocus?.(move.id)}
          onBlur={() => onUndoBlur?.(move.id)}
          onClick={() => void undo()}
        >
          Undo
        </Button>
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Undo time remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
