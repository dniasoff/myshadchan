import { describe, expect, it } from "vitest";

import type { Shadchan, Single } from "../../types";
import { createDataProvider } from "./dataProvider";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

const createSearchFixture = async () => {
  const dataProvider = makeProvider();
  const { data: single } = await dataProvider.create<Single>("singles", {
    data: {
      account_id: 1,
      first_name_en: "Miriam",
      status: "active",
    } as Single,
  });
  const { data: shadchan } = await dataProvider.create<Shadchan>("shadchanim", {
    data: { account_id: 1, name: "Rivka Cohen" } as Shadchan,
  });
  const shidduch = await dataProvider.createShidduch({
    single_id: single.id,
    shadchan_id: shadchan.id,
    name_en: "Candidate Person",
    suggested_by_name: "Sara Friend",
    suggested_by_phone: "*732 814-5891~",
  });

  return { dataProvider, shidduchId: shidduch.id };
};

describe("FakeRest shidduch search", () => {
  it("searches the enriched shadchan name", async () => {
    const { dataProvider, shidduchId } = await createSearchFixture();

    const result = await dataProvider.getList("shidduchim", {
      filter: { q: "rivka" },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    });

    expect(result.data.map((row) => row.id)).toContain(shidduchId);
  });

  it("matches digits against a decorated and formatted Suggested-by phone", async () => {
    const { dataProvider, shidduchId } = await createSearchFixture();

    const result = await dataProvider.getList("shidduchim", {
      filter: { q: "7328145891" },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    });

    expect(result.data.map((row) => row.id)).toContain(shidduchId);
  });
});
