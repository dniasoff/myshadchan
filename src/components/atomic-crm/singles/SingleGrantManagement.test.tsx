import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, RecordContextProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import { SingleGrantManagement } from "./SingleGrantManagement";

/**
 * The share flow's one job is to hand a parent a link they can actually
 * send. Both halves of that were broken and both are pinned here:
 *
 *  - the link was delivered in a native `alert()`, whose text is not
 *    selectable or copyable in iOS Safari or Android Chrome — so on a phone
 *    the flow dead-ended with a link the parent could read and not take;
 *  - the link itself was path-shaped (`/accept-grant/<token>`), and this
 *    app runs on ra-core's default HashRouter, so that URL reaches the web
 *    server and never the router. Only the `/#/…` form resolves.
 *
 * The provider is the real FakeRest one rather than a hand-stubbed object:
 * it already implements the whole grant lifecycle, so this test drives the
 * same code path the app does.
 */

const ACCOUNT_ID = 1;

const renderPanel = async () => {
  const db = generateData();
  // The signed-in caller, holding an active membership of the account the
  // single belongs to — `switchActiveContext` refuses any other id, and the
  // create path checks the single against the active account.
  db.account_members = [
    {
      id: 1,
      account_id: ACCOUNT_ID,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  const single = { ...db.singles[0], account_id: ACCOUNT_ID };
  db.singles = [single];

  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  await dataProvider.switchActiveContext(ACCOUNT_ID);

  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      queryClient={new QueryClient()}
      i18nProvider={testI18nProvider}
    >
      <RecordContextProvider value={single}>
        <SingleGrantManagement />
      </RecordContextProvider>
    </CoreAdminContext>,
  );

  return { screen, single };
};

describe("SingleGrantManagement — sharing with another household", () => {
  it("shows the invitation link in a copyable field, in the hash-router form the accept screen is actually reachable at", async () => {
    // Arrange
    const { screen } = await renderPanel();

    // Act
    await screen
      .getByRole("button", { name: "Share with another household" })
      .click();
    await screen.getByLabelText("Email address").fill("other@example.com");
    await screen.getByRole("button", { name: "Create grant" }).click();

    // Assert
    const link = screen.getByLabelText("Invitation link");
    await expect.element(link).toBeInTheDocument();
    const value = (link.element() as HTMLInputElement).value;
    expect(value).toContain(`${window.location.origin}/#/accept-grant/`);
    // The token has to survive into the link, not just the prefix.
    expect(
      value.replace(`${window.location.origin}/#/accept-grant/`, "").length,
    ).toBeGreaterThan(0);
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .toBeInTheDocument();
  });
});
