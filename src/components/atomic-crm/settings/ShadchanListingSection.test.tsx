import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
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

/**
 * `store` defaults to a FRESH `memoryStore()` per call, not
 * `CoreAdminContext`'s own module-level singleton default, for the same
 * test-isolation reason `settings/SingleListingSection.test.tsx` and
 * `layout/DemoBanner.test.tsx` both give: the singleton would leak the
 * `activeContext.lastKnownKind` hint one test writes into another's render.
 */
const renderSection = async (
  context: MyContext,
  {
    store = memoryStore(),
    pendingForever = false,
  }: { store?: Store; pendingForever?: boolean } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (!pendingForever) {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  }
  const dataProvider = {
    getMyContexts: vi.fn(() =>
      pendingForever ? new Promise(() => {}) : Promise.resolve([context]),
    ),
    getList: vi.fn(() =>
      pendingForever
        ? new Promise(() => {})
        : Promise.resolve({ data: [], total: 0 }),
    ),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
        store={store}
      >
        <ShadchanListingSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, store };
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

/**
 * CLS fix (Epic 9 layout-shift regression sweep — see this component's own
 * Dev Notes and `root/activeContextKindHint.ts`). Every assertion here is
 * synchronous against `container` with a `pendingForever` dataProvider,
 * the same `layout/DemoBanner.test.tsx` / `settings/
 * SingleListingSection.test.tsx` idiom: `expect.element(...)` retries, so
 * it would pass just as happily on a skeleton that popped in three renders
 * late — i.e. it could not fail on the bug being fixed.
 */
describe("ShadchanListingSection — CLS fix (reserved height on first paint)", () => {
  it("renders the publish-listing skeleton on the first paint when the hint says shadchanus", async () => {
    // Arrange — `useMyContexts()` never resolves; only the hint is available.
    const store = memoryStore({ "activeContext.lastKnownKind": "shadchanus" });

    // Act
    const { screen } = await renderSection(shadchanContext, {
      store,
      pendingForever: true,
    });

    // Assert — synchronously present, i.e. the card is already at its
    // final height. This is the assertion that is RED on the pre-fix code
    // (which returned `null` unconditionally while pending).
    expect(screen.container.textContent ?? "").toContain("Publish my listing");
  });

  it("renders nothing on the first paint when the hint says household", async () => {
    // Arrange — a hint of "not shadchanus" must not reserve space nobody
    // needs, mirroring `DemoBanner.test.tsx`'s identical assertion for its
    // own boolean.
    const store = memoryStore({ "activeContext.lastKnownKind": "household" });

    // Act
    const { screen } = await renderSection(householdContext, {
      store,
      pendingForever: true,
    });

    // Assert
    expect(screen.container.textContent ?? "").not.toContain(
      "Publish my listing",
    );
  });

  it("renders nothing on the first paint when there is no hint", async () => {
    // Arrange — first-ever visit to the app: no hint has ever been
    // written. Fails TOWARD nothing, never toward a guess.
    // Act
    const { screen } = await renderSection(shadchanContext, {
      pendingForever: true,
    });

    // Assert
    expect(screen.container.textContent ?? "").not.toContain(
      "Publish my listing",
    );
  });
});
