import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { MemberRole, MyContext } from "../types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import "../singles/entityDescriptor";
import { AddSingleLink } from "./AddSingleLink";

const renderLink = async (role: MemberRole) => {
  const contexts: MyContext[] = [
    {
      account_id: 1,
      kind: role === "shadchan" ? "shadchanus" : "household",
      name: "Current context",
      role,
      is_active: true,
    },
  ];
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
  } as unknown as CrmDataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <AddSingleLink />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("AddSingleLink", () => {
  it.each(["parent_admin", "self_manager", "helper", "shadchan"] as const)(
    "offers the existing create flow to a %s in the active context",
    async (role) => {
      const screen = await renderLink(role);

      const link = screen.getByRole("link", { name: "Add a single" });
      await expect.element(link).toBeVisible();
      expect(link.element().getAttribute("href")).toBe("/singles/new");
    },
  );

  it("does not offer creation to a single role", async () => {
    const screen = await renderLink("single");

    await expect
      .element(screen.getByRole("link", { name: "Add a single" }))
      .not.toBeInTheDocument();
  });

  it("keeps an added single visible only in the member's own household scope", async () => {
    const db = generateData();
    const [template] = db.accounts;
    db.accounts = [
      { ...template, id: 41, name: "Ronit's household", kind: "household" },
      { ...template, id: 42, name: "Another household", kind: "household" },
    ];
    db.account_members = [
      {
        id: 501,
        account_id: 41,
        user_id: "ronit",
        role: "parent_admin",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 502,
        account_id: 42,
        user_id: "other-household",
        role: "parent_admin",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    db.singles = [
      {
        id: 902,
        account_id: 42,
        first_name_en: "Other child's record",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const ownProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: "ronit" }) },
    });
    const otherProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: {
        getIdentity: async () => ({ id: "other-household" }),
      },
    });

    const { data: addedSingle } = await ownProvider.create("singles", {
      data: {
        account_id: 41,
        first_name_en: "Ronit's added child",
        status: "active",
        created_at: "2026-01-02T00:00:00Z",
      },
    });

    const [{ data: ownSingles }, { data: otherSingles }] = await Promise.all([
      ownProvider.getList("singles", {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      }),
      otherProvider.getList("singles", {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      }),
    ]);

    expect(addedSingle.first_name_en).toBe("Ronit's added child");
    expect(ownSingles.map((single) => single.id)).toEqual([addedSingle.id]);
    expect(otherSingles.map((single) => single.id)).toEqual([902]);
  });
});
