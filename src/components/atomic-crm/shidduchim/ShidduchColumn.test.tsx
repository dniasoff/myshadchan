import { DragDropContext } from "@hello-pangea/dnd";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot (`ShidduchCard` → `RecordLink`).
import "./entityDescriptor";
import { getPipelineStateDef } from "./pipelineStates";
import { ShidduchColumn } from "./ShidduchColumn";

/**
 * Review finding F3: AC-10's `isDropDisabled` — a column failing
 * `isValidTransition(dragFrom, state.value)` dims and structurally refuses
 * the drop — had zero coverage. `const isDropDisabled = false;` stayed
 * 97/97 green before this file existed. The dimming class
 * (`opacity-40`) is driven by the exact same boolean `@hello-pangea/dnd`'s
 * `Droppable` receives, so asserting it is present/absent is a faithful,
 * DOM-visible proxy for the drop being structurally disabled.
 */
const renderColumn = async (props: {
  stateValue: Parameters<typeof getPipelineStateDef>[0];
  dragFrom: Parameters<typeof getPipelineStateDef>[0] | null;
}) => {
  const state = getPipelineStateDef(props.stateValue)!;
  return render(
    <TestMemoryRouter initialEntries={["/shidduchim"]}>
      <DragDropContext onDragEnd={() => {}}>
        <ShidduchColumn
          state={state}
          shidduchim={[]}
          dragFrom={props.dragFrom}
        />
      </DragDropContext>
    </TestMemoryRouter>,
  );
};

const isDimmed = (screen: Awaited<ReturnType<typeof renderColumn>>) =>
  screen.container.querySelector("section")?.className.includes("opacity-40");

describe("ShidduchColumn — isDropDisabled dims a column an in-flight drag can't legally enter (AC-10)", () => {
  it("dims the column when the dragged-from state cannot legally reach it", async () => {
    // Arrange / Act — "new" -> "no" is not an edge in PIPELINE_TRANSITIONS.
    const screen = await renderColumn({ stateValue: "no", dragFrom: "new" });

    // Assert
    expect(isDimmed(screen)).toBe(true);
  });

  it("does not dim the column when the dragged-from state can legally reach it", async () => {
    // Arrange / Act — "new" -> "look_into" is a real edge.
    const screen = await renderColumn({
      stateValue: "look_into",
      dragFrom: "new",
    });

    // Assert
    expect(isDimmed(screen)).toBe(false);
  });

  it("does not dim the column the drag started from (same-state reorder is always legal)", async () => {
    // Arrange / Act
    const screen = await renderColumn({ stateValue: "new", dragFrom: "new" });

    // Assert
    expect(isDimmed(screen)).toBe(false);
  });

  it("dims no column while no drag is in progress (dragFrom is null)", async () => {
    // Arrange / Act
    const screen = await renderColumn({ stateValue: "no", dragFrom: null });

    // Assert
    expect(isDimmed(screen)).toBe(false);
  });
});
