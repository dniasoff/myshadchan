import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import type { ParsedResumeResponse } from "../inbox/useParseResume";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

const { callAiWorker, resolveAsNewShidduch } = vi.hoisted(() => ({
  callAiWorker: vi.fn(),
  resolveAsNewShidduch: vi.fn().mockResolvedValue({ id: 99 }),
}));

vi.mock("../providers/commons/aiWorkerClient", () => ({ callAiWorker }));
vi.mock("../inbox/useResolveInboxItem", () => ({
  useResolveInboxItem: () => ({ resolveAsNewShidduch }),
}));

const parsedResume = {
  fields: {
    name_en: "Rivky",
    name_he: null,
    father_en: null,
    father_he: null,
    mother_en: null,
    mother_he: null,
    seminary_en: "Bais Yaakov",
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: "Lakewood",
    location_he: null,
    age: 24,
    height: "5'6\"",
    person_gender: null,
    kohen_status: null,
    marital_status: null,
  },
  lowConfidenceFields: ["age"],
  sections: { learningHistory: [], references: [] },
  rawDraft: { name_en: { value: "Rivky", confidence: 0.95 } },
};

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
    removeInboxAttachment: vi.fn().mockResolvedValue(undefined),
    uploadResumePhoto: vi.fn().mockResolvedValue({ id: 501 }),
    aiEntitlement: vi.fn().mockResolvedValue({
      is_entitled: false,
      plan: "free",
      status: "none",
      resumes_used: 0,
      resumes_limit: 0,
    }),
    createShidduch: vi.fn().mockResolvedValue({ id: 99 }),
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

