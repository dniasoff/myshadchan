import type { DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import {
  requiresShidduchScope,
  useReminderTargetOptions,
  type ReminderTargetOptions,
} from "./useReminderTargetOptions";

/**
 * RULING 7 R4: the reminders hub must not offer a roster of references the
 * user has not reached through a shidduch.
 *
 * The behaviour under test is a QUERY, not a rendering, so these assertions
 * are made against the `dataProvider` spy rather than the DOM: the defect
 * being pinned was a real `getList("references", { perPage: 100 })` that
 * returned 100 named people to a user standing on `/reminders`.
 */

/**
 * Renders the hook and waits for the option count to settle on
 * `expectedOptions`. Waiting on the RENDERED count (rather than a bare
 * `toBeInTheDocument`) is what makes the data-bearing assertions
 * deterministic: `getList` resolves on a later tick, so a probe asserted at
 * first paint always sees an empty list and every such test would pass
 * vacuously.
 */
const flushHook = async (
  linkType: Parameters<typeof useReminderTargetOptions>[0],
  shidduchId: Parameters<typeof useReminderTargetOptions>[1],
  rows: unknown[] = [],
  expectedOptions = 0,
) => {
  const getList = vi.fn().mockResolvedValue({ data: rows, total: rows.length });
  const dataProvider = { getList } as unknown as DataProvider;

  let latest: ReminderTargetOptions | undefined;
  const Probe = () => {
    latest = useReminderTargetOptions(linkType, shidduchId);
    return <span data-testid="ready">{String(latest.options.length)}</span>;
  };

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Probe />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  await expect
    .element(screen.getByTestId("ready"))
    .toHaveTextContent(String(expectedOptions));
  return { getList, result: () => latest as ReminderTargetOptions };
};

const resourcesQueried = (getList: ReturnType<typeof vi.fn>): string[] =>
  getList.mock.calls.map((call) => call[0] as string);

describe("requiresShidduchScope — which reminder target needs a shidduch", () => {
  it("scopes references and nothing else", () => {
    // Assert — shidduchim and shadchanim are browsable entities; a plain
    // roster for those is legitimate and must stay.
    expect(requiresShidduchScope("reference")).toBe(true);
    expect(requiresShidduchScope("shidduch")).toBe(false);
    expect(requiresShidduchScope("shadchan")).toBe(false);
  });
});

describe("useReminderTargetOptions — RULING 7 R4", () => {
  it("issues NO reference query at all when Reference is picked without a shidduch", async () => {
    // Arrange / Act
    const { getList, result } = await flushHook("reference", undefined);

    // Assert — the defect: this used to be
    // getList("references", { pagination: { perPage: 100 } }).
    expect(resourcesQueried(getList)).not.toContain("references");
    expect(resourcesQueried(getList)).not.toContain("references_summary");
    expect(result().awaitingShidduch).toBe(true);
    expect(result().options).toEqual([]);
  });

  it("queries only the chosen shidduch's links once a shidduch is picked", async () => {
    // Arrange / Act
    const { getList } = await flushHook("reference", 42);

    // Assert — scoped to the shidduch, and never the raw references roster.
    expect(resourcesQueried(getList)).not.toContain("references");
    expect(getList).toHaveBeenCalledWith(
      "reference_links_summary",
      expect.objectContaining({ filter: { shidduchim_id: 42 } }),
    );
  });

  it("offers the references attached to that shidduch, labelled by name", async () => {
    // Arrange
    const rows = [
      { id: 1, reference_id: 7, reference_name_en: "Chaim Feldman" },
      { id: 2, reference_id: 9, reference_name_en: "Rivka Stern" },
    ];

    // Act
    const { result } = await flushHook("reference", 42, rows, 2);

    // Assert — the feature is rescoped, not deleted: a reminder to call a
    // reference back still works, from inside a shidduch.
    expect(result().options).toEqual([
      { id: 7, label: "Chaim Feldman" },
      { id: 9, label: "Rivka Stern" },
    ]);
  });

  it("still offers a plain roster for a browsable target type", async () => {
    // Arrange
    const rows = [{ id: 3, name: "Malka Klein" }];

    // Act
    const { getList, result } = await flushHook("shadchan", undefined, rows, 1);

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "shadchanim",
      expect.objectContaining({ pagination: { page: 1, perPage: 100 } }),
    );
    expect(result().options).toEqual([{ id: 3, label: "Malka Klein" }]);
  });
});
