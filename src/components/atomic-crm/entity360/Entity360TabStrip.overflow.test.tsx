import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import { Route, Routes } from "react-router";

import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { Entity360TabStrip, type Entity360TabsProps } from "./Entity360Tabs";
import { registerEntityDescriptor } from "./registry";
import type { EntityDescriptor } from "./entityDescriptor";

/**
 * The strip used to be `overflow-x-auto`, which failed in two ways on a
 * shidduch's twelve tabs. Per CSS Overflow §3 an `overflow-x` other than
 * `visible` forces the unspecified `overflow-y` to compute to `auto` too, so
 * the strip grew a spurious VERTICAL scrollbar — a stepper with up/down
 * arrows on Linux — drawn over the last tab. And the tabs past the fold were
 * simply unreachable: a horizontal scroll region nested inside a vertically
 * scrolling page is close to undiscoverable with a mouse, so "Discussions"
 * was present in the DOM and could not be found on the screen.
 *
 * These assertions are measurements, not class-name matches: a class-name
 * assertion would pass on `flex-wrap` applied to a container still pinned to
 * `h-9`, which clips the second row to nothing — the exact regression that
 * makes `h-auto` load-bearing.
 */
const FIXTURE_RESOURCE = "tab-overflow-fixture";

/** The shidduch's own twelve, the widest strip the product renders. */
const SHIDDUCH_TABS: Entity360TabsProps["tabs"] = (
  [
    "overview",
    "resume",
    "photo",
    "medical",
    "files",
    "diligence",
    "external-links",
    "notes",
    "tasks",
    "activity",
    "discussions",
    "related",
  ] as const
).map((key) => ({ key, render: () => <div /> }));

/** Narrow enough that twelve tabs cannot fit on one line at any sane font
 * size, so the wrap is actually exercised rather than assumed. */
const NARROW_VIEWPORT_PX = 720;

const renderStrip = async () => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });

  const screen = await render(
    <TestMemoryRouter initialEntries={[`/${FIXTURE_RESOURCE}/1`]}>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RecordContextProvider value={{ id: 1 }}>
            <div style={{ width: `${NARROW_VIEWPORT_PX}px` }}>
              <Routes>
                <Route
                  path={`/${FIXTURE_RESOURCE}/1`}
                  element={<Entity360TabStrip tabs={SHIDDUCH_TABS} />}
                />
              </Routes>
            </div>
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  const list = screen.container.querySelector<HTMLElement>(
    '[data-slot="tabs-list"]',
  );
  if (!list) throw new Error("the tab strip did not render");
  return { screen, list };
};

describe("Entity360TabStrip — twelve tabs on a narrow viewport", () => {
  it("hides nothing horizontally: the strip has no scrollable overflow", async () => {
    // Arrange / Act
    const { list } = await renderStrip();

    // Assert — `scrollWidth > clientWidth` is precisely "there is content
    // off to the side that someone has to find a way to scroll to".
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
  });

  it("grows to fit the rows it wrapped onto, rather than clipping them", async () => {
    // Arrange / Act
    const { list } = await renderStrip();

    // Assert — the `h-auto` half. A wrapped strip still pinned to `h-9`
    // reports scrollHeight well past clientHeight, and that difference is
    // also what made the browser draw the vertical stepper.
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
    // ...and it genuinely wrapped, so the measurement above is not vacuous.
    expect(list.clientHeight).toBeGreaterThan(50);
  });

  it("leaves every tab inside the strip's own box, last one included", async () => {
    // Arrange / Act
    const { screen, list } = await renderStrip();
    const stripBox = list.getBoundingClientRect();

    // Assert — "Discussions" is the tab that was being clipped in practice.
    const discussions = screen.container.querySelector<HTMLElement>(
      'a[href$="/discussions"]',
    );
    expect(discussions).not.toBeNull();
    const tabBox = discussions!.getBoundingClientRect();
    expect(tabBox.right).toBeLessThanOrEqual(stripBox.right + 1);
    expect(tabBox.bottom).toBeLessThanOrEqual(stripBox.bottom + 1);
    expect(tabBox.width).toBeGreaterThan(0);
  });

  it("keeps all twelve tabs reachable as links", async () => {
    // Arrange / Act
    const { screen } = await renderStrip();

    // Assert — the wrap must not have cost a tab.
    const links = screen.container.querySelectorAll(
      '[data-slot="tabs-list"] a',
    );
    expect(links.length).toBe(SHIDDUCH_TABS.length);
  });

  it("does not stretch a short final row across the full width", async () => {
    // Arrange — the `flex-none` half. The Tabs primitive gives every trigger
    // `flex-1`, i.e. `flex-basis: 0` plus grow, which in a wrapping container
    // makes each line's items expand to fill that line. Twelve tabs at 720px
    // wrap 9 + 3, and those last three measured 235px EACH without this
    // override: three half-page slabs under a row of normally-sized tabs.
    const { screen, list } = await renderStrip();
    const links = Array.from(
      screen.container.querySelectorAll<HTMLElement>(
        '[data-slot="tabs-list"] a',
      ),
    );

    // Group by rendered row, which is what "final row" actually means here.
    const rows = new Map<number, HTMLElement[]>();
    for (const link of links) {
      const top = Math.round(link.getBoundingClientRect().top);
      rows.set(top, [...(rows.get(top) ?? []), link]);
    }
    const rowTops = [...rows.keys()].sort((a, b) => a - b);
    expect(rowTops.length).toBeGreaterThan(1);

    const firstRow = rows.get(rowTops[0])!;
    const finalRow = rows.get(rowTops[rowTops.length - 1])!;
    expect(finalRow.length).toBeLessThan(firstRow.length);

    // Assert — a row holding fewer tabs than a full one must leave real slack
    // at its end. Measured: ~236px of 720 with the override, ~713px without.
    const finalRowWidth = finalRow.reduce(
      (total, link) => total + link.getBoundingClientRect().width,
      0,
    );
    const stripWidth = list.getBoundingClientRect().width;
    expect(finalRowWidth).toBeLessThan(stripWidth * 0.7);
  });
});
