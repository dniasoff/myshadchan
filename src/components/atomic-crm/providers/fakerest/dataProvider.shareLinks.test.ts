import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 9.5 — end-to-end FakeRest wiring: `dataProvider.create("share_links",
 * ...)` actually reaches the CSPRNG-token mirror (`internal/shareLinks.ts`'s
 * own unit suite pins the pure logic; this file proves the WIRING — the
 * `create()` override in `dataProvider.ts` — actually reaches it), and
 * `revokeShareLink`/`getShareAccessLog` are exposed and work end to end.
 * Mirrors `dataProvider.listingWithdrawal.test.ts`'s own fixture shape.
 */

const HOUSEHOLD_ACCOUNT_ID = 1;
const PARENT_MEMBER_ID = 1;
const SINGLE_ID = 1;

const asParent = { id: 0 };

const makeProvider = (db: Db, identity: { id: number } = asParent) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => identity },
  });

function seedFixture(db: Db): void {
  db.accounts = [
    {
      id: HOUSEHOLD_ACCOUNT_ID,
      name: "Share Links Household",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.account_members = [
    {
      id: PARENT_MEMBER_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.singles = [
    {
      id: SINGLE_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      first_name_en: "Rivky",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.share_links = [];
  db.share_access_log = [];
}

describe("FakeRest wiring — share_links create() (Story 9.5, AC-2)", () => {
  it("overwrites token/account_id/created_by_member_id even when a client sends its own values", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db);

    // Act — a raw create supplying a client-chosen token AND account_id,
    // mirroring what a bypass-the-UI raw insert would attempt.
    const { data: link } = await dataProvider.create("share_links", {
      data: {
        single_id: SINGLE_ID,
        include_photo: false,
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        token: "client-chosen-token",
        account_id: 999,
      },
    });

    // Assert
    expect(link.token).not.toBe("client-chosen-token");
    expect(link.token).toMatch(/^[0-9a-f]{48}$/);
    expect(link.account_id).toBe(HOUSEHOLD_ACCOUNT_ID);
    expect(link.created_by_member_id).toBe(PARENT_MEMBER_ID);
  });

  it("mints a DIFFERENT token on each successive create", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db);
    const create = () =>
      dataProvider.create("share_links", {
        data: {
          single_id: SINGLE_ID,
          include_photo: false,
          expires_at: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      });

    // Act
    const [{ data: first }, { data: second }] = await Promise.all([
      create(),
      create(),
    ]);

    // Assert
    expect(first.token).not.toBe(second.token);
  });
});

describe("FakeRest wiring — revokeShareLink() (Story 9.5, AC-6)", () => {
  it("sets revoked_at on an active link", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    db.share_links = [
      {
        id: 1,
        account_id: HOUSEHOLD_ACCOUNT_ID,
        single_id: SINGLE_ID,
        created_by_member_id: PARENT_MEMBER_ID,
        token: "a".repeat(48),
        include_photo: false,
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        revoked_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const dataProvider = makeProvider(db);

    // Act
    await dataProvider.revokeShareLink(1);

    // Assert
    const { data: link } = await dataProvider.getOne("share_links", {
      id: 1,
    });
    expect(link.revoked_at).not.toBeNull();
  });

  it("is a one-way no-op on an already-revoked link — the revoked_at timestamp never changes", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const revokedAt = "2026-01-05T00:00:00Z";
    db.share_links = [
      {
        id: 1,
        account_id: HOUSEHOLD_ACCOUNT_ID,
        single_id: SINGLE_ID,
        created_by_member_id: PARENT_MEMBER_ID,
        token: "a".repeat(48),
        include_photo: false,
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        revoked_at: revokedAt,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const dataProvider = makeProvider(db);

    // Act
    await dataProvider.revokeShareLink(1);

    // Assert
    const { data: link } = await dataProvider.getOne("share_links", {
      id: 1,
    });
    expect(link.revoked_at).toBe(revokedAt);
  });
});

describe("FakeRest wiring — getShareAccessLog() (Story 9.5, AC-8)", () => {
  it("returns only the rows for the given share_link_id, newest first", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    db.share_access_log = [
      {
        id: 1,
        share_link_id: 1,
        accessed_at: "2026-01-01T00:00:00Z",
        resource: "profile",
      },
      {
        id: 2,
        share_link_id: 1,
        accessed_at: "2026-01-02T00:00:00Z",
        resource: "resume:resume-0",
      },
      {
        id: 3,
        share_link_id: 2,
        accessed_at: "2026-01-03T00:00:00Z",
        resource: "profile",
      },
    ];
    const dataProvider = makeProvider(db);

    // Act
    const log = await dataProvider.getShareAccessLog(1);

    // Assert
    expect(log.map((entry) => entry.id)).toEqual([2, 1]);
  });
});
