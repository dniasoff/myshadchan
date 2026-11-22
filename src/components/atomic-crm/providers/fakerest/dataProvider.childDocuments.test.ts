import { describe, expect, it, vi } from "vitest";

import { createDataProvider } from "./dataProvider";

const PDF = "application/pdf";

function pdf(name: string): File {
  return new File(["paper"], name, { type: PDF });
}

async function getSingle(provider: ReturnType<typeof createDataProvider>) {
  const { data } = await provider.getList("singles", {
    filter: {},
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const single = data[0];
  if (!single) throw new Error("FakeRest fixture has no single");
  return single;
}

describe("FakeRest child document lifecycle", () => {
  it("enforces the child file policy, paper slots, and resume/photo validation", async () => {
    const provider = createDataProvider({ latency: 0, silent: true });
    const single = await getSingle(provider);

    await provider.uploadEntityFile({
      targetType: "single",
      targetId: single.id,
      slot: "paper_1",
      file: pdf("paper-one.pdf"),
    });
    await expect(
      provider.uploadEntityFile({
        targetType: "single",
        targetId: single.id,
        slot: "paper_1",
        file: pdf("paper-again.pdf"),
      }),
    ).rejects.toThrow("That paper slot is already in use.");
    await expect(
      provider.uploadEntityFile({
        targetType: "single",
        targetId: single.id,
        slot: "paper_2",
        file: new File(["paper"], "paper.doc", { type: PDF }),
      }),
    ).rejects.toThrow("file type and extension do not match");
    await expect(
      provider.uploadEntityFile({
        targetType: "single",
        targetId: single.id,
        slot: "paper_2",
        file: new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.pdf", {
          type: PDF,
        }),
      }),
    ).rejects.toThrow("8 MiB");

    await expect(
      provider.uploadResumeFile({
        singleId: single.id,
        file: new File(["resume"], "resume.txt", { type: "text/plain" }),
      }),
    ).rejects.toThrow("Choose a PDF, Word, JPEG, or PNG file.");
    await expect(
      provider.uploadResumePhoto({
        singleId: single.id,
        file: new File(["photo"], "photo.gif", { type: "image/gif" }),
      }),
    ).rejects.toThrow("Choose a PDF, Word, JPEG, or PNG file.");
  });

  it("soft-deletes with an exact token, hides summary rows, and finalizes idempotently", async () => {
    const provider = createDataProvider({ latency: 0, silent: true });
    const single = await getSingle(provider);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    try {
      const file = await provider.uploadEntityFile({
        targetType: "single",
        targetId: single.id,
        slot: "paper_1",
        file: pdf("undo-me.pdf"),
      });
      const deleted = await provider.softDeleteEntityFile({ id: file.id });
      expect(
        (
          await provider.getList("entity_files_summary", {
            filter: {},
            pagination: { page: 1, perPage: 100 },
            sort: { field: "id", order: "ASC" },
          })
        ).data,
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: file.id })]),
      );
      expect(
        (await provider.getOne("entity_files", { id: file.id })).data,
      ).toEqual(
        expect.objectContaining({
          delete_token: deleted.delete_token,
          delete_undo_until: deleted.undo_until,
        }),
      );
      await expect(
        provider.uploadEntityFile({
          targetType: "single",
          targetId: single.id,
          slot: "paper_1",
          file: pdf("while-undoable.pdf"),
        }),
      ).rejects.toThrow("That paper slot is already in use.");
      await expect(
        provider.undoEntityFileDelete({
          id: file.id,
          deleteToken: "wrong-token",
        }),
      ).rejects.toThrow("no longer valid");
      await provider.undoEntityFileDelete({
        id: file.id,
        deleteToken: deleted.delete_token,
      });

      const deletedAgain = await provider.softDeleteEntityFile({ id: file.id });
      await provider.update("entity_files", {
        id: file.id,
        data: { delete_undo_until: new Date(Date.now() - 1).toISOString() },
      });
      await provider.finalizeEntityFileDelete({
        id: file.id,
        deleteToken: deletedAgain.delete_token,
      });
      await expect(
        provider.getOne("entity_files", { id: file.id }),
      ).rejects.toThrow();
      await expect(
        provider.finalizeEntityFileDelete({
          id: file.id,
          deleteToken: deletedAgain.delete_token,
        }),
      ).resolves.toBeUndefined();
      expect(revoke).toHaveBeenCalled();
    } finally {
      revoke.mockRestore();
    }
  });

  it("sweeps expired rows but leaves an Undo-window row untouched", async () => {
    const provider = createDataProvider({ latency: 0, silent: true });
    const single = await getSingle(provider);
    const expired = await provider.uploadEntityFile({
      targetType: "single",
      targetId: single.id,
      slot: "paper_1",
      file: pdf("expired.pdf"),
    });
    const active = await provider.uploadEntityFile({
      targetType: "single",
      targetId: single.id,
      slot: "paper_2",
      file: pdf("active.pdf"),
    });
    const expiredDelete = await provider.softDeleteEntityFile({
      id: expired.id,
    });
    await provider.update("entity_files", {
      id: expired.id,
      data: { delete_undo_until: new Date(Date.now() - 1).toISOString() },
    });
    const count = await provider.finalizeExpiredEntityFileDeletes();
    expect(count).toBe(1);
    await expect(
      provider.getOne("entity_files", { id: expired.id }),
    ).rejects.toThrow();
    expect(
      (await provider.getOne("entity_files", { id: active.id })).data,
    ).toEqual(expect.objectContaining({ deleted_at: null }));
    await expect(
      provider.undoEntityFileDelete({
        id: expired.id,
        deleteToken: expiredDelete.delete_token,
      }),
    ).rejects.toThrow();
  });

  it("uploads the replacement before removing the old paper", async () => {
    const provider = createDataProvider({ latency: 0, silent: true });
    const single = await getSingle(provider);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    try {
      const oldFile = await provider.uploadEntityFile({
        targetType: "single",
        targetId: single.id,
        slot: "paper_1",
        file: pdf("old.pdf"),
      });
      const replacement = await provider.replaceEntityFile({
        oldId: oldFile.id,
        targetType: "single",
        targetId: single.id,
        slot: "paper_1",
        file: pdf("new.pdf"),
      });
      expect(replacement.id).not.toBe(oldFile.id);
      await expect(
        provider.getOne("entity_files", { id: oldFile.id }),
      ).rejects.toThrow();
      expect(revoke).toHaveBeenCalled();

      await expect(
        provider.replaceEntityFile({
          oldId: replacement.id,
          targetType: "single",
          targetId: single.id,
          slot: "paper_1",
          file: new File(["bad"], "bad.txt", { type: "text/plain" }),
        }),
      ).rejects.toThrow();
      expect(
        (await provider.getOne("entity_files", { id: replacement.id })).data,
      ).toEqual(expect.objectContaining({ file_name: "new.pdf" }));
    } finally {
      revoke.mockRestore();
    }
  });
});
