import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MyContext } from "../types";
import { ShadchanListingSection } from "./ShadchanListingSection";

/**
 * Story 9.1 — the Settings wiring's own active-context gate, mirroring
 * `ConnectionSection.test.tsx`'s household/shadchanus split: a household
 * has no shadchan listing of its own, so this must render nothing there,
 * exactly the same shape as every other kind-gated settings panel.
 */

const householdContext: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const shadchanContext: MyContext = {
  account_id: 9,
  kind: "shadchanus",
  name: "Rivka the Shadchan",
  role: "shadchan",
  is_active: true,
};

const renderSection = async (context: MyContext) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ShadchanListingSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ShadchanListingSection", () => {
  it("renders nothing for a household active context", async () => {
    // Arrange / Act
    const { screen, dataProvider } = await renderSection(householdContext);

    // Assert — review finding F3: asserting `.not.toBeInTheDocument()` on the
    // "Publish my listing" BUTTON is satisfied by the panel's own loading
    // skeleton too (it has no button while `isPending`), so it stayed green
    // even with the kind-gate deleted entirely. The panel's title text
    // (`SectionLabel`) renders synchronously in BOTH the skeleton and the
    // loaded form, on the very first commit — checked here without
    // `.element()` polling, the same synchronous-container idiom
    // `RepeatRecognitionPanel.test.tsx` uses, so a regression is caught
    // immediately rather than only outside whatever window `.element()`
    // happens to poll before the async fetch resolves. `getList` never
    // being called is the more direct proof still: `useShadchanListing`
    // calls it unconditionally whenever `PublishShadchanListingSection`
    // mounts at all, so this is deterministic evidence the component
    // subtree never mounted, not merely that it hadn't finished loading.
    expect(screen.container.textContent ?? "").not.toContain(
      "Publish my listing",
    );
    expect(dataProvider.getList).not.toHaveBeenCalled();
  });

  it("renders the publish panel for a shadchanus active context", async () => {
    // Arrange / Act
    const { screen, dataProvider } = await renderSection(shadchanContext);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Publish my listing" }))
      .toBeInTheDocument();
    await expect
      .poll(
        () =>
          (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
  });
});
