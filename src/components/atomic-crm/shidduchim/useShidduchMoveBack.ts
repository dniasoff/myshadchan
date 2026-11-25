import { useCallback, useEffect, useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRefresh } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { PipelineState } from "../types";
import { getPipelineStateDef } from "./pipelineStates";

export interface ReversibleShidduchMove {
  from_state: PipelineState;
  to_state: PipelineState;
}

export interface UseShidduchMoveBackResult {
  move: ReversibleShidduchMove | null;
  loading: boolean;
  busy: boolean;
  reload: () => Promise<void>;
  moveBack: () => Promise<void>;
}

/**
 * Reads the latest server-owned forward transition. The action is deliberately
 * not inferred from the current pipeline state: a suggestion can be moved
 * back only when its history says exactly which one-step correction is next.
 */
export const useShidduchMoveBack = (
  id: Identifier,
): UseShidduchMoveBackResult => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [move, setMove] = useState<ReversibleShidduchMove | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await dataProvider.getLatestReversibleShidduchStage(id);
      setMove(next);
    } catch (error) {
      setMove(null);
      notify(
        error instanceof Error ? error.message : "Could not read stage history",
        {
          type: "error",
        },
      );
    } finally {
      setLoading(false);
    }
  }, [dataProvider, id, notify]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const moveBack = useCallback(async () => {
    if (!move || busy) return;
    setBusy(true);
    try {
      await dataProvider.undoShidduch(id);
      notify(
        `Moved back to ${getPipelineStateDef(move.from_state)?.label ?? move.from_state}`,
        { type: "info" },
      );
      setMove(null);
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not move this suggestion back",
        {
          type: "error",
        },
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }, [busy, dataProvider, id, move, notify, refresh, reload]);

  return { move, loading, busy, reload, moveBack };
};
