import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember } from "../types";
import { useTaskAssignees } from "./useTaskAssignees";

const buildMember = (
  overrides: Partial<ContextMember> = {},
): ContextMember => ({
  id: 1,
  account_id: 1,
  user_id: "1",
  role: "parent_admin",
  full_name: "Chani Klein",
  is_self: true,
  ...overrides,
});

const Probe = () => {
  const { isPending, assignees, assigneesById, isMultiMember } =
    useTaskAssignees();
  if (isPending) return <p>loading</p>;
  return (
    <div>
      <p>count: {assignees.length}</p>
      <p>multi: {String(isMultiMember)}</p>
      <p>has-1: {String(assigneesById.has(1))}</p>
    </div>
  );
};

const renderProbe = async (data: ContextMember[]) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data, total: data.length }),
  } as unknown as DataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Probe />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("useTaskAssignees", () => {
  it("resolves context_members into a map keyed by members.id", async () => {
    // Arrange / Act
    const screen = await renderProbe([buildMember({ id: 1 })]);

    // Assert
    await expect.element(screen.getByText("count: 1")).toBeInTheDocument();
    await expect.element(screen.getByText("has-1: true")).toBeInTheDocument();
  });

  it("reports isMultiMember false for a single-member household", async () => {
    // Arrange / Act
    const screen = await renderProbe([buildMember({ id: 1 })]);

    // Assert
    await expect.element(screen.getByText("multi: false")).toBeInTheDocument();
  });

  it("reports isMultiMember true once a second active member exists", async () => {
    // Arrange / Act
    const screen = await renderProbe([
      buildMember({ id: 1, is_self: true }),
      buildMember({
        id: 2,
        user_id: "2",
        full_name: "Yaakov Klein",
        is_self: false,
      }),
    ]);

    // Assert
    await expect.element(screen.getByText("multi: true")).toBeInTheDocument();
  });
});
