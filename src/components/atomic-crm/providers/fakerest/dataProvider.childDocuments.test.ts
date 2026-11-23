import { describe, expect, it, vi } from "vitest";

import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";

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

    await expect(
      provider.uploadEntityFile({
        targetType: "single",
        targetId: "missing-single",
        slot: "paper_1",
        file: pdf("missing.pdf"),
      }),
    ).rejects.toThrow("entity file single target is missing");
    await expect(
      provider.uploadResumeFile({
        singleId: "missing-single",
        file: pdf("missing-resume.pdf"),
      }),
    ).rejects.toThrow("single resume target is missing");
    await expect(
      provider.uploadResumePhoto({
        singleId: "missing-single",
        file: new File(["photo"], "missing.jpg", { type: "image/jpeg" }),
      }),
    ).rejects.toThrow("single photo target is missing");

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
    ).rejects.toThrow(
      "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.",
    );
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
    ).rejects.toThrow(
      "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.",
    );
    await expect(
      provider.uploadResumePhoto({
        singleId: single.id,
        file: new File(["photo"], "photo.gif", { type: "image/gif" }),
      }),
    ).rejects.toThrow(
      "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.",
    );
  });

  it("does not create a duplicate photo when the source attachment is promoted again", async () => {
    const provider = createDataProvider({ latency: 0, silent: true });
    const single = await getSingle(provider);
    const params = {
      singleId: single.id,
      sourceAttachmentPath: "1/inbox/900/photo.jpg",
      file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
      visibility: "shared" as const,
    };

    const first = await provider.uploadResumePhoto(params);
    const second = await provider.uploadResumePhoto(params);

    expect(second).toEqual(first);
    const { data: photos } = await provider.getList("resume_photos", {
      filter: { path: first.path },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(photos).toHaveLength(1);
  });

  it("rejects direct entity_files creates for missing and foreign singles", async () => {
    const db = generateData();
    db.singles.push({
      ...db.singles[0]!,
      id: 99,
      account_id: 2,
      first_name_en: "Foreign",
      last_name_en: "Single",
    });
    const provider = createDataProvider({ db, latency: 0, silent: true });
    const row = (targetId: number | string) => ({
      account_id: 1,
      target_type: "single" as const,
      target_id: targetId,
      storage_path: `1/single/${targetId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`,
      file_name: "direct.pdf",
      mime_type: PDF,
      size_bytes: 10,
      visibility: "private_parent" as const,
      uploaded_by_member_id: 1,
      slot: "paper_1" as const,
    });

    await expect(
      provider.create("entity_files", {
        data: row("missing-single"),
      }),
    ).rejects.toThrow("entity file single target is missing");
    await expect(
      provider.create("entity_files", { data: row(99) }),
    ).rejects.toThrow("entity file single target is missing");
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
        provider.getOne("entity_files_summary", { id: file.id }),
      ).rejects.toThrow("Entity file not found");
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
      const current = (await provider.getOne("entity_files", { id: file.id }))
        .data;
      await provider.update("entity_files", {
        id: file.id,
        previousData: current,
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
    const expiredRow = (
      await provider.getOne("entity_files", { id: expired.id })
    ).data;
    await provider.update("entity_files", {
      id: expired.id,
      previousData: expiredRow,
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

      await provider.softDeleteEntityFile({ id: replacement.id });
      await expect(
        provider.replaceEntityFile({
          oldId: replacement.id,
          targetType: "single",
          targetId: single.id,
          slot: "paper_1",
          file: pdf("while-undoable.pdf"),
        }),
      ).rejects.toThrow("The file is already being deleted.");
    } finally {
      revoke.mockRestore();
    }
  });
});
