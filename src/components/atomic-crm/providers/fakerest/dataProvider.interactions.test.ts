import { createDataProvider } from "./dataProvider";

/**
 * Demo mode must refuse exactly what Postgres refuses. These mirror the
 * `interactions_scope_link_check` / `interactions_scope_check` constraints and
 * the revoked DELETE grant — without them the FakeRest build would accept rows
 * the real backend rejects, and the demo would teach the wrong data model.
 */

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

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
  // interaction already uses — no new FakeRest validation branch, just the
  // widened `InteractionKind` union round-tripping through the AD-10 mirror.
  it("accepts a single_input-kind interaction targeting a shidduch", async () => {
    // Arrange
    const dataProvider = makeProvider();

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
