import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";

/**
 * Demo mode must refuse exactly what Postgres refuses. These mirror the
 * `interactions_scope_link_check` / `interactions_scope_check` constraints and
 * the revoked DELETE grant — without them the FakeRest build would accept rows
 * the real backend rejects, and the demo would teach the wrong data model.
 */

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

// Story 6.4 — the default demo seed's only account_member is user_id "0",
// role "parent_admin" (dataGenerator/shidduchim.ts). These two helpers pin
// identity EXPLICITLY via a custom authProvider, rather than relying on
// `defaultAuthProvider`'s localStorage-derived fallback (id 0 when no
// USER_STORAGE_KEY entry exists) — deterministic regardless of what a
// browser-mode test run's localStorage happens to hold.
const SINGLE_USER_ID = "story-6-4-single";

const dbWithSingleMember = () => {
  const db = generateData();
  const accountId = db.accounts[0].id;
  db.account_members = [
    ...db.account_members,
    {
      id: 9001,
      account_id: accountId,
      user_id: SINGLE_USER_ID,
      role: "single",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  return db;
};

const makeSingleProvider = (db = dbWithSingleMember()) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: SINGLE_USER_ID }) },
  });

const makeParentProvider = (db = generateData()) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0 }) },
  });

const note = (overrides: Record<string, unknown>) => ({
  target_type: "reference",
  target_id: 1,
  kind: "note",
  body: "something candid",
  ...overrides,
});

describe("interactions guards (FakeRest parity with the database)", () => {
  it("accepts a general note with no shidduch parent", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act
    const { data } = await dataProvider.create("interactions", {
      data: note({ scope: "account" }),
    });

    // Assert
    expect(data.scope).toBe("account");
    expect(data.reference_link_id ?? null).toBeNull();
  });

  it("accepts a note tied to a specific conversation", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act
    const { data } = await dataProvider.create("interactions", {
      data: note({ scope: "shidduch", reference_link_id: 1 }),
    });

    // Assert
    expect(data.scope).toBe("shidduch");
    expect(data.reference_link_id).toBe(1);
  });

  it("rejects a shidduch-scoped note with no link to derive visibility from", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({ scope: "shidduch", reference_link_id: null }),
      }),
    ).rejects.toThrow(/must declare which parent/i);
  });

  it("rejects an account-scoped note that also claims a link", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({ scope: "account", reference_link_id: 1 }),
      }),
    ).rejects.toThrow(/must declare which parent/i);
  });

  it("rejects a note about a shidduch that claims no parent", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({ target_type: "shidduch", scope: "account" }),
      }),
    ).rejects.toThrow(/must declare which parent/i);
  });

  it("rejects an invented visibility scope", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({ scope: "nowhere" }),
      }),
    ).rejects.toThrow(/invalid interaction scope/i);
  });

  it("refuses to re-parent an interaction after the fact", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: created } = await dataProvider.create("interactions", {
      data: note({ scope: "shidduch", reference_link_id: 1 }),
    });

    // Act / Assert
    await expect(
      dataProvider.update("interactions", {
        id: created.id,
        data: { scope: "account", reference_link_id: null },
        previousData: created,
      }),
    ).rejects.toThrow(/cannot be changed after the fact/i);
  });

  it("still allows editing what a note says", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: created } = await dataProvider.create("interactions", {
      data: note({ scope: "account" }),
    });

    // Act
    const { data: updated } = await dataProvider.update("interactions", {
      id: created.id,
      data: { body: "corrected wording" },
      previousData: created,
    });

    // Assert
    expect(updated.body).toBe("corrected wording");
  });

  it("treats the diligence timeline as append-only", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: created } = await dataProvider.create("interactions", {
      data: note({ scope: "account" }),
    });

    // Act / Assert
    await expect(
      dataProvider.delete("interactions", {
        id: created.id,
        previousData: created,
      }),
    ).rejects.toThrow(/append-only/i);
  });

  // Story 3.5 (AC 11) — the two target types AC 1 widens
  // interactions_target_type_check to, in lockstep with the DB migration.
  it("accepts a shadchan-targeted, account-scoped interaction", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act
    const { data } = await dataProvider.create("interactions", {
      data: note({ target_type: "shadchan", target_id: 1, scope: "account" }),
    });

    // Assert
    expect(data.target_type).toBe("shadchan");
    expect(data.scope).toBe("account");
    expect(data.reference_link_id ?? null).toBeNull();
  });

  it("accepts a single-targeted, account-scoped interaction", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act
    const { data } = await dataProvider.create("interactions", {
      data: note({ target_type: "single", target_id: 1, scope: "account" }),
    });

    // Assert
    expect(data.target_type).toBe("single");
    expect(data.scope).toBe("account");
    expect(data.reference_link_id ?? null).toBeNull();
  });

  it("rejects a shadchan-targeted row claiming scope = 'shidduch' (shadchan has no shidduch parent to derive visibility from)", async () => {
    // Arrange
    const dataProvider = makeProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({
          target_type: "shadchan",
          target_id: 1,
          scope: "shidduch",
        }),
      }),
    ).rejects.toThrow(/must declare which parent/i);
  });

  // Story 5.7 (AC 5/AC 6) — the right rail's SingleInputPanel read path. A
  // single_input row is target_type = 'shidduch', scope = 'shidduch',
  // reference_link_id = null, the same shape every other shidduch-targeted
  // interaction already uses.
  //
  // Story 6.4 narrows WHO may create one: only a single-role session, never
  // a parent_admin/helper/etc — see the "single_input FakeRest parity"
  // describe block below for the role guard's own tests. This case is
  // therefore updated (not left as it shipped in 5.7) to run as a single.
  it("accepts a single_input-kind interaction targeting a shidduch, for a single-role session", async () => {
    // Arrange
    const dataProvider = makeSingleProvider();

    // Act
    const { data } = await dataProvider.create("interactions", {
      data: note({
        target_type: "shidduch",
        target_id: 1,
        kind: "single_input",
        scope: "shidduch",
      }),
    });

    // Assert
    expect(data.kind).toBe("single_input");
    expect(data.target_type).toBe("shidduch");
    expect(data.reference_link_id ?? null).toBeNull();
  });
});

