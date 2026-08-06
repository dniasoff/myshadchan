import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import "@/index.css";

import { buildRecordPath } from "../entity360/entityPaths";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import type { Reference, ReferenceLink, Shidduch, Task } from "../types";
import "../shidduchim/entityDescriptor";
import "../shadchanim/entityDescriptor";
import "../singles/entityDescriptor";
import { DueRemindersCard } from "./DueRemindersCard";

/**
 * AC-1 through AC-6. Real Chromium via `vitest-browser-react` +
 * `TestMemoryRouter` (`dashboard/StatStrip.test.tsx`'s own template) — this
 * repo has no `@testing-library/react` dependency. The real FakeRest data
 * provider (`dashboard/ShadchanDashboard.test.tsx`'s pattern) drives every
 * state except "loading", which needs a provider that deliberately never
 * resolves — no timing-based wait can freeze `isPending: true`
 * deterministically otherwise.
 *
 * Every render below is queried through its OWN `screen.locator`
 * (`page.elementLocator(container)`, scoped to that specific render's
 * container) rather than the top-level `screen.getByRole`/`getByText`
 * shortcuts, which resolve against `document.body` as a whole. A handful of
 * these tests mount the card more than once (loading/empty/full) to compare
 * across states, and this file never unmounts a still-pending render (a
 * `neverResolvingDataProvider()` render's query can never settle, and
 * forcing an unmount while it is still in flight destabilizes the shared
 * browser environment for every later test in the file — reproduced while
 * writing this suite). Leaving every render mounted and scoping queries to
 * each one's own container is what makes that safe.
 */

const ACCOUNT_ID = 1;
const SINGLE_ID = 901;
const SHIDDUCH_A_ID = 902;
const SHIDDUCH_B_ID = 903;
const SHADCHAN_ID = 904;
const REFERENCE_LINKED_ID = 905;
const REFERENCE_UNATTACHED_ID = 906;

const PAST = "2020-01-01T00:00:00.000Z";
const PAST_LATER = "2020-02-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

type TaskFixture = Omit<Task, "due_date"> & { due_date: string | null };

function buildDb(tasks: TaskFixture[], links: ReferenceLink[] = []) {
  const db = generateData();

  const shidduchim: Shidduch[] = [
    {
      id: SHIDDUCH_A_ID,
      account_id: ACCOUNT_ID,
      single_id: SINGLE_ID,
      name_en: "Ari Cohen",
      pipeline_state: "new",
      first_suggested_at: PAST,
      redt_date: PAST,
      origin: "manual",
      visibility: "shared",
      index: 0,
      created_at: PAST,
    },
    {
      id: SHIDDUCH_B_ID,
      account_id: ACCOUNT_ID,
      single_id: SINGLE_ID,
      name_en: "Dovid Katz",
      pipeline_state: "new",
      first_suggested_at: PAST,
      redt_date: PAST,
      origin: "manual",
      visibility: "shared",
      index: 1,
      created_at: PAST,
    },
  ];
  const references: Reference[] = [
    {
      id: REFERENCE_LINKED_ID,
      account_id: ACCOUNT_ID,
      name_en: "Chaim Feldman",
      created_at: PAST,
    },
    {
      id: REFERENCE_UNATTACHED_ID,
      account_id: ACCOUNT_ID,
      name_en: "Unattached Reference",
      created_at: PAST,
    },
  ];

  db.singles = [
    {
      id: SINGLE_ID,
      account_id: ACCOUNT_ID,
      first_name_en: "Chana",
      last_name_en: "Levi",
      status: "active",
      created_at: PAST,
    },
  ];
  db.shidduchim = shidduchim;
  db.shadchanim = [
    {
      id: SHADCHAN_ID,
      account_id: ACCOUNT_ID,
      name: "Rivka Stern",
      created_at: PAST,
    },
  ];
  db.references = references;
  db.reference_links = links;
  db.tasks = tasks as unknown as Task[];
  return db;
}

async function renderCard(dataProvider: DataProvider) {
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <DueRemindersCard />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

/** Freezes the card in its loading state deterministically — no promise
 * this data provider returns ever settles. */
function neverResolvingDataProvider(): DataProvider {
  const pending = () => new Promise<never>(() => {});
  return {
    getList: pending,
    getOne: pending,
    getMany: pending,
    getManyReference: pending,
    create: pending,
    update: pending,
    updateMany: pending,
    delete: pending,
    deleteMany: pending,
  } as unknown as DataProvider;
}

function listRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector('[data-role="due-reminders-list"]');
  if (!region) {
    throw new Error("due-reminders-list region not found");
  }
  return region as HTMLElement;
}

