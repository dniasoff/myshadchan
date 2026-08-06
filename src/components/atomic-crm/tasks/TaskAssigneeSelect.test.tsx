import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider, Identifier } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember } from "../types";
import { TaskAssigneeSelect } from "./TaskAssigneeSelect";

const MEMBERS: ContextMember[] = [
  {
    id: 1,
    account_id: 1,
    user_id: "1",
    role: "parent_admin",
    full_name: "Chani Klein",
    is_self: true,
  },
  {
    id: 2,
    account_id: 1,
    user_id: "2",
    role: "helper",
    full_name: "Yaakov Klein",
    is_self: false,
  },
];

const buildDataProvider = (members: ContextMember[] = MEMBERS) =>
  ({
    getList: vi
      .fn()
      .mockResolvedValue({ data: members, total: members.length }),
  }) as unknown as DataProvider;

const Harness = ({
  initialValue,
  onChangeSpy,
  defaultToSelf,
}: {
  initialValue: Identifier | null | undefined;
  onChangeSpy: (value: Identifier | null) => void;
  defaultToSelf?: boolean;
}) => {
  const [value, setValue] = useState<Identifier | null | undefined>(
    initialValue,
  );
  return (
    <TaskAssigneeSelect
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy(next);
      }}
      defaultToSelf={defaultToSelf}
    />
  );
};

const renderSelect = async (props: {
  initialValue: Identifier | null | undefined;
  defaultToSelf?: boolean;
  members?: ContextMember[];
}) => {
  const onChangeSpy = vi.fn();
  const dataProvider = buildDataProvider(props.members);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Harness
          initialValue={props.initialValue}
          onChangeSpy={onChangeSpy}
          defaultToSelf={props.defaultToSelf}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onChangeSpy };
};

describe("TaskAssigneeSelect — options come from context_members (AC-3)", () => {
  it("offers Unassigned plus one option per active member, self row marked", async () => {
    // Arrange / Act
    const { screen } = await renderSelect({ initialValue: undefined });
    await screen.getByRole("combobox").click();

    // Assert
    await expect
      .element(screen.getByRole("option", { name: "Unassigned" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("option", {
          name: "Chani Klein (You) · Parent / admin",
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Yaakov Klein · Helper" }))
      .toBeInTheDocument();
  });

  it("never sources choices from a bare members list", async () => {
    // Arrange
    const dataProvider = buildDataProvider();

    // Act
    await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <Harness initialValue={undefined} onChangeSpy={vi.fn()} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    expect(dataProvider.getList).toHaveBeenCalledWith(
      "context_members",
      expect.anything(),
    );
    expect(dataProvider.getList).not.toHaveBeenCalledWith(
      "members",
      expect.anything(),
    );
  });

  it("selecting a member calls onChange with that member's numeric id", async () => {
    // Arrange
    const { screen, onChangeSpy } = await renderSelect({
      initialValue: undefined,
    });
    await screen.getByRole("combobox").click();

    // Act
    await screen.getByRole("option", { name: "Yaakov Klein · Helper" }).click();

    // Assert
    expect(onChangeSpy).toHaveBeenCalledWith(2);
  });

  it("selecting Unassigned calls onChange with null", async () => {
    // Arrange
    const { screen, onChangeSpy } = await renderSelect({ initialValue: 2 });
    await screen.getByRole("combobox").click();

    // Act
    await screen.getByRole("option", { name: "Unassigned" }).click();

    // Assert
    expect(onChangeSpy).toHaveBeenCalledWith(null);
  });
});

describe("TaskAssigneeSelect — defaultToSelf (ReminderCreateSheet, AC-3)", () => {
  it("auto-selects the caller's own row once the roster loads, when nothing was chosen yet", async () => {
    // Arrange / Act
    const { onChangeSpy } = await renderSelect({
      initialValue: undefined,
      defaultToSelf: true,
    });

    // Assert
    await vi.waitFor(() => {
      expect(onChangeSpy).toHaveBeenCalledWith(1);
    });
  });

  it("does not override an explicit Unassigned choice", async () => {
    // Arrange / Act — value is already `null` (explicit Unassigned), not
    // `undefined`, so the self-default effect must not fire. `render()`
    // resolves only once mount effects have flushed, so no extra wait is
    // needed to observe their (non-)effect.
    const { screen, onChangeSpy } = await renderSelect({
      initialValue: null,
      defaultToSelf: true,
    });

    // Assert — the trigger still shows Unassigned, and the default-to-self
    // effect never fired.
    await expect
      .element(screen.getByRole("combobox"))
      .toHaveTextContent("Unassigned");
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
