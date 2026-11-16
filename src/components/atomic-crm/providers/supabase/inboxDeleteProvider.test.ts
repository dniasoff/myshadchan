import { beforeEach, describe, expect, it, vi } from "vitest";

const { baseDataProvider, rpc, remove, storageFrom, supabaseClient } =
  vi.hoisted(() => {
    const rpc = vi.fn();
    const remove = vi.fn();
    const storageFrom = vi.fn(() => ({ remove }));
    const supabaseClient = { rpc, storage: { from: storageFrom } };
    const baseDataProvider = {
      getList: vi.fn(),
      getOne: vi.fn(),
      getMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    };
    return { baseDataProvider, rpc, remove, storageFrom, supabaseClient };
  });

vi.mock("ra-supabase-core", () => ({
  supabaseDataProvider: vi.fn(() => baseDataProvider),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => supabaseClient,
}));

import { getDataProviderWithCustomMethods } from "./dataProvider";

const configureSuccessfulDelete = (paths: string[]) => {
  rpc.mockImplementation((name: string) => {
    if (name === "delete_inbox_item")
      return Promise.resolve({ data: 1, error: null });
    if (name === "current_context_id")
      return Promise.resolve({ data: 7, error: null });
    if (name === "claim_inbox_attachment_purge") {
      return Promise.resolve({
        data: paths.map((storage_path, index) => ({
          id: index + 1,
          storage_path,
        })),
        error: null,
      });
    }
    if (name === "ack_inbox_attachment_purge") {
      return Promise.resolve({ data: paths.length, error: null });
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  remove.mockResolvedValue({ data: [], error: null });
};

describe("Supabase Inbox delete provider", () => {
  beforeEach(() => {
    rpc.mockReset();
    remove.mockReset();
    storageFrom.mockClear();
    baseDataProvider.getList.mockReset();
    baseDataProvider.getOne.mockReset();
    baseDataProvider.delete.mockReset();
  });

  it("uses the atomic delete RPC, attachments bucket only, then acks successful paths", async () => {
    configureSuccessfulDelete([
      "7/inbox/41/11111111-1111-4111-8111-111111111111.pdf",
    ]);
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.deleteInboxItem(41)).resolves.toEqual({
      purgePending: false,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "delete_inbox_item",
      "current_context_id",
      "claim_inbox_attachment_purge",
      "ack_inbox_attachment_purge",
    ]);
    expect(storageFrom).toHaveBeenCalledWith("attachments");
    expect(remove).toHaveBeenCalledWith([
      "7/inbox/41/11111111-1111-4111-8111-111111111111.pdf",
    ]);
    expect(rpc).toHaveBeenCalledWith("ack_inbox_attachment_purge", {
      p_paths: ["7/inbox/41/11111111-1111-4111-8111-111111111111.pdf"],
    });
  });

  it("leaves failed paths queued while a later drain can finish them", async () => {
    const paths = [
      "7/inbox/41/22222222-2222-4222-8222-222222222222.pdf",
      "7/inbox/41/33333333-3333-4333-8333-333333333333.pdf",
    ];
    let pendingPaths = [...paths];
    rpc.mockImplementation((name: string, args?: { p_paths?: string[] }) => {
      if (name === "delete_inbox_item") {
        return Promise.resolve({ data: 2, error: null });
      }
      if (name === "current_context_id") {
        return Promise.resolve({ data: 7, error: null });
      }
      if (name === "claim_inbox_attachment_purge") {
        return Promise.resolve({
          data: pendingPaths.map((storage_path, index) => ({
            id: index + 1,
            storage_path,
          })),
          error: null,
        });
      }
      if (name === "ack_inbox_attachment_purge") {
        pendingPaths = pendingPaths.filter(
          (path) => !args?.p_paths?.includes(path),
        );
        return Promise.resolve({
          data: args?.p_paths?.length ?? 0,
          error: null,
        });
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    remove
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "storage down" },
      });
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.deleteInboxItem(41)).resolves.toEqual({
      purgePending: true,
    });
    expect(rpc).toHaveBeenCalledWith("ack_inbox_attachment_purge", {
      p_paths: [paths[0]],
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[1]).toEqual([[paths[1]]]);

    remove.mockResolvedValue({ data: [], error: null });
    await expect(provider.drainInboxAttachmentPurge()).resolves.toEqual({
      purgePending: false,
    });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls[2]).toEqual([[paths[1]]]);
  });

  it("treats a missing object as success and never touches destination buckets", async () => {
    configureSuccessfulDelete(["7/44444444-4444-4444-8444-444444444444.JPG"]);
    remove.mockResolvedValue({
      data: null,
      error: { statusCode: 404, message: "object not found" },
    });
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.deleteInboxItem(41)).resolves.toEqual({
      purgePending: false,
    });
    expect(storageFrom).toHaveBeenCalledTimes(1);
    expect(storageFrom).not.toHaveBeenCalledWith("documents");
    expect(storageFrom).not.toHaveBeenCalledWith("entity-files");
    expect(storageFrom).not.toHaveBeenCalledWith("resume_photos");
  });

  it("does not create a destination copy when the delete RPC has already won", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "delete_inbox_item") {
        return Promise.resolve({
          data: null,
          error: { message: "Inbox item not found" },
        });
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.deleteInboxItem(41)).rejects.toThrow(
      "Could not delete this Inbox item",
    );
    expect(storageFrom).not.toHaveBeenCalled();
    expect(baseDataProvider.create).not.toHaveBeenCalled();
  });

  it("drains only the claim RPC result, preserving paths the server dequeued as shared", async () => {
    configureSuccessfulDelete([
      "7/55555555-5555-4555-8555-555555555555.1234567890",
    ]);
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.drainInboxAttachmentPurge()).resolves.toEqual({
      purgePending: false,
    });
    expect(remove).toHaveBeenCalledWith([
      "7/55555555-5555-4555-8555-555555555555.1234567890",
    ]);
  });
});
