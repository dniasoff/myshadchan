import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataProvider } from "ra-core";

import type { Resume, ResumePhoto } from "../../types";
import { buildResumeStorageCleanupCallbacks } from "./resumeStorageCleanup";

/**
 * Mocks the Supabase client entirely (the `entityFiles.test.ts` idiom), so
 * `buildResumeStorageCleanupCallbacks` can be exercised without a real
 * backend — `removeResumeFileObjects`/`removeResumePhotoObjects` both
 * resolve through this one mocked `.storage.from(...).remove(...)` call.
 */
const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: { from: () => ({ remove }) },
  }),
}));

/**
 * AC-11, AC-12 (Story 9.5): deleting a `singles` row (and separately a
 * `shidduchim` row) with a resume carrying multiple `files[]` versions and
 * one `resume_photos` row calls `.storage.from("documents").remove([...])`
 * with every one of those paths; the parent row's delete still resolves
 * when the mocked `.remove()` call rejects (AC-12) — no exception
 * propagates out of the `beforeDelete` hook.
 */
describe("buildResumeStorageCleanupCallbacks (AC-11, AC-12)", () => {
  beforeEach(() => {
    remove.mockReset();
    remove.mockResolvedValue({ error: null });
  });

  it("returns exactly one callback each for singles and shidduchim — the only two resources that can ever orphan a resume", () => {
    // Act
    const callbacks = buildResumeStorageCleanupCallbacks();

    // Assert
    expect(callbacks.map((callback) => callback.resource).sort()).toEqual([
      "shidduchim",
      "singles",
    ]);
  });

  it("removes every resume file version AND every photo path when deleting a singles row (AC-11)", async () => {
    // Arrange
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }

    const resume: Resume = {
      id: 1,
      account_id: 1,
      single_id: 42,
      created_at: "2026-01-01T00:00:00Z",
      files: [
        {
          path: "1/resumes/single-42/a.pdf",
          filename: "a.pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          mime_type: "application/pdf",
          size: 100,
        },
        {
          path: "1/resumes/single-42/b.pdf",
          filename: "b.pdf",
          uploaded_at: "2026-01-02T00:00:00Z",
          uploaded_by: null,
          mime_type: "application/pdf",
          size: 200,
        },
      ],
    };
    const photo: ResumePhoto = {
      id: 9,
      account_id: 1,
      resume_id: 1,
      path: "1/photos/shared/single-42/p.jpg",
      uploaded_at: "2026-01-01T00:00:00Z",
      visibility: "shared",
    };

    const getList = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: [resume], total: 1 }))
      .mockImplementationOnce(async () => ({ data: [photo], total: 1 }));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act
    const result = await (
      singlesCallback.beforeDelete as (
        params: { id: number },
        dataProvider: DataProvider,
      ) => Promise<{ id: number }>
    )({ id: 42 }, stubDataProvider);

    // Assert
    expect(getList).toHaveBeenNthCalledWith(
      1,
      "resumes",
      expect.objectContaining({ filter: { single_id: 42 } }),
    );
    expect(getList).toHaveBeenNthCalledWith(
      2,
      "resume_photos",
      expect.objectContaining({ filter: { resume_id: 1 } }),
    );
    expect(remove).toHaveBeenNthCalledWith(1, [
      "1/resumes/single-42/a.pdf",
      "1/resumes/single-42/b.pdf",
    ]);
    expect(remove).toHaveBeenNthCalledWith(2, [
      "1/photos/shared/single-42/p.jpg",
    ]);
    expect(result).toEqual({ id: 42 });
  });

  it("removes every resume file version when deleting a shidduchim row (AC-11)", async () => {
    // Arrange
    const callbacks = buildResumeStorageCleanupCallbacks();
    const shidduchimCallback = callbacks.find(
      (callback) => callback.resource === "shidduchim",
    );
    if (!shidduchimCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for shidduchim");
    }

    const resume: Resume = {
      id: 5,
      account_id: 1,
      shidduchim_id: 7,
      created_at: "2026-01-01T00:00:00Z",
      files: [
        {
          path: "1/resumes/7/only.pdf",
          filename: "only.pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          mime_type: "application/pdf",
          size: 50,
        },
      ],
    };

    const getList = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: [resume], total: 1 }))
      .mockImplementationOnce(async () => ({ data: [], total: 0 }));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act
    await (
      shidduchimCallback.beforeDelete as (
        params: { id: number },
        dataProvider: DataProvider,
      ) => Promise<{ id: number }>
    )({ id: 7 }, stubDataProvider);

    // Assert
    expect(getList).toHaveBeenNthCalledWith(
      1,
      "resumes",
      expect.objectContaining({ filter: { shidduchim_id: 7 } }),
    );
    expect(remove).toHaveBeenNthCalledWith(1, ["1/resumes/7/only.pdf"]);
  });

  it("calls the storage API neither time when the target owned no resume at all", async () => {
    // Arrange
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act
    await (
      singlesCallback.beforeDelete as (
        params: { id: number },
        dataProvider: DataProvider,
      ) => Promise<{ id: number }>
    )({ id: 99 }, stubDataProvider);

    // Assert — no resume row means no resume_photos lookup either, and
    // .remove() is never reached.
    expect(getList).toHaveBeenCalledExactlyOnceWith(
      "resumes",
      expect.objectContaining({ filter: { single_id: 99 } }),
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not call the storage API for the photo half when the resume has none", async () => {
    // Arrange
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }
    const resume: Resume = {
      id: 2,
      account_id: 1,
      single_id: 3,
      created_at: "2026-01-01T00:00:00Z",
      files: [],
    };
    const getList = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: [resume], total: 1 }))
      .mockImplementationOnce(async () => ({ data: [], total: 0 }));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act
    await (
      singlesCallback.beforeDelete as (
        params: { id: number },
        dataProvider: DataProvider,
      ) => Promise<{ id: number }>
    )({ id: 3 }, stubDataProvider);

    // Assert — an empty files[] array is a no-op removal (removeResumeFile
    // Objects's own empty-array guard), so .remove() is called exactly once
    // (for the photo lookup's own empty result, also a no-op).
    expect(remove).not.toHaveBeenCalled();
  });

  it("the parent row's delete still resolves when the mocked .remove() call rejects (AC-12) — no exception propagates", async () => {
    // Arrange
    remove.mockRejectedValue(new Error("storage down"));
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }
    const resume: Resume = {
      id: 1,
      account_id: 1,
      single_id: 1,
      created_at: "2026-01-01T00:00:00Z",
      files: [
        {
          path: "1/resumes/1/a.pdf",
          filename: "a.pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          mime_type: "application/pdf",
          size: 1,
        },
      ],
    };
    const getList = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: [resume], total: 1 }))
      .mockImplementationOnce(async () => ({ data: [], total: 0 }));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act / Assert
    await expect(
      (
        singlesCallback.beforeDelete as (
          params: { id: number },
          dataProvider: DataProvider,
        ) => Promise<{ id: number }>
      )({ id: 1 }, stubDataProvider),
    ).resolves.toEqual({ id: 1 });
  });

  it("review fix F9: the parent row's delete still resolves when dataProvider.getList itself rejects — no exception propagates", async () => {
    // Arrange — a transient PostgREST/network failure on the FIRST
    // getList("resumes", ...) call, before .remove() is ever reached. Prior
    // to the F9 fix this threw straight out of beforeDelete, which would
    // have made the singles/shidduchim delete itself fail — the opposite
    // of AC-12's "never blocks the delete".
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }
    const getList = vi.fn().mockRejectedValue(new Error("PostgREST down"));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act / Assert
    await expect(
      (
        singlesCallback.beforeDelete as (
          params: { id: number },
          dataProvider: DataProvider,
        ) => Promise<{ id: number }>
      )({ id: 1 }, stubDataProvider),
    ).resolves.toEqual({ id: 1 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("review fix F9: the parent row's delete still resolves when the SECOND getList (resume_photos) rejects", async () => {
    // Arrange — the resumes lookup succeeds and finds a resume with a file,
    // but the follow-up resume_photos lookup rejects. The resume file's own
    // removal must still have been attempted (it doesn't depend on the
    // photo lookup), and the overall hook must still resolve.
    const callbacks = buildResumeStorageCleanupCallbacks();
    const singlesCallback = callbacks.find(
      (callback) => callback.resource === "singles",
    );
    if (!singlesCallback?.beforeDelete) {
      throw new Error("expected a beforeDelete callback for singles");
    }
    const resume: Resume = {
      id: 1,
      account_id: 1,
      single_id: 1,
      created_at: "2026-01-01T00:00:00Z",
      files: [
        {
          path: "1/resumes/1/a.pdf",
          filename: "a.pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          mime_type: "application/pdf",
          size: 1,
        },
      ],
    };
    const getList = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: [resume], total: 1 }))
      .mockRejectedValueOnce(new Error("PostgREST down"));
    const stubDataProvider = { getList } as unknown as DataProvider;

    // Act / Assert
    await expect(
      (
        singlesCallback.beforeDelete as (
          params: { id: number },
          dataProvider: DataProvider,
        ) => Promise<{ id: number }>
      )({ id: 1 }, stubDataProvider),
    ).resolves.toEqual({ id: 1 });
    expect(remove).toHaveBeenCalledExactlyOnceWith(["1/resumes/1/a.pdf"]);
  });
});
