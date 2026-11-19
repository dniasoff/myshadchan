import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import { insertNoteInteraction } from "../entity360/tabs/insertNoteInteraction";
import type { CrmDataProvider } from "../providers/types";
import type {
  OwnedResumeDeleteParams,
  OwnedResumeFileDeleteParams,
  OwnedShidduchDeleteParams,
} from "../providers/supabase/inboxResolution";
import type { CopiedResumeFile } from "../providers/supabase/resumes";
import type {
  CreateShidduchInput,
  EntityFile,
  InboxAttachment,
  InboxItem,
  Interaction,
  Resume,
  ResumeFileVersion,
  Shidduch,
} from "../types";
import { isAutomaticallyReadableResume } from "../resumes/resumeAutoReadHelpers";
import {
  createResumeReadRequestId,
  resumeReadAttemptKey,
  unresolvedResumeReadAttempts,
} from "../resumes/resumeReadRequest";
import type { ResumeReadOutcome } from "../providers/commons/rereadWorkerClient";
import { hasResumeContent } from "../resumes/resumeReadableSections";
import {
  acquireResolutionLock,
  conditionalInboxUpdate,
  finalizePayload,
  generateAttemptId,
  isResolutionLockStale,
  ResolutionClaimLostError,
  ResolutionTerminalError,
  type ResolutionInput,
  type ResumeDraft,
} from "./resolveInboxItemLock";

// Re-exported for backward compatibility: this hook's public surface used
// to define `ResumeDraft` itself before it moved into
// `resolveInboxItemLock.ts` alongside the rest of the lock protocol
// (coding-style.md's ~400-line typical ceiling).
export type { ResumeDraft };

const SHARED_INBOX_DOCUMENT_MIME_BY_EXTENSION = new Map([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
]);
const INBOX_IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const RESUME_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isResumeDocument(attachment: InboxAttachment): boolean {
  const mimeType = (attachment.type ?? "").trim().toLowerCase();
  if (mimeType.startsWith("image/")) return false;
  if (RESUME_DOCUMENT_MIME_TYPES.has(mimeType)) return true;
  const dot = attachment.title.lastIndexOf(".");
  const extension = dot === -1 ? "" : attachment.title.slice(dot).toLowerCase();
  return [".pdf", ".doc", ".docx"].includes(extension);
}

export function hasResumeDocumentAttachment(item: InboxItem): boolean {
  return item.attachments?.some(isResumeDocument) ?? false;
}

function findResumeFile(
  resume: Resume,
  itemId: Identifier,
  attachmentPath: string,
): ResumeFileVersion | undefined {
  return (resume.files ?? []).find(
    (file) =>
      String(file.source_inbox_item_id) === String(itemId) &&
      file.source_inbox_attachment_path === attachmentPath,
  );
}

type ResumeReadProgress = {
  resume_read_file_path?: string;
  resume_read_completed_file_path?: string;
  resume_read_pending_file_path?: string;
  resume_read_pending?: boolean;
};

function readPendingForFile(
  progress: ResumeReadProgress,
  filePath: string,
): boolean {
  return (
    progress.resume_read_pending === true &&
    (progress.resume_read_pending_file_path ??
      progress.resume_read_file_path) === filePath
  );
}

function readCompletedForFile(
  progress: ResumeReadProgress,
  filePath: string,
): boolean {
  if (progress.resume_read_completed_file_path === filePath) return true;
  if (readPendingForFile(progress, filePath)) return false;
  // A provenance match alone is not proof that this file was read. The
  // completed-file identity is written before finalization, so a duplicate
  // retry skips the read only when that exact identity is present here.
  return false;
}

function attachmentExtension(title: string): string {
  const dot = title.lastIndexOf(".");
  return dot === -1 ? "" : title.slice(dot).toLowerCase();
}

/** Only affirmative, matching document MIME and extension evidence may become
 * a shared Files-tab file. Everything else is parent-private by default. */
function isAffirmativeInboxDocument(attachment: InboxAttachment): boolean {
  const mimeType = (attachment.type ?? "").trim().toLowerCase();
  const extension = attachmentExtension(attachment.title ?? "");
  if (INBOX_IMAGE_EXTENSIONS.has(extension)) return false;
  return SHARED_INBOX_DOCUMENT_MIME_BY_EXTENSION.get(extension) === mimeType;
}

export type InboxResumeAction = "attach" | "new";

export type InboxResumePreparation = {
  shidduch: Shidduch;
  resume: Resume;
  file: ResumeFileVersion;
  suggestionCreatedId?: Identifier;
  resumeCreatedByAttempt: boolean;
  entityFiles: EntityFile[];
  entityFilesCreatedByAttempt: EntityFile[];
  resolutionAttemptId: string;
  readCompleted: boolean;
  resumeReadRequestId?: string;
};

export type InboxResumeProcessResult = {
  outcome: ResumeReadOutcome;
  shidduch: Shidduch | null;
  suggestionKept: boolean;
};

type OwnershipDataProvider = CrmDataProvider & {
  removeResumeFileObjectsStrict?: (paths: string[]) => Promise<void>;
  deleteOwnedInboxResume?: (
    params: OwnedResumeDeleteParams,
  ) => Promise<boolean>;
  deleteOwnedInboxResumeFile?: (
    params: OwnedResumeFileDeleteParams,
  ) => Promise<boolean>;
  deleteOwnedInboxShidduch?: (
    params: OwnedShidduchDeleteParams,
  ) => Promise<boolean>;
};

async function removeCopiedResumeObject(
  dataProvider: CrmDataProvider,
  storagePath: string,
): Promise<boolean> {
  const provider = dataProvider as OwnershipDataProvider;
  if (
    Object.prototype.hasOwnProperty.call(
      provider,
      "removeResumeFileObjectsStrict",
    ) &&
    typeof provider.removeResumeFileObjectsStrict === "function"
  ) {
    await provider.removeResumeFileObjectsStrict([storagePath]);
    return true;
  }
  await dataProvider.removeResumeFileObjects([storagePath]);
  // The legacy method is fail-soft on the live provider. A successful return
  // therefore cannot prove that the private object was actually removed.
  return false;
}

type NewResolutionProgress = Extract<ResolutionInput, { action: "new" }> & {
  resolved_shidduchim_id?: Identifier;
  resume_created?: boolean;
};

type LinkResolutionProgress = Extract<ResolutionInput, { action: "link" }> & {
  note_inserted?: boolean;
};

/**
 * The three ways a captured `inbox_items` row stops being unresolved (Story
 * 10.1 Task 2). Extracted out of `InboxResolveDialog.tsx` — the only place
 * that used to inline this — so `ShareTarget.tsx`'s new resolve screen (Task
 * 4) can reuse the exact same logic rather than forking a second copy (AD-4's
 * single-creation-path rule: one place decides new-vs-existing, reused by
 * every entry point).
 *
 * Story 10.5 adds idempotency: each path first moves the row to `resolving`,
 * stashes the inputs, executes the domain mutation, then finalizes. A retry
 * with the same inputs will observe the stashed progress and complete the
 * finalize step instead of duplicating the mutation.
 *
 * Every function here does the mutation ONLY — no `notify()`, no
 * `refresh()`, no navigation. Those are each caller's own UI concern
 * (`InboxResolveDialog.tsx` closes a dialog and refreshes a list;
 * `ShareTarget.tsx` navigates to a route) and stay in the caller, exactly as
 * `insertNoteInteraction.ts` keeps the note INSERT itself separate from
 * `NotesTab.tsx`'s form state.
 */
