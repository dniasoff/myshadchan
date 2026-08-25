import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  type DataProvider,
} from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { SinglePreferencesTab } from "./SinglePreferencesTab";

/**
 * The Preferences tab hardcoded female pronouns — a parent managing a son
 * was told "She has not added any preferences yet." on his own profile.
 * `gender` is on the record, but no sentence here needs a pronoun at all,
 * so the copy is person-neutral rather than branched.
 */

const renderTab = async () => {
  const dataProvider = {
    getList: async () => ({ data: [], total: 0 }),
  } as unknown as DataProvider;

  return render(
    <CoreAdminContext
      dataProvider={dataProvider}
      queryClient={new QueryClient()}
      i18nProvider={testI18nProvider}
    >
      <RecordContextProvider value={{ id: 1, first_name_en: "Yosef" }}>
        <SinglePreferencesTab />
      </RecordContextProvider>
    </CoreAdminContext>,
  );
};

describe("SinglePreferencesTab — copy is person-neutral", () => {
  it("uses no gendered pronoun in the empty state or the visibility label", async () => {
    // Arrange / Act
    const screen = await renderTab();
    await expect
      .element(screen.getByText("No preferences added yet."))
      .toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByText("Visible to whoever manages this process"))
      .toBeInTheDocument();
    const text = screen.container.textContent ?? "";
    expect(text).not.toMatch(/\b(she|her|his|him|he)\b/i);
  });
});
