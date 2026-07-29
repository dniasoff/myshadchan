import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import { createDataProvider } from "../../providers/fakerest/dataProvider";
import generateData from "../../providers/fakerest/dataGenerator";
import type { CrmDataProvider } from "../../providers/types";
import type {
  EntityFile,
  EntityFileSummary,
  EntityTargetType,
} from "../../types";
import { FilesTab } from "./FilesTab";

/**
 * Story 3.7's falsifiable claims for the universal Files tab: loading/empty/
 * error states with the upload control staying reachable (AC 6f), the
 * upload happy path and its failure notification (AC 6b), replace as
 * delete-then-upload carrying the previous row's visibility forward
 * (AC 6c), delete (AC 6d), per-click signed-URL minting (AC 5a), and the
 * visibility control rendering only for shidduch/single targets (AC 6e).
 */

let nextId = 1;
const buildFileRow = (
  overrides: Partial<EntityFileSummary> = {},
): EntityFileSummary => ({
  id: nextId++,
  account_id: 1,
  target_type: "shidduch",
  target_id: 1,
  storage_path: "1/shidduch/1/abc.pdf",
  file_name: "resume.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  visibility: "shared",
  uploaded_by_member_id: 7,
  created_at: "2026-01-01T00:00:00Z",
  uploaded_by_name: "Jane Doe",
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    update: vi.fn().mockResolvedValue({ data: buildFileRow() }),
    uploadEntityFile: vi.fn().mockResolvedValue(buildFileRow()),
    signEntityFileUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
    deleteEntityFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderFilesTab = async (
  props: { targetType?: EntityTargetType; targetId?: number },
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <FilesTab
          targetType={props.targetType ?? "shidduch"}
          targetId={props.targetId ?? 1}
        />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("FilesTab — loading, empty and error states (AC 6f)", () => {
  it("shows a skeleton placeholder while the query is in flight, with no empty-state copy", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderFilesTab({}, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect
      .element(screen.getByText("No files yet."))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when there are no files, and keeps the upload control usable", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderFilesTab({}, { getList });

    // Assert
    await expect.element(screen.getByText("No files yet.")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Upload a file" }))
      .toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab, and keeps the upload control usable", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderFilesTab({}, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the files."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Upload a file" }))
      .toBeInTheDocument();
  });

  it("renders each row's file name, mime type, formatted size and uploader", async () => {
    // Arrange
    const rows = [
      buildFileRow({
        id: 1,
        file_name: "resume.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        uploaded_by_name: "Jane Doe",
      }),
      buildFileRow({
        id: 2,
        file_name: "photo.png",
        mime_type: "image/png",
        size_bytes: 500_000,
        uploaded_by_name: "John Roe",
      }),
    ];
    const getList = vi.fn().mockResolvedValue({ data: rows, total: 2 });

    // Act
    const { screen } = await renderFilesTab({}, { getList });

    // Assert
    await expect.element(screen.getByText("resume.pdf")).toBeInTheDocument();
    await expect.element(screen.getByText("photo.png")).toBeInTheDocument();
    await expect.element(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    await expect.element(screen.getByText(/488\.3 KB/)).toBeInTheDocument();
    await expect.element(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    await expect.element(screen.getByText(/John Roe/)).toBeInTheDocument();
  });
});

describe("FilesTab — upload (AC 6b)", () => {
  it("uploads the selected file for the given target", async () => {
    // Arrange
    const uploadEntityFile = vi.fn().mockResolvedValue(buildFileRow());
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const file = new File(["hello"], "note.txt", { type: "text/plain" });

    // Act
    const { screen } = await renderFilesTab(
      { targetType: "reference", targetId: 42 },
      { uploadEntityFile, getList },
    );
    await screen.getByLabelText("Upload a file").upload(file);

    // Assert
    await expect.poll(() => uploadEntityFile.mock.calls.length).toBe(1);
    expect(uploadEntityFile).toHaveBeenCalledWith({
      targetType: "reference",
      targetId: 42,
      file,
    });
  });

  it("shows a translated error and stays usable when the upload rejects", async () => {
    // Arrange — the internal "no object without a row" cleanup on a failing
    // create lives in providers/supabase/entityFiles.test.ts; here the tab
    // only needs to react to uploadEntityFile rejecting.
    const uploadEntityFile = vi.fn().mockRejectedValue(new Error("boom"));
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const file = new File(["hello"], "note.txt", { type: "text/plain" });

    // Act
    const { screen } = await renderFilesTab({}, { uploadEntityFile, getList });
    await screen.getByLabelText("Upload a file").upload(file);

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Upload a file" }))
      .toBeInTheDocument();
  });
});

describe("FilesTab — replace (AC 6c)", () => {
  it("deletes the old file then uploads the replacement, carrying forward its visibility", async () => {
    // Arrange
    const existing = buildFileRow({
      id: 501,
      file_name: "old.pdf",
      storage_path: "1/shidduch/1/old.pdf",
      visibility: "private_parent",
    });
    const getList = vi.fn().mockResolvedValue({ data: [existing], total: 1 });
    const calls: string[] = [];
    const deleteEntityFile = vi.fn().mockImplementation(async () => {
      calls.push("delete");
    });
    const uploadEntityFile = vi.fn().mockImplementation(async () => {
      calls.push("upload");
      return buildFileRow();
    });
    const newFile = new File(["v2"], "new.pdf", { type: "application/pdf" });

    // Act
    const { screen } = await renderFilesTab(
      {},
      { getList, deleteEntityFile, uploadEntityFile },
    );
    await screen.getByLabelText("Replace").upload(newFile);

    // Assert
    await expect.poll(() => uploadEntityFile.mock.calls.length).toBe(1);
    expect(deleteEntityFile).toHaveBeenCalledWith({
      id: 501,
      storagePath: "1/shidduch/1/old.pdf",
    });
    expect(uploadEntityFile).toHaveBeenCalledWith({
      targetType: "shidduch",
      targetId: 1,
      file: newFile,
      visibility: "private_parent",
    });
    // The delete must complete before the upload starts.
    expect(calls).toEqual(["delete", "upload"]);
  });
});

describe("FilesTab — delete (AC 6d)", () => {
  it("deletes the file by id and storage path", async () => {
    // Arrange
    const row = buildFileRow({ id: 77, storage_path: "1/shidduch/1/x.pdf" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });
    const deleteEntityFile = vi.fn().mockResolvedValue(undefined);

    // Act
    const { screen } = await renderFilesTab({}, { getList, deleteEntityFile });
    await screen.getByRole("button", { name: "Delete" }).click();

    // Assert
    expect(deleteEntityFile).toHaveBeenCalledExactlyOnceWith({
      id: 77,
      storagePath: "1/shidduch/1/x.pdf",
    });
  });
});

describe("FilesTab — signed URL minted per click, never cached (AC 5a)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls signEntityFileUrl again on a second click of the same row", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    const row = buildFileRow({ id: 9, storage_path: "1/shidduch/1/y.pdf" });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });
    const signEntityFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/y");

    // Act
    const { screen } = await renderFilesTab({}, { getList, signEntityFileUrl });
    const downloadButton = screen.getByRole("button", { name: "Download" });
    await downloadButton.click();
    await downloadButton.click();

    // Assert — an implementation that caches the URL in component state
    // fails this: it would call signEntityFileUrl once and reuse the value.
    await expect.poll(() => signEntityFileUrl.mock.calls.length).toBe(2);
    expect(signEntityFileUrl).toHaveBeenCalledWith({
      storagePath: "1/shidduch/1/y.pdf",
      fileName: row.file_name,
    });
  });
});

describe("FilesTab — visibility control only for shidduch/single targets (AC 6e)", () => {
  it.each(["shidduch", "single"] as const)(
    "renders the visibility combobox for a %s target",
    async (targetType) => {
      // Arrange
      const row = buildFileRow({ target_type: targetType });
      const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

      // Act
      const { screen } = await renderFilesTab({ targetType }, { getList });

      // Assert
      await expect
        .element(screen.getByRole("combobox", { name: /visibility/i }))
        .toBeInTheDocument();
    },
  );

  it.each(["shadchan", "reference"] as const)(
    "does not render the visibility combobox for a %s target",
    async (targetType) => {
      // Arrange
      const row = buildFileRow({ target_type: targetType });
      const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

      // Act
      const { screen } = await renderFilesTab({ targetType }, { getList });

      // Assert — the row must actually be on screen first (review fix,
      // F3): without this, the negative assertion below would resolve
      // while the tab is still in its loading skeleton, before the
      // mocked getList's promise settles, and would pass regardless of
      // whether the gate under test works at all. `await
      // expect.element(...).not.toBeInTheDocument()` is satisfied on
      // first check, so a query that never waits for the row to mount
      // can never observe the gate it claims to guard.
      await expect.element(screen.getByText(row.file_name)).toBeInTheDocument();
      await expect
        .element(screen.getByRole("combobox", { name: /visibility/i }))
        .not.toBeInTheDocument();
    },
  );

  it('writes only the visibility column through dataProvider.update("entity_files", ...)', async () => {
    // Arrange
    const row = buildFileRow({
      id: 55,
      target_type: "shidduch",
      visibility: "shared",
    });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });
    const update = vi.fn().mockResolvedValue({ data: row });

    // Act
    const { screen } = await renderFilesTab(
      { targetType: "shidduch" },
      { getList, update },
    );
    await screen.getByRole("combobox", { name: /visibility/i }).click();
    await screen.getByRole("option", { name: "Parents only" }).click();

    // Assert
    expect(update).toHaveBeenCalledExactlyOnceWith(
      "entity_files",
      expect.objectContaining({
        id: 55,
        data: { visibility: "private_parent" },
      }),
    );
  });
});

describe("FilesTab — real FakeRest round trip (AD-10 mirror)", () => {
  it("uploads through the real FakeRest provider and the file appears in the list", async () => {
    // Arrange — the real FakeRest data provider, not a mock, so
    // uploadEntityFile / entity_files_summary genuinely round-trip through
    // providers/fakerest/internal/entityFiles.ts (the same technique
    // NotesTab.test.tsx's AC 7 soft-delete case uses).
    const db = generateData();
    db.entity_files = [] as EntityFile[];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });
    const file = new File(["contents"], "attachment.pdf", {
      type: "application/pdf",
    });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <FilesTab targetType="reference" targetId={12345} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
    await expect.element(screen.getByText("No files yet.")).toBeInTheDocument();

    await screen.getByLabelText("Upload a file").upload(file);

    // Assert
    await expect
      .element(screen.getByText("attachment.pdf"))
      .toBeInTheDocument();
    const { data: persisted } = await dataProvider.getList("entity_files", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].target_type).toBe("reference");
    expect(persisted[0].target_id).toBe(12345);
  });
});
