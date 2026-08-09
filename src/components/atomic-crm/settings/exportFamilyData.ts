import type { DataProvider } from "ra-core";

/**
 * Fetches the complete export bundle for the current account via the
 * `export_full_account_bundle` RPC. This includes all tenant tables and
 * files (resumes, photos, attachments) as base64-encoded bytes.
 * The table list is derived from the schema at RPC level, not hardcoded.
 */
export const collectFamilyData = async (
  dataProvider: DataProvider,
): Promise<Record<string, unknown>> => {
  const { data } = await dataProvider.custom({
    url: "/rpc/export_full_account_bundle",
    options: { method: "POST" },
  });
  return data as Record<string, unknown>;
};

/**
 * Fetches just the data tables (without files) via `export_account_data` RPC.
 * Useful for smaller exports or when files are handled separately.
 */
export const collectFamilyDataOnly = async (
  dataProvider: DataProvider,
): Promise<Record<string, unknown[]>> => {
  const { data } = await dataProvider.custom({
    url: "/rpc/export_account_data",
    options: { method: "POST" },
  });
  return data as Record<string, unknown[]>;
};

/**
 * Fetches just the files via `export_account_files` RPC.
 */
export const collectFamilyFiles = async (
  dataProvider: DataProvider,
): Promise<Record<string, unknown[]>> => {
  const { data } = await dataProvider.custom({
    url: "/rpc/export_account_files",
    options: { method: "POST" },
  });
  return data as Record<string, unknown[]>;
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

/** Streams a large export to avoid assembling in memory. */
export const downloadAsJsonStream = async (
  dataProvider: DataProvider,
  filename: string,
): Promise<void> => {
  const { data } = await dataProvider.custom({
    url: "/rpc/export_full_account_bundle",
    options: { method: "POST" },
  });
  downloadAsJson(data, filename);
};
