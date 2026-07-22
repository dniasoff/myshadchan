import type { Identifier } from "ra-core";

import { createDataProvider } from "../providers/fakerest/dataProvider";
import type { Redt } from "../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

const getRedts = async (
  dataProvider: ReturnType<typeof makeProvider>,
  shidduchId: Identifier,
): Promise<Redt[]> => {
  const { data } = await dataProvider.getList<Redt>("redts", {
    filter: { shidduchim_id: shidduchId },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "ASC" },
  });
  return data;
};

describe("redt history", () => {
  it("records a first redt when a shidduch is created", async () => {
    // Arrange / Act
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "First Redt",
      shadchan_id: 1,
      redt_date: "2026-05-01",
      initial_state: "new",
    });
    // Assert
    const redts = await getRedts(dataProvider, shidduch.id);
    expect(redts).toHaveLength(1);
    expect(redts[0].redt_date).toBe("2026-05-01");
    expect(redts[0].shadchan_id).toBe(1);
  });

  it("advances redt_date to the latest when redt again on a newer date", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Advancer",
      shadchan_id: 1,
      redt_date: "2026-05-01",
    });
    const updated = await dataProvider.addRedt({
      shidduchim_id: shidduch.id,
      shadchan_id: 2,
      redt_date: "2026-06-15",
    });
    expect(updated.redt_date).toBe("2026-06-15"); // always the last date
    expect(updated.shadchan_id).toBe(2); // latest redt's shadchan (card "via")
    expect(await getRedts(dataProvider, shidduch.id)).toHaveLength(2);
  });

  it("keeps redt_date as the last date when an EARLIER redt is added", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Backfill",
      shadchan_id: 1,
      redt_date: "2026-05-01",
    });
    const updated = await dataProvider.addRedt({
      shidduchim_id: shidduch.id,
      shadchan_id: 2,
      redt_date: "2026-03-01",
    });
    expect(updated.redt_date).toBe("2026-05-01"); // still the most recent
    expect(updated.first_suggested_by).toBe(2); // earliest redt's shadchan
  });

  it("allows the same shadchan to redt again (multiple redts by the same person)", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Same Shadchan Twice",
      shadchan_id: 1,
      redt_date: "2026-05-01",
    });
    await dataProvider.addRedt({
      shidduchim_id: shidduch.id,
      shadchan_id: 1,
      redt_date: "2026-07-01",
    });
    const redts = await getRedts(dataProvider, shidduch.id);
    expect(redts).toHaveLength(2);
    expect(redts.every((r) => r.shadchan_id === 1)).toBe(true);
  });

  it("surfaces the redt count on the shidduch summary", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Counted",
      shadchan_id: 1,
      redt_date: "2026-05-01",
    });
    await dataProvider.addRedt({
      shidduchim_id: shidduch.id,
      shadchan_id: 2,
      redt_date: "2026-06-01",
    });
    const { data } = await dataProvider.getOne("shidduchim", {
      id: shidduch.id,
    });
    expect(data.nb_redts).toBe(2);
  });

  it("rejects adding a redt to a shidduch that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.addRedt({ shidduchim_id: 999999, shadchan_id: 1 }),
    ).rejects.toThrow(/not found/);
  });
});
