import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot.
import "./entityDescriptor";
import { buildRecordPath } from "../entity360/entityPaths";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import { ShidduchRow } from "./ShidduchRow";
import { rememberTransientSuggestionName } from "./transientSuggestionDisplay";

const buildShidduch = (
  overrides: Partial<ShidduchSummary> = {},
): ShidduchSummary => ({
  id: 42,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
  ...overrides,
});

const renderRow = async (
  overrides: Partial<ShidduchSummary> = {},
  onMove = vi.fn(),
) => {
  const screen = await render(
    <TestMemoryRouter initialEntries={["/shidduchim"]}>
      <ShidduchRow shidduch={buildShidduch(overrides)} onMove={onMove} />
    </TestMemoryRouter>,
  );
  return { screen, onMove };
};

const renderManagedRow = async (
  overrides: Partial<ShidduchSummary> = {},
  canManageLifecycle = true,
) =>
  render(
    <TestMemoryRouter initialEntries={["/shidduchim"]}>
      <CoreAdminContext
        dataProvider={
          {
            archiveShidduch: vi.fn().mockResolvedValue(undefined),
            deleteShidduch: vi.fn().mockResolvedValue({ purgePending: false }),
            getOne: vi
              .fn()
              .mockResolvedValue({ data: buildShidduch(overrides) }),
            getShidduchReadState: vi
              .fn()
              .mockResolvedValue({ inProgress: false }),
            restoreShidduch: vi.fn().mockResolvedValue(undefined),
          } as unknown as CrmDataProvider
        }
        i18nProvider={testI18nProvider}
      >
        <ShidduchRow
          shidduch={buildShidduch(overrides)}
          onMove={vi.fn()}
          canManageLifecycle={canManageLifecycle}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShidduchRow — RecordLink mention, Move as a sibling (AC-12)", () => {
  it("wraps the record mention in an anchor at buildRecordPath('shidduchim', id)", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert
    await expect
      .element(screen.getByRole("link"))
      .toHaveAttribute("href", buildRecordPath("shidduchim", 42));
  });

  it("renders the Move button as a sibling of the anchor, never nested inside it", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert
    const link = screen.getByRole("link").element();
    const moveButton = screen.getByRole("button", { name: /Move/ }).element();
    expect(link.contains(moveButton)).toBe(false);
    expect(moveButton.contains(link)).toBe(false);
  });

  it("calls onMove when the Move button is tapped, without navigating", async () => {
    // Arrange
    let pathname: string | undefined;
    const onMove = vi.fn();
    const screen = await render(
      <TestMemoryRouter
        initialEntries={["/shidduchim"]}
        locationCallback={(location) => (pathname = location.pathname)}
      >
        <ShidduchRow shidduch={buildShidduch()} onMove={onMove} />
      </TestMemoryRouter>,
    );

    // Act
    await screen.getByRole("button", { name: /Move/ }).click();

    // Assert
    expect(onMove).toHaveBeenCalledOnce();
    expect(pathname).toBe("/shidduchim");
  });

  it("renders no state chip — the section is the state", async () => {
    // Arrange / Act
    const { screen } = await renderRow();

    // Assert — no StateChip text ("New") anywhere on the row.
    await expect.element(screen.getByText("New")).not.toBeInTheDocument();
  });

  it("shows a catch chip when catch_count is greater than zero", async () => {
    // Arrange / Act
    const { screen } = await renderRow({ catch_count: 2 });

    // Assert
    await expect
      .element(screen.getByText("Suggested before"))
      .toBeInTheDocument();
  });

  it("shows no catch chip when catch_count is zero", async () => {
    // Arrange / Act
    const { screen } = await renderRow({ catch_count: 0 });

    // Assert
    await expect
      .element(screen.getByText("Suggested before"))
      .not.toBeInTheDocument();
  });

  it("keeps the established single-name fallback when name_en is NULL", async () => {
    const { screen } = await renderRow({
      name_en: null,
      single_first_name_en: "Malka E2E",
    });

    await expect.element(screen.getByText("Malka E2E")).toBeInTheDocument();
  });

  it("uses the transient filename label only after established fallbacks", async () => {
    rememberTransientSuggestionName(43, "resume.pdf");
    const { screen } = await renderRow({ id: 43, name_en: null });

    await expect
      .element(screen.getByText("New suggestion (from resume.pdf)"))
      .toBeInTheDocument();
  });

  it("keeps the previous Unnamed empty-state text when no fallback exists", async () => {
    const { screen } = await renderRow({ name_en: null });

    await expect.element(screen.getByText("Unnamed")).toBeInTheDocument();
  });

  it("hides More for roles that cannot manage lifecycle actions", async () => {
    const screen = await renderManagedRow({}, false);

    await expect
      .element(screen.getByRole("button", { name: /More actions/ }))
      .not.toBeInTheDocument();
  });

  it("shows the shared active-row menu with the exact archive and delete copy", async () => {
    const screen = await renderManagedRow();

    await screen
      .getByRole("button", { name: /More actions for Chaim Cohen/ })
      .click();

    await expect
      .element(screen.getByRole("menuitem", { name: /Archive suggestion/ }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Keeps the file and history"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("menuitem", { name: /Delete suggestion/ }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Removes the file and history"))
      .toBeInTheDocument();
  });

  it("uses the shared delete confirmation and returns focus to More on Cancel", async () => {
    const screen = await renderManagedRow();
    const more = screen.getByRole("button", {
      name: /More actions for Chaim Cohen/,
    });

    await more.click();
    await screen.getByRole("menuitem", { name: "Delete suggestion" }).click();

    await expect.element(screen.getByRole("dialog")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Delete Chaim Cohen?"))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "This also removes its resume files, references links, notes and call history. This cannot be undone after the Undo time.",
        ),
      )
      .toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    await expect
      .poll(
        () => cancel.element().ownerDocument.activeElement === cancel.element(),
      )
      .toBe(true);
    await cancel.click();
    await expect
      .poll(() =>
        more.element().ownerDocument.activeElement?.getAttribute("aria-label"),
      )
      .toBe("More actions for Chaim Cohen");
  });

  it("shows Restore and Delete, without Move or More, for archived rows", async () => {
    const screen = await renderManagedRow({
      archived_at: "2026-11-17T15:00:00.000Z",
    });

    await expect
      .element(screen.getByRole("button", { name: "Restore" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Delete" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Move/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /More actions/ }))
      .not.toBeInTheDocument();
  });
});
