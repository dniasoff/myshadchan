import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSupabaseClient = vi.hoisted(() => vi.fn());
const mockGetAnonSupabaseClient = vi.hoisted(() => vi.fn());

vi.mock("../providers/supabase/supabase", () => ({
  getSupabaseClient: mockGetSupabaseClient,
  getAnonSupabaseClient: mockGetAnonSupabaseClient,
}));

import {
  DemoPreviewDeniedError,
  loadDemoPreviewListings,
} from "./demoListingsClient";

const listing = {
  id: 7,
  created_at: "2026-08-23T00:00:00.000Z",
  listing_type: "shadchan" as const,
  shadchan_name: "Leah Feldman",
  shadchan_area: "Lakewood, NJ",
  shadchan_contact_info: "Contact through the Feldman office",
  single_first_name_en: null,
  single_first_name_he: null,
  single_age: null,
  single_height: null,
  single_community: null,
  single_location: null,
  single_summary: null,
};

const buildClient = ({
  session = { user: { id: "customer-1" } },
  isDemo = true,
  projection = [{ account_id: 1 }],
  rows = [listing],
}: {
  session?: { user: { id: string } } | null;
  isDemo?: boolean;
  projection?: Array<{ account_id: number }> | null;
  rows?: (typeof listing)[];
} = {}) => {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: isDemo ? projection : [],
      error: null,
    }),
    from: vi.fn(() => builder),
    builder,
  };
};

describe("loadDemoPreviewListings", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
  });

  it("fails closed for an anonymous caller without touching listings", async () => {
    const client = buildClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(client);

    await expect(loadDemoPreviewListings({})).rejects.toMatchObject({
      name: "DemoPreviewDeniedError",
      reason: "anonymous",
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("uses the persisted authenticated client after the active-demo check", async () => {
    const client = buildClient();
    mockGetSupabaseClient.mockReturnValue(client);

    await expect(loadDemoPreviewListings({ text: "Feldman" })).resolves.toEqual(
      [listing],
    );
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("current_demo_preview_accounts");
    expect(client.from).toHaveBeenCalledWith("listings");
    expect(client.builder.in).toHaveBeenCalledWith("account_id", [1]);
  });

  it.each([
    ["cleared", false],
    ["failed", false],
    ["cross-bundle", false],
  ])(
    "denies an %s or otherwise non-previewable run",
    async (_label, isDemo) => {
      const client = buildClient({ isDemo });
      mockGetSupabaseClient.mockReturnValue(client);

      const error = await loadDemoPreviewListings({}).catch((value) => value);
      expect(error).toBeInstanceOf(DemoPreviewDeniedError);
      expect((error as DemoPreviewDeniedError).reason).toBe("inactive");
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the sanitized projection is unavailable or empty", async () => {
    for (const projection of [null, []]) {
      const client = buildClient({ projection });
      mockGetSupabaseClient.mockReturnValue(client);

      await expect(loadDemoPreviewListings({})).rejects.toMatchObject({
        reason: "inactive",
      });
      expect(client.from).not.toHaveBeenCalled();
    }
  });
});
