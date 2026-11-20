import { useCallback, useEffect, useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { PipelineState } from "../types";
import { getPipelineStateDef } from "./pipelineStates";
import {
  isTerminalPipelineState,
  type ShidduchMoveReceipt,
} from "./useShidduchTransition";

/** The visible Undo window. The server permits a small grace period after it. */
export const SHIDDUCH_UNDO_MS = 10_000;

export interface ShidduchUndoProvider extends CrmDataProvider {
  undoShidduch: (id: Identifier) => Promise<unknown>;
}

export interface ShidduchUndoState {
  move: ShidduchMoveReceipt | null;
  remaining: number;
  busy: boolean;
  recordMove: (move: ShidduchMoveReceipt) => void;
  undo: () => Promise<void>;
}

/**
 * Owns the short-lived client state for a server-side stage undo. The RPC is
 * still the authority: this hook only controls the 10-second affordance and
 * asks the provider to undo the exact move receipt.
 */
export const useShidduchUndo = (): ShidduchUndoState => {
  const dataProvider =
    useDataProvider<CrmDataProvider>() as ShidduchUndoProvider;
  const notify = useNotify();
  const refresh = useRefresh();
  const [move, setMove] = useState<ShidduchMoveReceipt | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const recordMove = useCallback((nextMove: ShidduchMoveReceipt) => {
    setMove(nextMove);
    setNow(nextMove.movedAt);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!move) return undefined;
    const deadline = move.movedAt + SHIDDUCH_UNDO_MS;
    const update = () => setNow(Math.min(Date.now(), deadline));
    update();
    const interval = window.setInterval(update, 100);
    const timeout = window.setTimeout(
      update,
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [move]);

  const remaining = move
    ? Math.max(0, move.movedAt + SHIDDUCH_UNDO_MS - now)
    : 0;

  useEffect(() => {
    if (move && remaining === 0) setMove(null);
  }, [move, remaining]);

  const undo = useCallback(async () => {
    if (!move || busy || remaining === 0) return;
    setBusy(true);
    try {
      await dataProvider.undoShidduch(move.id);
      const label = getPipelineStateDef(move.from)?.label ?? move.from;
      notify(`Moved back to ${label}`, { type: "info" });
      refresh();
      setMove(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not undo this move",
        { type: "error" },
      );
      setBusy(false);
    }
  }, [busy, dataProvider, move, notify, refresh, remaining]);

  return {
    move: move && remaining > 0 ? move : null,
    remaining,
    busy,
    recordMove,
    undo,
  };
};

export const moveLabel = (state: PipelineState): string => {
  const label = getPipelineStateDef(state)?.label ?? state;
  return isTerminalPipelineState(state) ? `${label} (final)` : label;
};
