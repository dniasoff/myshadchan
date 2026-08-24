import { describe, expect, it } from "vitest";

import type { PipelineState, ShidduchSummary } from "../types";
import { buildParentFocus, OPEN_STATES, STALE_AFTER_DAYS } from "./parentFocus";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

let nextId = 1;

const suggestion = (
  pipeline_state: PipelineState,
  overrides: Partial<ShidduchSummary> = {},
): ShidduchSummary =>
  ({
    id: nextId++,
    account_id: 1,
    single_id: 1,
    pipeline_state,
    // Recent by default, so a test that cares about staleness has to say so.
    redt_date: daysAgo(1),
    nb_references: 1,
    ...overrides,
  }) as ShidduchSummary;

const countFor = (items: ReturnType<typeof buildParentFocus>, key: string) =>
  items.find((item) => item.key === key)?.count;

describe("buildParentFocus", () => {
  it("counts a suggestion nobody has answered yet", () => {
    // Arrange
    const summaries = [
      suggestion("new"),
      suggestion("new"),
      suggestion("look_into"),
    ];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "needs_answer")).toBe(2);
  });

  it("counts only look-intos where no reference has been called", () => {
    // Arrange — the distinction the card exists to draw: saying "we'll look
    // into it" is free, making the first call is the work.
    const summaries = [
      suggestion("look_into", { nb_references: 0 }),
      suggestion("look_into", { nb_references: 3 }),
      // A `new` with no references is not a stall — nobody promised anything.
      suggestion("new", { nb_references: 0 }),
    ];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "not_researched")).toBe(1);
  });

  it("treats a missing reference count as none called", () => {
    // Arrange — FakeRest and the summary view can both omit the field.
    const summaries = [suggestion("look_into", { nb_references: undefined })];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "not_researched")).toBe(1);
  });

  it("counts an open suggestion whose last redt is past the staleness window", () => {
    // Arrange
    const summaries = [
      suggestion("look_into", { redt_date: daysAgo(STALE_AFTER_DAYS + 1) }),
      suggestion("new", { redt_date: daysAgo(STALE_AFTER_DAYS - 1) }),
    ];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "waiting_a_while")).toBe(1);
  });

  it("does not call a decided suggestion stale, however old it is", () => {
    // Arrange — `yes`, `no`, `unsure` and the gut `for_sure_not` are settled;
    // nothing is waiting on the parent, so age is not a problem.
    const summaries = (["yes", "no", "unsure", "for_sure_not"] as const).map(
      (state) => suggestion(state, { redt_date: daysAgo(400) }),
    );

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "waiting_a_while")).toBe(0);
  });

  it("ignores a suggestion with no or unparseable redt date rather than counting it stale", () => {
    // Arrange — a missing date is unknown, not old. Counting it would put a
    // permanent number on a card a parent can never clear.
    const summaries = [
      suggestion("look_into", { redt_date: undefined }),
      suggestion("look_into", { redt_date: "not a date" }),
      // The row can also arrive null from Postgres even though the TS type
      // says `string | undefined`, so the guard has to survive that too.
      suggestion("look_into", { redt_date: null as unknown as undefined }),
    ];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "waiting_a_while")).toBe(0);
  });

  it("counts what the family has said yes to", () => {
    // Arrange
    const summaries = [
      suggestion("yes"),
      suggestion("unsure"),
      suggestion("no"),
    ];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert
    expect(countFor(focus, "moving_forward")).toBe(1);
  });

  it("reads as an all-clear rather than a blank when there is nothing to do", () => {
    // Arrange
    const summaries: ShidduchSummary[] = [];

    // Act
    const focus = buildParentFocus(summaries, NOW);

    // Assert — four zeroes should feel finished, not broken.
    expect(focus).toHaveLength(4);
    for (const item of focus) {
      expect(item.count).toBe(0);
      expect(item.caption.length).toBeGreaterThan(0);
    }
    expect(focus[0].caption).toBe("Nobody is waiting on you");
  });

  it("keeps the row in a stable order so the page never reshuffles", () => {
    // Act
    const focus = buildParentFocus([suggestion("new")], NOW);

    // Assert
    expect(focus.map((item) => item.key)).toEqual([
      "needs_answer",
      "not_researched",
      "waiting_a_while",
      "moving_forward",
    ]);
  });

  it("treats exactly the undecided states as open", () => {
    // Assert — a guard on the domain rule, not on the rendering: a state added
    // to the enum must be classified deliberately, not inherited by accident.
    expect(OPEN_STATES).toEqual(["new", "look_into", "not_sure"]);
  });
});
