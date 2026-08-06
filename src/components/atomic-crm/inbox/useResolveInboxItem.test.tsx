import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type Identifier } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  EntityFile,
  InboxItem,
  Resume,
  Shidduch,
} from "../types";
import { useResolveInboxItem, type ResumeDraft } from "./useResolveInboxItem";

/**
 * `useResolveInboxItem.ts` calls these two directly (the
 * `signInboxAttachmentUrl` idiom `InboxResolveDialog.tsx` already uses,
 * not a `CrmDataProvider` custom method — see the Finding 2 review-fix
 * comment on `resolveAsNewShidduch`), so they are mocked at the module
 * level rather than through the `dataProvider` mock below.
 */
const { copyInboxAttachmentToResumeFile, removeResumeFileObjects } = vi.hoisted(
  () => ({
    copyInboxAttachmentToResumeFile: vi.fn(),
    removeResumeFileObjects: vi.fn(),
  }),
);

vi.mock("../providers/supabase/resumes", () => ({
  copyInboxAttachmentToResumeFile,
  removeResumeFileObjects,
}));

/**
 * Story 10.1 (Task 5, AC 5/6/7) + Story 10.5 idempotency:
 * `InboxResolveDialog.tsx`'s own test covers the "create a new suggestion"
 * path through the UI; this suite exercises `useResolveInboxItem.ts`'s three
 * functions directly, against a mocked `dataProvider`, since `ShareTarget.tsx`
 * is the OTHER caller and the shared module's own contract (which
 * dataProvider calls each function makes, in which order) deserves coverage
 * independent of either screen.
 */

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "whatsapp",
  raw_text: "Chaim Berkowitz, BMG",
  subject: null,
  sender: null,
  sender_needs_confirmation: false,
  attachments: null,
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
  ...overrides,
});

/** Lets a test inject a one-off failure into a specific `update` call
 * without losing the default merge-into-`currentItem` behavior every other
 * call still needs — the F16 regression test uses this to fail exactly the
 * `resume_created` stash once, simulating a crash between the `resumes` row
 * landing and that stash reaching the database. */
type DataProviderHooks = {
  beforeUpdate?: (resource: string, params: unknown) => void;
};

/**
 * A stateful mock that merges inbox_items updates so `getOne` reflects the
 * current row, and tracks `resumes` rows so `getList`/`create` behave like a
 * real table (Finding 16's fix looks up existing rows before creating one).
 * This is the minimum fidelity needed to test Story 10.5's resolve-window
 * protocol (status: unresolved -> resolving -> resolved/dismissed) and the
 * resume-row idempotency it now also covers.
 */
const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
  initialItem: InboxItem = buildItem(),
  hooks: DataProviderHooks = {},
): CrmDataProvider => {
  let currentItem: InboxItem = { ...initialItem };
  const resumesTable: Resume[] = [];

  const createShidduch = vi.fn(async (_input: CreateShidduchInput) => {
    return { id: 99 } as Shidduch;
  });

  const create = vi.fn(async (resource: string, params: unknown) => {
    if (resource === "resumes") {
      const { data } = params as { data: Partial<Resume> };
      const row = {
        id: resumesTable.length + 1,
        account_id: 1,
        created_at: "2026-01-01T00:00:00Z",
        ...data,
      } as Resume;
      resumesTable.push(row);
      return { data: row };
    }
    return { data: { id: 100 } };
  });

  const getList = vi.fn(async (resource: string, params: unknown) => {
    if (resource === "resumes") {
      const { filter } = params as {
        filter?: { shidduchim_id?: Identifier };
      };
      const matches = resumesTable.filter(
        (row) => row.shidduchim_id === filter?.shidduchim_id,
      );
      return { data: matches, total: matches.length };
    }
    return { data: [], total: 0 };
  });

  const copyInboxAttachmentsToEntityFiles = vi.fn(async () => {
    return [] as EntityFile[];
  });

  const getOne = vi.fn(async (resource: string, params: { id: Identifier }) => {
    if (resource === "inbox_items" && params.id === currentItem.id) {
      return { data: currentItem };
    }
    if (resource === "shidduchim" && params.id === 99) {
      return { data: { id: 99 } as Shidduch };
    }
    throw new Error(`Unexpected getOne: ${resource} ${params.id}`);
  });

  const update = vi.fn(async (resource: string, params: unknown) => {
    hooks.beforeUpdate?.(resource, params);
    if (resource === "inbox_items") {
      const { data } = params as {
        id: Identifier;
        data: Partial<InboxItem>;
        previousData: InboxItem;
      };
      currentItem = { ...currentItem, ...data };
      return { data: currentItem };
    }
    return { data: {} };
  });

  return {
    createShidduch,
    create,
    getList,
    copyInboxAttachmentsToEntityFiles,
    getOne,
    update,
    ...overrides,
  } as unknown as CrmDataProvider;
};

