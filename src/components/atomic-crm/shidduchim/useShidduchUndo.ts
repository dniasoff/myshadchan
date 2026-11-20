import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { PipelineState, Shidduch } from "../types";
import { getPipelineStateDef } from "./pipelineStates";
import {
  isTerminalPipelineState,
  type ShidduchMoveReceipt,
} from "./useShidduchTransition";

/** The visible Undo window. The server permits a small grace period after it. */
export const SHIDDUCH_UNDO_MS = 10_000;

const focusShidduch = (id: Identifier) => {
  if (typeof document === "undefined") return;
  const container = Array.from(
    document.querySelectorAll<HTMLElement>("[data-shidduch-id]"),
  ).find((candidate) => candidate.dataset.shidduchId === String(id));
  const target = container?.matches("a,button,[tabindex]:not([tabindex='-1'])")
    ? container
    : container?.querySelector<HTMLElement>(
        "a,button,[tabindex]:not([tabindex='-1'])",
      );
  target?.focus();
};

export interface ShidduchUndoProvider {
  undoShidduch: (id: Identifier) => Promise<Shidduch>;
}

export interface ShidduchUndoState {
  move: ShidduchMoveReceipt | null;
  remaining: number;
  busy: boolean;
  recordMove: (move: ShidduchMoveReceipt) => void;
  undo: () => Promise<void>;
  onUndoFocus?: (id: Identifier) => void;
  onUndoBlur?: (id: Identifier) => void;
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
  const undoFocusId = useRef<Identifier | null>(null);
  const focusRestoreId = useRef<Identifier | null>(null);

  const onUndoFocus = useCallback((id: Identifier) => {
    undoFocusId.current = id;
  }, []);

  const onUndoBlur = useCallback((id: Identifier) => {
    if (undoFocusId.current === id) undoFocusId.current = null;
  }, []);

  const requestFocusRestore = useCallback((id: Identifier) => {
    if (undoFocusId.current === id) {
      focusRestoreId.current = id;
    }
  }, []);

  // The bar unmount can move focus to body. Restore it in a layout effect,
  // after React has committed the removal, so both success and expiry leave a
  // keyboard user at the suggestion they were acting on.
  useLayoutEffect(() => {
    if (move || focusRestoreId.current === null) return;
    const id = focusRestoreId.current;
    focusRestoreId.current = null;
    focusShidduch(id);
  }, [move]);

  const recordMove = useCallback((nextMove: ShidduchMoveReceipt) => {
    focusRestoreId.current = null;
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
    if (move && remaining === 0) {
      requestFocusRestore(move.id);
      setMove(null);
    }
  }, [move, remaining, requestFocusRestore]);

  const undo = useCallback(async () => {
    if (!move || busy || remaining === 0) return;
    setBusy(true);
    try {
      await dataProvider.undoShidduch(move.id);
      const label = getPipelineStateDef(move.from)?.label ?? move.from;
      notify(`Moved back to ${label}`, { type: "info" });
      refresh();
      requestFocusRestore(move.id);
      setMove(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not undo this move",
        { type: "error" },
      );
      setBusy(false);
    }
  }, [
    busy,
    dataProvider,
    move,
    notify,
    refresh,
    remaining,
    requestFocusRestore,
  ]);

  return {
    move: move && remaining > 0 ? move : null,
    remaining,
    busy,
    recordMove,
    undo,
    onUndoFocus,
    onUndoBlur,
  };
};

export const moveLabel = (state: PipelineState): string => {
  const label = getPipelineStateDef(state)?.label ?? state;
  return isTerminalPipelineState(state) ? `${label} (final)` : label;
};
