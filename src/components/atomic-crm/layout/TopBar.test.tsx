import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import { withSupabaseFilterAdapter } from "../providers/fakerest/internal/supabaseAdapter";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import { SingleSwitcherPill } from "./TopBar";

/**
 * Pins 2.5 AC-8's mandatory minimum bar: an archived single is not
 * selectable in the single switcher. Runs the real
 * withSupabaseFilterAdapter + ra-data-fakerest pipeline (rather than a
 * hand-rolled stub) so the `status@neq` filter is exercised exactly as the
 * production FakeRest provider applies it.
 */

const buildDataProvider = () =>
  withSupabaseFilterAdapter(
    fakeRestDataProvider({
      singles: [
        { id: 1, first_name_en: "Active Ari", status: "active" },
        { id: 2, first_name_en: "Archived Avi", status: "archived" },
      ],
    }),
  );

describe("SingleSwitcherPill", () => {
  it("only offers active singles — an archived single is never selectable", async () => {
    // Arrange
    const dataProvider = buildDataProvider();

    // Act
    const screen = await render(
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <SingleSwitcherPill />
      </CoreAdminContext>,
    );

    // Assert — the trigger defaults to the (only) active single...
    await expect.element(screen.getByText("Active Ari")).toBeVisible();

    // ...and the archived one never appears, not even in the dropdown list.
    await screen.getByRole("button").click();
    await expect
      .element(screen.getByText("Archived Avi"))
      .not.toBeInTheDocument();
  });

  it("renders nothing when every single is archived", async () => {
    // Arrange
    const dataProvider = withSupabaseFilterAdapter(
      fakeRestDataProvider({
        singles: [{ id: 1, first_name_en: "Archived Avi", status: "archived" }],
      }),
    );

    // Act
    const screen = await render(
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <SingleSwitcherPill />
      </CoreAdminContext>,
    );

    // Assert
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });
});
