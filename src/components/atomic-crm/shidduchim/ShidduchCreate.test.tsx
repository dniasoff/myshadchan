import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot. `buildListPath("shidduchim")`
// (used by the post-save redirect) resolves through it.
import "./entityDescriptor";
import { ShidduchCreate } from "./ShidduchCreate";

/**
 * Pins Story 3.13 AC 1 (page, not dialog) and AC 2 (create behaviour
 * preserved exactly, redirect built through `buildListPath`). Follows
 * `layout/ContextSwitcher.test.tsx:1-10,60-72`'s render + locationCallback
 * shape.
 */

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    // ShidduchInputs' two ReferenceInputs (single_id, shadchan_id) fetch
    // their choice list via getList, and the pre-selected single_id via
    // getMany — both stubbed empty/absent since no test asserts on them.
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockImplementation(async (resource: string) =>
      resource === "inbox_items"
        ? {
            data: {
              id: 700,
              created_at: "2026-11-11T00:00:00Z",
              source: "upload",
              status: "unresolved",
              sender_needs_confirmation: false,
              attachments: null,
            },
          }
        : { data: {} },
    ),
    update: vi.fn().mockImplementation(async (_resource, params) => ({
      data: {
        ...params.previousData,
        ...params.data,
      },
    })),
    uploadInboxAttachment: vi.fn().mockResolvedValue({
      title: "resume.pdf",
      type: "application/pdf",
      path: "1/inbox/700/resume.pdf",
      src: "https://signed.example/resume.pdf",
    }),
    aiEntitlement: vi.fn().mockResolvedValue({
      is_entitled: false,
      plan: "free",
      status: "none",
      resumes_used: 0,
      resumes_limit: 0,
    }),
    createShidduch: vi.fn().mockResolvedValue({ data: { id: 99 } }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderShidduchCreate = async (
  initialEntries: string[],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ShidduchCreate singleId={1} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, getPathname: () => pathname };
};

describe("ShidduchCreate — a page, not a dialog (AC 1)", () => {
  it("renders the heading and no role=dialog element", async () => {
    // Arrange / Act
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Add a suggestion" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ShidduchCreate — create behaviour preserved exactly (AC 2)", () => {
  it("preselects the starting column named by ?state=", async () => {
    // Arrange / Act
    const { screen } = await renderShidduchCreate([
      "/shidduchim/new?state=look_into",
    ]);

    // Assert — the SelectInput's displayed value is the chosen column.
    // Scoped to the labelled control itself: the page also carries a hidden
    // native <option> fallback and helper-text prose that both happen to
    // contain the same words.
    await expect
      .element(screen.getByLabelText("Starting column").getByText("Look-into"))
      .toBeInTheDocument();
  });

  it("falls back to New for an unrecognised ?state=", async () => {
    // Arrange / Act
    const { screen } = await renderShidduchCreate([
      "/shidduchim/new?state=zzz",
    ]);

    // Assert
    await expect
      .element(screen.getByLabelText("Starting column").getByText("New"))
      .toBeInTheDocument();
  });

  it("submits through createShidduch exactly once with origin: manual, never create, and ends at /shidduchim", async () => {
    // Arrange
    const { screen, dataProvider, getPathname } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    await screen.getByLabelText("Name (English)").fill("Chaya");

    // Act
    await screen.getByRole("button", { name: "Add a suggestion" }).click();

    // Assert
    await expect.poll(() => getPathname()).toBe("/shidduchim");
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "manual", single_id: 1 }),
    );
    expect(dataProvider.create).not.toHaveBeenCalled();
  });
});

describe("ShidduchCreate — resume capture and auto-fill affordance", () => {
  it("rejects unsupported files before creating an inbox capture", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);

    await screen
      .getByLabelText("Attach resume")
      .upload(new File(["plain text"], "resume.txt", { type: "text/plain" }));

    await expect
      .element(
        screen.getByText(
          "Please choose a PDF, Word document, JPG, PNG, HEIC, HEIF, or WebP file.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.uploadInboxAttachment).not.toHaveBeenCalled();
  });

  it("accepts Word as an attachment and explains that auto-fill is not available yet", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);

    await screen
      .getByLabelText("Attach resume")
      .upload(new File(["word bytes"], "resume.docx", { type: "" }));

    await expect
      .element(
        screen.getByText(
          "Word auto-fill isn’t available yet, but your file is attached.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.uploadInboxAttachment).toHaveBeenCalledTimes(1);
    expect(dataProvider.update).toHaveBeenCalledWith(
      "inbox_items",
      expect.objectContaining({ data: { attachments: [expect.anything()] } }),
    );
  });
});
