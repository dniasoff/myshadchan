import { createContext, useContext } from "react";

import type { ShidduchTodoSummary } from "./shidduchTodoSummary";

export const ShidduchTodoSummaryContext = createContext<
  ReadonlyMap<string, ShidduchTodoSummary>
>(new Map());

export const useShidduchTodoSummary = (
  shidduchId: string | number,
): ShidduchTodoSummary =>
  useContext(ShidduchTodoSummaryContext).get(String(shidduchId)) ?? {
    count: 0,
    earliestDueDate: null,
    hasOverdue: false,
    isDueSoon: false,
  };
