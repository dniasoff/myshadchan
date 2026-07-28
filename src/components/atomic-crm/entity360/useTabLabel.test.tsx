import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { TAB_KEYS, TAB_LABELS, tabLabelKey, type TabKey } from "./tabKeys";
import { useTabLabel } from "./useTabLabel";

/**
 * Story 3-10 AC 3: three falsifiable assertions plus a subordinate one. A
 * suite that only proved the explicit-override case would prove nothing
 * about i18n and would stay green while the feature it guards is inert —
 * (c) below is the one that must go red if resolution bypasses the catalog.
 */

function TabLabelProbe({
  tabKey,
  override,
}: {
  tabKey: TabKey;
  override?: string;
}) {
  return <span>{useTabLabel(tabKey, override)}</span>;
}

const renderProbe = (
  tabKey: TabKey,
  override: string | undefined,
  i18nProvider: typeof testI18nProvider,
) =>
  render(
    <CoreAdminContext i18nProvider={i18nProvider}>
      <TabLabelProbe tabKey={tabKey} override={override} />
    </CoreAdminContext>,
  );

// A second catalog, independent of testI18nProvider, with
// crm.entity360.tab.shidduchim overridden to a value that differs from
// TAB_LABELS.shidduchim ("Shidduchim"). If anything between the descriptor
// and useTabLabel synthesised an override out of TAB_LABELS instead of
// consulting the i18nProvider, this override would never be seen and
// assertion (c) below would fail.
const registeredCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  englishCrmMessages,
  { crm: { entity360: { tab: { shidduchim: "Registered translation" } } } },
);
const registeredI18nProvider = polyglotI18nProvider(
  () => registeredCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);

describe("useTabLabel — catalog round-trip (AC 3a)", () => {
  it("resolves every TabKey through the real catalog to its canonical label", () => {
    // Arrange / Act / Assert
    for (const key of TAB_KEYS) {
      expect(testI18nProvider.translate(tabLabelKey(key))).toBe(
        TAB_LABELS[key],
      );
    }
  });
});

describe("useTabLabel — label-less descriptor (AC 3b)", () => {
  it("renders the canonical label when no override is given", async () => {
    // Arrange / Act
    const screen = await renderProbe("shidduchim", undefined, testI18nProvider);

    // Assert
    await expect.element(screen.getByText("Shidduchim")).toBeInTheDocument();
  });
});

describe("useTabLabel — registered translation beats the canonical label (AC 3c)", () => {
  it("prefers a catalog translation over TAB_LABELS for a label-less descriptor", async () => {
    // Arrange / Act
    const screen = await renderProbe(
      "shidduchim",
      undefined,
      registeredI18nProvider,
    );

    // Assert — the registered string wins; the canonical fallback never
    // appears.
    await expect
      .element(screen.getByText("Registered translation"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Shidduchim"))
      .not.toBeInTheDocument();
  });
});

describe("useTabLabel — explicit override (subordinate case)", () => {
  it("returns the override even when a catalog translation is registered", async () => {
    // Arrange / Act
    const screen = await renderProbe(
      "shidduchim",
      "Linked shidduchim",
      registeredI18nProvider,
    );

    // Assert
    await expect
      .element(screen.getByText("Linked shidduchim"))
      .toBeInTheDocument();
  });
});
