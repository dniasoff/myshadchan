import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import { CoreAdminContext, ListContextProvider } from "ra-core";
import type { ListControllerResult } from "ra-core";

// Real fixed-position geometry against the real `--mobile-nav-*` custom
// properties — meaningless without the stylesheet that declares them.
import "@/index.css";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { BulkActionsToolbar } from "./bulk-actions-toolbar";

/**
 * The toolbar is `fixed` at the bottom of the viewport, which on a phone is
 * exactly where MobileNavigation lives (`--mobile-nav-h`, 64px, z-50). Parked
 * at `bottom-2` it renders *behind* the nav: select-all, export and delete are
 * all present, enabled, and impossible to tap. The DataTable that renders it
 * is desktop-only today, so this is a trap armed for whoever first gives a
 * list a mobile surface rather than a bug a user can hit right now.
 */
const MOBILE_NAV_H_PX = 64;

const PHONE = { width: 375, height: 720 } as const;

/** What the rest of the browser suite expects going in — restored after every
 * test so none of these depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DESKTOP = { width: 1280, height: 720 } as const;

const listContextWithSelection = () =>
  ({
    selectedIds: [1, 2],
    onUnselectItems: () => {},
  }) as unknown as ListControllerResult;

const renderToolbar = () =>
  render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <ListContextProvider value={listContextWithSelection()}>
        <BulkActionsToolbar>
          <span data-role="bulk-action">Delete</span>
        </BulkActionsToolbar>
      </ListContextProvider>
    </CoreAdminContext>,
  );

/** The toolbar Card: the only fixed-position element the component renders. */
const toolbarCard = (container: HTMLElement) =>
  container.querySelector('[data-slot="card"]') as HTMLElement;

describe("BulkActionsToolbar placement", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
  });

  it("clears the mobile navigation bar on a phone", async () => {
    // Arrange
    await page.viewport(PHONE.width, PHONE.height);

    // Act
    const screen = await renderToolbar();
    const card = toolbarCard(screen.container);

    // Assert — the gap between the toolbar's bottom edge and the viewport's
    // is at least the nav's own height, so the nav cannot cover it.
    const gapFromBottom =
      window.innerHeight - card.getBoundingClientRect().bottom;
    expect(gapFromBottom).toBeGreaterThanOrEqual(MOBILE_NAV_H_PX);
  });

  it("stays where it was at the bottom of a desktop viewport", async () => {
    // Arrange — the pair: there is no bottom nav from `md` up, and lifting the
    // toolbar 72px off the floor there would be a gratuitous regression.
    await page.viewport(DESKTOP.width, DESKTOP.height);

    // Act
    const screen = await renderToolbar();
    const card = toolbarCard(screen.container);

    // Assert — `bottom-2`, i.e. 8px.
    const gapFromBottom =
      window.innerHeight - card.getBoundingClientRect().bottom;
    expect(gapFromBottom).toBeCloseTo(8, 0);
  });
});
