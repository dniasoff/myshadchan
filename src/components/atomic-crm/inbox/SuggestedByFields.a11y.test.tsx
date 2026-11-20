import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { SimpleForm } from "@/components/admin/simple-form";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { SuggestedByFields } from "./SuggestedByFields";

const renderFields = async () => {
  const dataProvider = {
    create: vi.fn(),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/shidduchim/1"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value="shidduchim">
          <SimpleForm>
            <SuggestedByFields />
          </SimpleForm>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return screen;
};

describe("SuggestedByFields accessibility", () => {
  it("keeps the phone validation error in the input description", async () => {
    const screen = await renderFields();
    const phone = screen.getByLabelText("Phone number");

    await phone.fill("x".repeat(41));
    await screen.getByRole("button", { name: "Save" }).click();

    const error = screen.getByText(
      "Use 40 characters or fewer for a phone number",
      { exact: true },
    );
    await expect.element(phone).toHaveAttribute("aria-invalid", "true");
    await expect
      .element(phone)
      .toHaveAttribute(
        "aria-describedby",
        "suggested_by_phone-description suggested_by_phone-message",
      );
    await expect
      .element(error)
      .toHaveAttribute("id", "suggested_by_phone-message");
  });

  it("keeps the name validation error in the input description", async () => {
    const screen = await renderFields();
    const name = screen.getByLabelText("Suggested by");

    await name.fill("x".repeat(201));
    await screen.getByRole("button", { name: "Save" }).click();

    const error = screen.getByText("Use 200 characters or fewer for a name", {
      exact: true,
    });
    await expect.element(name).toHaveAttribute("aria-invalid", "true");
    await expect
      .element(name)
      .toHaveAttribute(
        "aria-describedby",
        "suggested_by_name-description suggested_by_name-message",
      );
    await expect
      .element(error)
      .toHaveAttribute("id", "suggested_by_name-message");
  });
});
