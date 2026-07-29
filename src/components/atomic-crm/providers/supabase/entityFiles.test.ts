import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataProvider } from "ra-core";

import type { EntityFile } from "../../types";

/**
 * Mocks the Supabase client entirely (the `authProvider.test.ts` idiom) so
 * `uploadEntityFile` / `signEntityFileUrl` / `deleteEntityFile` /
 * `removeEntityFileObjects` can be exercised without a real backend.
 * `vi.hoisted` is required (not a plain module-scope `const`) because
 * `vi.mock`'s factory itself is hoisted above every import/declaration.
 */
const { upload, remove, createSignedUrl, rpc } = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: () => ({ upload, remove, createSignedUrl }),
    },
    rpc,
  }),
}));

import {
  deleteEntityFile,
  ENTITY_FILE_URL_TTL_SECONDS,
  removeEntityFileObjects,
  signEntityFileUrl,
  uploadEntityFile,
} from "./entityFiles";

const buildFile = (name = "resume.pdf"): File =>
  new File(["contents"], name, { type: "application/pdf" });

describe("uploadEntityFile (AC 4)", () => {
  beforeEach(() => {
    upload.mockReset();
    remove.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 7, error: null });
    upload.mockResolvedValue({ error: null });
  });

  it("resolves the key from current_context_id, never from client state, then uploads the bytes", async () => {
    // Arrange
    const create = vi
      .fn()
      .mockResolvedValue({ data: { id: 1 } as unknown as EntityFile });
    const baseDataProvider = { create } as unknown as DataProvider;
    const file = buildFile();

    // Act
    await uploadEntityFile(baseDataProvider, {
      targetType: "shidduch",
      targetId: 42,
      file,
    });

    // Assert
    expect(rpc).toHaveBeenCalledExactlyOnceWith("current_context_id");
    expect(upload).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^7\/shidduch\/42\/[0-9a-f-]+\.pdf$/),
      file,
    );
  });

  it("sends only target_type, target_id, storage_path, file_name, mime_type, size_bytes and visibility — never account_id or uploaded_by_member_id", async () => {
    // Arrange — both are trigger-assigned server-side; sending them from the
    // client would be a failing assertion.
    const create = vi
      .fn()
      .mockResolvedValue({ data: { id: 1 } as unknown as EntityFile });
    const baseDataProvider = { create } as unknown as DataProvider;
    const file = buildFile();

    // Act
    await uploadEntityFile(baseDataProvider, {
      targetType: "reference",
      targetId: 5,
      file,
      visibility: "private_parent",
    });

    // Assert
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "entity_files",
      expect.objectContaining({
        data: expect.objectContaining({
          target_type: "reference",
          target_id: 5,
          file_name: "resume.pdf",
          mime_type: "application/pdf",
          size_bytes: file.size,
          visibility: "private_parent",
        }),
      }),
    );
    const [, params] = create.mock.calls[0];
    expect(params.data.account_id).toBeUndefined();
    expect(params.data.uploaded_by_member_id).toBeUndefined();
  });

  it("omits visibility entirely when the caller does not pass one, letting the column default apply", async () => {
    // Arrange
    const create = vi
      .fn()
      .mockResolvedValue({ data: { id: 1 } as unknown as EntityFile });
    const baseDataProvider = { create } as unknown as DataProvider;

    // Act
    await uploadEntityFile(baseDataProvider, {
      targetType: "shadchan",
      targetId: 1,
      file: buildFile(),
    });

    // Assert
    const [, params] = create.mock.calls[0];
    expect(params.data.visibility).toBeUndefined();
  });

  it("removes the uploaded object and rethrows when the row create fails — no object without a row", async () => {
    // Arrange
    const createError = new Error("insert rejected");
    const create = vi.fn().mockRejectedValue(createError);
    const baseDataProvider = { create } as unknown as DataProvider;
    remove.mockResolvedValue({ error: null });

    // Act / Assert
    await expect(
      uploadEntityFile(baseDataProvider, {
        targetType: "shidduch",
        targetId: 42,
        file: buildFile(),
      }),
    ).rejects.toThrow("insert rejected");

    expect(remove).toHaveBeenCalledExactlyOnceWith([
      expect.stringMatching(/^7\/shidduch\/42\/[0-9a-f-]+\.pdf$/),
    ]);
    // The exact key removed is the exact key just uploaded.
    const uploadedKey = upload.mock.calls[0][0];
    const removedKeys = remove.mock.calls[0][0];
    expect(removedKeys).toEqual([uploadedKey]);
  });

  it("still rethrows the original create error even when the cleanup removal itself fails", async () => {
    // Arrange — a removal failure must never mask the create failure the
    // caller actually needs to see.
    const create = vi.fn().mockRejectedValue(new Error("insert rejected"));
    const baseDataProvider = { create } as unknown as DataProvider;
    remove.mockRejectedValue(new Error("storage down"));

    // Act / Assert
    await expect(
      uploadEntityFile(baseDataProvider, {
        targetType: "shidduch",
        targetId: 1,
        file: buildFile(),
      }),
    ).rejects.toThrow("insert rejected");
  });

  it("throws when the upload itself fails, and never attempts a create", async () => {
    // Arrange
    upload.mockResolvedValue({ error: { message: "network down" } });
    const create = vi.fn();
    const baseDataProvider = { create } as unknown as DataProvider;

    // Act / Assert
    await expect(
      uploadEntityFile(baseDataProvider, {
        targetType: "shidduch",
        targetId: 1,
        file: buildFile(),
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("signEntityFileUrl (AC 5)", () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
  });

  it("mints a signed URL with the 60-second TTL and the download filename, never persisting it", async () => {
    // Arrange
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/a" },
      error: null,
    });

    // Act
    const url = await signEntityFileUrl({
      storagePath: "1/shidduch/1/x.pdf",
      fileName: "resume.pdf",
    });

    // Assert
    expect(url).toBe("https://signed.example/a");
    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith(
      "1/shidduch/1/x.pdf",
      ENTITY_FILE_URL_TTL_SECONDS,
      { download: "resume.pdf" },
    );
    expect(ENTITY_FILE_URL_TTL_SECONDS).toBe(60);
  });

  it("calls signing again on a second, independent call — nothing is cached inside this module", async () => {
    // Arrange
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/a" },
      error: null,
    });

    // Act
    await signEntityFileUrl({ storagePath: "p", fileName: "f.pdf" });
    await signEntityFileUrl({ storagePath: "p", fileName: "f.pdf" });

    // Assert
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("throws on a signing error, the same idiom as dataProvider.ts's uploadToBucket", async () => {
    // Arrange
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "denied" },
    });

    // Act / Assert
    await expect(
      signEntityFileUrl({ storagePath: "p", fileName: "f.pdf" }),
    ).rejects.toThrow();
  });
});

