import { useDataProvider } from "ra-core";
import { useQuery } from "@tanstack/react-query";

import type { CrmDataProvider } from "../providers/types";
import type { Shadchan } from "../types";

const SHADCHAN_PAGE_SIZE = 200;

export const useAllShadchanim = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();

  return useQuery({
    queryKey: ["shadchanim", "all-account-rows"],
    queryFn: async () => {
      const rows: Shadchan[] = [];
      let page = 1;

      while (true) {
        const result = await dataProvider.getList<Shadchan>("shadchanim", {
          filter: {},
          pagination: { page, perPage: SHADCHAN_PAGE_SIZE },
          sort: { field: "name", order: "ASC" },
        });
        rows.push(...result.data);

        if (
          result.data.length === 0 ||
          result.data.length < SHADCHAN_PAGE_SIZE ||
          (typeof result.total === "number" && rows.length >= result.total)
        ) {
          return { data: rows, total: rows.length };
        }
        page += 1;
      }
    },
  });
};
