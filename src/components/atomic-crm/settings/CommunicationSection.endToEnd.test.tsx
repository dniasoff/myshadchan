import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { CommunicationSection } from "./CommunicationSection";

/**
 * Story 7.5 — review finding: `CommunicationSection.test.tsx` exercises the
 * "Private" radio against a MOCKED dataProvider, which only proves the
 * control CALLS `dataProvider.update(...)` with the right arguments. It
 * cannot prove the setting actually changes what a new thread's visibility
 * resolves to — un-greying the control is not the same claim as "private
 * enforcement is live and this setting drives it." This file wires the
 * control to the REAL FakeRest dataProvider (the same AD-10 mirror
 * production and `dataProvider.createThread.test.ts` both exercise) and
 * follows ONE write all the way through: click "Private" in the real UI ->
 * `accounts.default_thread_visibility` persists `'private'` through the
 * real round trip -> a NEW thread created with NO explicit `visibility`
 * (the exact call shape `ThreadList.tsx`'s "Start a discussion" button
 * uses) resolves to `'private'`.
 *
 * The default demo seed's only `account_members` row is `user_id: "0"`,
 * `parent_admin` on `accounts[0]` (id 1) — the same identity convention
 * `dataProvider.createThread.test.ts` already pins, reused here so
 * `useMyContexts()`/`useViewerRole()` resolve for real, with no module
 * mock (contrast `CommunicationSection.test.tsx`'s own `useViewerRole`
 * mock, needed there only to force the "still pending" case).
 */

const PARENT_USER_ID = 0;
const ACCOUNT_ID = 1;

describe("CommunicationSection -> createThread() — the private default actually takes effect (Story 7.5)", () => {
  it("selecting 'Private' persists the account default, and a NEW thread with no explicit visibility comes out private", async () => {
    // Arrange
    const db = generateData();
    db.accounts[0].default_thread_visibility = "open";
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: PARENT_USER_ID }) },
    });

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <CommunicationSection />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — starts 'open', matching the seed.
    await expect
      .element(screen.getByRole("radio", { name: /Open/ }))
      .toBeChecked();

    // Act — flip the account's default through the REAL control, not a
    // mocked update() call.
    await screen.getByRole("radio", { name: /Private/ }).click();
    await expect
      .element(screen.getByRole("radio", { name: /Private/ }))
      .toBeChecked();

    // Assert — the row actually persisted, through the real dataProvider.
    const { data: account } = await dataProvider.getOne("accounts", {
      id: ACCOUNT_ID,
    });
    expect(account.default_thread_visibility).toBe("private");

    // Act — create a NEW thread the same way `ThreadList.tsx`'s "Start a
    // discussion" button does: no explicit `visibility`. `relationship`
    // needs no shidduch fixture (Story 7.1's account-axis subject check
    // only fires for `subject_type: "shidduch"`), which keeps this test
    // scoped to the one thing under test.
    const thread = await dataProvider.createThread({
      subject_type: "relationship",
    });

    // Assert — the CONSEQUENCE, not just the setting: a brand-new thread
    // with nothing overriding the default comes out private.
    expect(thread.visibility).toBe("private");
  });
});
