import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type * as RaCore from "ra-core";

import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";

/**
 * Review fix (F5): the pre-story `ShadchanDirectory` gated its skeleton on
 * `shadchanimPending || shidduchimPending`; the retrofit dropped the second
 * half, so every card rendered immediately with `counts.get(id) ?? 0` and
 * flashed a wrong "0 shidduchim" before the `shidduchim` count query
 * resolved. `useGetList` is mocked here (rather than driven through a real
 * FakeRest round trip) so the still-pending state is actually observable —
 * a real fake-data-provider request resolves before the first assertion
 * ever runs, which is exactly why this regression shipped with every test
 * green.
 *
 * Story 5.9 (AD-23 remediation): the rendered label is "shidduch"/
 * "shidduchim" (via `crm.shadchanim.row.shidduchimCount`), never
 * "suggestion(s)" — this file's own two assertions below are updated in the
 * same diff.
 */
const { useGetListMock, useShadchanNotesMock, useShadchanRemindersMock } =
  vi.hoisted(() => ({
    useGetListMock: vi.fn(),
    useShadchanNotesMock: vi.fn<
      () => {
        notesByShadchanId: Map<string, unknown>;
        isPending: boolean;
        error: unknown;
      }
    >(() => ({
      notesByShadchanId: new Map(),
      isPending: false,
      error: null,
    })),
    useShadchanRemindersMock: vi.fn(() => ({
      remindersByShadchanId: new Map<string, { count: number }>(),
      isPending: false,
      error: null,
    })),
  }));

vi.mock("ra-core", async (importOriginal) => {
  const actual = await importOriginal<typeof RaCore>();
  return { ...actual, useGetList: useGetListMock };
});

vi.mock("./useShadchanNotes", () => ({
  useShadchanNotes: useShadchanNotesMock,
}));

vi.mock("./useShadchanReminders", () => ({
  useShadchanReminders: useShadchanRemindersMock,
}));

// Side-effect import — registers the real `shadchanim` descriptor so
// `ShadchanCard`'s `RecordLink` resolves a real href instead of degrading to
// a plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanCardGrid } from "./ShadchanCardGrid";

const SHADCHANIM = [
  { id: 1, name: "Rivka Stern" },
  { id: 2, name: "Moshe Adler" },
];

const FOOTER_LAYOUT_SHADCHANIM = [
  { id: 1, name: "Rivka Stern" },
  { id: 2, name: "Moshe Adler" },
  { id: 3, name: "Yael Cohen" },
];

const NOTE = {
  id: 22,
  account_id: 1,
  target_type: "shadchan" as const,
  target_id: 1,
  scope: "account" as const,
  kind: "note" as const,
  body: "Private body",
  created_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
};

