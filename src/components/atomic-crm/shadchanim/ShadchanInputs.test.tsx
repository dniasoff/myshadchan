import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { SimpleForm } from "@/components/admin/simple-form";
import { ShadchanInputs } from "./ShadchanInputs";

const renderForm = async (
  form: React.ReactNode,
  dataProvider: CrmDataProvider,
) =>
  render(
    <TestMemoryRouter initialEntries={["/shadchanim/1"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value="shadchanim">
          {form}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("Shadchan name form", () => {
  it("renders an empty create form without crashing and focuses the name field", async () => {
    const dataProvider = {
      create: vi.fn(),
    } as unknown as CrmDataProvider;

    const screen = await renderForm(
      <SimpleForm>
        <ShadchanInputs autoFocusName />
      </SimpleForm>,
      dataProvider,
    );
    const nameInput = screen.getByLabelText("Name");

    await expect.element(nameInput).toBeVisible();
    await expect.element(nameInput).toHaveFocus();

    await nameInput.fill("dvora");
    await expect.element(nameInput).toHaveValue("Dvora");
  });

  it("renders and formats an existing edit name without taking focus", async () => {
    const dataProvider = {
      getOne: vi.fn().mockResolvedValue({
        data: { id: 1, name: "rivka cohen" },
      }),
    } as unknown as CrmDataProvider;

    const screen = await renderForm(
      <SimpleForm record={{ id: 1, name: "rivka cohen" }}>
        <ShadchanInputs />
      </SimpleForm>,
      dataProvider,
    );
    const nameInput = screen.getByLabelText("Name");

    await expect.element(nameInput).toHaveValue("Rivka Cohen");
    await expect.element(nameInput).not.toHaveFocus();
  });
});
