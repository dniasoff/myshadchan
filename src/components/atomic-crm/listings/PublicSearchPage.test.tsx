import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import type { Listing } from "../types";
import { PublicSearchPage } from "./PublicSearchPage";
import type { PublicSearchUrl } from "./publicSearchUrl";

/**
 * Real timers, not fake ones — same reasoning as
 * `misc/GlobalSearch.test.tsx`'s own debounce suite: this runs in a genuine
 * browser (Playwright/Chromium), where `.fill()`'s actionability checks and
 * React's passive-effect flush both ride on real timer ticks
 * `vi.useFakeTimers()` would freeze right along with the debounce it is
 * meant to isolate. A short real sleep stands in for "not yet";
 * `expect.poll`/`expect.element` (deterministic, retrying) stand in for
 * "eventually".
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const url = (overrides: Partial<PublicSearchUrl> = {}): PublicSearchUrl => ({
  pathname: "/find",
  search: "",
  ...overrides,
});

const shadchanListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 1,
  account_id: 100,
  listing_type: "shadchan",
  shadchan_name: "Rivka Klein",
  shadchan_area: "Lakewood and nearby",
  shadchan_contact_info: null,
  created_at: "2026-07-01T00:00:00Z",
  ...overrides,
});

const singleListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 2,
  account_id: 200,
  listing_type: "single",
  single_id: 20,
  single_first_name_en: "Chaya",
  single_first_name_he: null,
  single_age: 24,
  single_height: null,
  single_community: null,
  single_location: null,
  single_summary: null,
  created_at: "2026-07-02T00:00:00Z",
  ...overrides,
});

describe("PublicSearchPage — idle state (AC-6)", () => {
  it("shows the idle hint before any query is typed, and never calls the loader", async () => {
    // Arrange
    const loadListings = vi.fn(() => Promise.resolve([]));

    // Act
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );

    // Assert
    await expect
      .element(screen.getByTestId("public-search-idle"))
      .toHaveTextContent(/start typing to search/i);
    await sleep(400);
    expect(loadListings).not.toHaveBeenCalled();
  });
});

describe("PublicSearchPage — loading, then results (AC-1, AC-6)", () => {
  it("renders outside any Admin/dataProvider context, shows loading, then the fetched results", async () => {
    // Arrange
    let resolveLoad: (listings: Listing[]) => void = () => {};
    const loadListings = vi.fn(
      () =>
        new Promise<Listing[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("chaya");

    // Assert — the debounce settles into exactly one call…
    await expect
      .poll(() => loadListings.mock.calls.length, { timeout: 2000 })
      .toBe(1);
    expect(loadListings).toHaveBeenCalledWith({ text: "chaya" });
    // …and a loading state is visible before it resolves.
    await expect
      .element(screen.getByTestId("public-search-loading"))
      .toBeVisible();

    // Act
    resolveLoad([shadchanListing(), singleListing()]);

    // Assert
    await expect
      .element(screen.getByTestId("public-search-loading"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Rivka Klein")).toBeVisible();
    await expect.element(screen.getByText("Chaya")).toBeVisible();
  });
});

describe("PublicSearchPage — the two kinds render separately (AC-5)", () => {
  it("groups shadchan and single listings under two distinct headings, not one interleaved list", async () => {
    // Arrange
    const loadListings = vi.fn(() =>
      Promise.resolve([shadchanListing(), singleListing()]),
    );
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("l");

    // Assert — headings looked up by role, not bare text: the subtitle
    // copy and the heading text sit in adjacent block elements with no
    // literal whitespace between them in the DOM's own textContent, which
    // makes a bare case-insensitive substring match ambiguous (e.g. "...a
    // singleSearch only..." contains "singles"). The role scopes the match
    // to the heading element itself.
    await expect
      .element(screen.getByRole("heading", { name: "Shadchanim" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("heading", { name: "Singles" }))
      .toBeVisible();
    await expect.element(screen.getByText("Rivka Klein")).toBeVisible();
    await expect.element(screen.getByText("Chaya")).toBeVisible();
  });
});

describe("PublicSearchPage — only opted-in fields render (AC-2)", () => {
  it("never shows a field the row left null, and never fabricates a placeholder for it", async () => {
    // Arrange — a shadchan listing with no area/contact opted in, and a
    // single listing with no height/community/location/summary opted in.
    const loadListings = vi.fn(() =>
      Promise.resolve([
        shadchanListing({ shadchan_area: null, shadchan_contact_info: null }),
        singleListing({ single_age: null }),
      ]),
    );
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("l");
    await expect.element(screen.getByText("Rivka Klein")).toBeVisible();

    // Assert
    await expect
      .element(screen.getByText("Lakewood and nearby"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText(/^Contact:/)).not.toBeInTheDocument();
    await expect.element(screen.getByText(/^Age/)).not.toBeInTheDocument();
  });

  it("shows every opted-in field, including the Hebrew name alongside the English one", async () => {
    // Arrange
    const loadListings = vi.fn(() =>
      Promise.resolve([
        shadchanListing({ shadchan_contact_info: "shadchan@example.com" }),
        singleListing({
          single_first_name_he: "חיה",
          single_height: "5'4\"",
          single_community: "Yeshivish",
          single_location: "Lakewood, NJ",
        }),
      ]),
    );
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("l");

    // Assert
    await expect.element(screen.getByText("Lakewood and nearby")).toBeVisible();
    await expect
      .element(screen.getByText(/Contact:\s*shadchan@example.com/))
      .toBeVisible();
    await expect.element(screen.getByText(/חיה/)).toBeVisible();
    await expect.element(screen.getByText(/Age 24/)).toBeVisible();
    await expect.element(screen.getByText(/5'4"/)).toBeVisible();
    await expect.element(screen.getByText(/Yeshivish/)).toBeVisible();
    await expect.element(screen.getByText(/Lakewood, NJ/)).toBeVisible();
  });
});

describe("PublicSearchPage — zero matches (AC-6)", () => {
  it("shows a calm empty state distinct from the idle and error states", async () => {
    // Arrange
    const loadListings = vi.fn(() => Promise.resolve([]));
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("nobody-matches-this");

    // Assert
    await expect
      .element(screen.getByTestId("public-search-empty"))
      .toBeVisible();
  });
});

describe("PublicSearchPage — network/config failure (AC-6)", () => {
  it("shows a calm error state rather than an unhandled exception", async () => {
    // Arrange
    const loadListings = vi.fn(() =>
      Promise.reject(new Error("network unreachable")),
    );
    const screen = await render(
      <PublicSearchPage url={url()} loadListings={loadListings} />,
    );
    const input = screen.getByRole("searchbox");

    // Act
    await input.fill("chaya");

    // Assert
    await expect
      .element(screen.getByTestId("public-search-error"))
      .toBeVisible();
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("PublicSearchPage — a shared search link reconstructs its query (Task 1)", () => {
  it("pre-fills the search box from ?q= and searches on load", async () => {
    // Arrange
    const loadListings = vi.fn(() => Promise.resolve([shadchanListing()]));

    // Act
    const screen = await render(
      <PublicSearchPage
        url={url({ search: "?q=rivka" })}
        loadListings={loadListings}
      />,
    );

    // Assert
    await expect
      .poll(() => loadListings.mock.calls.length, { timeout: 2000 })
      .toBe(1);
    expect(loadListings).toHaveBeenCalledWith({ text: "rivka" });
    await expect.element(screen.getByRole("searchbox")).toHaveValue("rivka");
  });
});

describe("PublicSearchPage — stays outside the authenticated dataProvider/EntityList seam (Task 4)", () => {
  it("its own source, and the client/card modules it imports, never reference dataProvider or EntityList", () => {
    // Arrange — this story's own declared file set (Dev Notes, "Project
    // Structure Notes"), read as raw text via Vite's `?raw` import so the
    // check runs against the real committed source, not a hand-copied
    // string a future edit could silently drift from.
    const sources = import.meta.glob(
      [
        "./PublicSearchPage.tsx",
        "./publicListingsClient.ts",
        "./ShadchanListingCard.tsx",
        "./SingleListingCard.tsx",
        "./publicSearchUrl.ts",
        "./publicSearchTranslate.ts",
      ],
      { query: "?raw", import: "default", eager: true },
    ) as Record<string, string>;

    // Assert — the scan actually found this story's files (an empty glob
    // would make every "appears nowhere" assertion below pass vacuously).
    expect(Object.keys(sources)).toHaveLength(6);

    // Act / Assert
    for (const [path, content] of Object.entries(sources)) {
      expect(content, `${path} must not reference dataProvider`).not.toMatch(
        /\bdataProvider\b/,
      );
      expect(content, `${path} must not reference EntityList`).not.toMatch(
        /\bEntityList\b/,
      );
    }
  });
});
