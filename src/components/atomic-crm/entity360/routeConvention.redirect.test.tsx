import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { Create } from "@/components/admin/create";
import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";
import { TextInput } from "@/components/admin/text-input";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Registers the real `singles` stub descriptor as a side effect, so
// `requireEntityDescriptor("singles")` below resolves the same object the
// production `<Create redirect={redirectToRecord}>` / `<Edit .../>` at
// `singles/SingleCreate.tsx` / `singles/SingleEdit.tsx` resolve against.
import { singlesDescriptor } from "../singles/entityDescriptor";
import { registerEntityDescriptor, requireEntityDescriptor } from "./registry";
import { redirectToRecord } from "./routeConvention";

/**
 * Story 3.12 AC 4 / Task 4: a successful create or edit lands on the record
 * through `buildRecordPath`, not the hardcoded show-record verb. One test
 * per surface family (create, edit), asserting the navigated path equals
 * `requireEntityDescriptor("singles").buildRecordPath(id)` — not a
 * hardcoded string — so this test survives Epic 5's `buildRecordPath` flip.
 * A minimal fixture form stands in for the production
 * `SingleCreate`/`SingleEdit` surfaces: what Task 4 changes is the
 * `redirect` prop, not the form fields.
 *
 * Both tests register an explicit AD-24-shaped `singles` descriptor
 * (`buildRecordPath: (id) => \`/singles/${id}\``) rather than depending on
 * whatever `singlesDescriptor` happens to be at the moment this file runs —
 * true today (Story 5.8) but was, at write time, still Story 3.9's stub
 * (`buildRecordPath: (id) => \`/singles/${id}/show\``). That stub's shape
 * is byte-identical to what the retired hardcoded show-record verb would
 * have produced, so asserting against it could not distinguish
 * `redirectToRecord` from the mechanism this story replaces — reverting the
 * `redirect` prop below from `redirectToRecord` back to that retired verb
 * still passed both tests. The real descriptor is restored in `afterEach`,
 * exactly as `edit-button.test.tsx` / `show-button.test.tsx` do
 * (.claude/rules/testing.md#Test-isolation).
 */

const AD24_SINGLES_DESCRIPTOR = {
  ...singlesDescriptor,
  buildRecordPath: (id: string | number) => `/singles/${id}`,
};

const renderWithLocation = async (element: ReactElement) => {
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      {element}
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("redirect={redirectToRecord} — the create surface family (AC 4)", () => {
  afterEach(() => {
    registerEntityDescriptor(singlesDescriptor, { replace: true });
  });

  it("navigates to requireEntityDescriptor('singles').buildRecordPath(id) after a successful create", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`,
    // which the retired hardcoded show-record verb could never produce.
    registerEntityDescriptor(AD24_SINGLES_DESCRIPTOR, { replace: true });
    const dataProvider = {
      create: vi.fn().mockResolvedValue({ data: { id: 42 } }),
    } as unknown as DataProvider;

    const { screen, getPathname } = await renderWithLocation(
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Create resource="singles" redirect={redirectToRecord}>
          <SimpleForm>
            <TextInput source="first_name_en" label="First name" />
          </SimpleForm>
        </Create>
      </CoreAdminContext>,
    );

    // Act
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — /singles/42, not useCreatePath's /singles/42/show.
    await expect
      .poll(() => getPathname())
      .toBe(requireEntityDescriptor("singles").buildRecordPath(42));
  });
});

describe("redirect={redirectToRecord} — the edit surface family (AC 4)", () => {
  afterEach(() => {
    registerEntityDescriptor(singlesDescriptor, { replace: true });
  });

  it("navigates to requireEntityDescriptor('singles').buildRecordPath(id) after a successful edit", async () => {
    // Arrange — the Epic 5 state: buildRecordPath already `/{name}/{id}`,
    // which the retired hardcoded show-record verb could never produce.
    registerEntityDescriptor(AD24_SINGLES_DESCRIPTOR, { replace: true });
    const dataProvider = {
      getOne: vi
        .fn()
        .mockResolvedValue({ data: { id: 1, first_name_en: "Nechama" } }),
      update: vi
        .fn()
        .mockResolvedValue({ data: { id: 1, first_name_en: "Nechama" } }),
    } as unknown as DataProvider;

    const { screen, getPathname } = await renderWithLocation(
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Edit resource="singles" id={1} redirect={redirectToRecord}>
          <SimpleForm>
            <TextInput source="first_name_en" label="First name" />
          </SimpleForm>
        </Edit>
      </CoreAdminContext>,
    );

    // Act — wait for the fetched record to populate the form before saving.
    await expect
      .element(screen.getByLabelText("First name"))
      .toHaveValue("Nechama");
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — /singles/1, not useCreatePath's /singles/1/show.
    await expect
      .poll(() => getPathname())
      .toBe(requireEntityDescriptor("singles").buildRecordPath(1));
  });
});