describe("single_input FakeRest parity (Story 6.4, AC 1 / AC 3 / AC 7)", () => {
  it("rejects a single_input insert from a non-single (parent_admin) session", async () => {
    // Arrange
    const dataProvider = makeParentProvider();

    // Act / Assert
    await expect(
      dataProvider.create("interactions", {
        data: note({
          target_type: "shidduch",
          target_id: 1,
          kind: "single_input",
          scope: "shidduch",
        }),
      }),
    ).rejects.toThrow(/only a single may add/i);
  });

  it("treats a single_input row as append-only, even for its own single author", async () => {
    // Arrange
    const db = dbWithSingleMember();
    const singleProvider = makeSingleProvider(db);
    const { data: created } = await singleProvider.create("interactions", {
      data: note({
        target_type: "shidduch",
        target_id: 1,
        kind: "single_input",
        scope: "shidduch",
      }),
    });

    // Act / Assert
    await expect(
      singleProvider.update("interactions", {
        id: created.id,
        data: { body: "revised after the fact" },
        previousData: created,
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("treats a single_input row as append-only for a parent_admin too — no owning-role moderation escape", async () => {
    // Arrange — the single creates the row; a SEPARATE parent_admin session
    // against the same in-memory db then tries to moderate it.
    const db = dbWithSingleMember();
    const singleProvider = makeSingleProvider(db);
    const { data: created } = await singleProvider.create("interactions", {
      data: note({
        target_type: "shidduch",
        target_id: 1,
        kind: "single_input",
        scope: "shidduch",
      }),
    });
    const parentProvider = makeParentProvider(db);

    // Act / Assert
    await expect(
      parentProvider.update("interactions", {
        id: created.id,
        data: { deleted_at: "2026-01-01T00:00:00.000Z" },
        previousData: created,
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("still allows a parent_admin to update a note they authored — the append-only rule is single_input-specific", async () => {
    // Arrange — the moderation path for every other kind is untouched by
    // this story; this is the falsifiable counterpart to the two checks
    // above (a guard that rejected every update, not just single_input's,
    // would still pass those two but fail this one).
    const parentProvider = makeParentProvider();
    const { data: created } = await parentProvider.create("interactions", {
      data: note({ scope: "account" }),
    });

    // Act
    const { data: updated } = await parentProvider.update("interactions", {
      id: created.id,
      data: { body: "corrected wording" },
      previousData: created,
    });

    // Assert
    expect(updated.body).toBe("corrected wording");
  });
});
