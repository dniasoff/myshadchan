import type { Identifier } from "ra-core";

import { createDataProvider } from "../providers/fakerest/dataProvider";
import type { ShidduchEducation } from "../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

const getEducation = async (
  dataProvider: ReturnType<typeof makeProvider>,
  shidduchId: Identifier,
): Promise<ShidduchEducation[]> => {
  const { data } = await dataProvider.getList<ShidduchEducation>(
    "shidduch_education",
    {
      filter: { shidduchim_id: shidduchId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data;
};

describe("shidduch education", () => {
  it("records the headline seminary as the first education entry — a yeshiva for a girl's match", async () => {
    // Arrange — single 1 (Rivky, female); her match is a boy -> yeshiva
    const dataProvider = makeProvider();
    // Act
    const shidduch = await dataProvider.createShidduch({
      single_id: 1,
      name_en: "A boy",
      seminary_en: "BMG",
    });
    // Assert
    const education = await getEducation(dataProvider, shidduch.id);
    expect(education).toHaveLength(1);
    expect(education[0].name_en).toBe("BMG");
    expect(education[0].kind).toBe("yeshiva");
  });

  it("records a seminary for a boy's match (single is male)", async () => {
    const dataProvider = makeProvider();
    // single 2 (Yaakov, male); his match is a girl -> seminary
    const shidduch = await dataProvider.createShidduch({
      single_id: 2,
      name_en: "A girl",
      seminary_en: "Bnos Chava",
    });
    const education = await getEducation(dataProvider, shidduch.id);
    expect(education[0].kind).toBe("seminary");
  });

  it("creates no education entry when no seminary is given", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      single_id: 1,
      name_en: "No school",
    });
    expect(await getEducation(dataProvider, shidduch.id)).toHaveLength(0);
  });

  it("links multiple education entries with optional years", async () => {
    const dataProvider = makeProvider();
    const shidduch = await dataProvider.createShidduch({
      single_id: 1,
      name_en: "Multi",
      seminary_en: "BMG",
    });
    await dataProvider.addEducation({
      shidduchim_id: shidduch.id,
      kind: "school",
      name_en: "Mesivta of Lakewood",
      start_year: 2016,
      end_year: 2020,
    });
    const education = await getEducation(dataProvider, shidduch.id);
    expect(education).toHaveLength(2);
    const mesivta = education.find((s) => s.name_en === "Mesivta of Lakewood");
    expect(mesivta?.kind).toBe("school");
    expect(mesivta?.start_year).toBe(2016);
    expect(mesivta?.end_year).toBe(2020);
  });

  it("rejects adding an education entry to a shidduch that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.addEducation({ shidduchim_id: 999999, name_en: "X" }),
    ).rejects.toThrow(/not found/);
  });
});
