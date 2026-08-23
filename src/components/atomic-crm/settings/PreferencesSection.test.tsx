import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { PhotoPrivacyRow } from "./PreferencesSection";

const renderPhotoPrivacyRow = async (
  role: "parent_admin" | "single" = "parent_admin",
  enabled = false,
) => {
  const db = generateData();
  db.accounts[0].photo_reveal_on_click = enabled;
  db.account_members[0].role = role;
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      i18nProvider={testI18nProvider}
    >
      <PhotoPrivacyRow />
    </CoreAdminContext>,
  );

  return { screen, dataProvider };
};

describe("PhotoPrivacyRow", () => {
  it("defaults off and persists an authorized toggle", async () => {
    const { screen, dataProvider } = await renderPhotoPrivacyRow();
    const toggle = screen.getByRole("switch", {
      name: "Require click to reveal photos",
    });

    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    await expect.element(toggle).toBeChecked();

    const { data: account } = await dataProvider.getOne("accounts", { id: 1 });
    expect(account.photo_reveal_on_click).toBe(true);
  });

  it("does not offer the account control to a single", async () => {
    const { screen } = await renderPhotoPrivacyRow("single");

    await expect
      .element(
        screen.getByRole("switch", {
          name: "Require click to reveal photos",
        }),
      )
      .not.toBeInTheDocument();
  });
});