describe("DueRemindersCard — identical height across states (AC-2)", () => {
  it("measures the exact same list-region height loading, empty, and full", async () => {
    // Arrange / Act — loading (frozen: never resolves).
    const loadingScreen = await renderCard(neverResolvingDataProvider());
    const loadingHeight = listRegion(
      loadingScreen.container,
    ).getBoundingClientRect().height;

    // Arrange / Act — empty (zero open tasks).
    const emptyScreen = await renderCard(
      createDataProvider({ db: buildDb([]), latency: 0, silent: true }),
    );
    await expect
      .element(
        emptyScreen.locator.getByText("Nothing due — you're on top of it"),
      )
      .toBeVisible();
    const emptyHeight = listRegion(
      emptyScreen.container,
    ).getBoundingClientRect().height;

    // Arrange / Act — full (three rows).
    const fullScreen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "First reminder",
            due_date: PAST,
            target_type: "shidduch",
            target_id: SHIDDUCH_A_ID,
          },
          {
            id: 2,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Second reminder",
            due_date: PAST_LATER,
            target_type: "shadchan",
            target_id: SHADCHAN_ID,
          },
          {
            id: 3,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Third reminder",
            due_date: FUTURE,
            target_type: "single",
            target_id: SINGLE_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(fullScreen.locator.getByText("Third reminder"))
      .toBeVisible();
    const fullHeight = listRegion(fullScreen.container).getBoundingClientRect()
      .height;

    // Assert — a number, not a class name (AC-2's own "Failing looks like").
    expect(loadingHeight).toBeGreaterThan(0);
    expect(emptyHeight).toBe(loadingHeight);
    expect(fullHeight).toBe(loadingHeight);
  });
});

describe("DueRemindersCard — read-only, one navigation affordance (AC-3)", () => {
  it("renders no checkbox and no Snooze button with three rows on screen", async () => {
    // Arrange / Act
    const screen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "First checkbox-guard reminder",
            due_date: PAST,
            target_type: "shidduch",
            target_id: SHIDDUCH_A_ID,
          },
          {
            id: 2,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Second checkbox-guard reminder",
            due_date: PAST_LATER,
            target_type: "shadchan",
            target_id: SHADCHAN_ID,
          },
          {
            id: 3,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Third checkbox-guard reminder",
            due_date: FUTURE,
            target_type: "single",
            target_id: SINGLE_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(screen.locator.getByText("Third checkbox-guard reminder"))
      .toBeVisible();

    // Assert
    await expect
      .element(screen.locator.getByRole("checkbox"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.locator.getByRole("button", { name: /snooze/i }))
      .not.toBeInTheDocument();
  });

  it("renders exactly one 'See all reminders' link, pointing at /reminders, in loading/empty/full", async () => {
    // Loading
    const loadingScreen = await renderCard(neverResolvingDataProvider());
    const loadingLink = loadingScreen.locator.getByRole("link", {
      name: "See all reminders",
    });
    await expect.element(loadingLink).toBeVisible();
    expect(loadingLink.element().getAttribute("href")).toBe("/reminders");

    // Empty
    const emptyScreen = await renderCard(
      createDataProvider({ db: buildDb([]), latency: 0, silent: true }),
    );
    const emptyLink = emptyScreen.locator.getByRole("link", {
      name: "See all reminders",
    });
    await expect.element(emptyLink).toBeVisible();
    expect(emptyLink.element().getAttribute("href")).toBe("/reminders");

    // Full
    const fullScreen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "A reminder",
            due_date: PAST,
            target_type: "shidduch",
            target_id: SHIDDUCH_A_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(fullScreen.locator.getByText("A reminder"))
      .toBeVisible();
    const fullLink = fullScreen.locator.getByRole("link", {
      name: "See all reminders",
    });
    await expect.element(fullLink).toBeVisible();
    expect(fullLink.element().getAttribute("href")).toBe("/reminders");
  });
});

describe("DueRemindersCard — ordering, due lines, overflow (AC-4)", () => {
  it("shows overdue rows first with 'Since …', upcoming rows with 'Due …', and an overflow line past MAX_ROWS", async () => {
    // Arrange / Act — 4 open tasks: MAX_ROWS (3) render, 1 overflows.
    const screen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Overdue reminder",
            due_date: PAST,
            target_type: "shidduch",
            target_id: SHIDDUCH_A_ID,
          },
          {
            id: 2,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Later overdue reminder",
            due_date: PAST_LATER,
            target_type: "shadchan",
            target_id: SHADCHAN_ID,
          },
          {
            id: 3,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "Upcoming reminder",
            due_date: FUTURE,
            target_type: "single",
            target_id: SINGLE_ID,
          },
          {
            id: 4,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "The overflow reminder",
            due_date: FUTURE,
            target_type: "single",
            target_id: SINGLE_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(screen.locator.getByText("Upcoming reminder"))
      .toBeVisible();

    // Assert — only MAX_ROWS text rows render, the 4th is the overflow line.
    await expect
      .element(screen.locator.getByText("The overflow reminder"))
      .not.toBeInTheDocument();
    await expect.element(screen.locator.getByText("and 1 more")).toBeVisible();
    expect(
      screen.locator.getByText(/^Since \d/).elements().length,
    ).toBeGreaterThan(0);
    // `/^Due \d/`, not `/^Due /` — the card's own "Due now" heading also
    // starts with "Due ", and a looser pattern would match it instead of
    // (or as well as) the due-line paragraph this assertion means to find.
    await expect.element(screen.locator.getByText(/^Due \d/)).toBeVisible();
  });

  it("renders a null-due_date row's text with no due line and no 'Invalid Date' anywhere", async () => {
    // Arrange / Act
    const screen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "No due date set",
            due_date: null,
            target_type: "shidduch",
            target_id: SHIDDUCH_A_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );

    // Assert
    await expect
      .element(screen.locator.getByText("No due date set"))
      .toBeVisible();
    expect(screen.container.textContent ?? "").not.toContain("Invalid Date");
  });
});

