import { createDataProvider } from "./dataProvider";
import type { Shadchan, Single, SingleSummary } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

// The singles roster reads singles_summary via useGetList; the adapter
// collapses "_summary" to "singles", so the test reads it the same way and
// picks the target single out of the enriched list.
const singleSummaryById = async (
  dataProvider: ReturnType<typeof makeProvider>,
  singleId: number,
): Promise<SingleSummary> => {
  const { data } = await dataProvider.getList<SingleSummary>(
    "singles_summary",
    {
      filter: { id: singleId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data[0];
};

/**
 * Builds an isolated single + shadchan with three suggestions in known states, so
 * the singles_summary (E6) and shadchan_stats (E5) emulation can be asserted
 * without depending on the seed data's exact counts.
 *
 *   A: new           -> open,  not progressed
 *   B: look_into->yes-> not open, progressed, reached yes
 *   C: for_sure_not  -> not open, progressed
 */
const buildScenario = async (dataProvider: ReturnType<typeof makeProvider>) => {
  const { data: single } = await dataProvider.create<Single>("singles", {
    data: { account_id: 1, first_name_en: "Test", status: "active" } as Single,
  });
  const { data: shadchan } = await dataProvider.create<Shadchan>("shadchanim", {
    data: { account_id: 1, name: "Test Shadchan" } as Shadchan,
  });

  await dataProvider.createShidduch({
    single_id: single.id,
    shadchan_id: shadchan.id,
    initial_state: "new",
  });
  const suggestionB = await dataProvider.createShidduch({
    single_id: single.id,
    shadchan_id: shadchan.id,
    initial_state: "look_into",
  });
  await dataProvider.transitionShidduch(suggestionB.id, "look_into", "yes");
  await dataProvider.createShidduch({
    single_id: single.id,
    shadchan_id: shadchan.id,
    initial_state: "for_sure_not",
  });

  return { singleId: single.id, shadchanId: shadchan.id };
};

describe("singles_summary emulation (E6)", () => {
  it("counts total and open (still-in-triage) suggestions per single", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { singleId } = await buildScenario(dataProvider);
    // Act
    const summary = await singleSummaryById(dataProvider, singleId as number);
    // Assert -- 3 total; only the 'new' one stays open (yes/for_sure_not exit triage)
    expect(summary.total_shidduchim).toBe(3);
    expect(summary.open_shidduchim).toBe(1);
  });

  it("reports zero counts for a single with no suggestions", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: single } = await dataProvider.create<Single>("singles", {
      data: {
        account_id: 1,
        first_name_en: "Lonely",
        status: "active",
      } as Single,
    });
    // Act
    const summary = await singleSummaryById(dataProvider, single.id as number);
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
    // Story 5.9 (RULING 8): all three shidduchim share the one single, and
    // only A ('new') is still open — B reached 'yes', C reached
    // 'for_sure_not', both terminal. last_redt_date is set (all three were
    // created "now", so it is today's date), never fabricated to a
    // different value.
    expect(data.nb_open_singles).toBe(1);
    expect(data.last_redt_date).not.toBeNull();
  });

  it("returns a zeroed row for a shadchan with no suggestions", async () => {
    // Arrange
    const dataProvider = makeProvider();
    const { data: shadchan } = await dataProvider.create<Shadchan>(
      "shadchanim",
      {
        data: { account_id: 1, name: "Idle Shadchan" } as Shadchan,
      },
    );
    // Act
    const { data } = await dataProvider.getOne("shadchan_stats", {
      id: shadchan.id,
    });
    // Assert
    expect(data.id).toBe(shadchan.id);
    expect(data.nb_suggestions).toBe(0);
    expect(data.nb_progressed).toBe(0);
    expect(data.nb_reached_yes).toBe(0);
    // Story 5.9 (RULING 8): the zeroed/null row — no shidduchim, so no open
    // singles and no redt to report, never a fabricated 0-date.
    expect(data.nb_open_singles).toBe(0);
    expect(data.last_redt_date).toBeNull();
  });
});
