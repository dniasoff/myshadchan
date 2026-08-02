import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 7.2 (AC-3, AC-4): AD-10 parity for the demo build. The real
 * `create_thread()` (02_functions.sql) resolves an omitted `p_visibility`
 * from the caller's account's `default_thread_visibility`; this file's own
 * `createThread` wrapper (`dataProvider.ts`) resolves the same way before
 * delegating to `./internal/threads.ts` — which still falls back to the
 * literal `'open'`, but that branch is unreachable once identity/membership
 * resolve, exactly the case these tests exercise.
 *
 * The default demo seed's only account_member is user_id "0", role
 * `parent_admin` on `db.accounts[0]` (`dataGenerator/shidduchim.ts`) — same
 * identity convention `dataProvider.interactions.test.ts` already pins.
 */

const PARENT_USER_ID = 0;

const makeProvider = (db: Db) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: PARENT_USER_ID }) },
  });

const firstShidduchIdFor = (db: Db, accountId: number | string) => {
  const shidduch = db.shidduchim.find(
    (s) => String(s.account_id) === String(accountId),
  );
  if (!shidduch) {
    throw new Error("fixture has no shidduch for this account");
  }
  return shidduch.id;
};

describe("FakeRest createThread() — account-default visibility resolution (Story 7.2)", () => {
  it("resolves an omitted visibility to the account's 'open' default", async () => {
    // Arrange
    const db = generateData();
    db.accounts[0].default_thread_visibility = "open";
    const subjectId = firstShidduchIdFor(db, db.accounts[0].id);
    const dataProvider = makeProvider(db);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "shidduch",
      subject_id: subjectId,
    });

    // Assert
    expect(thread.visibility).toBe("open");
  });

  it("resolves an omitted visibility to the account's 'private' default", async () => {
    // Arrange
    const db = generateData();
    db.accounts[0].default_thread_visibility = "private";
    const subjectId = firstShidduchIdFor(db, db.accounts[0].id);
    const dataProvider = makeProvider(db);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "shidduch",
      subject_id: subjectId,
    });

    // Assert
    expect(thread.visibility).toBe("private");
  });

  it("an explicit visibility always wins over a 'private' account default", async () => {
    // Arrange
    const db = generateData();
    db.accounts[0].default_thread_visibility = "private";
    const subjectId = firstShidduchIdFor(db, db.accounts[0].id);
    const dataProvider = makeProvider(db);

    // Act
    const thread = await dataProvider.createThread({
      subject_type: "shidduch",
      subject_id: subjectId,
      visibility: "open",
    });

    // Assert
    expect(thread.visibility).toBe("open");
  });
});
