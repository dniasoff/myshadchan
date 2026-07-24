import { createDataProvider } from "./dataProvider";
import type { Child, ChildSummary, Shadchan } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

// The children roster reads children_summary via useGetList; the adapter
// collapses "_summary" to "children", so the test reads it the same way and
// picks the target child out of the enriched list.
const childSummaryById = async (
  dataProvider: ReturnType<typeof makeProvider>,
  childId: number,
): Promise<ChildSummary> => {
  const { data } = await dataProvider.getList<ChildSummary>(
    "children_summary",
    {
      filter: { id: childId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data[0];
};

/**
 * Builds an isolated child + shadchan with three suggestions in known states, so
 * the children_summary (E6) and shadchan_stats (E5) emulation can be asserted
 * without depending on the seed data's exact counts.
 *
 *   A: new           -> open,  not progressed
 *   B: look_into->yes-> not open, progressed, reached yes
 *   C: for_sure_not  -> not open, progressed
 */
const buildScenario = async (
  dataProvider: ReturnType<typeof makeProvider>,
) => {
  const { data: child } = await dataProvider.create<Child>("children", {
    data: { account_id: 1, first_name_en: "Test", status: "active" } as Child,
  });
  const { data: shadchan } = await dataProvider.create<Shadchan>("shadchanim", {
    data: { account_id: 1, name: "Test Shadchan" } as Shadchan,
  });

  await dataProvider.createShidduch({
    child_id: child.id,
    shadchan_id: shadchan.id,
    initial_state: "new",
  });
  const suggestionB = await dataProvider.createShidduch({
    child_id: child.id,
    shadchan_id: shadchan.id,
    initial_state: "look_into",
  });
  await dataProvider.transitionShidduch(suggestionB.id, "look_into", "yes");
  await dataProvider.createShidduch({
    child_id: child.id,
    shadchan_id: shadchan.id,
    initial_state: "for_sure_not",
  });

  return { childId: child.id, shadchanId: shadchan.id };
};

describe("children_summary emulation (E6)", () => {
  it("counts total and open (still-in-triage) suggestions per child", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { childId } = await buildScenario(dataProvider);
    // Act
    const summary = await childSummaryById(dataProvider, childId as number);
    // Assert -- 3 total; only the 'new' one stays open (yes/for_sure_not exit triage)
    expect(summary.total_shidduchim).toBe(3);
    expect(summary.open_shidduchim).toBe(1);
  });

  it("reports zero counts for a child with no suggestions", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: child } = await dataProvider.create<Child>("children", {
      data: { account_id: 1, first_name_en: "Lonely", status: "active" } as Child,
    });
    // Act
    const summary = await childSummaryById(dataProvider, child.id as number);
    // Assert
    expect(summary.total_shidduchim).toBe(0);
    expect(summary.open_shidduchim).toBe(0);
  });
});

describe("shadchan_stats emulation (E5)", () => {
  it("counts suggestions, progressed, and reached-yes per shadchan", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { shadchanId } = await buildScenario(dataProvider);
    // Act
    const { data } = await dataProvider.getOne("shadchan_stats", {
      id: shadchanId,
    });
    // Assert
    expect(data.nb_suggestions).toBe(3);
    // progressed = moved past 'new' -> the yes and the for_sure_not
    expect(data.nb_progressed).toBe(2);
    expect(data.nb_reached_yes).toBe(1);
  });

  it("returns a zeroed row for a shadchan with no suggestions", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: shadchan } = await dataProvider.create<Shadchan>("shadchanim", {
      data: { account_id: 1, name: "Idle Shadchan" } as Shadchan,
    });
    // Act
    const { data } = await dataProvider.getOne("shadchan_stats", {
      id: shadchan.id,
    });
    // Assert
    expect(data.id).toBe(shadchan.id);
    expect(data.nb_suggestions).toBe(0);
    expect(data.nb_progressed).toBe(0);
    expect(data.nb_reached_yes).toBe(0);
  });
});
