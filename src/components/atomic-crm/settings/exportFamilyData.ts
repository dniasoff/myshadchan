import type { DataProvider } from "ra-core";

/** Resources that make up "this family's records" for the export bundle. */
const EXPORT_RESOURCES = [
  "children",
  "shidduchim",
  "shadchanim",
  "references",
] as const;

/**
 * Fetches every record this account holds across the core shidduchim
 * entities and returns a plain object keyed by resource — the shape written
 * to the downloaded export file. Reads only; RLS already scopes every query
 * to the signed-in account, so no extra filter is needed here.
 */
export const collectFamilyData = async (
  dataProvider: DataProvider,
): Promise<Record<string, unknown[]>> => {
  const entries = await Promise.all(
    EXPORT_RESOURCES.map(async (resource) => {
      const { data } = await dataProvider.getList(resource, {
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
        filter: {},
      });
      return [resource, data] as const;
    }),
  );
  return Object.fromEntries(entries);
};

/** Triggers a browser download of `data` as a formatted JSON file. */
export const downloadAsJson = (data: unknown, filename: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
