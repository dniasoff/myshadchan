import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, mergeTranslations, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import { englishCrmMessages } from "../../providers/commons/englishCrmMessages";
import { createDataProvider } from "../../providers/fakerest/dataProvider";
import generateData from "../../providers/fakerest/dataGenerator";
import { ENTITY_TARGET_TYPES, type Interaction } from "../../types";
import { NotesTab } from "./NotesTab";

/**
 * Story 3.6's falsifiable claims for the universal Notes tab: empty/loading/
 * error states plus the i18n sentinel (AC 9), the `can_moderate`
 * control-visibility pair (AC 6), the four `targetType` scope payloads and
 * that `actor_member_id` is never sent (AC 6), the cache remedy —
 * `useRefresh()` after every mutation, since the read resource
 * (`interactions_summary`) differs from the write resource (`interactions`)
 * (AC 6) — the soft-deleted-note-absent case proven against the real
 * FakeRest filter (AC 7), and the edit/soft-delete happy paths writing to
 * the `interactions` table (AC 6).
 */

type NoteRow = Interaction & {
  author_name: string | null;
  can_moderate: boolean;
};

let nextId = 1;
const buildNote = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  id: nextId++,
  account_id: 1,
  target_type: "shidduch",
  target_id: 1,
  scope: "shidduch",
  reference_link_id: null,
  actor_member_id: 1,
  kind: "note",
  body: "a note",
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  author_name: "Jane Doe",
  can_moderate: false,
  ...overrides,
});

const renderNotesTab = async (
  props: { targetType?: Interaction["target_type"]; targetId?: number },
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ data: buildNote() }),
    update: vi.fn().mockResolvedValue({ data: buildNote() }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <NotesTab
          targetType={props.targetType ?? "shidduch"}
          targetId={props.targetId ?? 1}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("NotesTab — reads interactions_summary with the note filter (AC 6)", () => {
  it("filters by target_type, target_id, kind and the deleted_at exclusion, sorted newest-first", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderNotesTab({ targetType: "reference", targetId: 7 }, { getList });

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "interactions_summary",
      expect.objectContaining({
        filter: {
          target_type: "reference",
          target_id: 7,
          kind: "note",
          "deleted_at@is": null,
        },
        sort: { field: "created_at", order: "DESC" },
      }),
    );
  });
});

describe("NotesTab — empty, loading and error states (AC 9)", () => {
  it("shows a skeleton placeholder while the query is in flight", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows a translated empty message when there are no notes", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    await expect.element(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab, on a fetch failure", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the notes."))
      .toBeInTheDocument();
  });
});

describe("NotesTab — the i18n sentinel (AC 9)", () => {
  it("renders the registered translation for the empty state, not the hardcoded English fallback", async () => {
    // Arrange — a catalog with crm.entity360.notes.empty overridden to a
    // sentinel, mirroring useTabLabel.test.tsx's round-trip technique: a
    // hardcoded English empty-state string would never see this override.
    const sentinelCatalog = mergeTranslations(
      englishMessages,
      raSupabaseEnglishMessages,
      englishCrmMessages,
      { crm: { entity360: { notes: { empty: "SENTINEL_EMPTY_NOTES" } } } },
    );
    const sentinelI18nProvider = polyglotI18nProvider(
      () => sentinelCatalog,
      "en",
      [{ locale: "en", name: "English" }],
      { allowMissing: true },
    );
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as DataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={sentinelI18nProvider}
        >
          <NotesTab targetType="shidduch" targetId={1} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText("SENTINEL_EMPTY_NOTES"))
      .toBeInTheDocument();
  });
});