function ResolveProbe({
  item,
  draft,
  input = { single_id: 5, shadchan_id: 7 },
}: {
  item: InboxItem;
  draft?: ResumeDraft;
  input?: CreateShidduchInput;
}) {
  const { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem } =
    useResolveInboxItem();
  const [result, setResult] = useState("idle");

  const run = async (action: () => Promise<string>) => {
    try {
      setResult(await action());
    } catch (error) {
      setResult(`error:${error instanceof Error ? error.message : "unknown"}`);
    }
  };

  return (
    <div>
      <span>result:{result}</span>
      <button
        onClick={() =>
          run(async () => {
            const created = await resolveAsNewShidduch(item, input, draft);
            return `new:${created.id}`;
          })
        }
      >
        resolveAsNewShidduch
      </button>
      <button
        onClick={() =>
          run(async () => {
            await resolveAsLinkToExisting(item, 42);
            return "linked";
          })
        }
      >
        resolveAsLinkToExisting
      </button>
      <button
        onClick={() =>
          run(async () => {
            await dismissInboxItem(item);
            return "dismissed";
          })
        }
      >
        dismissInboxItem
      </button>
    </div>
  );
}

const renderProbe = async (
  item: InboxItem,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
  draft?: ResumeDraft,
  hooks: DataProviderHooks = {},
  input?: CreateShidduchInput,
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides, item, hooks);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResolveProbe item={item} draft={draft} input={input} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

const buildResumeDraft = (
  overrides: Partial<ResumeDraft["attachment"]> = {},
): ResumeDraft => ({
  attachment: {
    title: "resume.pdf",
    type: "application/pdf",
    path: "1/inbox-resume.pdf",
    src: "https://example.test/resume.pdf",
    ...overrides,
  },
  rawDraft: { name_en: "Chaim Berkowitz" },
  sections: { learningHistory: [], references: [] },
});

describe("useResolveInboxItem — resolveAsNewShidduch (AC 7: the sole createShidduch path)", () => {
  it("creates via dataProvider.createShidduch, then marks the item resolved and linked", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ single_id: 5, shadchan_id: 7 }),
    );

    // Story 10.5: three-step protocol (resolving -> stash created id -> resolved)
    expect(dataProvider.update).toHaveBeenCalledTimes(3);

    const resolvingCall = (dataProvider.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(resolvingCall[0]).toBe("inbox_items");
    expect(resolvingCall[1].data).toMatchObject({
      status: "resolving",
      resolution_attempt_id: expect.any(String),
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
      },
    });

    const stashCall = (dataProvider.update as ReturnType<typeof vi.fn>).mock
      .calls[1];
    expect(stashCall[0]).toBe("inbox_items");
    expect(stashCall[1].data).toMatchObject({
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
        resolved_shidduchim_id: 99,
      },
    });

    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "resolved",
          resolved_shidduchim_id: 99,
          single_id: 5,
          shadchan_id: 7,
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("is idempotent: a second resolveAsNewShidduch returns the existing shidduch without creating another", async () => {
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
  });
});

