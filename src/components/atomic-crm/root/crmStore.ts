import { localStorageStore } from "ra-core";

/**
 * localStorage namespace under which the app persists UI preferences
 * (theme, locale, list settings...). Shared so that surfaces rendered outside
 * `<Admin>` — the public landing page — read back the same preferences the
 * signed-in app wrote.
 */
export const CRM_STORE_APP_KEY = "CRM";

export const createCrmStore = () =>
  localStorageStore(undefined, CRM_STORE_APP_KEY);