const renderGrid = (data = SHADCHANIM) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ShadchanCardGrid data={data} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanCardGrid — gates on the shidduchim count query, not just the shadchanim list (F5)", () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
  });

  beforeEach(() => {
    useShadchanNotesMock.mockImplementation(() => ({
      notesByShadchanId: new Map(),
      isPending: false,
      error: null,
    }));
    useShadchanRemindersMock.mockImplementation(() => ({
      remindersByShadchanId: new Map(),
      isPending: false,
      error: null,
    }));
  });

  it("shows one quiet pending status and no Note action while indicators load", async () => {
    // Arrange
    useShadchanNotesMock.mockReturnValue({
      notesByShadchanId: new Map(),
      isPending: true,
      error: null,
    });
    useGetListMock.mockReturnValue({
      data: [{ id: 100, shadchan_id: 1, pipeline_state: "new" }],
      isPending: false,
    });

    // Act
    const screen = await renderGrid();

    // Assert
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Checking for notes…");
    await expect
      .element(
        screen.getByRole("button", { name: "Open note for Rivka Stern" }),
      )
      .not.toBeInTheDocument();
  });

  it("shows one error status and no Note action when indicators fail", async () => {
    // Arrange
    useShadchanNotesMock.mockReturnValue({
      notesByShadchanId: new Map(),
      isPending: false,
      error: new Error("private read failed"),
    });
    useGetListMock.mockReturnValue({
      data: [{ id: 100, shadchan_id: 1, pipeline_state: "new" }],
      isPending: false,
    });

    // Act
    const screen = await renderGrid();

    // Assert
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Could not load note indicators.");
    await expect
      .element(
        screen.getByRole("button", { name: "Open note for Rivka Stern" }),
      )
      .not.toBeInTheDocument();
  });

  it("passes the visible note through to the matching card", async () => {
    useShadchanNotesMock.mockReturnValue({
      notesByShadchanId: new Map([["1", NOTE]]),
      isPending: false,
      error: null,
    });
    useGetListMock.mockReturnValue({
      data: [{ id: 100, shadchan_id: 1, pipeline_state: "new" }],
      isPending: false,
    });

    const screen = await renderGrid();

    await expect
      .element(
        screen.getByRole("button", { name: "Open note for Rivka Stern" }),
      )
      .toBeInTheDocument();
  });

  it("renders the skeleton, not a card claiming '0 shidduchim', while the count query is pending", async () => {
    // Arrange
    useGetListMock.mockReturnValue({ data: undefined, isPending: true });

    // Act
    const screen = await renderGrid();

    // Assert — neither shadchan's card has rendered yet.
    await expect
      .element(screen.getByText("Rivka Stern"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Moshe Adler"))
      .not.toBeInTheDocument();
  });

  it("renders the batched reminder marker on the matching card", async () => {
    useGetListMock.mockReturnValue({ data: [], isPending: false });
    useShadchanRemindersMock.mockReturnValue({
      remindersByShadchanId: new Map([["1", { count: 2 }]]),
      isPending: false,
      error: null,
    });

    const screen = await renderGrid();

    await expect
      .element(screen.getByRole("link", { name: "2 reminders" }))
      .toHaveAttribute("href", "/shadchanim/1/tasks");
  });

  it("keeps every card footer on one stable phone line", async () => {
    await page.viewport(390, 844);
    useGetListMock.mockReturnValue({ data: [], isPending: false });
    useShadchanNotesMock.mockReturnValue({
      notesByShadchanId: new Map([["2", { ...NOTE, target_id: 2 }]]),
      isPending: false,
      error: null,
    });
    useShadchanRemindersMock.mockReturnValue({
      remindersByShadchanId: new Map([
        ["1", { count: 1 }],
        ["2", { count: 2 }],
      ]),
      isPending: false,
      error: null,
    });

    const screen = await renderGrid(FOOTER_LAYOUT_SHADCHANIM);
    const cards = screen.getByTestId("shadchan-card");
    const footers = screen.getByTestId("shadchan-card-footer");
    const actionGroups = screen.getByTestId("shadchan-card-actions");

    await expect.element(cards.nth(0)).toBeInTheDocument();
    await expect.element(cards.nth(1)).toBeInTheDocument();
    await expect.element(cards.nth(2)).toBeInTheDocument();
    await expect.element(actionGroups.nth(0)).toHaveClass("min-h-11");
    await expect.element(actionGroups.nth(1)).toHaveClass("min-h-11");
    await expect.element(actionGroups.nth(2)).toHaveClass("min-h-11");
    await expect.element(footers.nth(0)).toHaveClass("flex-nowrap");
    await expect.element(footers.nth(1)).toHaveClass("flex-nowrap");
    await expect.element(footers.nth(2)).toHaveClass("flex-nowrap");

    const cardHeights = [0, 1, 2].map((index) =>
      Math.round(cards.nth(index).element().getBoundingClientRect().height),
    );
    const footerHeights = [0, 1, 2].map((index) =>
      Math.round(footers.nth(index).element().getBoundingClientRect().height),
    );
    expect(new Set(cardHeights).size).toBe(1);
    expect(new Set(footerHeights).size).toBe(1);
    expect(cards.nth(0).element().scrollWidth).toBeLessThanOrEqual(
      cards.nth(0).element().clientWidth,
    );
    expect(cards.nth(1).element().scrollWidth).toBeLessThanOrEqual(
      cards.nth(1).element().clientWidth,
    );
    expect(cards.nth(2).element().scrollWidth).toBeLessThanOrEqual(
      cards.nth(2).element().clientWidth,
    );
    await expect
      .element(screen.getByRole("link", { name: "1 reminder" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", { name: "Open note for Moshe Adler" }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "2 reminders" }))
      .toBeInTheDocument();
  });

  it("renders the real per-shadchan shidduchim counts once the count query resolves", async () => {
    // Arrange — one shidduch for shadchan 1, none for shadchan 2.
    useGetListMock.mockReturnValue({
      data: [{ id: 100, shadchan_id: 1, pipeline_state: "new" }],
      isPending: false,
    });

    // Act
    const screen = await renderGrid();

    // Assert
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("Moshe Adler")).toBeInTheDocument();
    await expect.element(screen.getByText("1 shidduch")).toBeInTheDocument();
    await expect.element(screen.getByText("0 shidduchim")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Open Rivka Stern file" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Open Moshe Adler file" }))
      .toBeInTheDocument();
  });
});
