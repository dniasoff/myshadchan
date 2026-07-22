import type { Identifier } from "ra-core";

import { createDataProvider } from "../providers/fakerest/dataProvider";
import type { ShidduchSchool } from "../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

const getSchools = async (
  dataProvider: ReturnType<typeof makeProvider>,
  shidduchId: Identifier,
): Promise<ShidduchSchool[]> => {
  const { data } = await dataProvider.getList<ShidduchSchool>(
    "shidduch_schools",
    {
      filter: { shidduchim_id: shidduchId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data;
};

describe("shidduch schools", () => {
  it("records the headline seminary as the first school — a yeshiva for a girl's match", async () => {
    // Arrange — child 1 (Rivky, female); her match is a boy -> yeshiva
    const dataProvider = makeProvider();
    // Act
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "A boy",
      seminary_en: "BMG",
    });
    // Assert
    const schools = await getSchools(dataProvider, shidduch.id);
    expect(schools).toHaveLength(1);
    expect(schools[0].name_en).toBe("BMG");
    expect(schools[0].kind).toBe("yeshiva");
  });

  it("records a seminary for a boy's match (child is male)", async () => {
    const dataProvider = makeProvider();
    // child 2 (Yaakov, male); his match is a girl -> seminary
    const shidduch = await dataProvider.createShidduch({
      child_id: 2,
      name_en: "A girl",
      seminary_en: "Bnos Chava",
    });
    const schools = await getSchools(dataProvider, shidduch.id);
    expect(schools[0].kind).toBe("seminary");
  });

  it("creates no school when no seminary is given", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "No school",
    });
    expect(await getSchools(dataProvider, shidduch.id)).toHaveLength(0);
  });

  it("links multiple schools with optional years", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      child_id: 1,
      name_en: "Multi",
      seminary_en: "BMG",
    });
    await dataProvider.addSchool({
      shidduchim_id: shidduch.id,
      kind: "school",
      name_en: "Mesivta of Lakewood",
      start_year: 2016,
      end_year: 2020,
    });
    const schools = await getSchools(dataProvider, shidduch.id);
    expect(schools).toHaveLength(2);
    const mesivta = schools.find((s) => s.name_en === "Mesivta of Lakewood");
    expect(mesivta?.kind).toBe("school");
    expect(mesivta?.start_year).toBe(2016);
    expect(mesivta?.end_year).toBe(2020);
  });

  it("rejects adding a school to a shidduch that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.addSchool({ shidduchim_id: 999999, name_en: "X" }),
    ).rejects.toThrow(/not found/);
  });
});
