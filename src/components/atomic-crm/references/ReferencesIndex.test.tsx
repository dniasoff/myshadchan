import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { GetListParams } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

// Side-effect import — registers the "references" entity descriptor, exactly
// as `references/index.ts` does at boot. `RecordLink` resolves through it.
import "./entityDescriptor";
import { ReferencesIndex } from "./ReferencesIndex";

/**
 * Pins what `/references` renders under RULING 7: the unattached-references
 * index, never the reference book.
 *
 * The load-bearing assertion is the FILTER. A component that rendered the
 * same rows without `linked_shidduchim_count@eq: 0` would look identical in
 * a test that only inspected the DOM, and would be the browse surface the
 * ruling closed — so the query itself is asserted, not just its output.
 */

const ATTACHED_REFERENCE = {
  id: 7,
  name_en: "Rivky Attached",
  linked_shidduchim_count: 2,
};

const UNATTACHED_REFERENCE = {
  id: 9,
  name_en: "Chaya Orphan",
  relationship: "Seminary teacher",
  phone: "555-0100",
  linked_shidduchim_count: 0,
};

/** Mirrors the server: honours `linked_shidduchim_count@eq`, so a component
 * that dropped the filter would really receive the attached reference too. */
const buildDataProvider = (
  rows: Record<string, unknown>[],
): { dataProvider: CrmDataProvider; getListSpy: ReturnType<typeof vi.fn> } => {
  const getListSpy = vi.fn(async (_resource: string, params: GetListParams) => {
    const wanted = params.filter?.["linked_shidduchim_count@eq"];
    const data =
      wanted === undefined
        ? rows
        : rows.filter((row) => row.linked_shidduchim_count === wanted);
    return { data, total: data.length };
  });

  return {
    dataProvider: { getList: getListSpy } as unknown as CrmDataProvider,
    getListSpy,
  };
};

const renderIndex = async (rows: Record<string, unknown>[]) => {
  const { dataProvider, getListSpy } = buildDataProvider(rows);

  const screen = await render(
    <TestMemoryRouter initialEntries={["/references"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ReferencesIndex />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getListSpy };
};

describe("ReferencesIndex — only references attached to nothing (RULING 7 §1a)", () => {
  it("queries references filtered to zero linked shidduchim", async () => {
    // Arrange / Act
    const { screen, getListSpy } = await renderIndex([UNATTACHED_REFERENCE]);
    await expect.element(screen.getByText("Chaya Orphan")).toBeInTheDocument();

    // Assert — the filter IS the ruling; without it this page is the book.
    expect(getListSpy).toHaveBeenCalledWith(
      "references",
      expect.objectContaining({
        filter: { "linked_shidduchim_count@eq": 0 },
      }),
    );
  });

  it("never renders a reference that already belongs to a shidduch", async () => {
    // Arrange / Act — both rows exist in the account; only the unattached
    // one may reach the screen, and it is the FILTER that decides, because
    // the fake provider honours it exactly as the view does.
    const { screen } = await renderIndex([
      ATTACHED_REFERENCE,
      UNATTACHED_REFERENCE,
    ]);
    await expect.element(screen.getByText("Chaya Orphan")).toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByText("Rivky Attached"))
      .not.toBeInTheDocument();
  });

  it("offers exactly one action per row — attach it to a shidduch", async () => {
    // Arrange / Act
    const { screen } = await renderIndex([UNATTACHED_REFERENCE]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Attach to a shidduch" }))
      .toBeInTheDocument();
  });

  it("renders no free-text search box and no create button", async () => {
    // Arrange / Act
    const { screen } = await renderIndex([UNATTACHED_REFERENCE]);
    await expect.element(screen.getByText("Chaya Orphan")).toBeInTheDocument();

    // Assert — the two affordances that made the old reference book a
    // browse surface. Their absence is the point of this component.
    await expect.element(screen.getByRole("searchbox")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /Add a reference/i }))
      .not.toBeInTheDocument();
  });

  it("explains where references are reached from once nothing is unattached", async () => {
    // Arrange / Act — the self-emptying end state.
    const { screen } = await renderIndex([ATTACHED_REFERENCE]);

    // Assert
    await expect
      .element(screen.getByText(/every reference belongs to a shidduch/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Go to the pipeline" }))
      .toBeInTheDocument();
  });
});
