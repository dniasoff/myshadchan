import { createContext, useContext } from "react";

import type { ShidduchTodoSummary } from "./shidduchTodoSummary";

/** Visibility is decided once by the list-level role gate and inherited by rows. */
export const ShidduchTodoVisibilityContext = createContext(false);

export type ShidduchTodoSummaryStatus =
  "hidden" | "loading" | "ready" | "error";

export const ShidduchTodoSummaryStatusContext =
  createContext<ShidduchTodoSummaryStatus>("hidden");

export const ShidduchTodoSummaryContext = createContext<
  ReadonlyMap<string, ShidduchTodoSummary>
>(new Map());

export const useShidduchTodoVisibility = () =>
  useContext(ShidduchTodoVisibilityContext);

export const useShidduchTodoSummaryStatus = () =>
  useContext(ShidduchTodoSummaryStatusContext);

export const useShidduchTodoSummary = (
  shidduchId: string | number,
): ShidduchTodoSummary =>
  useContext(ShidduchTodoSummaryContext).get(String(shidduchId)) ?? {
    count: 0,
    earliestDueDate: null,
    hasOverdue: false,
    isDueSoon: false,
  };
