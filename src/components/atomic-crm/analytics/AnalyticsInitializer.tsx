import { useEffect } from "react";
import { useDataProvider } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import { initEventCollector, getSetting } from "./eventCollector";

const ANALYTICS_ENABLED_KEY = "analytics_collection_enabled";

/**
 * Initializes the first-party analytics event collector for the current account.
 * Reads the account ID from the active context and the user's analytics preference.
 * Story 15.2: First-party analytics collection for PRD §18 metrics.
 */
export const AnalyticsInitializer = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();

  useEffect(() => {
    const init = async () => {
      try {
        // Get account ID from the server-side context pointer
        const accountId = await dataProvider.getCurrentAccountId?.();
        if (!accountId) return;

        // Check local storage for user's analytics preference
        const localEnabled = await getSetting<boolean>(ANALYTICS_ENABLED_KEY);
        const enabled = localEnabled ?? true; // Default to enabled if not set

        // Initialize the event collector
        await initEventCollector(accountId.toString(), enabled);
      } catch {
        // Silently fail - analytics is non-critical
      }
    };

    init();
  }, [dataProvider]);

  return null;
};
