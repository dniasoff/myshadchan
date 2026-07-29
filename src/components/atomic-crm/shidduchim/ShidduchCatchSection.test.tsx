import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor so
// `buildRecordPath` (Task 5's replacement for the old hand-built literal)
// resolves through the real registry, exactly as `shidduchim/index.ts` does
// at boot.
import "./entityDescriptor";
import type { CrmDataProvider } from "../providers/types";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ShidduchCatch } from "../types";
import { ShidduchCatchSection } from "./ShidduchCatchSection";
import { buildRecordPath } from "../entity360/entityPaths";
import type * as EntityPaths from "../entity360/entityPaths";

/**
 * Pins Task 5's live-code edit: confirming a catch suggestion must redirect
 * through `entity360/entityPaths.ts`'s `buildRecordPath` — never a
 * hand-built `/shidduchim/${id}/show` literal — while leaving
 * `{ _scrollToTop: false }` untouched. AD-24 (contract §4): nothing but
 * `entityPaths.ts` builds a record path.
 *
 * F2 fix (Story 3-11 review): the resulting pathname alone does NOT
 * distinguish this from the pre-fix bypass,
 * `requireEntityDescriptor("shidduchim").buildRecordPath(id)` — both
 * resolve to the identical string against today's stub descriptor, so a
 * pathname-only assertion passed against either implementation and proved
 * nothing about which one is wired. `../entity360/entityPaths` is mocked
 * below so the test can assert its OWN exported `buildRecordPath` is the
 * function actually called.
 */
vi.mock("../entity360/entityPaths", async (importOriginal) => {
  const actual = await importOriginal<typeof EntityPaths>();
  return { ...actual, buildRecordPath: vi.fn(actual.buildRecordPath) };
});

const CATCH: ShidduchCatch = {
  has_catch: true,
  suggestions: [
    {
      prior_shidduchim_id: 42,
      confidence: 0.9,
      deciding_facts: [{ signal: "phone", detail: "phone number matches" }],
      name_en: "Chaya Cohen",
      pipeline_state: "new",
    },
  ],
  dates: [],
};

const renderSection = async () => {
  const dataProvider = {
    catchShidduch: () => Promise.resolve(CATCH),
  } as unknown as CrmDataProvider;
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      locationCallback={(location) => (pathname = location.pathname)}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ShidduchCatchSection shidduchimId={7} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("ShidduchCatchSection — confirm redirect (Task 5)", () => {
  it("redirects via entity360/entityPaths.ts's buildRecordPath, never a hand-built bypass", async () => {
    // Arrange
    const { screen, getPathname } = await renderSection();

    // Act
    await screen.getByRole("button", { name: /Confirm match/i }).click();

    // Assert — today's real AD-24 shape for an unmigrated entity
    // (`/shidduchim/{id}/show`, per the stub descriptor); Epic 5's one-line
    // `buildRecordPath` flip changes this automatically.
    expect(getPathname()).toBe("/shidduchim/42/show");
    // Assert — independently of the string it happens to produce today,
    // that it got there by calling entity360/entityPaths.ts's OWN
    // `buildRecordPath` (F2 fix, Story 3-11 review): the pre-fix bypass
    // resolves to the identical pathname and would otherwise pass this test
    // unnoticed.
    expect(vi.mocked(buildRecordPath)).toHaveBeenCalledExactlyOnceWith(
      "shidduchim",
      42,
    );
  });
});
