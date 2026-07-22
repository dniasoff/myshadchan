import { createDataProvider } from "../providers/fakerest/dataProvider";

// These tests exercise the single-owner service guards in the FakeRest mirror
// (createShidduch / transitionShidduch), which mirror the create_shidduch and
// transition_shidduch Postgres functions. Child id 1 is seeded by the demo
// data generator (see dataGenerator/shidduchim.ts).
const makeProvider = () => createDataProvider({ latency: 0, silent: true });

describe("createShidduch (sole INSERT path)", () => {
  it("creates a shidduch in the requested triage state with account + defaults", async () => {
    // Arrange
    const dataProvider = makeProvider();
    // Act
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Test Single",
      shadchan_id: 1,
      initial_state: "look_into",
    });
    // Assert
    expect(created.pipeline_state).toBe("look_into");
    expect(created.account_id).toBe(1);
    expect(created.origin).toBe("manual");
    expect(created.visibility).toBe("shared");
    expect(created.first_suggested_by).toBe(1);
  });

  it("defaults a new shidduch to the 'new' state", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Defaulted",
    });
    expect(created.pipeline_state).toBe("new");
  });

  it("refuses to create directly into a decision state", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.createShidduch({
        child_id: 1,
        name_en: "Illegal",
        initial_state: "yes",
      }),
    ).rejects.toThrow(/invalid initial pipeline_state/);
  });
});

describe("transitionShidduch (sole state writer)", () => {
  it("performs a legal triage transition new -> look_into", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Mover",
      initial_state: "new",
    });
    const moved = await dataProvider.transitionShidduch(
      created.id,
      "new",
      "look_into",
    );
    expect(moved.pipeline_state).toBe("look_into");
  });

  it("allows a decision only from look_into (look_into -> yes)", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Decider",
      initial_state: "look_into",
    });
    const moved = await dataProvider.transitionShidduch(
      created.id,
      "look_into",
      "yes",
    );
    expect(moved.pipeline_state).toBe("yes");
  });

  it("rejects an illegal transition new -> yes", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Jumper",
      initial_state: "new",
    });
    await expect(
      dataProvider.transitionShidduch(created.id, "new", "yes"),
    ).rejects.toThrow(/illegal pipeline transition/);
  });

  it("rejects moving out of a terminal state (for_sure_not -> look_into)", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Gut No",
      initial_state: "for_sure_not",
    });
    await expect(
      dataProvider.transitionShidduch(created.id, "for_sure_not", "look_into"),
    ).rejects.toThrow(/illegal pipeline transition/);
  });

  it("rejects a stale transition when `from` does not match the live state", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Stale",
      initial_state: "new",
    });
    await expect(
      dataProvider.transitionShidduch(created.id, "look_into", "yes"),
    ).rejects.toThrow(/stale transition/);
  });

  it("is a no-op when from and to are the same state", async () => {
    const dataProvider = makeProvider();
    const created = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Same",
      initial_state: "look_into",
    });
    const moved = await dataProvider.transitionShidduch(
      created.id,
      "look_into",
      "look_into",
    );
    expect(moved.pipeline_state).toBe("look_into");
  });
});
