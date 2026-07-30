import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { TextInput } from "@/components/admin/text-input";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `singles` descriptor (Story 5.8's
// migrated, AD-24-shaped one).
import "../singles/entityDescriptor";
import { requireEntityDescriptor } from "../entity360/registry";
import { EditSheet } from "./EditSheet";

/**
 * Story 3.12 review fix (F3): an unspecified `redirect` prop must not
 * silently resolve through `useRedirect`'s hardcoded `/{resource}/{id}/show`
 * (`useRedirect.js:55`) for a resource that already has a registered AD-24
 * descriptor — that is the exact dead URL AC 4 retires from the four
 * `SingleCreate`/`SingleEdit`/`ReferenceCreate`/`ReferenceEdit` sites.
 * `EditSheet` is a shared, resource-generic component (`TaskEditSheet`), so
 * it cannot switch to `redirectToRecord` unconditionally — `tasks` has no
 * descriptor, and `buildRecordPath` throws for one. It must therefore
 * degrade per resource, exactly like `EditButton`/`ShowButton` (AC 3).
 */

const renderEditSheetAt = async (resource: string) => {
  let pathname: string | undefined;
  const dataProvider = {
    getOne: vi.fn().mockResolvedValue({ data: { id: 1, name: "Nechama" } }),
    update: vi.fn().mockResolvedValue({ data: { id: 1, name: "Nechama" } }),
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <EditSheet resource={resource} id={1} open onOpenChange={() => {}}>
          <TextInput source="name" label="Name" />
        </EditSheet>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("EditSheet — default redirect degrades per resource (review fix F3)", () => {
  it("resolves through redirectToRecord/buildRecordPath for a resource with a registered descriptor", async () => {
    // Arrange / Act
    const { screen, getPathname } = await renderEditSheetAt("singles");
    await expect.element(screen.getByLabelText("Name")).toHaveValue("Nechama");
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — not the retired /singles/1/show.
    await expect
      .poll(() => getPathname())
      .toBe(requireEntityDescriptor("singles").buildRecordPath(1));
  });

  it("keeps today's 'show' verb for a resource with no registered descriptor", async () => {
    // Arrange / Act
    const { screen, getPathname } = await renderEditSheetAt("tasks");
    await expect.element(screen.getByLabelText("Name")).toHaveValue("Nechama");
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert — `tasks` has no AD-24 descriptor to diverge from, so the
    // pre-existing behavior is preserved exactly.
    await expect.poll(() => getPathname()).toBe("/tasks/1/show");
  });
});
