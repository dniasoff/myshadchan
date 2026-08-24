import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { withSupabaseFilterAdapter } from "../providers/fakerest/internal/supabaseAdapter";
import { SingleSwitcherPill } from "../layout/TopBar";
import { useSelectedSingle } from "./useSelectedSingle";

/**
 * The regression test for the reported bug: picking a name in the app-bar pill
 * changed the pill and nothing else, so the dashboard below kept showing the
 * other child's pipeline — the header said "Rivky Klein's shidduchim" while
 * the pill said "Yaakov Klein". Two components, two independent `useState`s.
 *
 * `Probe` stands in for the dashboard: any second consumer of the selection.
 * If the two ever drift back onto separate state, this fails.
 */
const buildDataProvider = () =>
  withSupabaseFilterAdapter(
    fakeRestDataProvider({
      singles: [
        {
          id: 1,
          first_name_en: "Rivky",
          last_name_en: "Klein",
          status: "active",
        },
        {
          id: 2,
          first_name_en: "Yaakov",
          last_name_en: "Klein",
          status: "active",
        },
      ],
    }),
  );

const Probe = () => {
  const { selected } = useSelectedSingle();
  return <p data-testid="probe">Showing: {selected?.first_name_en ?? "—"}</p>;
};

describe("useSelectedSingle", () => {
  it("makes the app-bar pill drive every other consumer of the selection", async () => {
    // Arrange
    const screen = await render(
      <CoreAdminContext
        dataProvider={buildDataProvider()}
        i18nProvider={testI18nProvider}
      >
        <SingleSwitcherPill />
        <Probe />
      </CoreAdminContext>,
    );

    // Both start on the same single (first by name), not on separate defaults.
    await expect.element(screen.getByText("Showing: Rivky")).toBeVisible();

    // Act — pick the other child in the pill, exactly as the bug report did.
    await screen.getByRole("button").click();
    await screen.getByRole("menuitem", { name: "Yaakov Klein" }).click();

    // Assert — the OTHER consumer followed. This is the whole bug.
    await expect.element(screen.getByText("Showing: Yaakov")).toBeVisible();
  });

  it("falls back to a real single when the stored selection no longer resolves", async () => {
    // Arrange — a stored id that belongs to nothing: an archived single, or a
    // store that outlived a context switch into a different account. Neither
    // may strand the UI on an empty selection.
    const store = {
      getItem: <T,>(key: string, defaultValue: T) =>
        key === "single.selected" ? (999 as unknown as T) : defaultValue,
      setItem: () => {},
      removeItem: () => {},
      removeItems: () => {},
      reset: () => {},
      subscribe: () => () => {},
      unsubscribe: () => {},
      setup: () => {},
      teardown: () => {},
    };

    // Act
    const screen = await render(
      <CoreAdminContext
        dataProvider={buildDataProvider()}
        i18nProvider={testI18nProvider}
        store={store}
      >
        <Probe />
      </CoreAdminContext>,
    );

    // Assert
    await expect.element(screen.getByText("Showing: Rivky")).toBeVisible();
  });
});