describe("useResolveInboxItem — resolveAsNewShidduch resume draft (Story 11.2 review fix, Finding 2 + also-fixes)", () => {
  beforeEach(() => {
    copyInboxAttachmentToResumeFile.mockReset();
    removeResumeFileObjects.mockReset();
  });

  it("persists the copied documents-bucket path and the real byte size on the new resumes row — the regression test for Finding 2", async () => {
    // Arrange
    copyInboxAttachmentToResumeFile.mockResolvedValue({
      storagePath: "7/resumes/99/generated-uuid-resume.pdf",
      size: 245678,
    });
    const item = buildItem();
    const draft = buildResumeDraft();
    const { screen, dataProvider } = await renderProbe(item, {}, draft);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Assert: the ORIGINAL inbox attachment path is handed to the copier,
    // never persisted directly (that was the bug: an `attachments`-bucket
    // path saved as if it were a `documents`-bucket one).
    expect(copyInboxAttachmentToResumeFile).toHaveBeenCalledWith({
      shidduchimId: 99,
      attachmentPath: "1/inbox-resume.pdf",
      fileName: "resume.pdf",
    });

    // Assert: the persisted file version uses the COPIED path (the bucket
    // the signer actually reads from) and the real downloaded size, not the
    // stale attachment path or a hardcoded 0.
    expect(dataProvider.create).toHaveBeenCalledWith(
      "resumes",
      expect.objectContaining({
        data: expect.objectContaining({
          shidduchim_id: 99,
          files: [
            expect.objectContaining({
              path: "7/resumes/99/generated-uuid-resume.pdf",
              filename: "resume.pdf",
              mime_type: "application/pdf",
              size: 245678,
            }),
          ],
          extracted: draft.rawDraft,
          sections: draft.sections,
        }),
      }),
    );
  });

  it("does not attempt a resumes row when no draft was used", async () => {
    // Arrange
    const item = buildItem();
    const { dataProvider, screen } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Assert
    expect(copyInboxAttachmentToResumeFile).not.toHaveBeenCalled();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("is idempotent: a retry that resumes an in-progress resolve with the resumes row already stashed does not create a second one", async () => {
    // Arrange: simulates a crash between the `resume_created` stash update
    // and the finalize update — the item is still `resolving`, but the
    // resolution_input already recorded that the row was created.
    const draft = buildResumeDraft();
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
        resume_draft: draft,
        resolved_shidduchim_id: 99,
        resume_created: true,
      },
    });
    const { screen, dataProvider } = await renderProbe(item, {}, draft);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Assert: the retry completes (finalizes) without redoing any of the
    // already-stashed work.
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
    expect(copyInboxAttachmentToResumeFile).not.toHaveBeenCalled();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("recovers from a crash between the resumes-row create and the resume_created stash: a retry produces exactly one storage object and one resumes row (Finding 16)", async () => {
    // Arrange: unlike the "already stashed" test above (which starts AFTER
    // `resume_created` is durably true), this simulates the crash window
    // itself — the `resumes` row is created successfully, but the very next
    // write (stashing `resume_created: true` on the inbox item) fails once,
    // exactly as a dropped connection or a closed tab would. `stashShouldFail`
    // makes the injected failure fire on that ONE call only, so the retry's
    // own stash succeeds.
    copyInboxAttachmentToResumeFile.mockResolvedValue({
      storagePath: "7/resumes/99/generated-uuid-resume.pdf",
      size: 245678,
    });
    let stashShouldFail = true;
    const hooks: DataProviderHooks = {
      beforeUpdate: (resource, params) => {
        if (!stashShouldFail) return;
        const { data } = params as {
          data?: { resolution_input?: { resume_created?: boolean } | null };
        };
        if (
          resource === "inbox_items" &&
          data?.resolution_input?.resume_created
        ) {
          stashShouldFail = false;
          throw new Error("connection dropped");
        }
      },
    };
    const item = buildItem();
    const draft = buildResumeDraft();

    // Act: first attempt crashes in the stash window described above.
    const { screen, dataProvider } = await renderProbe(item, {}, draft, hooks);
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect
      .element(screen.getByText("error:connection dropped"))
      .toBeInTheDocument();

    // Act: retry, against the SAME dataProvider (so its `resumes` table and
    // stashed inbox-item state persist across the "crash").
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Assert: exactly ONE copy and ONE `resumes` row exist — the retry found
    // the row the first attempt already durably created instead of making a
    // second one.
    expect(copyInboxAttachmentToResumeFile).toHaveBeenCalledTimes(1);
    const resumesCreateCalls = (
      dataProvider.create as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([resource]) => resource === "resumes");
    expect(resumesCreateCalls).toHaveLength(1);
  });

  it("removes the copied object and rethrows when the resumes row write fails, rather than leaving an orphaned object", async () => {
    // Arrange
    copyInboxAttachmentToResumeFile.mockResolvedValue({
      storagePath: "7/resumes/99/generated-uuid-resume.pdf",
      size: 245678,
    });
    const create = vi.fn(async (resource: string) => {
      if (resource === "resumes") {
        throw new Error("insert failed");
      }
      return { data: { id: 100 } };
    }) as unknown as CrmDataProvider["create"];
    const item = buildItem();
    const draft = buildResumeDraft();
    const { screen } = await renderProbe(item, { create }, draft);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert
    await expect
      .element(screen.getByText("error:insert failed"))
      .toBeInTheDocument();
    expect(removeResumeFileObjects).toHaveBeenCalledWith([
      "7/resumes/99/generated-uuid-resume.pdf",
    ]);
  });
});

describe("useResolveInboxItem — resolveAsLinkToExisting (AC 5: never a second suggestion)", () => {
  it("inserts a note interaction against the chosen shidduch and marks the item resolved, without ever calling createShidduch", async () => {
    // Arrange
    const item = buildItem({ raw_text: "Chaim Berkowitz" });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith("interactions", {
      data: {
        target_type: "shidduch",
        target_id: 42,
        kind: "note",
        body: "Chaim Berkowitz",
        scope: "shidduch",
        reference_link_id: null,
        metadata: { source: "inbox_item", inbox_item_id: item.id },
      },
    });
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();

    // Story 10.5: resolving -> note inserted -> resolved
    expect(dataProvider.update).toHaveBeenCalledTimes(3);
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "resolved",
          resolved_shidduchim_id: 42,
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("falls back to an empty body when the captured item has no raw_text (e.g. a photo-only share)", async () => {
    // Arrange
    const item = buildItem({ raw_text: null });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({ data: expect.objectContaining({ body: "" }) }),
    );
  });

  it("is idempotent: a second resolveAsLinkToExisting does not insert a second note", async () => {
    const item = buildItem({ raw_text: "Chaim Berkowitz" });
    const { screen, dataProvider } = await renderProbe(item);

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    expect(dataProvider.create).toHaveBeenCalledTimes(1);
  });

  it("Story 10.4: carries inbox attachments into the linked shidduch", async () => {
    const item = buildItem({
      raw_text: "Chaim Berkowitz",
      attachments: [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: "1/inbox-resume.pdf",
          src: "https://example.test/resume.pdf",
        },
      ],
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    expect(dataProvider.copyInboxAttachmentsToEntityFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: item.attachments,
        targetType: "shidduch",
        targetId: 42,
        visibility: "shared",
      }),
    );
  });
});

describe("useResolveInboxItem — dismissInboxItem (InboxResolveDialog's Dismiss, never lets the item disappear)", () => {
  it("marks the item dismissed, never deletes it", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "dismissInboxItem" }).click();

    // Assert
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "dismissed",
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("is idempotent: a second dismiss is a no-op", async () => {
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    // Story 10.5: the first call moves unresolved -> resolving -> dismissed.
    // The second call observes resolved/dismissed and returns immediately.
    // Only the first call's second update (finalization) mutates the DB.
    expect(dataProvider.update).toHaveBeenCalledTimes(2);
  });

  it("Epic 11: also dismisses a 'held' item — widening InboxStatus did not break this path, which never assumed 'unresolved'", async () => {
    // Arrange — NeedsReviewDialog.tsx's Discard action reuses this exact
    // function against an item whose status is 'held', never 'unresolved'.
    // `acquireResolutionLock`'s own branching only special-cases
    // resolved/dismissed/resolving — every other status (this included)
    // falls through to "try to acquire the lock", so this must keep working
    // without this file needing a 'held'-specific branch.
    const item = buildItem({
      status: "held",
      sender: "newcontact@example.com",
    });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "dismissInboxItem" }).click();

    // Assert
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "dismissed",
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });
});

