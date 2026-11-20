import { beforeEach, describe, expect, it, vi } from "vitest";

const { baseDataProvider, rpc, supabaseClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  const supabaseClient = { rpc };
  const baseDataProvider = {};
  return { baseDataProvider, rpc, supabaseClient };
});

vi.mock("ra-supabase-core", () => ({
  supabaseDataProvider: vi.fn(() => baseDataProvider),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => supabaseClient,
}));

import { getDataProviderWithCustomMethods } from "./dataProvider";

describe("Supabase shidduch undo provider", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the server undo RPC with only the suggestion id", async () => {
    const row = { id: 42, pipeline_state: "new" };
    rpc.mockResolvedValue({ data: [row], error: null });
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.undoShidduch(42)).resolves.toEqual(row);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("undo_shidduch", {
      p_id: 42,
    });
  });

  it("surfaces the server denial instead of pretending the move was undone", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "undo is not available for shidduch 42" },
    });
    const provider = getDataProviderWithCustomMethods();

    await expect(provider.undoShidduch(42)).rejects.toThrow(
      "undo is not available for shidduch 42",
    );
  });
});
