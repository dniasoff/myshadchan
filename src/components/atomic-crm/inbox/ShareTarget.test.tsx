import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { ShareTarget } from "./ShareTarget";
import {
  applyParsedResumeFields,
  deriveShareSource,
  removeSharedFilesBestEffort,
  preserveResumeSourceMarker,
  uploadSharedFiles,
} from "./ShareTarget.helpers";

const { parseResume, uploadToBucket } = vi.hoisted(() => ({
  parseResume: vi.fn(),
  uploadToBucket: vi.fn(),
}));
vi.mock("../providers/supabase/dataProvider", () => ({ uploadToBucket }));
vi.mock("./useParseResume", () => ({
  useParseResume: () => ({ parse: parseResume }),
}));

const parsedResume = {
  fields: {
    name_en: null,
    name_he: null,
    father_en: null,
    father_he: null,
    mother_en: null,
    mother_he: null,
    seminary_en: null,
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: null,
    location_he: null,
    age: null,
    height: null,
    person_gender: null,
    kohen_status: null,
    marital_status: null,
  },
  lowConfidenceFields: [],
  sections: { learningHistory: [], references: [] },
  rawDraft: null,
};

const renderShareTarget = async (
  initialEntries = ["/share?text=hello"],
  overrides: Record<string, unknown> = {},
) => {
  let currentItem = {
    id: 1,
    account_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    source: "photo",
    raw_text: "hello",
    subject: null,
    sender: null,
    sender_needs_confirmation: false,
    attachments: null,
    status: "unresolved",
  };
  const create = vi.fn().mockResolvedValue({ data: currentItem });
  const update = vi.fn().mockImplementation((_resource, params) => {
    currentItem = { ...currentItem, ...params.data };
    return Promise.resolve({ data: currentItem });
  });
  const deleteRow = vi.fn().mockResolvedValue({ data: currentItem });
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create,
    update,
    delete: deleteRow,
    removeInboxAttachment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as CrmDataProvider;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const screen = await render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ShareTarget />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider, create, update, deleteRow };
};

