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

/**
 * Pins Task 5's live-code edit: confirming a catch suggestion must redirect
 * through `entity360/entityPaths.ts`'s `buildRecordPath` — never a
 * hand-built `/shidduchim/${id}/show` literal — while leaving
 * `{ _scrollToTop: false }` untouched. AD-24 (contract §4): nothing but
 * `entityPaths.ts` builds a record path.
 */

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
  it("redirects to the prior suggestion's buildRecordPath target when confirmed", async () => {
    // Arrange
    const { screen, getPathname } = await renderSection();

    // Act
    await screen.getByRole("button", { name: /Confirm match/i }).click();

    // Assert — today's real AD-24 shape for an unmigrated entity
    // (`/shidduchim/{id}/show`, per the stub descriptor); Epic 5's one-line
    // `buildRecordPath` flip changes this automatically.
    expect(getPathname()).toBe("/shidduchim/42/show");
  });
});
