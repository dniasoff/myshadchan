import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { UndoBar } from "./UndoBar";
import { useShidduchUndo } from "./useShidduchUndo";

const Harness = () => {
  const undoState = useShidduchUndo();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          undoState.recordMove({
            id: 7,
            from: "new",
            to: "look_into",
            movedAt: Date.now(),
          })
        }
      >
        Record move
      </button>
      <UndoBar {...undoState} />
    </>
  );
};

describe("useShidduchUndo", () => {
  it("calls the server undo RPC for the recorded move and clears the bar", async () => {
    const undoShidduch = vi.fn().mockResolvedValue({});
    const dataProvider = { undoShidduch } as unknown as CrmDataProvider;
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <Harness />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByRole("button", { name: "Record move" }).click();
    await expect.element(screen.getByRole("status")).toBeInTheDocument();

    await screen.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => undoShidduch.mock.calls.length).toBe(1);
    expect(undoShidduch).toHaveBeenCalledExactlyOnceWith(7);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });
});
