import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ShidduchSummary } from "../types";
import { ShidduchOverviewTab } from "./ShidduchOverviewTab";

vi.mock("./SingleInputForm", () => ({
  SingleInputForm: () => <div>Single input</div>,
}));
vi.mock("./ShidduchCatchSection", () => ({
  ShidduchCatchSection: () => <div>Catch section</div>,
}));
vi.mock("./ShidduchFactsCard", () => ({
  ShidduchFactsCard: () => <div>Facts card</div>,
}));
vi.mock("./RedtHistorySection", () => ({
  RedtHistorySection: () => <div>Redt history</div>,
}));
vi.mock("./ShidduchTodoBox", () => ({
  ShidduchTodoBox: () => <div data-slot="todo-box">TO_DO_BOX</div>,
}));

const record: ShidduchSummary = {
  id: 42,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
  shadchan_name: "Mrs Klein",
};

describe("ShidduchOverviewTab To-do placement", () => {
  it("keeps To do directly beside the shadchan on desktop and below it on phone", async () => {
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as unknown as DataProvider;
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={record}>
            <ShidduchOverviewTab />
          </RecordContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    const todo = screen.getByText("TO_DO_BOX").element();
    const layout = todo.parentElement;
    const shadchan = screen.getByRole("region", { name: "Shadchan" }).element();

    expect(layout?.getAttribute("data-slot")).toBe(
      "shidduch-shadchan-todo-layout",
    );
    expect(layout?.className).toContain("lg:grid-cols-");
    expect(layout?.children[0]).toBe(shadchan);
    expect(layout?.children[1]).toBe(todo);
    await expect.element(screen.getByText("Mrs Klein")).toBeInTheDocument();
  });
});