describe("useResolveInboxItem — Story 10.5 idempotency edge cases", () => {
  it("returns the existing shidduch when the item was already resolved as new", async () => {
    const item = buildItem({
      status: "resolved",
      resolved_shidduchim_id: 99,
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the item was already dismissed", async () => {
    const item = buildItem({ status: "dismissed" });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("throws when another incompatible resolution is already in progress", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "other-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 99, shadchan_id: null },
      },
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect
      .element(
        screen.getByText(
          "error:Another resolution is already in progress for inbox item 1.",
        ),
      )
      .toBeInTheDocument();

    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
  });

  it("resumes a compatible in-progress resolution (takeover) on retry", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
      },
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Takes over the existing lock and completes the resolve.
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
  });
});

describe("useResolveInboxItem — retry-compatibility widened to full input + draft (Finding 17)", () => {
  it("rejects a retry whose form fields differ from the in-progress attempt, instead of silently finalizing the stale shidduch", async () => {
    // Arrange: an earlier attempt already created shidduch 99 (its id is
    // stashed on `resolved_shidduchim_id`) with background "Learns at BMG",
    // then never reached finalize — simulating a crash right after creation.
    // The user has since edited the form (background is now different) and
    // retries. Before Finding 17's fix, `inputsAreCompatible` only compared
    // single_id/shadchan_id/origin/attachment-path — all unchanged here — so
    // this would have taken over the lock, skipped `createShidduch`
    // (`stashed.resolved_shidduchim_id` is already set), and silently
    // finalized shidduch 99 with the STALE background while reporting
    // success.
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7, background: "Learns at BMG" },
        resolved_shidduchim_id: 99,
      },
    });
    const { screen, dataProvider } = await renderProbe(
      item,
      {},
      undefined,
      {},
      { single_id: 5, shadchan_id: 7, background: "Moved to Lakewood" },
    );

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert: rejected — never silently finalized with mismatched data.
    await expect
      .element(
        screen.getByText(
          "error:Another resolution is already in progress for inbox item 1.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("still takes over a compatible in-progress attempt when every field, including background, matches exactly — the ordinary crash-retry case", async () => {
    // Arrange — same shape as the test above, but the retry resubmits IDENTICAL
    // values, exactly what a genuine crash-retry (not a user edit) looks like.
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7, background: "Learns at BMG" },
        resolved_shidduchim_id: 99,
      },
    });
    const { screen, dataProvider } = await renderProbe(
      item,
      {},
      undefined,
      {},
      { single_id: 5, shadchan_id: 7, background: "Learns at BMG" },
    );

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert: takes over and finalizes — never re-runs createShidduch, since
    // the earlier attempt's id is reused.
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
  });

  it("rejects a retry whose resume draft differs from the one already in progress, even though the attachment path is unchanged", async () => {
    // Arrange: same attachment (same path — all the OLD narrow check
    // compared), but a different extraction (`rawDraft`/`sections`) — e.g. a
    // re-run of auto-fill against the same file produced a different
    // result. The old code treated this as compatible purely because the
    // path matched.
    const oldDraft = buildResumeDraft();
    const newDraft: ResumeDraft = {
      ...oldDraft,
      rawDraft: { name_en: "Someone Else Entirely" },
    };
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
        resume_draft: oldDraft,
      },
    });
    const { screen, dataProvider } = await renderProbe(
      item,
      {},
      newDraft,
      {},
      { single_id: 5, shadchan_id: 7 },
    );

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert
    await expect
      .element(
        screen.getByText(
          "error:Another resolution is already in progress for inbox item 1.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.update).not.toHaveBeenCalled();
  });
});
