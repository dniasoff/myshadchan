import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
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
 * The strip used to be `overflow-x-auto` at every width, which failed in two
 * ways on a shidduch's twelve tabs. Per CSS Overflow §3 an `overflow-x` other
 * than `visible` forces the unspecified `overflow-y` to compute to `auto` too,
 * so the strip grew a spurious VERTICAL scrollbar — a stepper with up/down
 * arrows on Linux — drawn over the last tab. And the tabs past the fold were
 * simply unreachable: a horizontal scroll region nested inside a vertically
 * scrolling page is close to undiscoverable WITH A MOUSE, so "Discussions" was
 * present in the DOM and could not be found on the screen.
 *
 * It then wrapped at every width, which bought that back at the phone's
 * expense: twelve tabs stack into ~4 rows of 44px, ~200px of chrome above the
 * fold on every record. So the treatment is now a breakpoint — wrap from `sm`
 * up, scroll below it, where a horizontal swipe IS a discoverable gesture —
 * and both halves are asserted here, at a real desktop and a real phone
 * viewport. The mobile half additionally proves the two things that made
 * scrolling wrong the first time are handled: no vertical overflow (the
 * stepper) and the active tab brought into view (the lost "Discussions").
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

/** Wide enough to be unambiguously above the `sm` breakpoint, so the wrapping
 * half of the treatment is what is under test. */
const DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;

/** A 390px handset — below `sm` (640px), so the scrolling half applies. */
const PHONE_VIEWPORT = { width: 390, height: 720 } as const;

const renderStrip = async ({
  containerWidthPx = NARROW_VIEWPORT_PX,
  tab,
}: { containerWidthPx?: number; tab?: string } = {}) => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });

  const strip = <Entity360TabStrip tabs={SHIDDUCH_TABS} />;
  const screen = await render(
    <TestMemoryRouter
      initialEntries={[
        tab ? `/${FIXTURE_RESOURCE}/1/${tab}` : `/${FIXTURE_RESOURCE}/1`,
      ]}
    >
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RecordContextProvider value={{ id: 1 }}>
            <div style={{ width: `${containerWidthPx}px` }}>
              <Routes>
                <Route path={`/${FIXTURE_RESOURCE}/1`} element={strip} />
                <Route path={`/${FIXTURE_RESOURCE}/1/:tab`} element={strip} />
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

/** Group the rendered triggers by their rendered row, which is what "wrapped
 * onto N rows" actually means in geometry. */
const rowsOf = (links: HTMLElement[]): HTMLElement[][] => {
  const rows = new Map<number, HTMLElement[]>();
  for (const link of links) {
    const top = Math.round(link.getBoundingClientRect().top);
    rows.set(top, [...(rows.get(top) ?? []), link]);
  }
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((top) => rows.get(top) as HTMLElement[]);
};

const linksIn = (list: HTMLElement): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>("a"));

describe("Entity360TabStrip — twelve tabs, desktop viewport (wraps)", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  it("hides nothing horizontally: the strip has no scrollable overflow", async () => {
    // Arrange
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

    // Act
    const { list } = await renderStrip();

    // Assert — `scrollWidth > clientWidth` is precisely "there is content
    // off to the side that someone has to find a way to scroll to", which
    // with a mouse is the failure this wrap exists to prevent.
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
  });

  it("grows to fit the rows it wrapped onto, rather than clipping them", async () => {
    // Arrange
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

    // Act
    const { list } = await renderStrip();

    // Assert — the `h-auto` half. A wrapped strip still pinned to `h-9`
    // reports scrollHeight well past clientHeight, and that difference is
    // also what made the browser draw the vertical stepper.
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
    // ...and it genuinely wrapped, so the measurement above is not vacuous.
    expect(list.clientHeight).toBeGreaterThan(50);
  });

  it("leaves every tab inside the strip's own box, last one included", async () => {
    // Arrange
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

    // Act
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
    // Arrange
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

    // Act
    const { list } = await renderStrip();

    // Assert — the wrap must not have cost a tab.
    expect(linksIn(list).length).toBe(SHIDDUCH_TABS.length);
  });

  it("does not stretch a short final row across the full width", async () => {
    // Arrange — the `flex-none` half. The Tabs primitive gives every trigger
    // `flex-1`, i.e. `flex-basis: 0` plus grow, which in a wrapping container
    // makes each line's items expand to fill that line. Twelve tabs at 720px
    // wrap 9 + 3, and those last three measured 235px EACH without this
    // override: three half-page slabs under a row of normally-sized tabs.
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    const { list } = await renderStrip();
    const rows = rowsOf(linksIn(list));
    expect(rows.length).toBeGreaterThan(1);

    const firstRow = rows[0];
    const finalRow = rows[rows.length - 1];
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

describe("Entity360TabStrip — twelve tabs, phone viewport (scrolls)", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  it("stays a single row instead of stacking ~200px of chrome above the record", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const { list } = await renderStrip({ containerWidthPx: 360 });

    // Assert — one rendered row, and it is the 44px touch row, not four of
    // them. `flex-none` is what keeps the tabs their natural width here
    // rather than being squeezed to fit (which would leave nothing to
    // scroll and unreadable labels).
    expect(rowsOf(linksIn(list)).length).toBe(1);
    expect(list.clientHeight).toBeLessThan(60);
  });

  it("scrolls horizontally rather than hiding the tabs past the fold", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const { list } = await renderStrip({ containerWidthPx: 360 });

    // Assert — there is more strip than fits, and it is reachable by swipe.
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    expect(linksIn(list).length).toBe(SHIDDUCH_TABS.length);
  });

  it("grows no vertical scrollbar — the stepper CSS Overflow §3 caused last time", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const { list } = await renderStrip({ containerWidthPx: 360 });

    // Assert — the COMPUTED pair, not the class names: `overflow-x: auto`
    // is what silently drags `overflow-y` from `visible` to `auto`, and an
    // `auto` y-axis with any overflow at all draws the stepper over the last
    // tab. Declaring `hidden` explicitly is the only thing that stops it,
    // and a computed value is the only place that shows up.
    const computed = getComputedStyle(list);
    expect(computed.overflowX).toBe("auto");
    expect(computed.overflowY).toBe("hidden");
    // ...and no vertical scrollbar is eating layout space either way.
    expect(list.clientWidth).toBe(list.getBoundingClientRect().width);
  });

  it("brings the active tab into view when the record is deep-linked to one past the fold", async () => {
    // Arrange — "Discussions" is eleventh of twelve: off-screen to the right
    // on a 360px strip, and the exact tab that "existed and could not be
    // found" when this last scrolled.
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const { screen, list } = await renderStrip({
      containerWidthPx: 360,
      tab: "discussions",
    });
    const discussions = screen.container.querySelector<HTMLElement>(
      'a[href$="/discussions"]',
    );
    expect(discussions).not.toBeNull();

    // Assert — inside the strip's visible box, both edges. Polled because
    // the centring runs in an effect after the first paint.
    await expect
      .poll(() => {
        const stripBox = list.getBoundingClientRect();
        const tabBox = discussions!.getBoundingClientRect();
        return (
          tabBox.left >= stripBox.left - 1 && tabBox.right <= stripBox.right + 1
        );
      })
      .toBe(true);
  });
});
