import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { Location } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
// Side-effect imports — registers the three real entity descriptors
// (RecordLink/buildRecordPath resolve through the registry, contract §4)
// exactly as they ship, so AC-3's href assertions pin the real routes.
import "../shadchanim/entityDescriptor";
import "../shidduchim/entityDescriptor";
import "../singles/entityDescriptor";
import { GlobalSearch, GlobalSearchProvider } from "./GlobalSearch";
import { useGlobalSearchDialog } from "./useGlobalSearch";

/**
 * Task 5 / AC 1, 3, 5, 6. Three distinct, non-overlapping labels across the
 * three resources (never sharing a substring) so a `getByRole` query by
 * accessible name can never match the wrong row.
 */
const SINGLE_ROW = { id: 1, first_name_en: "Chaya", last_name_en: "Klein" };
const SHIDDUCH_ROW = {
  id: 10,
  name_en: "Devora Cohen",
  shadchan_name: "Malka Gold",
};
const SHADCHAN_ROW = { id: 20, name: "Faiga Roth" };

type Rows = {
  singles?: unknown[];
  shidduchim?: unknown[];
  shadchanim?: unknown[];
};

function buildDataProvider(rows: Rows = {}): CrmDataProvider {
  const singles = rows.singles ?? [SINGLE_ROW];
  const shidduchim = rows.shidduchim ?? [SHIDDUCH_ROW];
  const shadchanim = rows.shadchanim ?? [SHADCHAN_ROW];

  const getList = vi.fn(async (resource: string) => {
    if (resource === "singles") return { data: singles, total: singles.length };
    if (resource === "shidduchim")
      return { data: shidduchim, total: shidduchim.length };
    if (resource === "shadchanim")
      return { data: shadchanim, total: shadchanim.length };
    throw new Error(`GlobalSearch.test.tsx: unexpected resource "${resource}"`);
  });

  return { getList } as unknown as CrmDataProvider;
}

/** Opens the shell's single dialog instance as soon as it mounts — mirrors
 * how a real chrome trigger (TopBar's icon, the Cmd/Ctrl+K listener) calls
 * `open()`, without needing a locator click on that trigger in every test. */
function AutoOpen() {
  const { open } = useGlobalSearchDialog();
  useEffect(() => {
    open();
  }, [open]);
  return null;
}

function Harness({
  dataProvider,
  locationCallback,
}: {
  dataProvider: CrmDataProvider;
  locationCallback?: (location: Location) => void;
}) {
  return (
    <TestMemoryRouter locationCallback={locationCallback}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <GlobalSearchProvider>
          <AutoOpen />
          <GlobalSearch />
        </GlobalSearchProvider>
      </CoreAdminContext>
    </TestMemoryRouter>
  );
}

const PLACEHOLDER = "Search singles, shidduchim, shadchanim…";

