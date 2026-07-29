import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import type { ReferenceLinkSummary } from "../types";
import { RepeatRecognitionPanel } from "./RepeatRecognitionPanel";

/**
 * RULING 7 verification finding: `ReferenceShow.tsx` destructured only
 * `{ links }` from `useReferenceLinks` and dropped `isPending`, so while the
 * `reference_links` query is in flight `links` is `[]` — indistinguishable,
 * from this panel's own props, from a reference that genuinely has no other
 * conversations. Before `isPending` was threaded through, that pending frame
 * rendered the exact "No other conversations with this person yet." copy on
 * a reference that turns out to have two — the opposite of what repeat
 * recognition (FR42) promises, at the exact moment the owner asked for it by
 * name.
 *
 * These tests render the panel directly with a controlled `isPending`, so
 * they lock the panel's own render contract regardless of how a future
 * caller sources its data (`ReferenceShow.test.tsx`-style wiring tests are a
 * separate concern from this file's).
 */

const SHIDDUCHIM_RESOURCE = "shidduchim";

const registerFixtureDescriptor = () => {
  const descriptor: EntityDescriptor = {
    name: SHIDDUCHIM_RESOURCE,
    label: "Shidduchim",
    buildRecordPath: (id) => `/${SHIDDUCHIM_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

let nextId = 1;
const buildLink = (
  overrides: Partial<ReferenceLinkSummary> = {},
): ReferenceLinkSummary => ({
  id: nextId++,
  account_id: 1,
  reference_id: 1,
  shidduchim_id: 10,
  call_status: "not_started",
  created_at: "2026-01-01T00:00:00Z",
  conversation_log_count: 0,
  shidduch_name_en: "Sara Klein",
  ...overrides,
});

const renderPanel = async (
  props: Partial<ComponentProps<typeof RepeatRecognitionPanel>> = {},
) => {
  registerFixtureDescriptor();
  const dataProvider = {} as unknown as DataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RepeatRecognitionPanel
          referenceName="Moshe Fried"
          links={[]}
          {...props}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("RepeatRecognitionPanel — isPending (RULING 7 false-empty finding)", () => {
  it("does not show the no-other-conversations empty copy while isPending is true", async () => {
    // Arrange / Act — a reference that DOES have two other conversations,
    // caught mid-flight: `links` is still `[]` because the query has not
    // settled yet, exactly the race the bug report reproduced "once in five
    // runs".
    const screen = await renderPanel({ isPending: true, links: [] });

    // Assert
    await expect
      .element(screen.getByText("No other conversations with this person yet."))
      .not.toBeInTheDocument();
  });

  it("reserves the panel's footprint with a busy skeleton instead of returning null while isPending", async () => {
    // Arrange / Act
    const screen = await renderPanel({ isPending: true, links: [] });

    // Assert — a real placeholder occupies the slot, not a collapsed `null`.
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("still shows the empty copy once settled with genuinely zero links", async () => {
    // Arrange / Act — the query has resolved and there truly is nothing.
    const screen = await renderPanel({ isPending: false, links: [] });

    // Assert
    await expect
      .element(screen.getByText("No other conversations with this person yet."))
      .toBeInTheDocument();
  });

  it("shows the cross-shidduch list once settled with two other conversations", async () => {
    // Arrange
    const links = [
      buildLink({ shidduchim_id: 10, shidduch_name_en: "Sara Klein" }),
      buildLink({ shidduchim_id: 11, shidduch_name_en: "Rivka Weiss" }),
    ];

    // Act
    const screen = await renderPanel({ isPending: false, links });

    // Assert
    await expect
      .element(
        screen.getByText(
          "You have spoken to Moshe Fried about 2 other singles",
        ),
      )
      .toBeInTheDocument();
    await expect.element(screen.getByText("Sara Klein")).toBeInTheDocument();
    await expect.element(screen.getByText("Rivka Weiss")).toBeInTheDocument();
  });
});
