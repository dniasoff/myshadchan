import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  mergeTranslations,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";

import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { buildEntityRoutes } from "./buildEntityRoutes";
import type { EntityDescriptor } from "./entityDescriptor";
import { EntityShow } from "./EntityShow";
import { registerEntityDescriptor } from "./registry";

/**
 * Contract §2 rule 8 / Story 3.3b AC 8 — "the owner's ruling," restated:
 * `EntityShow` must forward `EntityTabDescriptor.label` verbatim, including
 * `undefined`, to `Entity360Tabs`, and must **never** substitute
 * `TAB_LABELS[tab.key]` itself and pass that on as if it were an explicit
 * override. `useTabLabel.test.tsx` proves the hook itself consults the
 * catalog, and `mergeEntityTabs.test.ts` proves the merge step copies
 * `label` through unchanged — but neither exercises `EntityShow.tsx`'s own
 * render body, which is exactly where the forbidden substitution
 * (`tab.label ?? TAB_LABELS[tab.key]`, handed to `Entity360Tabs` as if it
 * were `tab.label`) would actually be written, and neither test would go
 * red if it were.
 *
 * This test renders the real `EntityShow` with a translation registered for
 * `crm.entity360.tab.overview` that differs from the canonical
 * `TAB_LABELS.overview` ("Overview"), against a descriptor tab that
 * declares **no** `label` — the normal case (contract §2 rule 8). If
 * `EntityShow` ever computed the forbidden substitution, every tab would
 * carry a defined override, `useTabLabel`'s `override ?? translate(...)`
 * would short-circuit before the catalog is ever consulted, and this
 * registered string would never render (adversarial review, Epic 3 step 5,
 * finding 2).
 */

const FIXTURE_RESOURCE = "entity-show-i18n-fixture";
const FIXTURE_RECORD = { id: 1 };

const REGISTERED_OVERVIEW_LABEL = "Registered Overview Label";

const registeredCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  englishCrmMessages,
  { crm: { entity360: { tab: { overview: REGISTERED_OVERVIEW_LABEL } } } },
);
const registeredI18nProvider = polyglotI18nProvider(
  () => registeredCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);

const registerFixtureDescriptor = (
  overrides: Partial<EntityDescriptor> = {},
): void => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
    ...overrides,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

const renderEntityShow = async (initialEntries: string[]) => {
  const dataProvider = {
    getOne: vi.fn().mockResolvedValue({ data: FIXTURE_RECORD }),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as DataProvider;

  return render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={registeredI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          {buildEntityRoutes({ List: () => null, Show: EntityShow })}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("EntityShow — tab labels resolve through the i18n catalog, never a substituted TAB_LABELS[key] (contract §2 rule 8)", () => {
  it("renders the catalog's registered translation for a label-less tab, not the canonical TAB_LABELS fallback", async () => {
    // Arrange
    registerFixtureDescriptor({
      title: () => "i18n Fixture",
      tabs: [{ key: "overview", render: () => <div>OVERVIEW_CONTENT</div> }],
    });

    // Act
    const screen = await renderEntityShow(["/1"]);

    // Assert — the registered catalog translation wins; the canonical
    // TAB_LABELS fallback ("Overview") never appears anywhere in the tab
    // strip. `exact: true` on the negative query matters: without it,
    // "Overview" case-insensitive substring-matches the registered label
    // itself ("Registered Overview Label"), which would make the negative
    // assertion pass for the wrong reason.
    await expect
      .element(
        screen.getByRole("tab", {
          name: REGISTERED_OVERVIEW_LABEL,
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Overview", exact: true }))
      .not.toBeInTheDocument();
  });
});