export function useResolveInboxItem() {
  const dataProvider = useDataProvider<CrmDataProvider>();

  /**
   * AC 7 / Task 2: the ONLY way a new suggestion is created from a capture
   * is `dataProvider.createShidduch()` (AD-4's sole INSERT path) — never a
   * bespoke `dataProvider.create("shidduchim", …)`. Mirrors the exact
   * sequence `InboxResolveDialog.tsx` inlined before this story: create,
   * then mark the source item resolved and linked to what was just created.
   */
  const resolveAsNewShidduch = async (
    item: InboxItem,
    input: CreateShidduchInput,
    draft?: ResumeDraft,
  ): Promise<Shidduch> => {
    const attemptId = generateAttemptId();
    let preserveInputAfterFailure = true;
    const resolutionInput: ResolutionInput = {
      action: "new",
      input,
      resume_draft: draft,
    };
    const lockedItem = await acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      resolutionInput,
      { claimFromStatuses: ["unresolved", "held"] },
    );

    try {
      if (lockedItem.status === "dismissed") {
        throw new ResolutionTerminalError();
      }
      // Every resolved row is terminal. A nullable foreign key is corrupt or
      // incomplete state, not permission to create a second suggestion.
      if (lockedItem.status === "resolved") {
        if (!lockedItem.resolved_shidduchim_id) {
          throw new Error("This Inbox item is already resolved.");
        }
        const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
          id: lockedItem.resolved_shidduchim_id,
        });
        return data;
      }

      let resolutionSnapshot = lockedItem;
      const stashed = (resolutionSnapshot.resolution_input ??
        {}) as ResolutionInput & {
        resolved_shidduchim_id?: Identifier;
      };

      let created: Shidduch;
      if (stashed.resolved_shidduchim_id) {
        const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
          id: stashed.resolved_shidduchim_id,
        });
        created = data;
      } else {
        created = await dataProvider.createShidduch(input);
        // Stash the created id so a retry can skip createShidduch if the
        // finalize step fails. If this read/CAS is the lost part of the
        // action, compensate the just-created empty suggestion before the
        // lock is released; otherwise the next retry would create a second
        // suggestion because it has no durable id to reuse.
        try {
          const current = await getCurrentResolutionItem(item);
          // Carry the row returned by the successful CAS forward. The next
          // phase must build its progress from this committed snapshot, not
          // the pre-stash `lockedItem` captured before the suggestion existed.
          resolutionSnapshot = await updateOwnedInboxResolution(
            item,
            {
              resolution_input: {
                ...(current?.resolution_input ?? resolutionInput),
                resolved_shidduchim_id: created.id,
              },
            },
            attemptId,
          );
        } catch (error) {
          // A provider can report a transport failure after the CAS has
          // committed. Re-read the row before compensating so a committed
          // suggestion id remains durable and the retry reuses it.
          let currentAfterFailure: InboxItem | undefined;
          try {
            currentAfterFailure = await getCurrentResolutionItem(item);
          } catch {
            // The commit state is ambiguous. Preserve the created suggestion;
            // deleting it without a verification read could lose a committed
            // row that the Inbox already references.
            preserveInputAfterFailure = true;
            throw error;
          }
          if (!currentAfterFailure) {
            preserveInputAfterFailure = true;
            throw error;
          }
          const stashCommitted =
            currentAfterFailure.resolution_input != null &&
            String(
              (
                currentAfterFailure.resolution_input as {
                  resolved_shidduchim_id?: Identifier;
                }
              ).resolved_shidduchim_id,
            ) === String(created.id);
          if (!stashCommitted) {
            const compensated = await compensateNewSuggestion(
              item,
              attemptId,
              created.id,
              undefined,
              "",
              created.id,
              true,
            ).catch(() => false);
            preserveInputAfterFailure = !compensated;
          }
          throw error;
        }
      }

      // Story 11.2: when a resume draft was used, attach the original
      // attachment and extracted draft to the new shidduch as a resumes row.
      // This is a plain CRUD write on a table the user already has full grants
      // on. A failure here surfaces without leaving the shidduch half-created
      // silently unexplained.
      //
      // Review fix (Finding 2, P1): the captured attachment lives in the
      // `attachments` bucket; every resume download signs against the
      // separate `documents` bucket. `copyInboxAttachmentToResumeFile` moves
      // the bytes into the bucket the signer (and its stricter, single-denying
      // RLS — see that function's own comment) actually uses, and returns the
      // real byte size instead of the hardcoded `0` this path used to persist.
      //
      // Review fix (also-fix #2): gated by the same stashed-progress mechanism
      // guarding `resolved_shidduchim_id` above and `note_inserted` in
      // `resolveAsLinkToExisting` below — a retry that observes
      // `resume_created` already stashed skips re-creating the row, so a crash
      // between this write and the finalize step below cannot duplicate it.
      let draftProgress = (resolutionSnapshot.resolution_input ??
        stashed) as NewResolutionProgress;
      const savedDraft = draftProgress.resume_draft;
      if (savedDraft && !draftProgress.resume_created) {
        // Review fix (Finding 16, Epic 11 adversarial review): the copied
        // storage object and the `resumes` row used to be created BEFORE
        // `resume_created` was stashed on the inbox item, with nothing to
        // recover the window between them. A failure between the `create`
        // above succeeding and the stash `update` below landing (network
        // drop, tab close) left `resume_created` still false, so a retry
        // re-entered this whole block and produced a SECOND copied object and
        // a SECOND `resumes` row for the same shidduch — duplicated personal
        // data, silently.
        //
        // `resumes` carries no uniqueness constraint on `shidduchim_id`
        // (`01_tables.sql`), so this can't be closed with a database
        // constraint alone. It doesn't need one: `created.id` was only just
        // created (or reused from an earlier stashed attempt) by THIS exact
        // resolve flow a few lines up, and no other code path attaches a
        // resume to a shidduch this function is in the middle of resolving —
        // so any `resumes` row already carrying this `shidduchim_id` can only
        // be this same flow's own, earlier, not-yet-stashed attempt. Looking
        // it up before creating turns the create into an idempotent
        // operation: a retry that finds the row already there skips straight
        // to the stash, closing the window without ever risking a duplicate.
        const { data: existingResumes } = await dataProvider.getList<Resume>(
          "resumes",
          {
            filter: { shidduchim_id: created.id },
            pagination: { page: 1, perPage: 100 },
            sort: { field: "id", order: "ASC" },
          },
        );

        const existingResumeForAttempt = existingResumes.find((resume) =>
          findResumeFile(resume, item.id, savedDraft.attachment.path),
        );
        if (existingResumes.length > 0 && !existingResumeForAttempt) {
          throw new Error(
            "A different resume is already attached to this suggestion.",
          );
        }

        if (!existingResumeForAttempt) {
          let copiedFile: CopiedResumeFile | undefined;
          if (
            draftProgress.resume_transfer_state === "cleanup_pending" &&
            draftProgress.resume_transfer_path
          ) {
            const removed = await removeCopiedResumeObject(
              dataProvider,
              draftProgress.resume_transfer_path,
            );
            if (!removed) {
              throw new Error("Resume cleanup could not be verified.");
            }
            resolutionSnapshot = await updateOwnedInboxResolution(
              item,
              {
                resolution_input: {
                  ...draftProgress,
                  resume_transfer_state: "cleaned",
                },
              },
              attemptId,
            );
            draftProgress = {
              ...draftProgress,
              resume_transfer_state: "cleaned",
            };
          }
          const stashedTransferPath =
            draftProgress.resume_transfer_state === "pending" &&
            draftProgress.resume_transfer_path;
          try {
            copiedFile = stashedTransferPath
              ? {
                  storagePath: stashedTransferPath,
                  size: draftProgress.resume_transfer_size ?? 0,
                }
              : await dataProvider.copyInboxAttachmentToResumeFile({
                  shidduchimId: created.id,
                  inboxItemId: item.id,
                  attachment: savedDraft.attachment,
                });

            if (!stashedTransferPath) {
              resolutionSnapshot = await updateOwnedInboxResolution(
                item,
                {
                  resolution_input: {
                    ...draftProgress,
                    resume_transfer_path: copiedFile.storagePath,
                    resume_transfer_size: copiedFile.size,
                    resume_transfer_state: "pending",
                  },
                },
                attemptId,
              );
              draftProgress = {
                ...draftProgress,
                resume_transfer_path: copiedFile.storagePath,
                resume_transfer_size: copiedFile.size,
                resume_transfer_state: "pending",
              };
            }
            const resumeData: Record<string, unknown> = {
              shidduchim_id: created.id,
              files: [
                {
                  path: copiedFile.storagePath,
                  filename: savedDraft.attachment.title,
                  mime_type: savedDraft.attachment.type,
                  uploaded_at: new Date().toISOString(),
                  uploaded_by: null,
                  size: copiedFile.size,
                  source_inbox_item_id: item.id,
                  source_inbox_attachment_path: savedDraft.attachment.path,
                },
              ],
            };
            // A plain confirmation does not have extracted fields. Leave them
            // absent so the Resume-tab reader remains the only writer of read
            // results; parsed callers still preserve their existing metadata.
            if (savedDraft.rawDraft != null) {
              resumeData.extracted = savedDraft.rawDraft;
            }
            if (savedDraft.sections != null) {
              resumeData.sections = savedDraft.sections;
            }
            await dataProvider.create<Resume>("resumes", {
              data: resumeData,
            });
          } catch (creationError) {
            // The copied path was durably recorded before the row write. A
            // strict cleanup closes the normal failure path; when cleanup is
            // unavailable or loses the network, the pending path remains in
            // resolution_input and the retry reuses this exact object rather
            // than creating a second private object.
            if (copiedFile) {
              try {
                const current = await getCurrentResolutionItem(item);
                if (current?.status !== "resolving") throw creationError;
                await updateOwnedInboxResolution(
                  item,
                  {
                    resolution_input: {
                      ...(current.resolution_input ?? draftProgress),
                      resume_transfer_state: "cleanup_pending",
                    },
                  },
                  attemptId,
                );
                const removed = await removeCopiedResumeObject(
                  dataProvider,
                  copiedFile.storagePath,
                );
                if (!removed) throw creationError;
                const afterDelete = await getCurrentResolutionItem(item);
                if (afterDelete?.status !== "resolving") throw creationError;
                await updateOwnedInboxResolution(
                  item,
                  {
                    resolution_input: {
                      ...(afterDelete.resolution_input ?? draftProgress),
                      resume_transfer_state: "cleaned",
                    },
                  },
                  attemptId,
                );
              } catch {
                // Keep cleanup_pending and its path durable. A retry repeats
                // deletion before ever reusing the path, so a successful
                // delete followed by a lost CAS cannot create a dangling row.
              }
            }
            throw creationError;
          }
        }

        resolutionSnapshot = await updateOwnedInboxResolution(
          item,
          {
            resolution_input: {
              ...((resolutionSnapshot.resolution_input ??
                draftProgress) as ResolutionInput),
              resolved_shidduchim_id: created.id,
              resume_created: true,
            },
          },
          attemptId,
        );
        if (item.source === "upload") {
          await dataProvider
            .removeInboxAttachment(savedDraft.attachment.path)
            .catch(() => undefined);
        }
      }

      resolutionSnapshot = await updateOwnedInboxResolution(
        item,
        finalizePayload("resolved", {
          resolved_shidduchim_id: created.id,
          single_id: input.single_id,
          shadchan_id: input.shadchan_id ?? null,
        }),
        attemptId,
      );
      return created;
    } catch (error) {
      // Every post-claim failure must release this attempt's lock. Preserve
      // the stash so a retry can reuse a created suggestion/resume instead of
      // creating a second one. The owner predicate makes this a no-op if a
      // newer attempt already took over the stale lock.
      if (!(error instanceof ResolutionClaimLostError)) {
        await releaseInboxResolution(item, {
          attemptId,
          preserveInput: preserveInputAfterFailure,
        }).catch(() => undefined);
      }
      throw error;
    }
  };

  /**
   * AC 5 / AC 7: "link to an existing suggestion" never creates a second,
   * duplicate suggestion — it writes an `interactions` note against the
   * chosen `shidduchim` row instead, through `insertNoteInteraction.ts` (the
   * sole writer for a `kind: "note" row), then marks the source item
   * resolved and linked to that same suggestion. The linked capture then
   * shows up in that suggestion's Notes/Activity tab automatically — no new
   * rendering path needed on the receiving end.
   */
  const resolveAsLinkToExisting = async (
    item: InboxItem,
    shidduchimId: Identifier,
  ): Promise<void> => {
    const attemptId = generateAttemptId();
    const resolutionInput: ResolutionInput = {
      action: "link",
      shidduchim_id: shidduchimId,
    };
    const lockedItem = await acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      resolutionInput,
      { claimFromStatuses: ["unresolved", "held"] },
    );

    if (lockedItem.status === "dismissed") {
      throw new ResolutionTerminalError();
    }
    if (lockedItem.status === "resolved") {
      if (!lockedItem.resolved_shidduchim_id) {
        throw new Error("This Inbox item is already resolved.");
      }
      return;
    }

    try {
      let resolutionSnapshot = lockedItem;
      const stashed = (resolutionSnapshot.resolution_input ??
        {}) as LinkResolutionProgress;

      if (!stashed.note_inserted) {
        // The stash is written after the insert, so a lost response can leave
        // the note committed while note_inserted is still false. Read the
        // provenance key before writing and reuse that note on retry.
        const { data: existingInteractions } =
          await dataProvider.getList<Interaction>("interactions", {
            filter: { target_type: "shidduch", target_id: shidduchimId },
            pagination: { page: 1, perPage: 100 },
            sort: { field: "id", order: "ASC" },
          });
        const existingInboxNote = existingInteractions.some((interaction) => {
          const metadata = interaction.metadata;
          return (
            metadata?.source === "inbox_item" &&
            String(metadata.inbox_item_id) === String(item.id)
          );
        });
        if (!existingInboxNote) {
          await insertNoteInteraction(
            dataProvider,
            "shidduch",
            shidduchimId,
            item.raw_text ?? "",
            { source: "inbox_item", inbox_item_id: item.id },
          );
        }
        const current = await getCurrentResolutionItem(item);
        resolutionSnapshot = await updateOwnedInboxResolution(
          item,
          {
            resolution_input: {
              ...(current?.resolution_input ?? resolutionInput),
              note_inserted: true,
            },
          },
          attemptId,
        );
      }

      // Story 10.4: carry any capture attachments into the linked shidduch's
      // Files tab so they remain reachable after the inbox item is resolved.
      // Pictures are deliberately parent-private here: linking an Inbox item
      // must not turn an unreviewed picture into a shared suggestion asset.
      // Explicit photo flows are the only place that may promote a picture.
      const attachments = (item.attachments ?? []) as InboxAttachment[];
      const documentAttachments = attachments.filter(
        isAffirmativeInboxDocument,
      );
      const pictureAttachments = attachments.filter(
        (attachment) => !isAffirmativeInboxDocument(attachment),
      );
      if (documentAttachments.length > 0) {
        await dataProvider.copyInboxAttachmentsToEntityFiles({
          baseDataProvider: dataProvider,
          attachments: documentAttachments,
          targetType: "shidduch",
          targetId: shidduchimId,
          visibility: "shared",
          sourceInboxItemId: item.id,
        });
      }
      if (pictureAttachments.length > 0) {
        await dataProvider.copyInboxAttachmentsToEntityFiles({
          baseDataProvider: dataProvider,
          attachments: pictureAttachments,
          targetType: "shidduch",
          targetId: shidduchimId,
          visibility: "private_parent",
          sourceInboxItemId: item.id,
        });
      }

      resolutionSnapshot = await updateOwnedInboxResolution(
        item,
        finalizePayload("resolved", {
          resolved_shidduchim_id: shidduchimId,
        }),
        attemptId,
      );
    } catch (error) {
      if (!(error instanceof ResolutionClaimLostError)) {
        await releaseInboxResolution(item, {
          attemptId,
          preserveInput: true,
        }).catch(() => undefined);
      }
      throw error;
    }
  };

  const readInboxResume = async (
    resume: Resume,
    file: ResumeFileVersion,
    requestId?: string,
  ): Promise<ResumeReadOutcome> => {
    if (!isAutomaticallyReadableResume(file)) return "failed";

    const attemptKey = resumeReadAttemptKey(resume.id, file.path);
    const effectiveRequestId =
      requestId ??
      unresolvedResumeReadAttempts.get(attemptKey) ??
      createResumeReadRequestId();
    unresolvedResumeReadAttempts.set(attemptKey, effectiveRequestId);
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ResumeReadOutcome>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve("ambiguous");
      }, 90_000);
    });

    try {
      const outcome = await Promise.race([
        dataProvider.readResume({
          resumeId: resume.id,
          requestId: effectiveRequestId,
          fileIdentity: file.path,
          mode: "fill_empty",
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (
        outcome === "completed" ||
        outcome === "empty" ||
        outcome === "no_allowance" ||
        outcome === "not_entitled" ||
        outcome === "timeout" ||
        outcome === "stale_file"
      ) {
        unresolvedResumeReadAttempts.delete(attemptKey);
      }
      // A Worker 409 means its ledger still owns the request. Treat it like a
      // transport ambiguity in this flow so the caller keeps the lock and
      // retries the same idempotent request without compensation.
      return outcome === "already_reading" ? "ambiguous" : outcome;
    } catch {
      return "ambiguous";
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  };

  const getCurrentResolutionItem = async (item: InboxItem) => {
    const { data } = await dataProvider.getOne<InboxItem>("inbox_items", {
      id: item.id,
    });
    return data;
  };

  const updateOwnedInboxResolution = async (
    item: InboxItem,
    data: Record<string, unknown>,
    ownerAttemptId: string,
  ): Promise<InboxItem> => {
    const current = await getCurrentResolutionItem(item);
    if (
      !current ||
      current.status !== "resolving" ||
      current.resolution_attempt_id !== ownerAttemptId
    ) {
      throw new ResolutionClaimLostError();
    }
    const currentInput = current.resolution_input as {
      lock_acquired_at?: unknown;
    } | null;
    const expectedLockAcquiredAt =
      typeof currentInput?.lock_acquired_at === "string"
        ? currentInput.lock_acquired_at
        : undefined;
    const updated = await conditionalInboxUpdate(
      dataProvider,
      {
        id: item.id,
        status: "resolving",
        expectedResolutionAttemptId: ownerAttemptId,
        expectedLockAcquiredAt,
        data,
      },
      current,
    );
    if (!updated) throw new ResolutionClaimLostError();
    return updated;
  };

  const releaseInboxResolution = async (
    item: InboxItem,
    options: { preserveInput?: boolean; attemptId?: string } = {},
  ): Promise<void> => {
    if (!options.attemptId) return;
    // A dropped response must not leave the item in `resolving` forever. The
    // retry repeats the existing CAS/update path; it never invents another
    // lock or another domain attempt.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = await getCurrentResolutionItem(item);
        if (
          !current ||
          current.status !== "resolving" ||
          current.resolution_attempt_id !== options.attemptId
        ) {
          return;
        }
        const currentInput = current.resolution_input as {
          lock_acquired_at?: unknown;
          claimed_from_status?: "unresolved" | "held";
        } | null;
        const updated = await conditionalInboxUpdate(
          dataProvider,
          {
            id: item.id,
            status: "resolving",
            expectedResolutionAttemptId: options.attemptId,
            expectedLockAcquiredAt:
              typeof currentInput?.lock_acquired_at === "string"
                ? currentInput.lock_acquired_at
                : undefined,
            data: {
              status:
                currentInput?.claimed_from_status === "held"
                  ? "held"
                  : "unresolved",
              resolution_attempt_id: null,
              resolution_input: options.preserveInput
                ? current.resolution_input
                : null,
            },
          },
          current,
        );
        if (!updated) return;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Could not release the Inbox resolution lock.");
  };

  const finalizeInboxResolution = async (
    item: InboxItem,
    shidduch: Shidduch,
    attemptId: string,
  ): Promise<void> => {
    const current = await getCurrentResolutionItem(item);
    if (!current || current.status === "resolved") return;
    if (current.status !== "resolving") {
      throw new ResolutionClaimLostError();
    }
    await updateOwnedInboxResolution(
      item,
      finalizePayload("resolved", {
        resolved_shidduchim_id: shidduch.id,
        single_id: shidduch.single_id,
      }),
      attemptId,
    );
  };

  const findResumeByInboxProvenance = async (
    itemId: Identifier,
    attachmentPath: string,
  ): Promise<Resume | undefined> => {
    const provenance = JSON.stringify([
      {
        source_inbox_item_id: itemId,
        source_inbox_attachment_path: attachmentPath,
      },
    ]);
    let resumes: Resume[];
    try {
      const result = await dataProvider.getList<Resume>("resumes", {
        filter: { "files@cs": provenance },
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      });
      resumes = result.data;
    } catch {
      // FakeRest and older adapters do not all expose JSONB containment. The
      // fallback still performs the authoritative provenance check in the
      // client and keeps retries identical across providers.
      const result = await dataProvider.getList<Resume>("resumes", {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      });
      resumes = result.data;
    }
    return resumes.find((resume) =>
      (resume.files ?? []).some(
        (file) =>
          String(file.source_inbox_item_id) === String(itemId) &&
          file.source_inbox_attachment_path === attachmentPath,
      ),
    );
  };

  const suggestionHasEditedFields = (suggestion: Shidduch): boolean =>
    [
      suggestion.name_en,
      suggestion.name_he,
      suggestion.father_en,
      suggestion.father_he,
      suggestion.mother_en,
      suggestion.mother_he,
      suggestion.seminary_en,
      suggestion.seminary_he,
      suggestion.shul_en,
      suggestion.shul_he,
      suggestion.location_en,
      suggestion.location_he,
      suggestion.age,
      suggestion.height,
      suggestion.dob,
      suggestion.background,
      suggestion.marital_status,
      suggestion.person_gender,
      suggestion.existing_children_note,
      suggestion.close_reason,
    ].some((value) =>
      typeof value === "string" ? value.trim().length > 0 : value != null,
    );

  const suggestionHasOtherData = async (
    shidduchimId: Identifier,
    resumeId: Identifier | undefined,
    item: InboxItem,
    attachmentPath: string,
    suggestion: Shidduch,
    attemptEntityFileIds: Set<string>,
  ): Promise<boolean> => {
    if (suggestionHasEditedFields(suggestion)) return true;
    const checks: Array<Promise<{ data: unknown[] }>> = [
      dataProvider.getList("interactions", {
        filter: { target_type: "shidduch", target_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("tasks", {
        filter: { target_type: "shidduch", target_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("redts", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("shidduch_education", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("shidduchim_external_links", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("medical_notes", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("date_records", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("entity_files", {
        filter: { target_type: "shidduch", target_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
      dataProvider.getList("reference_links", {
        filter: { shidduchim_id: shidduchimId },
        pagination: { page: 1, perPage: 1 },
      }),
    ];
    const results = await Promise.all(checks);
    const otherEntityFiles = (results[7].data as EntityFile[]).filter(
      (file) => !attemptEntityFileIds.has(String(file.id)),
    );
    if (
      results.some((result, index) => index !== 7 && result.data.length > 0) ||
      otherEntityFiles.length > 0
    ) {
      return true;
    }

    const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: shidduchimId },
      pagination: { page: 1, perPage: 2 },
      sort: { field: "id", order: "ASC" },
    });
    if (resumes.length > 1) return true;
    const resume = resumes[0];
    if (resumeId != null && resume && String(resume.id) !== String(resumeId)) {
      return true;
    }
    if (
      resume &&
      resume.files?.some(
        (file: ResumeFileVersion) =>
          String(file.source_inbox_item_id) !== String(item.id) ||
          file.source_inbox_attachment_path !== attachmentPath,
      )
    ) {
      return true;
    }

    // Parsed sections/extracted content is user-visible read data. It is
    // ownership evidence even when the fill-empty read returned no name, so a
    // lost response can never cause a committed read to be compensated. The
    // schema marker alone is not evidence; the Worker also writes it for a
    // definite empty result.
    if (resume && hasResumeContent(resume)) return true;

    if (resume) {
      const { data: photos } = await dataProvider.getList("resume_photos", {
        filter: { resume_id: resume.id },
        pagination: { page: 1, perPage: 1 },
      });
      if (photos.length > 0) return true;
    }
    return false;
  };

  const compensateNewSuggestion = async (
    item: InboxItem,
    ownerAttemptId: string,
    shidduchimId: Identifier,
    resumeId: Identifier | undefined,
    attachmentPath: string,
    suggestionCreatedId: Identifier | undefined,
    resumeCreatedByAttempt: boolean,
    attemptEntityFiles: EntityFile[] = [],
  ): Promise<boolean> => {
    let currentItem: InboxItem | undefined;
    try {
      currentItem = await getCurrentResolutionItem(item);
    } catch {
      // An unavailable verification read is ambiguity, never proof that the
      // suggestion was not stashed. Preserve it for a retry.
      return false;
    }
    if (
      !currentItem ||
      currentItem.status !== "resolving" ||
      currentItem.resolution_attempt_id !== ownerAttemptId
    ) {
      return false;
    }
    const currentResolvedId = (
      currentItem.resolution_input as {
        resolved_shidduchim_id?: Identifier;
      } | null
    )?.resolved_shidduchim_id;
    if (String(currentResolvedId) === String(shidduchimId)) return false;
    if (
      suggestionCreatedId == null ||
      String(suggestionCreatedId) !== String(shidduchimId)
    )
      return false;

    const { data: suggestion } = await dataProvider.getOne<Shidduch>(
      "shidduchim",
      { id: shidduchimId },
    );
    if (!suggestion) return true;
    // Never delete a resume row that predates this attempt. It may look empty
    // in the current read but is still user-owned state.
    if (!resumeCreatedByAttempt) return false;
    if (
      await suggestionHasOtherData(
        shidduchimId,
        resumeId,
        item,
        attachmentPath,
        suggestion,
        new Set(attemptEntityFiles.map((file) => String(file.id))),
      )
    )
      return false;

    // The dependent-data scan is intentionally a best-effort ownership
    // fence: there is no transaction around the client-side reads and
    // deletes. Re-read immediately before deleting anything so an edit that
    // appeared during the first scan aborts compensation safely. A user edit
    // racing this second scan remains the documented residual TOCTOU window.
    const { data: currentSuggestion } = await dataProvider.getOne<Shidduch>(
      "shidduchim",
      { id: shidduchimId },
    );
    if (
      !currentSuggestion ||
      (await suggestionHasOtherData(
        shidduchimId,
        resumeId,
        item,
        attachmentPath,
        currentSuggestion,
        new Set(attemptEntityFiles.map((file) => String(file.id))),
      ))
    ) {
      return !currentSuggestion;
    }

    for (const entityFile of attemptEntityFiles) {
      const provider = dataProvider as OwnershipDataProvider & {
        deleteEntityFile?: (params: {
          id: Identifier;
          storagePath: string;
        }) => Promise<void>;
      };
      const deleteEntityFile = Object.prototype.hasOwnProperty.call(
        provider,
        "deleteEntityFile",
      )
        ? provider.deleteEntityFile
        : undefined;
      if (deleteEntityFile) {
        await deleteEntityFile({
          id: entityFile.id,
          storagePath: entityFile.storage_path,
        });
      } else {
        await dataProvider.delete("entity_files", {
          id: entityFile.id,
          previousData: entityFile,
        });
      }
    }

    const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: shidduchimId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
    const resume = resumes[0];
    if (resume && resumeId != null && String(resume.id) !== String(resumeId)) {
      return false;
    }
    if (resume) {
      // Keep the catalog row when storage cleanup itself loses the network;
      // the unresolved Inbox attempt can safely retry both steps later.
      const provider = dataProvider as OwnershipDataProvider;
      const resumeFilePaths = (resume.files ?? []).map(
        (file: ResumeFileVersion) => file.path,
      );
      const removeResumeFileObjectsStrict =
        Object.prototype.hasOwnProperty.call(
          provider,
          "removeResumeFileObjectsStrict",
        )
          ? provider.removeResumeFileObjectsStrict
          : undefined;
      if (removeResumeFileObjectsStrict) {
        await removeResumeFileObjectsStrict(resumeFilePaths);
      } else {
        // Test doubles and older providers retain the historical method. Live
        // Supabase/FakeRest providers expose the strict sibling above; the
        // fallback preserves compatibility for non-production callers.
        await dataProvider.removeResumeFileObjects(resumeFilePaths);
      }
      const deleteOwnedInboxResume = Object.prototype.hasOwnProperty.call(
        provider,
        "deleteOwnedInboxResume",
      )
        ? provider.deleteOwnedInboxResume
        : undefined;
      const deletedResume = deleteOwnedInboxResume
        ? await deleteOwnedInboxResume({
            id: resume.id,
            shidduchimId,
            expectedFiles: resume.files ?? [],
          })
        : (
            await dataProvider.delete("resumes", {
              id: resume.id,
              previousData: resume,
            })
          ).data != null;
      if (!deletedResume) return false;
    }
    const provider = dataProvider as OwnershipDataProvider;
    const deleteOwnedInboxShidduch = Object.prototype.hasOwnProperty.call(
      provider,
      "deleteOwnedInboxShidduch",
    )
      ? provider.deleteOwnedInboxShidduch
      : undefined;
    if (deleteOwnedInboxShidduch) {
      return deleteOwnedInboxShidduch({
        id: shidduchimId,
        singleId: suggestion.single_id,
        expectedCreatedAt: suggestion.created_at,
      });
    }
    const deleted = await dataProvider.delete("shidduchim", {
      id: shidduchimId,
      previousData: suggestion,
    });
    return deleted.data != null;
  };

  const prepareInboxResume = async (
    item: InboxItem,
    action: InboxResumeAction,
    shidduchimId?: Identifier,
    singleId?: Identifier,
    attemptId = generateAttemptId(),
  ): Promise<InboxResumePreparation> => {
    const attachment = item.attachments?.find(isResumeDocument);
    if (!attachment) {
      throw new Error("Add a resume file first.");
    }
    const resolutionInput = {
      action:
        action === "new" ? ("resume_new" as const) : ("resume_attach" as const),
      attachment_path: attachment.path,
      ...(shidduchimId == null ? {} : { shidduchim_id: shidduchimId }),
      ...(singleId == null ? {} : { single_id: singleId }),
    };
    let precreatedShidduch: Shidduch | undefined;
    let suggestionCreatedId: Identifier | undefined;
    let preAttachedResume: Resume | undefined;
    let preAttachedResumeCreatedByAttempt = false;
    let preAttachedFile: ResumeFileVersion | undefined;
    let preAttachedFileAddedByAttempt = false;
    let preAttachedTargetShidduchId: Identifier | undefined;
    const currentBeforeLock = await getCurrentResolutionItem(item);
    const currentProgress = (currentBeforeLock.resolution_input ?? {}) as {
      resolved_shidduchim_id?: Identifier;
      resume_id?: Identifier;
      resume_file_path?: string;
    };
    const assertTargetMatchesSelection = (target: Shidduch): void => {
      if (
        action === "new" &&
        singleId != null &&
        String(target.single_id) !== String(singleId)
      ) {
        throw new Error(
          "This resume is already attached to a different child. Choose that child to retry.",
        );
      }
    };

    const rollbackPreLockResumeAttachment = async (): Promise<void> => {
      if (
        !preAttachedFileAddedByAttempt ||
        !preAttachedFile ||
        !preAttachedResume ||
        preAttachedTargetShidduchId == null
      ) {
        return;
      }
      const provider = dataProvider as OwnershipDataProvider;
      const removeOwnedInboxResumeFile = Object.prototype.hasOwnProperty.call(
        provider,
        "deleteOwnedInboxResumeFile",
      )
        ? provider.deleteOwnedInboxResumeFile
        : undefined;
      if (!removeOwnedInboxResumeFile) {
        throw new Error("Could not safely roll back the captured resume file.");
      }

      let currentResume = preAttachedResume;
      for (let retry = 0; retry < 3; retry += 1) {
        const matchingFile = findResumeFile(
          currentResume,
          item.id,
          attachment.path,
        );
        if (!matchingFile || matchingFile.path !== preAttachedFile.path) {
          const removed = await removeCopiedResumeObject(
            dataProvider,
            preAttachedFile.path,
          );
          if (!removed) {
            throw new Error("Could not verify resume rollback cleanup.");
          }
          preAttachedFileAddedByAttempt = false;
          return;
        }
        const removed = await removeOwnedInboxResumeFile({
          id: currentResume.id,
          shidduchimId: preAttachedTargetShidduchId,
          expectedFiles: currentResume.files ?? [],
          storagePath: preAttachedFile.path,
          sourceInboxItemId: item.id,
          sourceInboxAttachmentPath: attachment.path,
        });
        if (removed) {
          if (preAttachedResumeCreatedByAttempt) {
            const { data: afterRemoval } = await dataProvider.getOne<Resume>(
              "resumes",
              { id: currentResume.id },
            );
            if (afterRemoval && (afterRemoval.files ?? []).length === 0) {
              const deleted = await provider.deleteOwnedInboxResume?.({
                id: afterRemoval.id,
                shidduchimId: preAttachedTargetShidduchId,
                expectedFiles: [],
              });
              if (deleted === false) {
                throw new Error("Could not safely remove the empty resume.");
              }
            }
          }
          preAttachedFileAddedByAttempt = false;
          return;
        }
        const { data: refreshed } = await dataProvider.getOne<Resume>(
          "resumes",
          { id: currentResume.id },
        );
        if (!refreshed) throw new Error("Could not verify resume rollback.");
        currentResume = refreshed;
      }
      throw new Error("Could not safely roll back the captured resume file.");
    };

    // add_resume_file intentionally rejects a source that is already
    // `resolving`; the source-status predicate is also enforced by the SQL
    // RPC. Complete the attachment while the row is still `unresolved`, then
    // acquire the owned lock and only stash/finalize afterward. A stale retry
    // that has no attached file is failed closed rather than calling the RPC
    // from the resolving state.
    if (currentBeforeLock.status === "unresolved") {
      try {
        let targetShidduch: Shidduch | undefined;
        let resumeFromProvenance: Resume | undefined;
        if (action === "new") {
          if (currentProgress.resolved_shidduchim_id) {
            const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
              id: currentProgress.resolved_shidduchim_id,
            });
            targetShidduch = data;
            assertTargetMatchesSelection(targetShidduch);
          } else {
            resumeFromProvenance = await findResumeByInboxProvenance(
              item.id,
              attachment.path,
            );
            if (resumeFromProvenance?.shidduchim_id != null) {
              const { data } = await dataProvider.getOne<Shidduch>(
                "shidduchim",
                { id: resumeFromProvenance.shidduchim_id },
              );
              targetShidduch = data;
              assertTargetMatchesSelection(targetShidduch);
            }
          }
          if (!targetShidduch) {
            if (singleId == null)
              throw new Error("Choose who this suggestion is for.");
            precreatedShidduch = await dataProvider.createShidduch({
              single_id: singleId,
              name_en: null,
              origin: item.source === "shadchan" ? "shadchan" : "channel",
              initial_state: "new",
              visibility: "shared",
              kohen_status: "unknown",
              redt_date: item.created_at.split("T")[0],
            });
            suggestionCreatedId = precreatedShidduch.id;
            targetShidduch = precreatedShidduch;
          }
        } else {
          if (shidduchimId == null)
            throw new Error("Choose a suggestion first.");
          const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
            id: shidduchimId,
          });
          targetShidduch = data;
        }

        if (currentProgress.resume_id) {
          const { data } = await dataProvider.getOne<Resume>("resumes", {
            id: currentProgress.resume_id,
          });
          preAttachedResume = data;
        }
        if (!preAttachedResume) {
          const { data: resumes } = await dataProvider.getList<Resume>(
            "resumes",
            {
              filter: { shidduchim_id: targetShidduch.id },
              pagination: { page: 1, perPage: 1 },
              sort: { field: "id", order: "ASC" },
            },
          );
          preAttachedResume = resumes[0];
        }
        preAttachedFile =
          preAttachedResume &&
          findResumeFile(preAttachedResume, item.id, attachment.path);
        if (!preAttachedFile) {
          const resumeExistedBeforeAttach = preAttachedResume != null;
          preAttachedResumeCreatedByAttempt =
            action === "new" && !resumeExistedBeforeAttach;
          preAttachedTargetShidduchId = targetShidduch.id;
          preAttachedResume =
            await dataProvider.attachInboxAttachmentToResumeFile({
              shidduchimId: targetShidduch.id,
              inboxItemId: item.id,
              attachment,
            });
          preAttachedFile = findResumeFile(
            preAttachedResume,
            item.id,
            attachment.path,
          );
          if (!preAttachedFile)
            throw new Error("Could not attach this resume.");
          preAttachedFileAddedByAttempt = true;
        }
      } catch (error) {
        await rollbackPreLockResumeAttachment();
        throw error;
      }
    }

    let lockedItem: InboxItem;
    try {
      lockedItem = await acquireResolutionLock(
        dataProvider,
        item,
        attemptId,
        resolutionInput,
        { claimFromStatuses: ["unresolved"] },
      );
    } catch (error) {
      await rollbackPreLockResumeAttachment();
      throw error;
    }
    if (lockedItem.status === "dismissed") {
      await rollbackPreLockResumeAttachment();
      throw new ResolutionTerminalError();
    }
    if (lockedItem.status === "resolved") {
      if (!lockedItem.resolved_shidduchim_id) {
        await rollbackPreLockResumeAttachment();
        throw new Error("This Inbox item is already resolved.");
      }
      await rollbackPreLockResumeAttachment();
      const { data: existing } = await dataProvider.getOne<Shidduch>(
        "shidduchim",
        { id: lockedItem.resolved_shidduchim_id },
      );
      if (!existing) throw new Error("This suggestion is no longer available.");
      const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
        filter: { shidduchim_id: existing.id },
        pagination: { page: 1, perPage: 1 },
      });
      const file =
        resumes[0] && findResumeFile(resumes[0], item.id, attachment.path);
      if (!resumes[0] || !file)
        throw new Error("This Inbox item is already resolved.");
      return {
        shidduch: existing,
        resume: resumes[0],
        file,
        suggestionCreatedId: undefined,
        resumeCreatedByAttempt: false,
        entityFiles: [],
        entityFilesCreatedByAttempt: [],
        resolutionAttemptId: attemptId,
        // A terminal Inbox row already completed this action. Do not infer a
        // new file's read state from the resume's older parsed content.
        readCompleted: true,
      };
    }

    const stashed = (lockedItem.resolution_input ??
      {}) as typeof resolutionInput & {
      resolved_shidduchim_id?: Identifier;
      resume_id?: Identifier;
      resume_file_path?: string;
      resume_created?: boolean;
      read_completed?: boolean;
      entity_file_ids?: Identifier[];
      resume_read_request_id?: string;
      resume_read_pending?: boolean;
      resume_read_file_path?: string;
      resume_read_completed_file_path?: string;
      resume_read_pending_file_path?: string;
    };
    let resumeFromProvenance: Resume | undefined;
    if (action === "new" && !stashed.resolved_shidduchim_id) {
      resumeFromProvenance = await findResumeByInboxProvenance(
        item.id,
        attachment.path,
      );
    }
    let shidduch: Shidduch;
    if (action === "new") {
      if (stashed.resolved_shidduchim_id) {
        const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
          id: stashed.resolved_shidduchim_id,
        });
        shidduch = data;
      } else {
        if (singleId == null)
          throw new Error("Choose who this suggestion is for.");
        const suggestionWasCreatedForThisAttempt =
          precreatedShidduch == null && resumeFromProvenance == null;
        if (precreatedShidduch) {
          shidduch = precreatedShidduch;
        } else if (resumeFromProvenance?.shidduchim_id != null) {
          const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
            id: resumeFromProvenance.shidduchim_id,
          });
          shidduch = data;
        } else {
          shidduch = await dataProvider.createShidduch({
            single_id: singleId,
            name_en: null,
            origin: item.source === "shadchan" ? "shadchan" : "channel",
            initial_state: "new",
            visibility: "shared",
            kohen_status: "unknown",
            redt_date: item.created_at.split("T")[0],
          });
          suggestionCreatedId = shidduch.id;
        }
        assertTargetMatchesSelection(shidduch);
        try {
          await updateOwnedInboxResolution(
            item,
            {
              resolution_input: {
                ...stashed,
                ...resolutionInput,
                lock_acquired_at: (
                  lockedItem.resolution_input as {
                    lock_acquired_at?: string;
                  } | null
                )?.lock_acquired_at,
                resolved_shidduchim_id: shidduch.id,
              },
            },
            attemptId,
          );
        } catch (error) {
          if (suggestionWasCreatedForThisAttempt) {
            // If the stash response is the part that was lost, remove only
            // this just-created empty suggestion. If cleanup also loses the
            // network, the caller releases the Inbox lock and the source
            // remains intact.
            await compensateNewSuggestion(
              item,
              attemptId,
              shidduch.id,
              undefined,
              attachment.path,
              shidduch.id,
              true,
            ).catch(() => undefined);
          }
          throw error;
        }
      }
    } else {
      if (shidduchimId == null) throw new Error("Choose a suggestion first.");
      const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
        id: shidduchimId,
      });
      shidduch = data;
    }

    let resume: Resume | undefined = preAttachedResume ?? resumeFromProvenance;
    // Ownership is an immutable fact recorded by the attempt that inserted
    // the row. A resume found through provenance or an ordinary target lookup
    // belongs to the user, even when this flow appends the selected file to it.
    const resumeCreatedByAttempt =
      (action === "new" && stashed.resume_created === true) ||
      preAttachedResumeCreatedByAttempt;
    if (stashed.resume_id) {
      const { data } = await dataProvider.getOne<Resume>("resumes", {
        id: stashed.resume_id,
      });
      resume = data;
    }
    if (!resume) {
      const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
        filter: { shidduchim_id: shidduch.id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      resume = resumes[0];
    }
    const file = resume && findResumeFile(resume, item.id, attachment.path);
    const fileWasAlreadyAttached = file != null;

    // Record the selected file before any attach/storage work. If the tab dies
    // after the catalog append but before the read request is recorded, a
    // retry must know that this file still needs its first read rather than
    // mistaking the provenance match for a completed read.
    if (
      !fileWasAlreadyAttached &&
      (stashed.resume_read_file_path !== attachment.path ||
        stashed.resume_read_pending_file_path !== attachment.path)
    ) {
      const current = await getCurrentResolutionItem(item);
      if (current?.status === "resolving") {
        await updateOwnedInboxResolution(
          item,
          {
            resolution_input: {
              ...(current.resolution_input ?? resolutionInput),
              resume_read_file_path: attachment.path,
              resume_read_pending_file_path: attachment.path,
              resume_read_pending: true,
            },
          },
          attemptId,
        );
        stashed.resume_read_file_path = attachment.path;
        stashed.resume_read_pending_file_path = attachment.path;
        stashed.resume_read_pending = true;
      }
    }
    if (!resume || !file) {
      throw new Error(
        "Could not attach this resume while the Inbox item is being resolved.",
      );
    }
    if (!file) throw new Error("Could not attach this resume.");

    const readCompleted = readCompletedForFile(stashed, file.path);

    // The chosen document is the only Resume-tab/read input. Every other
    // captured attachment, including additional resume-like documents, is a
    // private Files-tab copy. A deterministic source/item key makes a retry
    // reuse rows/objects created before a lost response instead of duplicating
    // them; the Inbox source remains untouched until its own deletion.
    let entityFiles: EntityFile[] = [];
    const privateAttachments = (item.attachments ?? []).filter(
      (candidate) => candidate.path !== attachment.path,
    );
    if (privateAttachments.length > 0) {
      try {
        entityFiles = await dataProvider.copyInboxAttachmentsToEntityFiles({
          baseDataProvider: dataProvider,
          attachments: privateAttachments,
          targetType: "shidduch",
          targetId: shidduch.id,
          visibility: "private_parent",
          sourceInboxItemId: item.id,
        });
      } catch (error) {
        const partialFiles = (error as { copiedFiles?: EntityFile[] })
          .copiedFiles;
        if (partialFiles && partialFiles.length > 0) {
          const current = await getCurrentResolutionItem(item);
          if (current?.status === "resolving") {
            await updateOwnedInboxResolution(
              item,
              {
                resolution_input: {
                  ...(current.resolution_input ?? resolutionInput),
                  entity_file_ids: partialFiles
                    .filter(
                      (file) =>
                        (file as EntityFile & { createdByAttempt?: boolean })
                          .createdByAttempt === true,
                    )
                    .map((file) => file.id),
                },
              },
              attemptId,
            ).catch(() => undefined);
          }
        }
        throw error;
      }
    }

    if (
      stashed.resume_id !== resume.id ||
      stashed.resume_file_path !== file.path ||
      stashed.read_completed !== readCompleted ||
      stashed.resume_read_file_path !== file.path ||
      (readCompleted &&
        stashed.resume_read_completed_file_path !== file.path) ||
      JSON.stringify(stashed.entity_file_ids ?? []) !==
        JSON.stringify(entityFiles.map((entityFile) => entityFile.id))
    ) {
      const current = await getCurrentResolutionItem(item);
      if (current?.status === "resolving") {
        await updateOwnedInboxResolution(
          item,
          {
            resolution_input: {
              ...(current.resolution_input ?? resolutionInput),
              resume_id: resume.id,
              resume_file_path: file.path,
              resume_created: resumeCreatedByAttempt,
              read_completed: readCompleted,
              resume_read_file_path: file.path,
              ...(readCompleted
                ? {
                    resume_read_completed_file_path: file.path,
                    resume_read_pending: false,
                    resume_read_pending_file_path: undefined,
                  }
                : {}),
              entity_file_ids: entityFiles.map((entityFile) => entityFile.id),
            },
          },
          attemptId,
        );
      }
    }

    const entityFilesCreatedByAttempt = entityFiles.filter(
      (entityFile) =>
        (entityFile as EntityFile & { createdByAttempt?: boolean })
          .createdByAttempt === true,
    );

    return {
      shidduch,
      resume,
      file,
      suggestionCreatedId,
      resumeCreatedByAttempt,
      entityFiles,
      entityFilesCreatedByAttempt,
      resolutionAttemptId: attemptId,
      readCompleted,
      resumeReadRequestId: stashed.resume_read_request_id,
    };
  };

  const resolveInboxResume = async (
    item: InboxItem,
    action: InboxResumeAction,
    options: { shidduchimId?: Identifier; singleId?: Identifier },
  ): Promise<InboxResumeProcessResult> => {
    const currentBeforeAttempt = await getCurrentResolutionItem(item).catch(
      () => undefined,
    );
    const currentInput = currentBeforeAttempt?.resolution_input as {
      resume_read_pending?: boolean;
    } | null;
    const canResumePendingAttempt =
      currentBeforeAttempt?.status === "resolving" &&
      currentInput?.resume_read_pending === true &&
      currentBeforeAttempt.resolution_attempt_id != null &&
      !isResolutionLockStale(currentBeforeAttempt.resolution_input);
    // An ambiguous read deliberately keeps the lock. A retry from the same
    // UI can resume that exact attempt immediately; a crash before the
    // pending marker lands still follows normal stale-lock takeover.
    const attemptId = canResumePendingAttempt
      ? String(currentBeforeAttempt.resolution_attempt_id)
      : generateAttemptId();
    let preparation: InboxResumePreparation | undefined;
    let readSucceeded = false;
    let readStarted = false;
    let ambiguousRead = false;
    try {
      preparation = await prepareInboxResume(
        item,
        action,
        options.shidduchimId,
        options.singleId,
        attemptId,
      );
      let outcome: ResumeReadOutcome = "completed";
      readSucceeded = preparation.readCompleted;
      if (!preparation.readCompleted) {
        const requestId =
          preparation.resumeReadRequestId ?? createResumeReadRequestId();
        const current = await getCurrentResolutionItem(item);
        if (current?.status === "resolving") {
          await updateOwnedInboxResolution(
            item,
            {
              resolution_input: {
                ...(current.resolution_input ?? {}),
                resume_read_request_id: requestId,
                resume_read_file_path: preparation.file.path,
                resume_read_pending_file_path: preparation.file.path,
                resume_read_pending: true,
              },
            },
            attemptId,
          );
        }
        readStarted = true;
        outcome = await readInboxResume(
          preparation.resume,
          preparation.file,
          requestId,
        );
        if (outcome === "ambiguous") {
          // A transport ambiguity has no client-visible commit marker. Reissue
          // the exact request once in this action; the Worker ledger makes the
          // replay free when the first call committed and performs the read
          // once when it did not. A second ambiguity (including a 409
          // already_reading mapped by readInboxResume) keeps the lock pending.
          outcome = await readInboxResume(
            preparation.resume,
            preparation.file,
            requestId,
          );
          if (outcome === "ambiguous" || outcome === "already_reading") {
            ambiguousRead = true;
            // The pending file and request id were stashed before the first
            // call. Leave them untouched so the next user action retries the
            // same idempotent Worker request.
            return {
              outcome: "ambiguous",
              shidduch: null,
              suggestionKept: true,
            };
          }
        }
        if (outcome === "completed") {
          readSucceeded = true;
          const current = await getCurrentResolutionItem(item);
          if (current?.status === "resolving") {
            await updateOwnedInboxResolution(
              item,
              {
                resolution_input: {
                  ...(current.resolution_input ?? {}),
                  read_completed: true,
                  resume_read_file_path: preparation.file.path,
                  resume_read_completed_file_path: preparation.file.path,
                  resume_read_pending: false,
                  resume_read_pending_file_path: undefined,
                },
              },
              attemptId,
            );
          }
        }
      }

      if (outcome === "completed") {
        await finalizeInboxResolution(item, preparation.shidduch, attemptId);
        let completedShidduch = preparation.shidduch;
        try {
          const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
            id: preparation.shidduch.id,
          });
          if (data) completedShidduch = data;
        } catch {
          // The read/finalize already succeeded. A stale display object must
          // never turn that success into compensation; the next list refresh
          // will fetch the fill_empty name.
        }
        return {
          outcome,
          shidduch: completedShidduch,
          suggestionKept: true,
        };
      }

      let suggestionKept = action === "attach";
      if (action === "new") {
        try {
          suggestionKept = !(await compensateNewSuggestion(
            item,
            attemptId,
            preparation.shidduch.id,
            preparation.resume.id,
            item.attachments?.find(isResumeDocument)?.path ?? "",
            preparation.suggestionCreatedId,
            preparation.resumeCreatedByAttempt,
            preparation.entityFilesCreatedByAttempt,
          ));
        } catch {
          // Cleanup itself is retryable. Release the Inbox row with the
          // provenance stash intact and return the plain failure outcome; the
          // caller must never turn a cleanup outage into allowance copy.
          await releaseInboxResolution(item, {
            preserveInput: true,
            attemptId,
          });
          return { outcome: "failed", shidduch: null, suggestionKept: true };
        }
      }
      await releaseInboxResolution(item, {
        attemptId,
        preserveInput: suggestionKept,
      });
      return { outcome, shidduch: null, suggestionKept };
    } catch (error) {
      let preserveInput = true;
      if (action === "new" && !(error instanceof ResolutionClaimLostError)) {
        const current = await getCurrentResolutionItem(item).catch(() => null);
        const stashed = current?.resolution_input as {
          resolved_shidduchim_id?: Identifier;
          resume_id?: Identifier;
          resume_file_path?: string;
          resume_created?: boolean;
          entity_file_ids?: Identifier[];
        } | null;
        const shidduchimId =
          preparation?.shidduch.id ?? stashed?.resolved_shidduchim_id;
        // If this verification read is unavailable, the stash state is
        // ambiguous. Keep the suggestion and leave the input retryable; a
        // missing read must never authorize destructive compensation.
        if (shidduchimId != null && current != null) {
          if (!readSucceeded && readStarted && !ambiguousRead) {
            let attemptEntityFiles =
              preparation?.entityFilesCreatedByAttempt ?? [];
            if (attemptEntityFiles.length === 0 && stashed?.entity_file_ids) {
              const { data: entityFiles } = await dataProvider
                .getList<EntityFile>("entity_files", {
                  filter: { target_type: "shidduch", target_id: shidduchimId },
                  pagination: { page: 1, perPage: 100 },
                })
                .catch(() => ({ data: [] as EntityFile[] }));
              const ownedIds = new Set(
                stashed.entity_file_ids.map((id) => String(id)),
              );
              attemptEntityFiles = entityFiles.filter((file) =>
                ownedIds.has(String(file.id)),
              );
            }
            const compensated = await compensateNewSuggestion(
              item,
              attemptId,
              shidduchimId,
              preparation?.resume.id ?? stashed?.resume_id,
              preparation?.file.path ??
                stashed?.resume_file_path ??
                item.attachments?.find(isResumeDocument)?.path ??
                "",
              preparation?.suggestionCreatedId,
              preparation?.resumeCreatedByAttempt ??
                stashed?.resume_created === true,
              attemptEntityFiles,
            ).catch(() => false);
            preserveInput = !compensated;
          }
        }
      }
      await releaseInboxResolution(item, {
        preserveInput: readSucceeded || preserveInput,
        attemptId,
      }).catch(() => undefined);
      throw error;
    }
  };

  /** `InboxResolveDialog.tsx`'s "Dismiss — not a redt" action (never AC 6's
   * "Skip" — that action creates a bare unresolved row from scratch via
   * `dataProvider.create`, on `ShareTarget.tsx`; it never calls this).
   * Marks an ALREADY-captured item `dismissed` rather than deleting it, so
   * nothing already in the Inbox is ever lost by dismissing it. Review fix
   * (F7, LOW, Story 10.1): this comment used to mislabel this as AC 6's
   * Skip. */
  const dismissInboxItem = async (item: InboxItem): Promise<void> => {
    const attemptId = generateAttemptId();
    const resolutionInput: ResolutionInput = { action: "dismiss" };
    const lockedItem = await acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      resolutionInput,
      { claimFromStatuses: ["unresolved", "held"] },
    );

    if (lockedItem.status === "dismissed") {
      return;
    }

    try {
      await updateOwnedInboxResolution(
        item,
        finalizePayload("dismissed"),
        attemptId,
      );
    } catch (error) {
      if (!(error instanceof ResolutionClaimLostError)) {
        await releaseInboxResolution(item, { attemptId }).catch(
          () => undefined,
        );
      }
      throw error;
    }
  };

  return {
    resolveAsNewShidduch,
    resolveAsLinkToExisting,
    dismissInboxItem,
    prepareInboxResume,
    resolveInboxResume,
    releaseInboxResolution,
  };
}