describe("NotesTab — can_moderate control visibility (AC 6)", () => {
  it("renders no edit or delete control when can_moderate is false", async () => {
    // Arrange
    const row = buildNote({ can_moderate: false, body: "not moderatable" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    await expect
      .element(screen.getByText("not moderatable"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /edit/i }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /delete/i }))
      .not.toBeInTheDocument();
  });

  it("renders both edit and delete controls when can_moderate is true", async () => {
    // Arrange
    const row = buildNote({ can_moderate: true, body: "moderatable" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: /edit/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /delete/i }))
      .toBeInTheDocument();
  });

  it("falls back to a translated label when author_name is null", async () => {
    // Arrange
    const row = buildNote({ author_name: null, body: "orphaned note" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderNotesTab({}, { getList });

    // Assert
    await expect.element(screen.getByText("Unknown")).toBeInTheDocument();
  });
});

describe("NotesTab — add payload per target type (AC 6)", () => {
  it.each(ENTITY_TARGET_TYPES)(
    "posts the AD-3 scope pair for target type '%s' and never sends actor_member_id",
    async (targetType) => {
      // Arrange
      const create = vi.fn().mockResolvedValue({ data: buildNote() });
      const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

      // Act
      const { screen } = await renderNotesTab(
        { targetType, targetId: 42 },
        { create, getList },
      );
      await screen.getByPlaceholder("Add a note…").fill("a fresh note");
      await screen.getByRole("button", { name: "Add note" }).click();

      // Assert
      expect(create).toHaveBeenCalledTimes(1);
      const [resource, params] = create.mock.calls[0];
      expect(resource).toBe("interactions");
      expect(params.data).toMatchObject({
        target_type: targetType,
        target_id: 42,
        kind: "note",
        body: "a fresh note",
        ...(targetType === "shidduch"
          ? { scope: "shidduch", reference_link_id: null }
          : { scope: "account", reference_link_id: null }),
      });
      expect(params.data).not.toHaveProperty("actor_member_id");
    },
  );

  it("does not submit an empty or whitespace-only note", async () => {
    // Arrange
    const create = vi.fn();
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderNotesTab({}, { create, getList });
    await screen.getByPlaceholder("Add a note…").fill("   ");

    // Assert — the button stays disabled for whitespace-only input, so it
    // is never actionable in the first place.
    await expect
      .element(screen.getByRole("button", { name: "Add note" }))
      .toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("NotesTab — cache: useRefresh() after every mutation (AC 6)", () => {
  it("adds a note and shows its body without remounting the component", async () => {
    // Arrange — interactions_summary (the read resource) never reflects a
    // create() on interactions (the write resource) through ra-core's own
    // per-resource cache; only an explicit refetch (useRefresh) would.
    const newNote = buildNote({ body: "just added", can_moderate: true });
    const getList = vi
      .fn()
      .mockResolvedValueOnce({ data: [], total: 0 })
      .mockResolvedValueOnce({ data: [newNote], total: 1 });
    const create = vi.fn().mockResolvedValue({ data: newNote });

    // Act
    const { screen } = await renderNotesTab({}, { getList, create });
    await expect.element(screen.getByText("No notes yet.")).toBeInTheDocument();
    await screen.getByPlaceholder("Add a note…").fill("just added");
    await screen.getByRole("button", { name: "Add note" }).click();

    // Assert
    await expect.element(screen.getByText("just added")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledTimes(2);
  });

  it("clears the textarea after a successful add", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const create = vi.fn().mockResolvedValue({ data: buildNote() });

    // Act
    const { screen } = await renderNotesTab({}, { getList, create });
    const textarea = screen.getByPlaceholder("Add a note…");
    await textarea.fill("temporary");
    await screen.getByRole("button", { name: "Add note" }).click();

    // Assert
    await expect.element(textarea).toHaveValue("");
  });
});

describe("NotesTab — edit and soft-delete write to the interactions table (AC 6)", () => {
  it("edits a note's body via useUpdate, targeting the interactions table", async () => {
    // Arrange
    const row = buildNote({ can_moderate: true, body: "original body" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });
    const update = vi.fn().mockResolvedValue({ data: row });

    // Act
    const { screen } = await renderNotesTab({}, { getList, update });
    await screen.getByRole("button", { name: /edit/i }).click();
    const editBox = screen.getByRole("textbox").nth(1);
    await editBox.fill("edited body");
    await screen.getByRole("button", { name: "Save" }).click();

    // Assert
    expect(update).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({
        id: row.id,
        data: { body: "edited body" },
      }),
    );
  });

  it("soft-deletes a note by setting deleted_at, targeting the interactions table", async () => {
    // Arrange
    const row = buildNote({ can_moderate: true, body: "to be deleted" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });
    const update = vi.fn().mockResolvedValue({ data: row });

    // Act
    const { screen } = await renderNotesTab({}, { getList, update });
    await screen.getByRole("button", { name: /delete/i }).click();

    // Assert
    expect(update).toHaveBeenCalledTimes(1);
    const [resource, params] = update.mock.calls[0];
    expect(resource).toBe("interactions");
    expect(params.id).toBe(row.id);
    expect(typeof params.data.deleted_at).toBe("string");
    expect(Number.isNaN(Date.parse(params.data.deleted_at))).toBe(false);
  });
});

describe("NotesTab — a soft-deleted note is absent from the list (AC 7)", () => {
  it("excludes a soft-deleted note through the real FakeRest deleted_at@is filter", async () => {
    // Arrange — the real FakeRest data provider, not a mock, so the
    // `deleted_at@is: null` filter genuinely round-trips through
    // transformFilter.ts's `@is` mapping (the same technique
    // ActivityTab.test.tsx's AC 11 case uses).
    const db = generateData();
    db.interactions = [
      buildNote({
        id: 90101,
        target_type: "shidduch",
        target_id: 999,
        body: "still here",
        deleted_at: null,
      }),
      buildNote({
        id: 90102,
        target_type: "shidduch",
        target_id: 999,
        body: "soft deleted",
        deleted_at: "2026-01-01T00:00:00Z",
      }),
      buildNote({
        id: 90103,
        target_type: "shidduch",
        target_id: 999,
        body: "third note remains",
        deleted_at: null,
      }),
    ];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <NotesTab targetType="shidduch" targetId={999} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText("still here", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("third note remains"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("soft deleted"))
      .not.toBeInTheDocument();
  });
});
