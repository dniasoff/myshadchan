import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember, Task } from "../types";
import { ReminderCreateSheet } from "./ReminderCreateSheet";

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

type CreateMock = ReturnType<
  typeof vi.fn<
    (resource: string, params: unknown) => Promise<{ data: unknown }>
  >
>;

const buildDataProvider = (create: CreateMock) =>
  ({
    getList: vi.fn((resource: string) => {
      if (resource === "context_members") {
        return Promise.resolve({ data: MEMBERS, total: MEMBERS.length });
      }
      if (resource === "shidduchim") {
        return Promise.resolve({
          data: [{ id: 42, name_en: "Chaim Cohen" }],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),
    create,
  }) as unknown as DataProvider;

const renderSheet = async (
  create: CreateMock = vi.fn().mockResolvedValue({ data: {} }),
) => {
  const dataProvider = buildDataProvider(create);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ReminderCreateSheet open onOpenChange={() => {}} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

const fillMinimalForm = async (screen: Awaited<ReturnType<typeof render>>) => {
  await screen.getByLabelText("Remind me to...").fill("Call about the redt");
  await screen.getByLabelText("Due date").fill("2026-08-10");
  await screen.getByLabelText("Time").fill("09:00");
  // Default "linked to" is "shidduch" — pick the seeded shidduch.
  await screen.getByRole("combobox").nth(1).click();
  await screen.getByRole("option", { name: "Chaim Cohen" }).click();
};

describe("ReminderCreateSheet — says why the button is disabled", () => {
  it("names the field still missing, and stops once the form is complete", async () => {
    // Arrange — four separate fields gate the submit button. With nothing
    // filled in and no message, a disabled button just reads as broken; on a
    // phone the unmet field is usually scrolled out of view besides.
    const { screen } = await renderSheet();

    // Assert — the first missing field, in the order the form asks.
    await expect
      .element(screen.getByText("Still needed: Remind me to..."))
      .toBeInTheDocument();

    // Act — answer it, and the hint moves on to the next one rather than
    // disappearing.
    await screen.getByLabelText("Remind me to...").fill("Call about the redt");

    // Assert
    await expect
      .element(screen.getByText("Still needed: Due date"))
      .toBeInTheDocument();

    // Act — complete the form.
    await screen.getByLabelText("Due date").fill("2026-08-10");
    await screen.getByLabelText("Time").fill("09:00");
    await screen.getByRole("combobox").nth(1).click();
    await screen.getByRole("option", { name: "Chaim Cohen" }).click();

    // Assert — nothing left to say, and the button is live.
    await expect
      .element(screen.getByText(/^Still needed:/))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add reminder" }))
      .not.toBeDisabled();
  });
});

describe("ReminderCreateSheet — stops offering a channel it cannot deliver (AC-3, Story 12.2)", () => {
  it("has no push checkbox in the DOM", async () => {
    // Arrange / Act
    const { screen } = await renderSheet();

    // Assert
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/push notification/i))
      .not.toBeInTheDocument();
  });

  it("names the assignee as the email recipient in the reassurance line", async () => {
    // Arrange / Act
    const { screen } = await renderSheet();

    // Assert — F3 (12.3 cross-reconciliation): must say WHO gets the
    // email, not just "by email", because member_id is the assignee and
    // the creator is not tracked.
    await expect
      .element(
        screen.getByText(
          "Delivered in-app, and by email to the person it is assigned to. We never send SMS.",
        ),
      )
      .toBeInTheDocument();
  });

  it("submits delivery_channels as exactly ['in_app', 'email'], never 'push'", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: {} as Task });
    const { screen } = await renderSheet(create);
    await fillMinimalForm(screen);

    // Act
    await screen.getByRole("button", { name: "Add reminder" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [, params] = create.mock.calls[0];
    expect(params.data.delivery_channels).toEqual(["in_app", "email"]);
  });
});

describe("ReminderCreateSheet — assignee defaults to the caller (AC-3)", () => {
  it("auto-selects the caller's own row once the roster loads", async () => {
    // Arrange / Act
    const { screen } = await renderSheet();

    // Assert
    await expect
      .element(screen.getByRole("combobox").nth(2))
      .toHaveTextContent("Chani Klein (You) · Parent / admin");
  });

  it("sends the caller's own member_id when the form is submitted untouched", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: {} as Task });
    const { screen } = await renderSheet(create);
    await fillMinimalForm(screen);
    await expect
      .element(screen.getByRole("combobox").nth(2))
      .toHaveTextContent("Chani Klein (You) · Parent / admin");

    // Act
    await screen.getByRole("button", { name: "Add reminder" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [, params] = create.mock.calls[0];
    expect(params.data.member_id).toBe(1);
  });

  it("sends the newly picked assignee when the user changes the selection", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: {} as Task });
    const { screen } = await renderSheet(create);
    await fillMinimalForm(screen);
    await expect
      .element(screen.getByRole("combobox").nth(2))
      .toHaveTextContent("Chani Klein (You) · Parent / admin");

    // Act
    await screen.getByRole("combobox").nth(2).click();
    await screen.getByRole("option", { name: "Yaakov Klein · Helper" }).click();
    await screen.getByRole("button", { name: "Add reminder" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [, params] = create.mock.calls[0];
    expect(params.data.member_id).toBe(2);
  });
});
