import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Entity360 } from "./Entity360";

const MARKER = {
  breadcrumb: "BREADCRUMB_MARKER",
  identityHeader: "IDENTITY_HEADER_MARKER",
  statBand: "STAT_BAND_MARKER",
  alertSlot: "ALERT_SLOT_MARKER",
  tabBar: "TAB_BAR_MARKER",
  children: "CONTENT_MARKER",
  rightRail: "RIGHT_RAIL_MARKER",
} as const;

/** Pinned region order, the exact AC 1 sequence. */
const PINNED_ORDER = [
  MARKER.breadcrumb,
  MARKER.identityHeader,
  MARKER.statBand,
  MARKER.alertSlot,
  MARKER.tabBar,
  MARKER.children,
  MARKER.rightRail,
];

/** All seven regions populated, as a fresh set of elements per call. */
const allRegions = () => ({
  breadcrumb: <span>{MARKER.breadcrumb}</span>,
  identityHeader: <span>{MARKER.identityHeader}</span>,
  statBand: <span>{MARKER.statBand}</span>,
  alertSlot: <span>{MARKER.alertSlot}</span>,
  tabBar: <span>{MARKER.tabBar}</span>,
  children: <span>{MARKER.children}</span>,
  rightRail: <span>{MARKER.rightRail}</span>,
});

/** Root element count when every one of the 5 singleton regions is present
 * and the content/rail wrapper is emitted (6 total). */
const ALL_REGIONS_ROOT_COUNT = 6;

describe("Entity360", () => {
  it("renders all seven regions in the pinned order, regardless of the order props are written in JSX", async () => {
    // Arrange
    const regions = allRegions();

    // Act — props deliberately scrambled relative to the pinned order.
    const screen = await render(
      <Entity360
        rightRail={regions.rightRail}
        tabBar={regions.tabBar}
        breadcrumb={regions.breadcrumb}
        children={regions.children}
        alertSlot={regions.alertSlot}
        statBand={regions.statBand}
        identityHeader={regions.identityHeader}
      />,
    );

    // Assert
    const text = screen.container.textContent ?? "";
    const indices = PINNED_ORDER.map((marker) => text.indexOf(marker));
    expect(indices.every((index) => index !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("emits no wrapper for any region when all seven props are omitted", async () => {
    // Arrange / Act
    const screen = await render(<Entity360 />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.children.length).toBe(0);
    expect(root.textContent).toBe("");
  });

  it("omits breadcrumb entirely (no wrapper, root child count drops by one) when its prop is absent", async () => {
    // Arrange
    const { breadcrumb: _breadcrumb, ...rest } = allRegions();

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.textContent ?? "").not.toContain(MARKER.breadcrumb);
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
  });

  it("omits identityHeader entirely (no wrapper, root child count drops by one) when its prop is absent", async () => {
    // Arrange
    const { identityHeader: _identityHeader, ...rest } = allRegions();

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.textContent ?? "").not.toContain(MARKER.identityHeader);
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
  });

  it("omits statBand entirely (no wrapper, root child count drops by one) when its prop is absent", async () => {
    // Arrange
    const { statBand: _statBand, ...rest } = allRegions();

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.textContent ?? "").not.toContain(MARKER.statBand);
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
  });

  it("omits alertSlot entirely (no wrapper, root child count drops by one) when its prop is absent", async () => {
    // Arrange
    const { alertSlot: _alertSlot, ...rest } = allRegions();

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.textContent ?? "").not.toContain(MARKER.alertSlot);
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
  });

  it("omits tabBar entirely (no wrapper, root child count drops by one) when its prop is absent", async () => {
    // Arrange
    const { tabBar: _tabBar, ...rest } = allRegions();

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert
    expect(root.textContent ?? "").not.toContain(MARKER.tabBar);
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
  });

  it("omits the content/rail wrapper entirely when both children and rightRail are absent", async () => {
    // Arrange
    const regions = allRegions();
    const { children: _content, rightRail: _rail, ...rest } = regions;

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;

    // Assert — the 5 singleton regions only; no sixth (wrapper) child.
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT - 1);
    expect(root.textContent ?? "").not.toContain(MARKER.children);
    expect(root.textContent ?? "").not.toContain(MARKER.rightRail);
  });

  it("still emits the content/rail wrapper with only children present", async () => {
    // Arrange
    const regions = allRegions();
    const { rightRail: _rightRail, ...rest } = regions;

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;
    const wrapper = root.children[root.children.length - 1] as HTMLElement;

    // Assert — wrapper present (root count unchanged) with exactly 1 child.
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT);
    expect(wrapper.children.length).toBe(1);
    expect(root.textContent ?? "").toContain(MARKER.children);
    expect(root.textContent ?? "").not.toContain(MARKER.rightRail);
  });

  it("still emits the content/rail wrapper with only rightRail present", async () => {
    // Arrange
    const regions = allRegions();
    const { children: _content, ...rest } = regions;

    // Act
    const screen = await render(<Entity360 {...rest} />);
    const root = screen.container.children[0] as HTMLElement;
    const wrapper = root.children[root.children.length - 1] as HTMLElement;

    // Assert
    expect(root.children.length).toBe(ALL_REGIONS_ROOT_COUNT);
    expect(wrapper.children.length).toBe(1);
    expect(root.textContent ?? "").toContain(MARKER.rightRail);
    expect(root.textContent ?? "").not.toContain(MARKER.children);
  });

  // AC 2 — the signature is closed. An unused type-check-suppression
  // directive is itself a tsc error (`npm run typecheck` fails the moment
  // either prop becomes accepted), so these two cases are enforced by the
  // compiler, not by the test runner. `void` keeps the JSX expression from
  // tripping an unrelated lint rule while giving the statement a use.
  it("rejects a className prop at compile time", () => {
    // @ts-expect-error — Entity360 has no className prop (AC 2).
    void (<Entity360 className="x" />);
  });

  // The contract's literal AC 2 fixture is `<Entity360 data-testid="x" />`,
  // but TypeScript's JSX checker special-cases every hyphenated attribute
  // name (`data-*`/`aria-*`) and skips excess-property checking for it on
  // ANY element, custom components included — so that exact case can never
  // produce an error, and a suppression directive above it would itself
  // fail `npm run typecheck` as unused. `variant` (named in AC 1 as a
  // banned prop) is substituted here as an equivalent, checkable arbitrary
  // prop — see the story report for this contract discrepancy.
  it("rejects an arbitrary prop (variant) at compile time", () => {
    // @ts-expect-error — Entity360 performs no prop spread (AC 2).
    void (<Entity360 variant="x" />);
  });
});
