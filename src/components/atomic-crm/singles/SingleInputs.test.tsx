import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { SimpleForm } from "@/components/admin/simple-form";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { buildNewPath } from "../entity360/entityPaths";
import { SingleCreate } from "./SingleCreate";
import { SingleInputs } from "./SingleInputs";
import "./entityDescriptor";

type SubmitMock = ReturnType<typeof vi.fn<SubmitHandler<FieldValues>>>;

const LegacyUntouchedInputs = () => (
  <>
    <TextInput source="first_name_en" label="First name" />
    <TextInput source="community" />
    <SelectInput
      source="kohen_status"
      choices={[{ id: "unknown", name: "Unknown" }]}
      defaultValue="unknown"
    />
    <TextInput source="marital_status" />
    <SelectInput
      source="status"
      choices={[{ id: "active", name: "Active" }]}
      defaultValue="active"
    />
  </>
);

const renderForm = async ({
  mode,
  record,
  defaultValues,
  onSubmit = vi.fn(),
}: {
  mode: "create" | "edit";
  record?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  onSubmit?: SubmitMock;
}) => {
  const submitHandler: SubmitMock =
    onSubmit ?? vi.fn<SubmitHandler<FieldValues>>();
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={{} as CrmDataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value="singles">
          <SimpleForm
            record={record}
            defaultValues={defaultValues}
            onSubmit={submitHandler}
            toolbar={<button type="submit">Save</button>}
          >
            <SingleInputs mode={mode} />
          </SimpleForm>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, onSubmit: submitHandler };
};

describe("SingleInputs", () => {
  it("keeps only the four requested Add fields and the truthful helper line", async () => {
    const { screen } = await renderForm({ mode: "create" });

    await expect.element(screen.getByLabelText("First name")).toBeVisible();
    await expect.element(screen.getByLabelText("Last name")).toBeVisible();
    await expect.element(screen.getByLabelText("Gender")).toBeVisible();
    await expect.element(screen.getByLabelText("Date of birth")).toBeVisible();

    for (const label of [
      "Community",
      "Kohen status",
      "Marital status",
      "Status",
    ]) {
      await expect.element(screen.getByText(label)).not.toBeInTheDocument();
    }

    await expect
      .element(
        screen.getByText(
          "You can update the name, gender, or date of birth later from Edit single.",
        ),
      )
      .toBeInTheDocument();
  });

  it("keeps Status on Edit with Active, Paused, and read-only Archived", async () => {
    const { screen } = await renderForm({
      mode: "edit",
      record: {
        id: 1,
        first_name_en: "Rivka",
        status: "archived",
        community: "Bnei Brak",
        kohen_status: "yes",
        marital_status: "single",
      },
    });

    for (const label of ["Community", "Kohen status", "Marital status"]) {
      await expect.element(screen.getByText(label)).not.toBeInTheDocument();
    }
    await expect
      .element(screen.getByRole("combobox", { name: "Status" }))
      .toHaveTextContent("Archived");

    await screen.getByRole("combobox", { name: "Status" }).click();
    await expect
      .element(screen.getByRole("option", { name: "Active" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Paused" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Archived" }))
      .toBeDisabled();
  });

  it("submits an untouched Add with the pre-change defaults", async () => {
    const { screen, onSubmit } = await renderForm({
      mode: "create",
      defaultValues: {
        kohen_status: "unknown",
        status: "active",
      },
    });

    await screen.getByLabelText("First name").fill("Rivka");
    await screen.getByRole("button", { name: "Save" }).click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [values] = onSubmit.mock.calls[0];
    expect(values).toEqual(
      expect.objectContaining({
        kohen_status: "unknown",
        status: "active",
      }),
    );
    expect(values).not.toHaveProperty("community");
    expect(values).not.toHaveProperty("marital_status");
  });

  it("captures the legacy untouched payload shape", async () => {
    const onSubmit = vi.fn<SubmitHandler<FieldValues>>();
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={{} as CrmDataProvider}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value="singles">
            <SimpleForm
              onSubmit={onSubmit}
              toolbar={<button type="submit">Save</button>}
            >
              <LegacyUntouchedInputs />
            </SimpleForm>
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByLabelText("First name").fill("Rivka");
    await screen.getByRole("button", { name: "Save" }).click();

    const [values] = onSubmit.mock.calls[0];
    expect(values).toEqual({
      first_name_en: "Rivka",
      kohen_status: "unknown",
      status: "active",
    });
  });

  it("keeps the Add caller's persisted defaults when its fields are hidden", async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const screen = await render(
      <TestMemoryRouter initialEntries={[buildNewPath("singles")]}>
        <CoreAdminContext
          dataProvider={{ create } as unknown as CrmDataProvider}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value="singles">
            <SingleCreate />
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByLabelText("First name").fill("Rivka");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    const [, params] = create.mock.calls[0];
    expect(params.data).toEqual(
      expect.objectContaining({
        kohen_status: "unknown",
        status: "active",
      }),
    );
    expect(params.data).not.toHaveProperty("community");
    expect(params.data).not.toHaveProperty("marital_status");
  });

  it("submits a changed Edit status without exposing the removed fields", async () => {
    const { screen, onSubmit } = await renderForm({
      mode: "edit",
      record: {
        id: 1,
        first_name_en: "Rivka",
        status: "active",
        community: "Bnei Brak",
        kohen_status: "yes",
        marital_status: "single",
      },
    });

    await screen.getByRole("combobox", { name: "Status" }).click();
    await screen.getByRole("option", { name: "Paused" }).click();
    await screen.getByRole("button", { name: "Save" }).click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [values] = onSubmit.mock.calls[0];
    expect(values).toEqual(
      expect.objectContaining({
        community: "Bnei Brak",
        kohen_status: "yes",
        marital_status: "single",
        status: "paused",
      }),
    );
  });
});