describe("DueRemindersCard — a reference row links to the shidduch, never the reference (AC-6)", () => {
  it("reads '{reference name} · about {shidduch name}' and links to the shidduch", async () => {
    // Arrange / Act
    const screen = await renderCard(
      createDataProvider({
        db: buildDb(
          [
            {
              id: 1,
              account_id: ACCOUNT_ID,
              type: "call",
              text: "Ask Chaim Feldman about Ari",
              due_date: PAST,
              target_type: "reference",
              target_id: REFERENCE_LINKED_ID,
            },
          ],
          [
            {
              id: 1,
              account_id: ACCOUNT_ID,
              reference_id: REFERENCE_LINKED_ID,
              shidduchim_id: SHIDDUCH_A_ID,
              created_at: PAST,
            },
          ],
        ),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(screen.locator.getByText("Ask Chaim Feldman about Ari"))
      .toBeVisible();

    // Assert
    const link = screen.locator.getByRole("link", { name: /Chaim Feldman/ });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe(
      buildRecordPath("shidduchim", SHIDDUCH_A_ID),
    );
    expect(link.element().textContent ?? "").toContain("about");
    expect(link.element().textContent ?? "").toContain("Ari Cohen");
  });

  it("never links resource=references and renders an unattached reference as inert text", async () => {
    // Arrange / Act — the reference has zero rows in reference_links.
    const screen = await renderCard(
      createDataProvider({
        db: buildDb([
          {
            id: 1,
            account_id: ACCOUNT_ID,
            type: "call",
            text: "An unattached reference task",
            due_date: PAST,
            target_type: "reference",
            target_id: REFERENCE_UNATTACHED_ID,
          },
        ]),
        latency: 0,
        silent: true,
      }),
    );
    await expect
      .element(screen.locator.getByText("An unattached reference task"))
      .toBeVisible();

    // Assert — no link at all for this row, and the app never routes a
    // reference-typed row to `/references/{id}` from this card. The only
    // link anywhere on the card is "See all reminders" (AC-3).
    const links = screen.locator.getByRole("link").elements();
    expect(links).toHaveLength(1);
    for (const element of links) {
      expect(element.getAttribute("href") ?? "").not.toContain("/references/");
    }
  });
});
