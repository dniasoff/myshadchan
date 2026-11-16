import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type Identifier } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { EntityFile, InboxItem, Resume, Shidduch } from "../types";
import { useResolveInboxItem } from "./useResolveInboxItem";

const ATTACHMENT = {
  title: "resume.pdf",
  type: "application/pdf",
  path: "1/inbox/resume.pdf",
  src: "https://example.test/resume.pdf",
};

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 44,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "upload",
  raw_text: null,
  subject: null,
  sender: null,
  sender_needs_confirmation: false,
  attachments: [ATTACHMENT],
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
  ...overrides,
});

const buildSuggestion = (overrides: Partial<Shidduch> = {}): Shidduch =>
  ({
    id: 99,
    account_id: 1,
    single_id: 5,
    shadchan_id: null,
    name_en: null,
    pipeline_state: "new",
    first_suggested_at: "2026-01-01T00:00:00Z",
    redt_date: "2026-01-01",
    origin: "channel",
    visibility: "shared",
    index: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Shidduch;

const buildResume = (overrides: Partial<Resume> = {}): Resume =>
  ({
    id: 7,
    account_id: 1,
    shidduchim_id: 99,
    files: [
      {
        path: "1/resumes/99/deterministic-resume.pdf",
        filename: ATTACHMENT.title,
        mime_type: ATTACHMENT.type,
        uploaded_at: "2026-01-01T00:00:00Z",
        uploaded_by: null,
        size: 120,
        source_inbox_item_id: 44,
        source_inbox_attachment_path: ATTACHMENT.path,
      },
    ],
    extracted: null,
    sections: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Resume;

type ReadOutcome =
  | "completed"
  | "empty"
  | "no_allowance"
  | "failed"
  | "ambiguous"
  | "already_reading";

type ResumeProviderOptions = {
  readOutcome?: ReadOutcome;
  readOutcomeSequence?: ReadOutcome[];
  commitReadBeforeAmbiguousResponse?: boolean;
  commitReadOnCompletedResponse?: boolean;
  editSuggestionOnAmbiguous?: Partial<Shidduch>;
  applyEmptyReadState?: boolean;
  initialItem?: InboxItem;
  initialResume?: Resume;
  suggestion?: Shidduch;
  removeResumeFileObjects?: CrmDataProvider["removeResumeFileObjects"];
  removeResumeFileObjectsStrict?: (paths: string[]) => Promise<void>;
  dependentDataAppearsDuringCompensation?: boolean;
};

const buildDataProvider = (options: ResumeProviderOptions = {}) => {
  let currentItem = options.initialItem ?? buildItem();
  let suggestion = options.suggestion ?? buildSuggestion();
  const resumes: Resume[] = options.initialResume
    ? [options.initialResume]
    : [];
  const readOutcome = options.readOutcome ?? "completed";
  let readCalls = 0;
  let readCharges = 0;
  const chargedRequestIds = new Set<string>();
  const removeResumeFileObjects =
    options.removeResumeFileObjects ?? vi.fn().mockResolvedValue(undefined);
  const removeResumeFileObjectsStrict =
    options.removeResumeFileObjectsStrict ??
    (async (paths: string[]) => removeResumeFileObjects(paths));
  let interactionReads = 0;

  const getOne = vi.fn(async (resource: string, params: { id: Identifier }) => {
    if (resource === "inbox_items" && params.id === currentItem.id) {
      return { data: currentItem };
    }
    if (resource === "shidduchim" && params.id === suggestion.id) {
      return { data: suggestion };
    }
    if (resource === "resumes") {
      return { data: resumes.find((resume) => resume.id === params.id) };
    }
    return { data: undefined };
  });

  const getList = vi.fn(
    async (resource: string, params: { filter?: Record<string, unknown> }) => {
      if (
        resource === "interactions" &&
        options.dependentDataAppearsDuringCompensation
      ) {
        interactionReads += 1;
        if (interactionReads >= 2) {
          return { data: [{ id: 123 }], total: 1 };
        }
      }
      if (resource !== "resumes") return { data: [], total: 0 };
      const filter = params.filter ?? {};
      if (filter.shidduchim_id != null) {
        const data = resumes.filter(
          (resume) => resume.shidduchim_id === filter.shidduchim_id,
        );
        return { data, total: data.length };
      }
      if (filter["files@cs"] != null) {
        const data = resumes.filter((resume) =>
          resume.files?.some(
            (file) =>
              String(file.source_inbox_item_id) === "44" &&
              file.source_inbox_attachment_path === ATTACHMENT.path,
          ),
        );
        return { data, total: data.length };
      }
      return { data: resumes, total: resumes.length };
    },
  );

  const createShidduch = vi.fn(async (input: Partial<Shidduch>) => {
    suggestion = buildSuggestion(input);
    return suggestion;
  });

  const attachInboxAttachmentToResumeFile = vi.fn(
    async (params: {
      shidduchimId: Identifier;
      inboxItemId: Identifier;
      attachment: typeof ATTACHMENT;
    }) => {
      const existing = resumes.find(
        (resume) => resume.shidduchim_id === params.shidduchimId,
      );
      if (existing) {
        existing.files = [
          ...(existing.files ?? []),
          {
            path: `1/resumes/${params.shidduchimId}/${params.attachment.title}`,
            filename: params.attachment.title,
            mime_type: params.attachment.type,
            uploaded_at: "2026-01-02T00:00:00Z",
            uploaded_by: null,
            size: 120,
            source_inbox_item_id: params.inboxItemId,
            source_inbox_attachment_path: params.attachment.path,
          },
        ];
        return existing;
      }
      const resume = buildResume();
      resumes.push(resume);
      return resume;
    },
  );

  const update = vi.fn(
    async (
      resource: string,
      params: { data: Partial<InboxItem>; id: Identifier },
    ) => {
      if (resource === "inbox_items" && params.id === currentItem.id) {
        currentItem = { ...currentItem, ...params.data };
      }
      return { data: currentItem };
    },
  );

  const updateInboxItemResolution = vi.fn(async (params: any) => {
    const lockAcquiredAt = (
      currentItem.resolution_input as { lock_acquired_at?: unknown } | null
    )?.lock_acquired_at;
    if (
      currentItem.status !== params.status ||
      (params.expectedResolutionAttemptId !== undefined &&
        currentItem.resolution_attempt_id !==
          params.expectedResolutionAttemptId) ||
      (params.expectedLockAcquiredAt !== undefined &&
        lockAcquiredAt !== params.expectedLockAcquiredAt) ||
      (params.expectedLockAcquiredAtIsNull && lockAcquiredAt != null) ||
      (params.staleBefore !== undefined &&
        (typeof lockAcquiredAt !== "string" ||
          lockAcquiredAt >= params.staleBefore))
    ) {
      return null;
    }
    const result = await update("inbox_items", {
      id: currentItem.id,
      data: params.data,
    });
    return result.data;
  });

  const dataProvider = {
    getOne,
    getList,
    createShidduch,
    attachInboxAttachmentToResumeFile,
    readResume: vi.fn(async (params: { requestId: string }) => {
      const outcome = options.readOutcomeSequence?.[readCalls] ?? readOutcome;
      readCalls += 1;
      const requestWasCharged = chargedRequestIds.has(params.requestId);
      const shouldCommit =
        (outcome === "ambiguous" &&
          options.commitReadBeforeAmbiguousResponse) ||
        (outcome === "completed" &&
          options.commitReadOnCompletedResponse &&
          !requestWasCharged);
      if (outcome === "ambiguous" && options.editSuggestionOnAmbiguous) {
        suggestion = buildSuggestion({
          ...suggestion,
          ...options.editSuggestionOnAmbiguous,
        });
      }
      if (shouldCommit) {
        const resume = resumes[0];
        if (resume) {
          resume.sections = { schemaVersion: 4 };
          resume.extracted = { fields: { name_en: "Committed" } };
        }
        if (!requestWasCharged) {
          chargedRequestIds.add(params.requestId);
          readCharges += 1;
        }
      }
      if (outcome === "empty" && options.applyEmptyReadState) {
        const resume = resumes[0];
        if (resume) {
          resume.sections = {
            learningHistory: [],
            references: [],
            additionalSections: [],
            schemaVersion: 4,
          };
          resume.extracted = { fields: { name_en: null } };
        }
      }
      return outcome;
    }),
    update,
    updateInboxItemResolution,
    delete: vi.fn().mockResolvedValue({ data: {} }),
    removeResumeFileObjects,
    removeResumeFileObjectsStrict,
    create: vi.fn().mockResolvedValue({ data: {} }),
    copyInboxAttachmentsToEntityFiles: vi.fn().mockResolvedValue([]),
  } as unknown as CrmDataProvider;

  return {
    dataProvider,
    getCurrentItem: () => currentItem,
    resumes,
    createShidduch,
    getReadCharges: () => readCharges,
  };
};

function Probe({
  item,
  action = "new",
}: {
  item: InboxItem;
  action?: "new" | "attach";
}) {
  const { resolveInboxResume } = useResolveInboxItem();
  const [result, setResult] = useState("idle");

  return (
    <>
      <span>result:{result}</span>
      <button
        onClick={() =>
          void resolveInboxResume(item, action, {
            singleId: action === "new" ? 5 : undefined,
            shidduchimId: action === "attach" ? 99 : undefined,
          })
            .then((outcome) =>
              setResult(
                `${outcome.outcome}:${outcome.shidduch?.id ?? "none"}:${outcome.suggestionKept}`,
              ),
            )
            .catch((error: unknown) =>
              setResult(
                `error:${error instanceof Error ? error.message : "unknown"}`,
              ),
            )
        }
      >
        resolve resume
      </button>
    </>
  );
}

const renderProbe = async (
  item: InboxItem,
  options: ResumeProviderOptions = {},
  action: "new" | "attach" = "new",
) => {
  const { dataProvider, ...state } = buildDataProvider({
    ...options,
    initialItem: item,
  });
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Probe item={item} action={action} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider, ...state };
};

describe("resume-first Inbox resolution", () => {
  it("creates a nameless suggestion, runs fill_empty, and finalizes only after the read succeeds", async () => {
    const item = buildItem();
    const { screen, dataProvider, createShidduch } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    expect(createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ single_id: 5, name_en: null }),
    );
    expect(dataProvider.readResume).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fill_empty", resumeId: 7 }),
    );
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        data: expect.objectContaining({ status: "resolved" }),
      }),
    );
    expect(item.attachments?.[0].path).toBe(ATTACHMENT.path);
    expect(JSON.stringify(createShidduch.mock.calls[0][0])).not.toContain(
      ATTACHMENT.title,
    );
  });

  it("reads a newly attached file on a parsed resume, then does not read it again after success", async () => {
    const newAttachment = {
      title: "new-resume.pdf",
      type: "application/pdf",
      path: "1/inbox/new-resume.pdf",
      src: "https://example.test/new-resume.pdf",
    };
    const item = buildItem({ attachments: [newAttachment] });
    const initialResume = buildResume({
      files: [
        {
          path: "1/resumes/99/old-resume.pdf",
          filename: "old-resume.pdf",
          mime_type: "application/pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          size: 120,
          source_inbox_item_id: null,
          source_inbox_attachment_path: null,
        },
      ],
      sections: { learningHistory: [{ school: "Already parsed" }] },
      extracted: { fields: { name_en: "Existing person" } },
    });
    const { screen, dataProvider, getCurrentItem } = await renderProbe(
      item,
      { initialResume },
      "attach",
    );

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    expect(readResume).toHaveBeenCalledTimes(1);
    expect(readResume).toHaveBeenCalledWith(
      expect.objectContaining({
        fileIdentity: "1/resumes/99/new-resume.pdf",
        mode: "fill_empty",
      }),
    );
    const resolutionUpdates =
      dataProvider.updateInboxItemResolution as ReturnType<typeof vi.fn>;
    expect(resolutionUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution_input: expect.objectContaining({
            resume_read_file_path: "1/resumes/99/new-resume.pdf",
            resume_read_completed_file_path: "1/resumes/99/new-resume.pdf",
            resume_read_pending: false,
          }),
        }),
      }),
    );
    expect(getCurrentItem().status).toBe("resolved");

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();
    expect(readResume).toHaveBeenCalledTimes(1);
  });

  it("replays an ambiguous read for the newly selected file", async () => {
    const newAttachment = {
      title: "new-resume.pdf",
      type: "application/pdf",
      path: "1/inbox/new-resume.pdf",
      src: "https://example.test/new-resume.pdf",
    };
    const item = buildItem({ attachments: [newAttachment] });
    const initialResume = buildResume({
      files: [
        {
          path: "1/resumes/99/old-resume.pdf",
          filename: "old-resume.pdf",
          mime_type: "application/pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          size: 120,
          source_inbox_item_id: null,
          source_inbox_attachment_path: null,
        },
      ],
      sections: { learningHistory: [{ school: "Already parsed" }] },
      extracted: { fields: { name_en: "Existing person" } },
    });
    const { screen, dataProvider, getCurrentItem, getReadCharges } =
      await renderProbe(
        item,
        {
          initialResume,
          readOutcomeSequence: ["ambiguous", "completed"],
          commitReadBeforeAmbiguousResponse: true,
        },
        "attach",
      );

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    expect(readResume).toHaveBeenCalledTimes(2);
    expect(readResume.mock.calls[0]?.[0]).toMatchObject({
      fileIdentity: "1/resumes/99/new-resume.pdf",
      mode: "fill_empty",
    });
    expect(readResume.mock.calls[1]?.[0].requestId).toBe(
      readResume.mock.calls[0]?.[0].requestId,
    );
    expect(getReadCharges()).toBe(1);
    expect(getCurrentItem().status).toBe("resolved");
  });

  it("replays a committed read after a lost response without a second charge", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem, getReadCharges } =
      await renderProbe(item, {
        readOutcomeSequence: ["ambiguous", "completed"],
        commitReadBeforeAmbiguousResponse: true,
      });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    expect(dataProvider.removeResumeFileObjects).not.toHaveBeenCalled();
    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(getReadCharges()).toBe(1);
    expect(getCurrentItem()).toMatchObject({ status: "resolved" });
  });

  it("keeps a parsed existing resume pending after two ambiguous new-file reads", async () => {
    const newAttachment = {
      title: "new-resume.pdf",
      type: "application/pdf",
      path: "1/inbox/new-resume.pdf",
      src: "https://example.test/new-resume.pdf",
    };
    const item = buildItem({ attachments: [newAttachment] });
    const initialResume = buildResume({
      files: [
        {
          path: "1/resumes/99/old-resume.pdf",
          filename: "old-resume.pdf",
          mime_type: "application/pdf",
          uploaded_at: "2026-01-01T00:00:00Z",
          uploaded_by: null,
          size: 120,
          source_inbox_item_id: null,
          source_inbox_attachment_path: null,
        },
      ],
      sections: { learningHistory: [{ school: "Already parsed" }] },
      extracted: { fields: { name_en: "Existing person" } },
    });
    const { screen, dataProvider, getCurrentItem, getReadCharges } =
      await renderProbe(
        item,
        {
          initialResume,
          readOutcomeSequence: ["ambiguous", "ambiguous", "completed"],
          commitReadOnCompletedResponse: true,
        },
        "attach",
      );

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    const firstRequestId = readResume.mock.calls[0]?.[0].requestId;
    expect(firstRequestId).toEqual(expect.any(String));
    expect(getCurrentItem()).toMatchObject({
      status: "resolving",
      resolution_input: {
        resume_read_request_id: firstRequestId,
        resume_read_pending: true,
      },
    });
    expect(readResume).toHaveBeenCalledTimes(2);
    expect(readResume.mock.calls[1]?.[0].requestId).toBe(firstRequestId);
    expect(getReadCharges()).toBe(0);

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();
    expect(readResume).toHaveBeenCalledTimes(3);
    expect(readResume.mock.calls[2]?.[0].requestId).toBe(firstRequestId);
    expect(getReadCharges()).toBe(1);
    expect(getCurrentItem().status).toBe("resolved");
  });

  it("keeps an ambiguous read locked and reuses its stashed request id on retry", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "ambiguous",
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    const firstRequestId = readResume.mock.calls[0]?.[0].requestId;
    expect(firstRequestId).toEqual(expect.any(String));
    expect(getCurrentItem()).toMatchObject({
      status: "resolving",
      resolution_input: {
        resume_read_request_id: firstRequestId,
        resume_read_pending: true,
      },
    });
    expect(dataProvider.removeResumeFileObjects).not.toHaveBeenCalled();
    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(readResume).toHaveBeenCalledTimes(2);

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();
    expect(readResume).toHaveBeenCalledTimes(4);
    expect(readResume.mock.calls[3]?.[0].requestId).toBe(firstRequestId);
    expect(getCurrentItem().status).toBe("resolving");

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();
    expect(readResume).toHaveBeenCalledTimes(6);
    expect(readResume.mock.calls[5]?.[0].requestId).toBe(firstRequestId);
    expect(getCurrentItem().status).toBe("resolving");
  });

  it("does not finalize from a concurrent fixed-field edit after an ambiguous read", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcomeSequence: ["ambiguous", "ambiguous"],
      editSuggestionOnAmbiguous: { name_en: "Edited by parent" },
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();

    expect(dataProvider.readResume).toHaveBeenCalledTimes(2);
    expect(getCurrentItem()).toMatchObject({ status: "resolving" });
  });

  it("keeps the lock pending when the Worker reports already_reading", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcomeSequence: ["ambiguous", "already_reading"],
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    const firstRequestId = readResume.mock.calls[0]?.[0].requestId;
    expect(readResume).toHaveBeenCalledTimes(2);
    expect(readResume.mock.calls[1]?.[0].requestId).toBe(firstRequestId);
    expect(getCurrentItem()).toMatchObject({
      status: "resolving",
      resolution_input: {
        resume_read_request_id: firstRequestId,
        resume_read_pending: true,
      },
    });
  });

  it("takes over an aged pending read with a new attempt while reusing its request id", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "crashed-attempt",
      resolution_input: {
        action: "resume_new",
        attachment_path: ATTACHMENT.path,
        single_id: 5,
        resume_read_request_id: "same-request-id",
        resume_read_pending: true,
        lock_acquired_at: "2026-01-01T00:00:00Z",
      },
    });
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "ambiguous",
      initialResume: buildResume(),
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:ambiguous:none:true"))
      .toBeInTheDocument();

    const readResume = dataProvider.readResume as ReturnType<typeof vi.fn>;
    expect(readResume).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "same-request-id" }),
    );
    expect(getCurrentItem().resolution_attempt_id).not.toBe("crashed-attempt");
    expect(getCurrentItem()).toMatchObject({
      status: "resolving",
      resolution_input: {
        resume_read_request_id: "same-request-id",
        resume_read_pending: true,
      },
    });
  });

  it("compensates only its nameless suggestion on an allowance failure and releases the Inbox lock", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "no_allowance",
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:no_allowance:none:false"))
      .toBeInTheDocument();

    expect(dataProvider.removeResumeFileObjects).toHaveBeenCalledWith([
      "1/resumes/99/deterministic-resume.pdf",
    ]);
    expect(dataProvider.delete).toHaveBeenCalledWith(
      "resumes",
      expect.objectContaining({ id: 7 }),
    );
    expect(dataProvider.delete).toHaveBeenCalledWith(
      "shidduchim",
      expect.objectContaining({ id: 99 }),
    );
    expect(getCurrentItem()).toMatchObject({
      status: "unresolved",
      resolved_shidduchim_id: null,
    });
    expect(item.attachments?.[0].path).toBe(ATTACHMENT.path);
  });

  it("treats a definite empty-read response as failure and compensates the attempt", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "empty",
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:empty:none:false"))
      .toBeInTheDocument();

    expect(dataProvider.removeResumeFileObjects).toHaveBeenCalled();
    expect(dataProvider.delete).toHaveBeenCalledWith(
      "shidduchim",
      expect.objectContaining({ id: 99 }),
    );
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
  });

  it("compensates a production-shaped empty marker, not just a NULL resume", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "empty",
      applyEmptyReadState: true,
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:empty:none:false"))
      .toBeInTheDocument();

    expect(dataProvider.delete).toHaveBeenCalledWith(
      "resumes",
      expect.objectContaining({ id: 7 }),
    );
    expect(dataProvider.delete).toHaveBeenCalledWith(
      "shidduchim",
      expect.objectContaining({ id: 99 }),
    );
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
  });

  it("keeps an already edited suggestion and still releases the Inbox lock", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "resume_new",
        attachment_path: ATTACHMENT.path,
        single_id: 5,
        resolved_shidduchim_id: 99,
        resume_id: 7,
        resume_created: true,
        lock_acquired_at: "2026-01-01T00:00:00Z",
      },
    });
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "failed",
      suggestion: buildSuggestion({ name_en: "Edited by parent" }),
      initialResume: buildResume(),
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:failed:none:true"))
      .toBeInTheDocument();

    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
  });

  it("never compensates a pre-existing resume discovered through provenance", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "no_allowance",
      initialResume: buildResume(),
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:no_allowance:none:true"))
      .toBeInTheDocument();

    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(dataProvider.removeResumeFileObjects).not.toHaveBeenCalled();
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
  });

  it("reuses a stale resolving attempt through resume provenance instead of creating a second suggestion", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "resume_new",
        attachment_path: ATTACHMENT.path,
        single_id: 5,
        lock_acquired_at: "2026-01-01T00:00:00Z",
      },
    });
    const { screen, dataProvider, createShidduch } = await renderProbe(item, {
      initialResume: buildResume(),
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    expect(createShidduch).not.toHaveBeenCalled();
    expect(
      dataProvider.attachInboxAttachmentToResumeFile,
    ).not.toHaveBeenCalled();
    expect(dataProvider.readResume).toHaveBeenCalledTimes(1);
  });

  it("leaves source bytes and a retry-safe unresolved item when cleanup loses the network", async () => {
    const item = buildItem();
    const removeResumeFileObjects = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "no_allowance",
      removeResumeFileObjects,
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:failed:none:true"))
      .toBeInTheDocument();

    expect(removeResumeFileObjects).toHaveBeenCalled();
    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
    expect(item.attachments?.[0].path).toBe(ATTACHMENT.path);
  });

  it("keeps the catalog row when strict storage cleanup reports a failure", async () => {
    const item = buildItem();
    const softCleanup = vi.fn().mockResolvedValue(undefined);
    const strictCleanup = vi.fn().mockRejectedValue(new Error("storage down"));
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "no_allowance",
      removeResumeFileObjects: softCleanup,
      removeResumeFileObjectsStrict: strictCleanup,
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:failed:none:true"))
      .toBeInTheDocument();

    expect(strictCleanup).toHaveBeenCalledWith([
      "1/resumes/99/deterministic-resume.pdf",
    ]);
    expect(softCleanup).not.toHaveBeenCalled();
    expect(dataProvider.delete).not.toHaveBeenCalledWith(
      "resumes",
      expect.anything(),
    );
    expect(dataProvider.delete).not.toHaveBeenCalledWith(
      "shidduchim",
      expect.anything(),
    );
    expect(getCurrentItem()).toMatchObject({ status: "unresolved" });
  });

  it("aborts compensation when dependent data appears during its safety check", async () => {
    const item = buildItem();
    const { screen, dataProvider, getCurrentItem } = await renderProbe(item, {
      readOutcome: "no_allowance",
      dependentDataAppearsDuringCompensation: true,
    });

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:no_allowance:none:true"))
      .toBeInTheDocument();

    expect(dataProvider.removeResumeFileObjects).not.toHaveBeenCalled();
    expect(dataProvider.delete).not.toHaveBeenCalled();
    expect(getCurrentItem()).toMatchObject({
      status: "unresolved",
      resolved_shidduchim_id: null,
    });
    expect(getCurrentItem().resolution_input).toMatchObject({
      resolved_shidduchim_id: 99,
    });
  });

  it("copies accompanying pictures privately while reading only the selected resume", async () => {
    const picture = {
      title: "family-photo.jpg",
      type: "image/jpeg",
      path: "1/inbox/family-photo.jpg",
      src: "https://example.test/family-photo.jpg",
    };
    const privateFile = {
      id: 91,
      account_id: 1,
      target_type: "shidduch",
      target_id: 99,
      storage_path: "1/shidduch/99/inbox-picture.jpg",
      file_name: picture.title,
      mime_type: picture.type,
      size_bytes: 12,
      visibility: "private_parent",
      created_at: "2026-01-01T00:00:00Z",
    } as EntityFile;
    const item = buildItem({ attachments: [ATTACHMENT, picture] });
    const { screen, dataProvider } = await renderProbe(item, {
      initialItem: item,
    });
    const copy = vi
      .spyOn(dataProvider, "copyInboxAttachmentsToEntityFiles")
      .mockResolvedValue([privateFile]);

    await screen.getByRole("button", { name: "resolve resume" }).click();
    await expect
      .element(screen.getByText("result:completed:99:true"))
      .toBeInTheDocument();

    expect(copy).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [picture],
        sourceInboxItemId: 44,
        visibility: "private_parent",
      }),
    );
    expect(copy.mock.calls[0]?.[0].visibility).not.toBe("shared");
    expect(item.attachments).toEqual([ATTACHMENT, picture]);
  });
});
