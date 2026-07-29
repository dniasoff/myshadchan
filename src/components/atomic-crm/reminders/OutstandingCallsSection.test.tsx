import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

// Side-effect imports — register the descriptors `RecordLink` resolves
// through, exactly as each resource's `index.ts` does at boot.
import "../references/entityDescriptor";
import "../shidduchim/entityDescriptor";
import { OutstandingCallsSection } from "./OutstandingCallsSection";

/**
 * The account-wide "not yet spoken to" worklist, rehomed here from the
 * reference book RULING 7 deleted.
 *
 * Two things have to stay true at once, and they pull in opposite
 * directions: the workflow must survive (a real outstanding conversation
 * shows up), and the ruling must hold (every row is a conversation inside a
 * NAMED shidduch, not a reference floating on its own).
 */

const link = (overrides: Record<string, unknown>) => ({
  id: 1,
  reference_id: 10,
  shidduchim_id: 100,
  reference_name_en: "Mrs Gold",
  shidduch_name_en: "Yanky Klein",
  call_status: "not_started",
  ...overrides,
});

const renderSection = async (rows: Record<string, unknown>[]) => {
  const getList = vi.fn().mockResolvedValue({ data: rows, total: rows.length });
  const dataProvider = { getList } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/reminders"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <OutstandingCallsSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getList };
};

describe("OutstandingCallsSection — the worklist the reference book used to carry", () => {
  it("lists a conversation that has not happened yet", async () => {
    // Arrange / Act
    const { screen } = await renderSection([
      link({ call_status: "no_answer" }),
    ]);

    // Assert — the workflow survived the book's deletion.
    await expect.element(screen.getByText("Still to call")).toBeInTheDocument();
    await expect.element(screen.getByText("Mrs Gold")).toBeInTheDocument();
  });

  it("names the shidduch each outstanding conversation belongs to", async () => {
    // Arrange / Act
    const { screen } = await renderSection([link({})]);

    // Assert — RULING 7: a reference is reached from a shidduch's context,
    // and here that context is on the row and links to it.
    await expect
      .element(screen.getByRole("link", { name: "Yanky Klein" }))
      .toBeInTheDocument();
  });

  it("queries reference_links, never references — this is not the book by another name", async () => {
    // Arrange / Act
    const { getList } = await renderSection([link({})]);

    // Assert
    expect(getList).toHaveBeenCalledTimes(1);
    expect(getList.mock.calls[0][0]).toBe("reference_links");
  });

  it("hides itself entirely once every conversation has happened", async () => {
    // Arrange / Act — "answered" is a contacted status.
    const { screen } = await renderSection([
      link({ call_status: "answered" }),
      link({ id: 2, call_status: "they_will_call_back" }),
    ]);

    // Assert — calm, not a permanent empty card.
    await expect
      .element(screen.getByText("Still to call"))
      .not.toBeInTheDocument();
  });

  it("skips a link with no shidduch — it has no context to be reached from", async () => {
    // Arrange / Act — `reference_links.shidduchim_id` is nullable; such a
    // row belongs to the unattached-references index, not to a worklist
    // that promises a shidduch on every row.
    const { screen } = await renderSection([
      link({ shidduchim_id: null, shidduch_name_en: null }),
    ]);

    // Assert
    await expect
      .element(screen.getByText("Still to call"))
      .not.toBeInTheDocument();
  });
});
