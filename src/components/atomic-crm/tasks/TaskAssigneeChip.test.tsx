import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { Identifier } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember } from "../types";
import { TaskAssigneeChip } from "./TaskAssigneeChip";

const buildMember = (
  overrides: Partial<ContextMember> = {},
): ContextMember => ({
  id: 1,
  account_id: 1,
  user_id: "1",
  role: "parent_admin",
  full_name: "Chani Klein",
  is_self: false,
  ...overrides,
});

const renderChip = async (props: {
  memberId: Identifier | null | undefined;
  assigneesById: Map<Identifier, ContextMember>;
  isMultiMember: boolean;
}) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <TaskAssigneeChip {...props} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("TaskAssigneeChip — four states (AC-7, AC-10)", () => {
  it("renders nothing for a null assignee in a single-member household", async () => {
    // Arrange / Act
    const screen = await renderChip({
      memberId: null,
      assigneesById: new Map([[1, buildMember({ id: 1, is_self: true })]]),
      isMultiMember: false,
    });

    // Assert
    expect(screen.container.textContent).toBe("");
  });

  it("renders 'Unassigned' for a null assignee in a multi-member household", async () => {
    // Arrange / Act
    const screen = await renderChip({
      memberId: null,
      assigneesById: new Map([
        [1, buildMember({ id: 1, is_self: true })],
        [2, buildMember({ id: 2, user_id: "2", is_self: false })],
      ]),
      isMultiMember: true,
    });

    // Assert
    await expect.element(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders 'You' when the assignee is the caller", async () => {
    // Arrange / Act
    const screen = await renderChip({
      memberId: 1,
      assigneesById: new Map([[1, buildMember({ id: 1, is_self: true })]]),
      isMultiMember: true,
    });

    // Assert
    await expect.element(screen.getByText("You")).toBeInTheDocument();
  });

  it("renders the member's name and role when the assignee is someone else", async () => {
    // Arrange / Act
    const screen = await renderChip({
      memberId: 2,
      assigneesById: new Map([
        [1, buildMember({ id: 1, is_self: true })],
        [
          2,
          buildMember({
            id: 2,
            user_id: "2",
            full_name: "Yaakov Klein",
            role: "helper",
            is_self: false,
          }),
        ],
      ]),
      isMultiMember: true,
    });

    // Assert
    await expect
      .element(screen.getByText("Yaakov Klein · Helper"))
      .toBeInTheDocument();
  });

  it("renders the unresolved state for a member no longer in the household (AC-7) — never blank, never a crash", async () => {
    // Arrange / Act
    const screen = await renderChip({
      memberId: 99,
      assigneesById: new Map([[1, buildMember({ id: 1, is_self: true })]]),
      isMultiMember: true,
    });

    // Assert
    await expect
      .element(screen.getByText("No longer in this household"))
      .toBeInTheDocument();
  });
});
