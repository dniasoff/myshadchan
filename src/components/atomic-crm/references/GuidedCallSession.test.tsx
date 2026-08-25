import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import { GuidedCallSession } from "./GuidedCallSession";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ReferenceLinkSummary } from "../types";
import type { CrmDataProvider } from "../providers/types";

// Real Tailwind stylesheet must apply for computed geometry assertions
import "@/index.css";

/** Default viewport restored after each test so suites stay isolated. */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

const mockLink: ReferenceLinkSummary = {
  id: "123",
  account_id: "acc-1",
  reference_id: "ref-1",
  shidduchim_id: "shid-1",
  effective_relationship: null,
  conversation_log_count: 0,
  reference_name_en: "Test Reference",
  reference_name_he: null,
  reference_phone: null,
  shidduch_name_en: "Test Shidduch",
  shidduch_name_he: null,
  shidduch_pipeline_state: null,
  shidduch_visibility: null,
  single_id: null,
  single_first_name_en: null,
  single_first_name_he: null,
  call_status: null,
  what_they_said: null,
  conversation_log: null,
  relationship_override: null,
  created_at: new Date().toISOString(),
};

const mockLinkWithRelationship: ReferenceLinkSummary = {
  ...mockLink,
  effective_relationship: "teacher",
};

const links = [mockLink];
const linksWithRelationship = [mockLinkWithRelationship];

const createFakeDataProvider = () => {
  const calls: Array<{
    reference_link_id: string;
    what_they_said: string | null;
    source: "manual" | "assistant";
    call_status?: string | null;
  }> = [];

  return {
    dataProvider: {
      logReferenceCall: vi.fn(
        async (input: {
          reference_link_id: string;
          what_they_said: string | null;
          source: "manual" | "assistant";
          call_status?: string | null;
        }) => {
          calls.push(input);
          return { id: "new-log" } as any;
        },
      ),
      getList: vi.fn(async () => ({ data: [], total: 0 })),
    } as unknown as CrmDataProvider,
    getCalls: () => calls,
  };
};

const renderWithRouter = async (
  initialEntry: string,
  testLinks: ReferenceLinkSummary[] = links,
  fakeDataProvider: ReturnType<typeof createFakeDataProvider>["dataProvider"],
) => {
  const screen = await render(
    <TestMemoryRouter initialEntries={[initialEntry]}>
      <CoreAdminContext
        i18nProvider={testI18nProvider}
        dataProvider={fakeDataProvider}
      >
        <ResourceContextProvider value="references">
          <GuidedCallSession links={testLinks} />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return screen;
};

describe("GuidedCallSession", () => {
  it("null relationship still renders questions", async () => {
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const questionText = screen.getByTestId("current-question");
    await expect
      .element(questionText)
      .toHaveTextContent("How long have you known them, and in what setting?");
  });

  it("out-of-range step clamps to the last question", async () => {
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=99",
      linksWithRelationship,
      dataProvider,
    );

    const lastQuestion = screen.getByTestId("current-question");
    await expect
      .element(lastQuestion)
      .toHaveTextContent(
        "Is there anything you think we should know that we have not asked about?",
      );
  });

  it("save path passes the exact arguments", async () => {
    const { dataProvider, getCalls } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const textarea = screen.getByPlaceholder("Type their answer here…");
    await textarea.fill("They said something important");

    const saveButton = screen.getByRole("button", { name: /save and next/i });
    await saveButton.click();

    const calls = getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      reference_link_id: "123",
      what_they_said: "They said something important",
      source: "assistant",
    });
  });
});

describe("GuidedCallSession responsive layout (AC-11)", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("shows the current question at 390px", async () => {
    await page.viewport(390, 720);
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const question = screen.getByTestId("current-question");
    await expect.element(question).toBeVisible();
  });

  it("shows the answer textarea at 390px", async () => {
    await page.viewport(390, 720);
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const textarea = screen.getByPlaceholder("Type their answer here…");
    await expect.element(textarea).toBeVisible();
  });

  it("shows the primary action button at 390px", async () => {
    await page.viewport(390, 720);
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const saveButton = screen.getByRole("button", { name: /save and next/i });
    await expect.element(saveButton).toBeVisible();
  });

  it("has no horizontal overflow at 390px", async () => {
    await page.viewport(390, 720);
    const { dataProvider } = createFakeDataProvider();
    const screen = await renderWithRouter(
      "/references/1?call=123&step=1",
      links,
      dataProvider,
    );

    const question = screen.getByTestId("current-question");
    await expect.element(question).toBeVisible();

    // scrollWidth on the sheet content does NOT detect horizontal overflow here:
    // the sheet has className "max-h-[92dvh] overflow-y-auto" (vertical only),
    // so overflow-x remains visible. Descendants wider than the viewport simply
    // spill out without growing the scroll container's scrollWidth.
    const sheet = document.body.querySelector('[data-slot="sheet-content"]');
    expect(sheet).toBeInTheDocument();
    const rect = sheet!.getBoundingClientRect();
    let maxRight = 0;
    sheet!.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > maxRight) maxRight = r.right;
    });
    expect(maxRight).toBeLessThanOrEqual(rect.right + 1);
  });
});
