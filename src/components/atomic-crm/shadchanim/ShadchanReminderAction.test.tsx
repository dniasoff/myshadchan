import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import "./entityDescriptor";
import { ShadchanReminderAction } from "./ShadchanReminderAction";

describe("ShadchanReminderAction", () => {
  it("uses the plain count label, a 44px target, and the shadchan Reminders tab path", async () => {
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext i18nProvider={testI18nProvider}>
          <ShadchanReminderAction
            shadchan={{ id: 42, name: "Rivka Stern" }}
            count={3}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    const marker = screen.getByRole("link", { name: "3 reminders" });
    await expect
      .element(marker)
      .toHaveAttribute("href", "/shadchanim/42/tasks");
    await expect.element(marker).toHaveAttribute("title", "3 reminders");
    expect(marker.element().className).toContain("min-h-11");
    expect(marker.element().className).toContain("min-w-11");
    expect(marker.element().querySelector("svg")).not.toBeNull();
  });

  it("uses the singular accessible label for one reminder", async () => {
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext i18nProvider={testI18nProvider}>
          <ShadchanReminderAction
            shadchan={{ id: 42, name: "Rivka Stern" }}
            count={1}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByRole("link", { name: "1 reminder" }))
      .toBeInTheDocument();
  });
});