describe("deleteEntityFile — the row deletion is authoritative (AC 4)", () => {
  beforeEach(() => {
    remove.mockReset();
  });

  it("deletes the row first, then removes the storage object", async () => {
    // Arrange
    const callOrder: string[] = [];
    const deleteFn = vi.fn().mockImplementation(async () => {
      callOrder.push("row");
      return { data: { id: 1 } };
    });
    remove.mockImplementation(async () => {
      callOrder.push("object");
      return { error: null };
    });
    const baseDataProvider = { delete: deleteFn } as unknown as DataProvider;

    // Act
    await deleteEntityFile(baseDataProvider, {
      id: 9,
      storagePath: "1/shidduch/1/x.pdf",
    });

    // Assert
    expect(deleteFn).toHaveBeenCalledExactlyOnceWith("entity_files", {
      id: 9,
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith(["1/shidduch/1/x.pdf"]);
    expect(callOrder).toEqual(["row", "object"]);
  });

  it("does not throw when the storage removal fails — logged, not surfaced, by design", async () => {
    // Arrange — deliberate asymmetry: the row's absence is what every other
    // surface reads, so a storage-side failure must not turn into a failed
    // delete a user could "fix" by retrying (which would then fail on the
    // already-deleted row).
    const deleteFn = vi.fn().mockResolvedValue({ data: { id: 1 } });
    remove.mockResolvedValue({ error: { message: "storage down" } });
    const baseDataProvider = { delete: deleteFn } as unknown as DataProvider;

    // Act / Assert
    await expect(
      deleteEntityFile(baseDataProvider, {
        id: 9,
        storagePath: "1/shidduch/1/x.pdf",
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates a row-deletion failure — the row is authoritative", async () => {
    // Arrange
    const deleteFn = vi.fn().mockRejectedValue(new Error("row gone already"));
    const baseDataProvider = { delete: deleteFn } as unknown as DataProvider;

    // Act / Assert
    await expect(
      deleteEntityFile(baseDataProvider, { id: 9, storagePath: "p" }),
    ).rejects.toThrow("row gone already");
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("removeEntityFileObjects (AC 7b)", () => {
  beforeEach(() => {
    remove.mockReset();
  });

  it("removes every path given in one call", async () => {
    // Arrange
    remove.mockResolvedValue({ error: null });

    // Act
    await removeEntityFileObjects(["a/b/c.pdf", "a/b/d.pdf"]);

    // Assert
    expect(remove).toHaveBeenCalledExactlyOnceWith(["a/b/c.pdf", "a/b/d.pdf"]);
  });

  it("does not call the storage API at all for an empty list", async () => {
    // Act
    await removeEntityFileObjects([]);

    // Assert
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not throw when the removal fails — a parent delete must not be blocked by storage cleanup", async () => {
    // Arrange
    remove.mockResolvedValue({ error: { message: "storage down" } });

    // Act / Assert
    await expect(
      removeEntityFileObjects(["a/b/c.pdf"]),
    ).resolves.toBeUndefined();
  });
});