const installSharedFiles = (files: Array<{ name: string; type: string }>) => {
  const cache = {
    match: vi.fn((key: RequestInfo | URL) => {
      const path = String(key);
      if (path.endsWith("/manifest")) {
        return Promise.resolve(
          new Response(JSON.stringify(files), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      const index = Number(path.split("/").at(-1));
      const file = files[index];
      return Promise.resolve(
        file
          ? new Response(`file-${index}`, {
              headers: { "content-type": file.type },
            })
          : undefined,
      );
    }),
    delete: vi.fn().mockResolvedValue(true),
  };
  vi.stubGlobal("caches", {
    open: vi.fn().mockResolvedValue(cache),
  });
  return cache;
};

beforeEach(() => {
  uploadToBucket.mockReset();
  parseResume.mockReset().mockResolvedValue(parsedResume);
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("Android share target", () => {
  it("reports partial uploads for cleanup instead of leaving the first file orphaned", async () => {
    uploadToBucket
      .mockResolvedValueOnce({
        title: "first.jpg",
        type: "image/jpeg",
        path: "10/inbox/1/first.jpg",
        src: "first",
      })
      .mockRejectedValueOnce(new Error("second failed"));
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await expect(
      uploadSharedFiles(
        [
          new File(["first"], "first.jpg", { type: "image/jpeg" }),
          new File(["second"], "second.jpg", { type: "image/jpeg" }),
        ],
        1,
        async (uploaded) => cleanup(uploaded.map((file) => file.path)),
      ),
    ).rejects.toThrow("second failed");
    expect(cleanup).toHaveBeenCalledWith(["10/inbox/1/first.jpg"]);
  });

  it("keeps a failed removal path recoverable when partial cleanup rejects", async () => {
    const uploaded = [
      {
        title: "first.jpg",
        type: "image/jpeg",
        path: "10/inbox/1/first.jpg",
        src: "first",
        size: 5,
      },
      {
        title: "second.jpg",
        type: "image/jpeg",
        path: "10/inbox/1/second.jpg",
        src: "second",
        size: 6,
      },
    ];
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      removeSharedFilesBestEffort(uploaded, remove),
    ).resolves.toEqual([uploaded[0]]);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("treats a synchronous cleanup throw as a failed path", async () => {
    const uploaded = [
      {
        title: "first.jpg",
        type: "image/jpeg",
        path: "10/inbox/1/first.jpg",
        src: "first",
        size: 5,
      },
    ];

    await expect(
      removeSharedFilesBestEffort(uploaded, () => {
        throw new Error("storage unavailable");
      }),
    ).resolves.toEqual(uploaded);
  });

  it("maps the complete parsed resume into the suggestion payload", () => {
    const input = { single_id: 1 };
    applyParsedResumeFields(
      input,
      {
        name_en: "Model Name",
        name_he: "שם",
        father_en: "Father",
        father_he: null,
        mother_en: "Mother",
        mother_he: null,
        seminary_en: "Seminary",
        seminary_he: null,
        shul_en: "Shul",
        shul_he: null,
        location_en: "Brooklyn",
        location_he: null,
        age: 24,
        height: "5'6\"",
        person_gender: "female",
        kohen_status: null,
        marital_status: "single",
      },
      "Edited Name",
      "Bold Name",
    );

    expect(input).toMatchObject({
      name_en: "Edited Name",
      name_he: "שם",
      father_en: "Father",
      mother_en: "Mother",
      seminary_en: "Seminary",
      location_en: "Brooklyn",
      age: 24,
      height: "5'6\"",
      person_gender: "female",
      marital_status: "single",
    });
  });

  it("derives upload source before the source-tab effect settles", () => {
    expect(
      deriveShareSource([
        new File(["text"], "resume.pdf", { type: "application/pdf" }),
      ]),
    ).toBe("upload");
    expect(
      deriveShareSource([
        new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
      ]),
    ).toBe("photo");
  });

  it("preserves the inbox provenance marker when retrying a resume read", () => {
    expect(
      preserveResumeSourceMarker({ age: 24, source_inbox_item_id: 77 }, 99),
    ).toMatchObject({ age: 24, source_inbox_item_id: 77 });
  });

  it("filters the shadchan picker to active rows", async () => {
    const { dataProvider } = await renderShareTarget();

    await expect
      .poll(() =>
        (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
  });

  it("does not resolve a stale inbox row after a shared upload fails", async () => {
    installSharedFiles([
      { name: "first.jpg", type: "image/jpeg" },
      { name: "second.jpg", type: "image/jpeg" },
    ]);
    uploadToBucket
      .mockResolvedValueOnce({
        title: "first.jpg",
        type: "image/jpeg",
        path: "1/inbox/1/first.jpg",
        src: "first",
      })
      .mockRejectedValueOnce(new Error("second failed"));

    const { screen, create, deleteRow, update } = await renderShareTarget([
      "/share?shareKey=partial-upload",
    ]);
    await screen.getByRole("button", { name: /Skip/ }).click();

    await expect.poll(() => deleteRow.mock.calls.length).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Nothing was saved. Try again.");
  });

  it("files the raw capture after a failed automatic read without reparsing", async () => {
    parseResume.mockRejectedValueOnce(new Error("temporary model timeout"));
    const { screen } = await renderShareTarget([
      "/share?text=failed-read&shareKey=failed-read-save",
    ]);

    await expect.poll(() => parseResume.mock.calls.length).toBe(1);
    await expect
      .element(screen.getByText("We couldn’t read the text yet."))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Save & review" }).click();

    expect(parseResume).toHaveBeenCalledTimes(1);
  });

  it("surfaces a recovery failure when the row cannot retain an orphan path", async () => {
    installSharedFiles([
      { name: "first.jpg", type: "image/jpeg" },
      { name: "second.jpg", type: "image/jpeg" },
    ]);
    uploadToBucket
      .mockResolvedValueOnce({
        title: "first.jpg",
        type: "image/jpeg",
        path: "1/inbox/1/first.jpg",
        src: "first",
      })
      .mockRejectedValueOnce(new Error("second failed"));
    const removeInboxAttachment = vi
      .fn()
      .mockRejectedValue(new Error("storage unavailable"));
    const update = vi.fn().mockRejectedValue(new Error("row unavailable"));

    const { screen, deleteRow } = await renderShareTarget(
      ["/share?shareKey=recovery-failure"],
      { removeInboxAttachment, update },
    );
    await screen.getByRole("button", { name: /Skip/ }).click();

    await expect.poll(() => update.mock.calls.length).toBe(2);
    expect(deleteRow).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Please check your Inbox before trying again.");
  });

  it("does not offer a read retry that creates a second row after recovery fails", async () => {
    installSharedFiles([
      { name: "first.jpg", type: "image/jpeg" },
      { name: "second.jpg", type: "image/jpeg" },
    ]);
    uploadToBucket
      .mockResolvedValueOnce({
        title: "first.jpg",
        type: "image/jpeg",
        path: "1/inbox/1/first.jpg",
        src: "first",
      })
      .mockRejectedValueOnce(new Error("second failed"));
    const removeInboxAttachment = vi
      .fn()
      .mockRejectedValue(new Error("storage unavailable"));
    const update = vi.fn().mockRejectedValue(new Error("row unavailable"));

    const { screen, create, deleteRow } = await renderShareTarget(
      ["/share?text=hello&shareKey=recovery-read-retry"],
      { removeInboxAttachment, update },
    );

    await expect.poll(() => update.mock.calls.length).toBe(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(deleteRow).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Please check your Inbox before trying again.");
    expect(
      JSON.parse(
        window.sessionStorage.getItem(
          "myshadchan.share.orphaned-attachments",
        ) ?? "[]",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paths: ["1/inbox/1/first.jpg"] }),
      ]),
    );
    await expect
      .element(screen.getByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("updates the persisted source when the user changes tabs after auto-read", async () => {
    installSharedFiles([{ name: "photo.jpg", type: "image/jpeg" }]);
    uploadToBucket.mockResolvedValue({
      title: "photo.jpg",
      type: "image/jpeg",
      path: "1/inbox/1/photo.jpg",
      src: "photo",
    });

    const { screen, update } = await renderShareTarget([
      "/share?text=hello&shareKey=source-change",
    ]);
    await expect.poll(() => parseResume.mock.calls.length).toBe(1);
    await screen.getByRole("tab", { name: /WhatsApp/ }).click();

    await expect
      .poll(() =>
        update.mock.calls.some(
          ([resource, params]) =>
            resource === "inbox_items" && params.data?.source === "whatsapp",
        ),
      )
      .toBe(true);
  });

  it("advertises images and resume document MIME types", async () => {
    const manifest = (await fetch("/manifest.json").then((response) =>
      response.json(),
    )) as {
      share_target: { params: { files: Array<{ accept: string[] }> } };
    };
    const accept = manifest.share_target.params.files[0]?.accept;
    expect(accept).toEqual([
      "image/*",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });
});
