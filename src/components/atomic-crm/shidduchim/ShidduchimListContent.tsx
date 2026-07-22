import { DragDropContext, type OnDragEndResponder } from "@hello-pangea/dnd";
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

const DECISION_STATES: PipelineState[] = ["yes", "unsure", "no"];

export const ShidduchimListContent = () => {
  const { data, isPending } = useListContext<ShidduchSummary>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();

  const [byState, setByState] = useState<ShidduchimByState>(() =>
    getShidduchimByState([]),
  );

  useEffect(() => {
    if (data) {
      const next = getShidduchimByState(data);
      setByState((prev) => (isEqual(prev, next) ? prev : next));
    }
  }, [data]);

  if (isPending) return null;

  const onDragEnd: OnDragEndResponder = async (result) => {
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

    // Optimistic local move.
    const next = moveLocally(
      byState,
      moved,
      { state: fromState, index: source.index },
      { state: toState, index: destination.index },
    );
    setByState(next);

    try {
      // The ONLY state write goes through transitionShidduch (AD-4 invariant 2).
      if (fromState !== toState) {
        await dataProvider.transitionShidduch(moved.id, fromState, toState);
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

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-5">
        {PIPELINE_STATES.map((state) => (
          <ShidduchColumn
            key={state.value}
            state={state}
            shidduchim={byState[state.value] ?? []}
          />
        ))}
      </div>
    </DragDropContext>
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
