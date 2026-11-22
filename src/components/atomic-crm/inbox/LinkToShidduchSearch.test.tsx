import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { LinkToShidduchSearch } from "./LinkToShidduchSearch";

const RECENT_SUGGESTION = {
  id: 42,
  name_en: "Sarah Cohen",
  pipeline_state: "new",
  single_first_name_en: "Miriam",
  single_last_name_en: "Niasoff",
  suggested_by_name: "Kaila Niasoff",
  suggested_by_phone: "*7328145891~",
  shadchan_name: "Rivka Stein",
};

const renderSearch = async (onLink = vi.fn()) => {
  const getList = vi.fn().mockResolvedValue({
    data: [RECENT_SUGGESTION],
    total: 1,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={{ getList } as unknown as CrmDataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <LinkToShidduchSearch onLink={onLink} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { getList, onLink, screen };
};

describe("LinkToShidduchSearch", () => {
  it("loads recent suggestions immediately and links when the row is tapped", async () => {
    const { getList, onLink, screen } = await renderSearch();

    await expect.poll(() => getList.mock.calls.length).toBe(1);
    expect(getList).toHaveBeenCalledWith(
      "shidduchim",
      expect.objectContaining({
        filter: { q: "", "archived_at@is": null },
        pagination: { page: 1, perPage: 20 },
      }),
    );
    await expect.element(screen.getByText("Sarah Cohen")).toBeVisible();
    await expect.element(screen.getByText("For Miriam Niasoff")).toBeVisible();
    await expect
      .element(screen.getByText("Suggested by Kaila Niasoff · 7328145891"))
      .toBeVisible();

    await screen
      .getByRole("button", { name: "Link Sarah Cohen for Miriam Niasoff" })
      .click();
    expect(onLink).toHaveBeenCalledWith(42);
  });

  it("passes typed text to the same provider query so the list narrows", async () => {
    const { getList, screen } = await renderSearch();

    await expect.poll(() => getList.mock.calls.length).toBe(1);
    await screen
      .getByRole("textbox", { name: "Search your suggestions" })
      .fill("kaila niasoff");
    await expect
      .poll(() => getList.mock.calls.at(-1)?.[1]?.filter?.q)
      .toBe("kaila niasoff");
  });
});