/**
 * Real timers, not fake ones: this suite runs in a genuine browser
 * (Playwright/Chromium), where `.fill()`'s own actionability checks and
 * React's passive-effect flush both ride on real animation-frame/message
 * ticks that `vi.useFakeTimers()` freezes right along with `setTimeout` —
 * there is no way to fake only the debounce's own timer without also
 * freezing the machinery driving the interaction itself (confirmed: under
 * fake timers, `.fill()` still updates the input's value, but advancing the
 * fake clock never lets the resulting `useEffect` actually run). A short
 * real sleep stands in for "not yet"; `expect.poll` — a deterministic
 * retrying assertion, never a blind `waitForTimeout` — stands in for
 * "eventually, once the debounce settles".
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("GlobalSearch — debounce (AC 5)", () => {
  it("fetches nothing well before 300ms, and fetches exactly once once the debounce settles", async () => {
    // Arrange
    const dataProvider = buildDataProvider();
    const screen = await render(<Harness dataProvider={dataProvider} />);
    const input = screen.getByPlaceholder(PLACEHOLDER);

    // Act
    await input.fill("ab");
    await sleep(200);

    // Assert — well under the 300ms debounce, nothing has fired yet.
    expect(dataProvider.getList).not.toHaveBeenCalled();

    // Assert — exactly one fan-out (three calls, one per resource) once the
    // debounce settles.
    await expect
      .poll(() => vi.mocked(dataProvider.getList).mock.calls.length, {
        timeout: 2000,
      })
      .toBe(3);

    // Assert — and never more than that single fan-out.
    await sleep(200);
    expect(dataProvider.getList).toHaveBeenCalledTimes(3);
  });

  it("a burst of keystrokes inside the 300ms window produces exactly one fan-out", async () => {
    // Arrange
    const dataProvider = buildDataProvider();
    const screen = await render(<Harness dataProvider={dataProvider} />);
    const input = screen.getByPlaceholder(PLACEHOLDER);

    // Act — each keystroke resets the pending timeout (Task 2's cleanup),
    // so 300ms elapses in total but never 300ms since the LAST keystroke.
    await input.fill("a");
    await sleep(120);
    await input.fill("ab");
    await sleep(120);
    await input.fill("abc");
    await sleep(120);

    // Assert
    expect(dataProvider.getList).not.toHaveBeenCalled();

    // Act — let the trailing keystroke's own timeout elapse.
    await expect
      .poll(() => vi.mocked(dataProvider.getList).mock.calls.length, {
        timeout: 2000,
      })
      .toBe(3);

    // Assert — a single fan-out, not one per keystroke.
    await sleep(200);
    expect(dataProvider.getList).toHaveBeenCalledTimes(3);
  });
});

describe("GlobalSearch — Escape closes the dialog (AC 1)", () => {
  it("closes on Escape", async () => {
    // Arrange
    const dataProvider = buildDataProvider();
    const screen = await render(<Harness dataProvider={dataProvider} />);
    await expect.element(screen.getByRole("dialog")).toBeInTheDocument();

    // Act
    await userEvent.keyboard("{Escape}");

    // Assert
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("GlobalSearch — result rows (AC 2, AC 3)", () => {
  it("renders one RecordLink per result, each href equal to buildRecordPath(resource, id)", async () => {
    // Arrange
    const dataProvider = buildDataProvider();
    const screen = await render(<Harness dataProvider={dataProvider} />);
    const input = screen.getByPlaceholder(PLACEHOLDER);

    // Act
    await input.fill("ro");

    // Assert — AC-3: the descriptor-built path, not a hand-written template.
    await expect
      .element(screen.getByRole("link", { name: /Chaya Klein/ }))
      .toHaveAttribute("href", "/singles/1/show");
    await expect
      .element(screen.getByRole("link", { name: /Devora Cohen/ }))
      .toHaveAttribute("href", "/shidduchim/10/show");
    await expect
      .element(screen.getByRole("link", { name: /Faiga Roth/ }))
      .toHaveAttribute("href", "/shadchanim/20/show");

    // Assert — grouped by resource, under the translated resource-plural
    // heading. `exact: true` disambiguates from the dialog's own (visually
    // hidden) description text, which also contains these words.
    await expect
      .element(screen.getByText("Singles", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Shidduchim", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Shadchanim", { exact: true }))
      .toBeInTheDocument();
  });

  it("shows the empty-state hint before typing, and never names references", async () => {
    // Arrange / Act
    const dataProvider = buildDataProvider();
    const screen = await render(<Harness dataProvider={dataProvider} />);

    // Assert
    await expect.element(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
    expect(dataProvider.getList).not.toHaveBeenCalled();
  });

  it("shows a no-results message when all three groups come back empty", async () => {
    // Arrange
    const dataProvider = buildDataProvider({
      singles: [],
      shidduchim: [],
      shadchanim: [],
    });
    const screen = await render(<Harness dataProvider={dataProvider} />);
    const input = screen.getByPlaceholder(PLACEHOLDER);

    // Act
    await input.fill("nothing matches this");

    // Assert
    await expect.element(screen.getByText("No results")).toBeInTheDocument();
  });
});

describe("GlobalSearch — selecting a result (AC 3)", () => {
  it("a mouse click navigates exactly once and closes the dialog", async () => {
    // Arrange
    const dataProvider = buildDataProvider();
    const pathnames: string[] = [];
    const screen = await render(
      <Harness
        dataProvider={dataProvider}
        locationCallback={(location) => pathnames.push(location.pathname)}
      />,
    );
    const input = screen.getByPlaceholder(PLACEHOLDER);
    await input.fill("chaya");
    const link = screen.getByRole("link", { name: /Chaya Klein/ });
    await expect.element(link).toBeInTheDocument();

    // Act
    await link.click();

    // Assert — exactly one navigation to the single's page, and the dialog closed.
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(pathnames.filter((p) => p === "/singles/1/show")).toHaveLength(1);
    expect(pathnames.at(-1)).toBe("/singles/1/show");
  });

  it("keyboard Enter on the (only) result navigates exactly once and closes the dialog", async () => {
    // Arrange — only `singles` has a match, so cmdk's auto-selected item is
    // unambiguous.
    const dataProvider = buildDataProvider({ shidduchim: [], shadchanim: [] });
    const pathnames: string[] = [];
    const screen = await render(
      <Harness
        dataProvider={dataProvider}
        locationCallback={(location) => pathnames.push(location.pathname)}
      />,
    );
    const input = screen.getByPlaceholder(PLACEHOLDER);
    await input.fill("chaya");
    await expect
      .element(screen.getByRole("link", { name: /Chaya Klein/ }))
      .toBeInTheDocument();

    // Act
    await userEvent.keyboard("{Enter}");

    // Assert
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(pathnames.filter((p) => p === "/singles/1/show")).toHaveLength(1);
    expect(pathnames.at(-1)).toBe("/singles/1/show");
  });
});
