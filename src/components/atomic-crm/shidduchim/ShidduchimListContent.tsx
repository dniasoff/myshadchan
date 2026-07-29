import {
  DragDropContext,
  type OnDragEndResponder,
  type OnDragStartResponder,
} from "@hello-pangea/dnd";
import isEqual from "lodash/isEqual";
import {
  useDataProvider,
  useListContext,
  useNotify,
  useRefresh,
} from "ra-core";
import { useEffect, useState } from "react";

import type { CrmDataProvider } from "../providers/types";
import type { PipelineState, ShidduchSummary } from "../types";
import { getShidduchimByState, type ShidduchimByState } from "./boardUtils";
import {
  getPipelineStateDef,
  isValidTransition,
  PIPELINE_STATES,
} from "./pipelineStates";
import { ShidduchColumn } from "./ShidduchColumn";
import { TerminalMoveConfirm } from "./TerminalMoveConfirm";
import { isTerminalPipelineState } from "./useShidduchTransition";

const DECISION_STATES: PipelineState[] = ["yes", "unsure", "no"];

interface PendingDrop {
  moved: ShidduchSummary;
  fromState: PipelineState;
  toState: PipelineState;
  sourceIndex: number;
  destinationIndex: number;
}

/**
 * The Board (Task 3: unchanged in layout). Its own loading gate is gone —
 * `ShidduchimViewSwitch` (AC-5) already resolved loading/error above this
 * component, so by the time it mounts, `data` is always the ready array.
 */
export const ShidduchimListContent = () => {
  const { data } = useListContext<ShidduchSummary>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();

  const [byState, setByState] = useState<ShidduchimByState>(() =>
    getShidduchimByState([]),
  );
  const [dragFrom, setDragFrom] = useState<PipelineState | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  useEffect(() => {
    if (data) {
      const next = getShidduchimByState(data);
      setByState((prev) => (isEqual(prev, next) ? prev : next));
    }
  }, [data]);

  const commitMove = async (
    moved: ShidduchSummary,
    fromState: PipelineState,
    toState: PipelineState,
    sourceIndex: number,
    destinationIndex: number,
    closeReason?: string,
  ) => {
    const next = moveLocally(
      byState,
      moved,
      { state: fromState, index: sourceIndex },
      { state: toState, index: destinationIndex },
    );
    setByState(next);

    try {
      // The ONLY state write goes through transitionShidduch (AD-4 invariant 2).
      if (fromState !== toState) {
        await dataProvider.transitionShidduch(
          moved.id,
          fromState,
          toState,
          closeReason,
        );
      }
      // Persist per-column ordering with index-only updates (no state change,
      // so the transition trigger never fires).
      await Promise.all([
        persistOrder(dataProvider, next[toState]),
        fromState !== toState
          ? persistOrder(dataProvider, next[fromState])
          : Promise.resolve(),
      ]);
      refresh();
    } catch (error) {
      notify(getErrorMessage(error), { type: "error" });
      refresh(); // roll back to server truth
    }
  };

  const onDragStart: OnDragStartResponder = (start) => {
    setDragFrom(start.source.droppableId as PipelineState);
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    setDragFrom(null);
    const { destination, source } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const fromState = source.droppableId as PipelineState;
    const toState = destination.droppableId as PipelineState;
    const moved = byState[fromState]?.[source.index];
    if (!moved) return;

    // AD-4 guard: reject an illegal transition BEFORE touching anything. The
    // board does not move and the DB stays authoritative. transition_shidduch()
    // is the enforcing authority; this is the fast, friendly client mirror.
    // Structurally reinforced by ShidduchColumn's own isDropDisabled — this
    // remains as a defence-in-depth check.
    if (fromState !== toState && !isValidTransition(fromState, toState)) {
      const fromDef = getPipelineStateDef(fromState);
      const toDef = getPipelineStateDef(toState);
      const decisionHint = DECISION_STATES.includes(toState)
        ? " A decision (Yes / Unsure / No) can only be made from Look-into."
        : "";
      notify(
        `Can't move ${moved.name_en ?? "this shidduch"} from ${
          fromDef?.label ?? fromState
        } to ${toDef?.label ?? toState}.${decisionHint}`,
        { type: "warning" },
      );
      return;
    }

    // AC-10: a drop into an absorbing (terminal) state routes through the
    // same confirm step as AC-9 instead of writing directly — the card does
    // not move locally until the user confirms.
    if (fromState !== toState && isTerminalPipelineState(toState)) {
      setPendingDrop({
        moved,
        fromState,
        toState,
        sourceIndex: source.index,
        destinationIndex: destination.index,
      });
      return;
    }

    void commitMove(moved, fromState, toState, source.index, destination.index);
  };

  const handleConfirmDrop = (reason?: string) => {
    if (!pendingDrop) return;
    const { moved, fromState, toState, sourceIndex, destinationIndex } =
      pendingDrop;
    setPendingDrop(null);
    void commitMove(
      moved,
      fromState,
      toState,
      sourceIndex,
      destinationIndex,
      reason,
    );
  };

  return (
    <>
      {/* Task 8: "pipeline-board" now anchors ShidduchimViewSwitch's root
          (exists regardless of position), not this Board-only div. */}
      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-5">
          {PIPELINE_STATES.map((state, columnIndex) => (
            <ShidduchColumn
              key={state.value}
              state={state}
              shidduchim={byState[state.value] ?? []}
              tourAnchor={columnIndex === 0}
              dragFrom={dragFrom}
            />
          ))}
        </div>
      </DragDropContext>
      <TerminalMoveConfirm
        toState={pendingDrop?.toState ?? null}
        name={pendingDrop?.moved.name_en}
        onCancel={() => setPendingDrop(null)}
        onConfirm={handleConfirmDrop}
      />
    </>
  );
};

const moveLocally = (
  byState: ShidduchimByState,
  moved: ShidduchSummary,
  source: { state: PipelineState; index: number },
  destination: { state: PipelineState; index: number },
): ShidduchimByState => {
  if (source.state === destination.state) {
    const column = [...byState[source.state]];
    column.splice(source.index, 1);
    column.splice(destination.index, 0, moved);
    return { ...byState, [source.state]: column };
  }
  const sourceColumn = [...byState[source.state]];
  const destinationColumn = [...byState[destination.state]];
  sourceColumn.splice(source.index, 1);
  destinationColumn.splice(destination.index, 0, {
    ...moved,
    pipeline_state: destination.state,
  });
  return {
    ...byState,
    [source.state]: sourceColumn,
    [destination.state]: destinationColumn,
  };
};

const persistOrder = async (
  dataProvider: CrmDataProvider,
  cards: ShidduchSummary[],
): Promise<void> => {
  const updates = cards.flatMap((card, index) =>
    card.index === index
      ? []
      : [
          dataProvider.update("shidduchim", {
            id: card.id,
            data: { index },
            previousData: card,
          }),
        ],
  );
  await Promise.all(updates);
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Something went wrong moving the shidduch";