afterEach(() => {
  callAiWorker.mockReset();
  resolveAsNewShidduch.mockReset();
  resolveAsNewShidduch.mockResolvedValue({ id: 99 });
});

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
  it("renders an optional photo control without requiring a visibility choice", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);

    await expect
      .element(screen.getByRole("heading", { name: "Photo (optional)" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "Add a photo of the person being suggested. JPG, PNG, HEIC or WebP · up to 8 MB.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Upload a photo"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("radio", { name: "Shared" }))
      .not.toBeInTheDocument();
  });

  it("stages an accepted photo with preview details and shared visibility", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    const photo = new File(["photo bytes"], "ronit-photo.jpg", {
      type: "image/jpeg",
    });

    await screen.getByLabelText("Upload a photo").upload(photo);

    await expect
      .element(screen.getByText("Photo ready to add."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("ronit-photo.jpg"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("radio", { name: "Shared" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Replace photo" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Remove photo" }))
      .toBeInTheDocument();
    expect(dataProvider.uploadResumePhoto).not.toHaveBeenCalled();
  });

  it("offers Enlarge only after the local preview has loaded", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);
    const pngBytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    await screen
      .getByLabelText("Upload a photo")
      .upload(new File([pngBytes], "ronit-photo.png", { type: "image/png" }));

    expect(
      screen.container.querySelector('button[aria-label="Enlarge photo"]'),
    ).toBeNull();
    screen.container.querySelector("img")?.dispatchEvent(new Event("load"));
    await expect
      .element(screen.getByRole("button", { name: "Enlarge photo" }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Enlarge photo" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Enlarged photo" }))
      .toBeInTheDocument();
  });

  it("falls back to a text file chip when the local preview cannot render", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);
    await screen
      .getByLabelText("Upload a photo")
      .upload(
        new File(["photo bytes"], "ronit-photo.heic", { type: "image/heic" }),
      );

    const preview = screen.container.querySelector("img");
    expect(preview).not.toBeNull();
    preview?.dispatchEvent(new Event("error"));

    await expect
      .element(screen.getByRole("img", { name: "Selected photo file" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("ronit-photo.heic", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("image/heic")).toBeInTheDocument();
    expect(
      screen.container.querySelector('button[aria-label="Enlarge photo"]'),
    ).toBeNull();
  });

  it("keeps the suggestion saveable when a photo is rejected", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);

    await screen
      .getByLabelText("Upload a photo")
      .upload(new File(["gif"], "photo.gif", { type: "image/gif" }));

    await expect
      .element(
        screen.getByText(
          "This file type is not supported. Choose a JPG, PNG, HEIC or WebP photo.",
        ),
      )
      .toBeInTheDocument();
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();
    await expect
      .element(screen.getByText("Shidduch added"))
      .toBeInTheDocument();
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
    expect(dataProvider.uploadResumePhoto).not.toHaveBeenCalled();
  });

  it("shows a plain-English error for a photo over 8 MB", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);

    await screen.getByLabelText("Upload a photo").upload(
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], "photo.jpg", {
        type: "image/jpeg",
      }),
    );

    await expect
      .element(
        screen.getByText("This photo is too large. Choose a photo up to 8 MB."),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Choose another photo"))
      .toBeInTheDocument();
  });

  it("uploads the staged photo after the suggestion exists", async () => {
    const { screen, dataProvider, getPathname } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    const photo = new File(["photo bytes"], "ronit-photo.webp", {
      type: "image/webp",
    });

    await screen.getByLabelText("Upload a photo").upload(photo);
    await screen.getByRole("radio", { name: "Parents only" }).click();
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();

    await expect.poll(() => getPathname()).toBe("/shidduchim");
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
    expect(dataProvider.uploadResumePhoto).toHaveBeenCalledWith({
      shidduchimId: 99,
      file: photo,
      visibility: "private_parent",
    });
  });

  it("does not block the saved suggestion when photo upload fails", async () => {
    const { screen, dataProvider, getPathname } = await renderShidduchCreate(
      ["/shidduchim/new"],
      {
        uploadResumePhoto: vi
          .fn()
          .mockRejectedValue(new Error("storage unavailable")),
      },
    );

    await screen
      .getByLabelText("Upload a photo")
      .upload(
        new File(["photo bytes"], "ronit-photo.png", { type: "image/png" }),
      );
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();

    await expect.poll(() => getPathname()).toBe("/shidduchim");
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
    await expect
      .element(
        screen.getByText(
          "We couldn’t save the photo. The suggestion was saved, and you can add the photo later.",
        ),
      )
      .toBeInTheDocument();
  });

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

  it("retypes accepted octet-stream files from their extension", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    await screen.getByLabelText("Attach resume").upload(
      new File(["%PDF-1.4 test"], "resume.pdf", {
        type: "application/octet-stream",
      }),
    );
    expect(dataProvider.uploadInboxAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ type: "application/pdf" }),
      }),
    );
  });

  it("reads a PDF, fills only untouched fields, and keeps the fields editable", async () => {
    let resolveParse!: (value: ParsedResumeResponse) => void;
    callAiWorker.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    const { screen } = await renderShidduchCreate(["/shidduchim/new"], {
      aiEntitlement: vi.fn().mockResolvedValue({
        is_entitled: true,
        plan: "ai",
        status: "active",
        resumes_used: 0,
        resumes_limit: 50,
      }),
    });

    await screen
      .getByLabelText("Attach resume")
      .upload(
        new File(["%PDF-1.4 test"], "resume.pdf", { type: "application/pdf" }),
      );
    await expect
      .element(screen.getByText("Reading your resume…"))
      .toBeInTheDocument();
    await screen.getByLabelText("Name (English)").fill("Typed by Ronit");
    resolveParse(parsedResume);

    await expect
      .element(screen.getByLabelText("Seminary (English)"))
      .toHaveValue("Bais Yaakov");
    await expect
      .element(screen.getByLabelText("Name (English)"))
      .toHaveValue("Typed by Ronit");
    await expect.element(screen.getByText("Please check")).toBeInTheDocument();
    expect(resolveAsNewShidduch).not.toHaveBeenCalled();
  });

  it("does not blank a typed field when the parser returns null for it", async () => {
    let resolveParse!: (value: ParsedResumeResponse) => void;
    callAiWorker.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    const { screen } = await renderShidduchCreate(["/shidduchim/new"], {
      aiEntitlement: vi.fn().mockResolvedValue({
        is_entitled: true,
        plan: "ai",
        status: "active",
        resumes_used: 0,
        resumes_limit: 50,
      }),
    });

    await screen.getByLabelText("Attach resume").upload(
      new File(["%PDF-1.4 test"], "resume.pdf", {
        type: "application/pdf",
      }),
    );
    await screen.getByLabelText("Name (English)").fill("Typed by Ronit");
    resolveParse({
      ...parsedResume,
      fields: { ...parsedResume.fields, name_en: null },
    });

    await expect
      .element(screen.getByLabelText("Seminary (English)"))
      .toHaveValue("Bais Yaakov");
    await expect
      .element(screen.getByLabelText("Name (English)"))
      .toHaveValue("Typed by Ronit");
  });

  it("keeps the attachment and uses a fixed message for parse failures", async () => {
    callAiWorker.mockRejectedValue(new Error("monthly resume limit reached"));
    const { screen } = await renderShidduchCreate(["/shidduchim/new"], {
      aiEntitlement: vi.fn().mockResolvedValue({
        is_entitled: true,
        plan: "ai",
        status: "active",
        resumes_used: 50,
        resumes_limit: 50,
      }),
    });
    await screen
      .getByLabelText("Attach resume")
      .upload(
        new File(["%PDF-1.4 test"], "resume.pdf", { type: "application/pdf" }),
      );
    await expect
      .element(
        screen.getByText(
          "You’ve reached your monthly resume-reading limit. Your file is still attached.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Attached: resume.pdf"))
      .toBeInTheDocument();
  });

  it("keeps a PDF attached when the account has no AI entitlement", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"], {
      aiEntitlement: vi.fn().mockResolvedValue({
        is_entitled: false,
        plan: "free",
        status: "none",
        resumes_used: 0,
        resumes_limit: 0,
      }),
    });
    await screen
      .getByLabelText("Attach resume")
      .upload(
        new File(["%PDF-1.4 test"], "resume.pdf", { type: "application/pdf" }),
      );
    await expect
      .element(
        screen.getByText(
          "Your resume is attached. AI auto-fill isn’t available on this plan.",
        ),
      )
      .toBeInTheDocument();
  });

  it("submits the attached file through the existing resume resolver", async () => {
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);
    await screen
      .getByLabelText("Attach resume")
      .upload(
        new File(["word bytes"], "resume.docx", { type: "application/msword" }),
      );
    await expect
      .element(
        screen.getByText(
          "Word auto-fill isn’t available yet, but your file is attached.",
        ),
      )
      .toBeInTheDocument();
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();
    await expect.poll(() => resolveAsNewShidduch.mock.calls.length).toBe(1);
    expect(resolveAsNewShidduch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name_en: "Chaya" }),
      expect.objectContaining({ rawDraft: null, sections: null }),
    );
  });

  it("turns a conflicting retry into a plain-English notification", async () => {
    resolveAsNewShidduch.mockRejectedValue(
      new Error(
        "Another resolution is already in progress for inbox item 700.",
      ),
    );
    const { screen } = await renderShidduchCreate(["/shidduchim/new"]);
    await screen
      .getByLabelText("Attach resume")
      .upload(
        new File(["word bytes"], "resume.docx", { type: "application/msword" }),
      );
    await expect
      .element(
        screen.getByText(
          "Word auto-fill isn’t available yet, but your file is attached.",
        ),
      )
      .toBeInTheDocument();
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();
    await expect
      .element(
        screen.getByText(
          "This suggestion was already started. Please save again without changing it, or open it from the list.",
        ),
      )
      .toBeInTheDocument();
  });

  it("discards the previous capture when Ronit replaces the file", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    const removeInboxAttachment =
      dataProvider.removeInboxAttachment as unknown as ReturnType<typeof vi.fn>;
    const picker = screen.getByLabelText("Attach resume");
    await picker.upload(
      new File(["first"], "first.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await expect
      .element(screen.getByText("Attached: first.docx"))
      .toBeInTheDocument();

    await picker.upload(
      new File(["second"], "second.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    await expect.poll(() => removeInboxAttachment.mock.calls.length).toBe(1);
    expect(removeInboxAttachment).toHaveBeenCalledWith(
      "1/inbox/700/resume.pdf",
    );
  });

  it("discards the capture when Cancel leaves the form", async () => {
    const { screen, dataProvider, getPathname } = await renderShidduchCreate([
      "/shidduchim",
      "/shidduchim/new",
    ]);
    const removeInboxAttachment =
      dataProvider.removeInboxAttachment as unknown as ReturnType<typeof vi.fn>;
    await screen.getByLabelText("Attach resume").upload(
      new File(["resume"], "resume.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await screen.getByRole("button", { name: "Cancel" }).click();

    await expect.poll(() => getPathname()).toBe("/shidduchim");
    // TestMemoryRouter keeps the page mounted across the history change;
    // leaving the route in the real app unmounts it and runs the cleanup.
    screen.unmount();
    await expect.poll(() => removeInboxAttachment.mock.calls.length).toBe(1);
  });

  it("keeps the capture after submit starts if a later persistence step fails", async () => {
    const { screen, dataProvider } = await renderShidduchCreate([
      "/shidduchim/new",
    ]);
    resolveAsNewShidduch.mockImplementation(async () => {
      // Model the real resolver sequence: the suggestion insert succeeds,
      // then copying the attachment into the documents bucket fails.
      await dataProvider.createShidduch({} as never);
      throw new Error("copy failed");
    });
    await screen.getByLabelText("Attach resume").upload(
      new File(["resume"], "resume.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await screen.getByLabelText("Name (English)").fill("Chaya");
    await screen.getByRole("button", { name: "Add a suggestion" }).click();
    await expect
      .element(
        screen.getByText("We couldn’t add that suggestion. Please try again."),
      )
      .toBeInTheDocument();
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);

    screen.unmount();
    expect(dataProvider.removeInboxAttachment).not.toHaveBeenCalled();
  });
});
