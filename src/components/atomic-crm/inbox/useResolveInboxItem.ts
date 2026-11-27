import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import { insertNoteInteraction } from "../entity360/tabs/insertNoteInteraction";
import type { CrmDataProvider } from "../providers/types";
import type { CopiedResumeFile } from "../providers/supabase/resumes";
import type {
  CreateShidduchInput,
  EntityFile,
  InboxAttachment,
  InboxItem,
  Interaction,
  Resume,
  ResumeFileVersion,
  ResumePhoto,
  Shidduch,
} from "../types";
import { isAutomaticallyReadableResume } from "../resumes/resumeAutoReadHelpers";
import {
  createResumeReadRequestId,
  resumeReadAttemptKey,
  unresolvedResumeReadAttempts,
} from "../resumes/resumeReadRequest";
import type { ResumeReadOutcome } from "../providers/commons/rereadWorkerClient";
import { suggestedByPhoneForName } from "./suggestedBy";
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

/**
 * A confirmed Inbox sender is the non-shadchan referrer for a suggestion.
 * Keep this normalization local to the filing paths: the value is persisted
 * as data, never logged or placed in a URL/storage key. Unconfirmed, blank,
 * email-like, unsafe, and overlong legacy values remain unset so the DB check
 * constraints cannot reject an otherwise valid Inbox filing.
 */
export function suggestedByNameFromInboxItem(
  item: Pick<InboxItem, "sender" | "sender_needs_confirmation">,
): string | null {
  if (item.sender_needs_confirmation) return null;
  const sender = item.sender?.trim();
  const hasControlCharacter = sender
    ? [...sender].some((character) => {
        const codePoint = character.charCodeAt(0);
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      })
    : false;
  if (
    !sender ||
    sender.includes("@") ||
    sender.length > 200 ||
    hasControlCharacter
  ) {
    return null;
  }
  return sender;
}

export function suggestedByPhoneFromInboxItem(
  item: Pick<
    InboxItem,
    "sender" | "sender_needs_confirmation" | "sender_phone"
  >,
): string | null {
  return suggestedByPhoneForName(
    suggestedByNameFromInboxItem(item),
    item.sender_phone,
  );
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
    const normalizedSuggestedByPhone = suggestedByPhoneForName(
      input.suggested_by_name,
      input.suggested_by_phone,
    );
    // Preserve the optional-field shape when no phone was supplied. Existing
    // stashes may predate sender_phone and retry compatibility is structural.
    const filingInput: CreateShidduchInput =
      normalizedSuggestedByPhone === null &&
      !Object.prototype.hasOwnProperty.call(input, "suggested_by_phone")
        ? input
        : {
            ...input,
            suggested_by_phone: normalizedSuggestedByPhone,
          };
    const resolutionInput: ResolutionInput = {
      action: "new",
      input: filingInput,
      resume_draft: draft,
      ...(item.raw_text?.trim()
        ? { resume_source_inbox_item_id: item.id }
        : {}),
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
      const stashed = (resolutionSnapshot.resolution_input ?? {}) as Extract<
        ResolutionInput,
        { action: "new" }
      > & {
        resolved_shidduchim_id?: Identifier;
      };

      let created: Shidduch;
      if (stashed.resolved_shidduchim_id) {
        const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
          id: stashed.resolved_shidduchim_id,
        });
        created = data;
      } else {
        created = await dataProvider.createShidduch(filingInput);
        // Stash the created id so a retry can skip createShidduch if the
        // finalize step fails. The suggestion is deliberately retained if
        // this CAS is lost or ambiguous: without an exact server receipt,
        // deleting it could remove a row that another attempt already owns.
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

        const existingResumeForAttempt = savedDraft.attachment
          ? existingResumes.find((resume) =>
              findResumeFile(resume, item.id, savedDraft.attachment!.path),
            )
          : existingResumes[0];
        if (existingResumes.length > 0 && !existingResumeForAttempt) {
          throw new Error(
            "A different resume is already attached to this suggestion.",
          );
        }

        if (!existingResumeForAttempt) {
          let copiedFile: CopiedResumeFile | undefined;
          const stashedTransferPath =
            (draftProgress.resume_transfer_state === "pending" ||
              draftProgress.resume_transfer_state === "cleanup_pending") &&
            draftProgress.resume_transfer_path;
          try {
            copiedFile = savedDraft.attachment
              ? stashedTransferPath
                ? {
                    storagePath: stashedTransferPath,
                    size: draftProgress.resume_transfer_size ?? 0,
                  }
                : await dataProvider.copyInboxAttachmentToResumeFile({
                    shidduchimId: created.id,
                    inboxItemId: item.id,
                    attachment: savedDraft.attachment,
                  })
              : undefined;

            if (savedDraft.attachment && !copiedFile) {
              throw new Error("Could not copy the resume attachment.");
            }

            if (savedDraft.attachment && !stashedTransferPath) {
              resolutionSnapshot = await updateOwnedInboxResolution(
                item,
                {
                  resolution_input: {
                    ...draftProgress,
                    resume_transfer_path: copiedFile!.storagePath,
                    resume_transfer_size: copiedFile!.size,
                    resume_transfer_state: "pending",
                  },
                },
                attemptId,
              );
              draftProgress = {
                ...draftProgress,
                resume_transfer_path: copiedFile!.storagePath,
                resume_transfer_size: copiedFile!.size,
                resume_transfer_state: "pending",
              };
            }
            const resumeData: Record<string, unknown> = {
              shidduchim_id: created.id,
              files:
                copiedFile && savedDraft.attachment
                  ? [
                      {
                        path: copiedFile.storagePath,
                        filename: savedDraft.attachment.title,
                        mime_type: savedDraft.attachment.type,
                        uploaded_at: new Date().toISOString(),
                        uploaded_by: null,
                        size: copiedFile.size,
                        source_inbox_item_id: item.id,
                        source_inbox_attachment_path:
                          savedDraft.attachment.path,
                      },
                    ]
                  : [],
            };
            // A plain confirmation does not have extracted fields. Leave them
            // absent so the Resume-tab reader remains the only writer of read
            // results; parsed callers still preserve their existing metadata.
            if (savedDraft.rawDraft != null) {
              resumeData.extracted = savedDraft.rawDraft;
            }
            if (savedDraft.sections != null) {
              resumeData.sections =
                !savedDraft.attachment &&
                typeof savedDraft.sections === "object" &&
                savedDraft.sections !== null &&
                !Array.isArray(savedDraft.sections)
                  ? {
                      ...(savedDraft.sections as Record<string, unknown>),
                      source_inbox_item_id: item.id,
                    }
                  : savedDraft.sections;
            } else if (!savedDraft.attachment) {
              // Text captures have no file-version row in which to retain
              // provenance. Keep the source id alongside the parsed sections
              // metadata without changing the exact Inbox raw_text.
              resumeData.sections = { source_inbox_item_id: item.id };
            }
            await dataProvider.create<Resume>("resumes", {
              data: resumeData,
            });
          } catch (creationError) {
            // The copied path was durably recorded before the row write. Do
            // not delete this deterministic destination: another attempt may
            // already reference the same object and there is no per-call
            // receipt proving ownership. The retry reuses this exact path;
            // bead 89p tracks GC for any bounded leftover Inbox object.
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
              } catch {
                // The path was already recorded before the copy/create
                // failure. Preserve the object even if this progress update
                // is lost; its deterministic key is reused on retry.
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
        if (item.source === "upload" && savedDraft.attachment) {
          await dataProvider
            .removeInboxAttachment(savedDraft.attachment.path)
            .catch(() => undefined);
        }
      }

      const pictureAttachments = (
        (item.attachments ?? []) as InboxAttachment[]
      ).filter(
        (attachment) =>
          INBOX_IMAGE_EXTENSIONS.has(
            attachmentExtension(attachment.title ?? ""),
          ) || (attachment.type ?? "").toLowerCase().startsWith("image/"),
      );
      const pictureProgress = (resolutionSnapshot.resolution_input ??
        draftProgress) as NewResolutionProgress;
      if (
        pictureAttachments.length > 0 &&
        !pictureProgress.picture_files_created
      ) {
        await dataProvider.copyInboxAttachmentsToEntityFiles({
          baseDataProvider: dataProvider,
          attachments: pictureAttachments,
          targetType: "shidduch",
          targetId: created.id,
          visibility: "private_parent",
          sourceInboxItemId: item.id,
        });
        resolutionSnapshot = await updateOwnedInboxResolution(
          item,
          {
            resolution_input: {
              ...pictureProgress,
              picture_files_created: true,
            },
          },
          attemptId,
        );
      }

      const promotedSnapshot = await autoPromoteFirstPicture(
        item,
        created.id,
        pictureAttachments,
        (resolutionSnapshot.resolution_input ??
          pictureProgress) as NewResolutionProgress,
        attemptId,
      );
      if (promotedSnapshot) resolutionSnapshot = promotedSnapshot;

      resolutionSnapshot = await updateOwnedInboxResolution(
        item,
        finalizePayload("resolved", {
          resolved_shidduchim_id: created.id,
          single_id: filingInput.single_id,
          shadchan_id: filingInput.shadchan_id ?? null,
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
          preserveInput: true,
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
      ...(item.raw_text?.trim()
        ? { resume_source_inbox_item_id: item.id }
        : {}),
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
        // provenance key before writing and reuse that note on retry. The
        // remaining two-tab read-then-insert race needs the server-side
        // atomic RPC tracked in follow-up myshadchan-5qi.
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
      // Pictures remain parent-private in Files. If the suggestion has no
      // current Photo, the first supported picture is also promoted through
      // the same deterministic Photo path; later pictures remain in Files.
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

      const promotedSnapshot = await autoPromoteFirstPicture(
        item,
        shidduchimId,
        pictureAttachments,
        (resolutionSnapshot.resolution_input ??
          stashed) as LinkResolutionProgress,
        attemptId,
      );
      if (promotedSnapshot) resolutionSnapshot = promotedSnapshot;

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

  const autoPromoteFirstPicture = async (
    item: InboxItem,
    shidduchimId: Identifier,
    pictures: InboxAttachment[],
    progress: {
      picture_photo_created?: boolean;
      picture_photo_source_path?: string;
    },
    ownerAttemptId: string,
  ): Promise<InboxItem | null> => {
    if (progress.picture_photo_created) return null;
    const candidate = pictures.find((attachment) => {
      const mimeType = (attachment.type ?? "").trim().toLowerCase();
      if (mimeType) {
        return mimeType === "image/jpeg" || mimeType === "image/png";
      }
      return /\.(jpeg|jpg|png)$/iu.test(attachment.title ?? "");
    });
    if (!candidate) return null;

    const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: shidduchimId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
    const resume = resumes[0];
    if (resume) {
      const { data: photos } = await dataProvider.getList<ResumePhoto>(
        "resume_photos",
        {
          filter: { resume_id: resume.id, "hidden_at@is": null },
          pagination: { page: 1, perPage: 1 },
          sort: { field: "uploaded_at", order: "DESC" },
        },
      );
      if (photos.length > 0) return null;
    }

    await dataProvider.copyInboxAttachmentToResumePhoto({
      shidduchimId,
      attachment: candidate,
    });
    return updateOwnedInboxResolution(
      item,
      {
        resolution_input: {
          ...progress,
          picture_photo_created: true,
          picture_photo_source_path: candidate.path,
        },
      },
      ownerAttemptId,
    );
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

  const prepareInboxResume = async (
    item: InboxItem,
    action: InboxResumeAction,
    shidduchimId?: Identifier,
    singleId?: Identifier,
    shadchanId?: Identifier | null,
    suggestedByName?: string | null,
    suggestedByPhone?: string | null,
    attemptId = generateAttemptId(),
  ): Promise<InboxResumePreparation> => {
    const attachment = item.attachments?.find(isResumeDocument);
    if (!attachment) {
      throw new Error("Add a resume file first.");
    }
    let precreatedShidduch: Shidduch | undefined;
    let preAttachedResume: Resume | undefined;
    let preAttachedFile: ResumeFileVersion | undefined;
    const currentBeforeLock = await getCurrentResolutionItem(item);
    const currentProgress = (currentBeforeLock.resolution_input ?? {}) as {
      resolved_shidduchim_id?: Identifier;
      resume_id?: Identifier;
      resume_file_path?: string;
      shadchan_id?: Identifier | null;
      suggested_by_name?: string | null;
      suggested_by_phone?: string | null;
    };
    const effectiveShadchanId = Object.prototype.hasOwnProperty.call(
      currentProgress,
      "shadchan_id",
    )
      ? (currentProgress.shadchan_id ?? null)
      : (shadchanId ?? null);
    const effectiveSuggestedByName =
      currentProgress.suggested_by_name ?? suggestedByName ?? null;
    const effectiveSuggestedByPhone = suggestedByPhoneForName(
      effectiveSuggestedByName,
      currentProgress.suggested_by_phone ?? suggestedByPhone,
    );
    const resolutionInput = {
      action:
        action === "new" ? ("resume_new" as const) : ("resume_attach" as const),
      attachment_path: attachment.path,
      ...(shidduchimId == null ? {} : { shidduchim_id: shidduchimId }),
      ...(singleId == null ? {} : { single_id: singleId }),
      ...(action === "new"
        ? {
            shadchan_id: effectiveShadchanId,
            suggested_by_name: effectiveSuggestedByName,
            suggested_by_phone: effectiveSuggestedByPhone,
          }
        : {}),
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

    // add_resume_file intentionally rejects a source that is already
    // `resolving`; the source-status predicate is also enforced by the SQL
    // RPC. Complete the attachment while the row is still `unresolved`, then
    // acquire the owned lock and only stash/finalize afterward. A stale retry
    // that has no attached file is failed closed rather than calling the RPC
    // from the resolving state.
    if (currentBeforeLock.status === "unresolved") {
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
            const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
              id: resumeFromProvenance.shidduchim_id,
            });
            targetShidduch = data;
            assertTargetMatchesSelection(targetShidduch);
          }
        }
        if (!targetShidduch) {
          if (singleId == null)
            throw new Error("Choose who this suggestion is for.");
          precreatedShidduch = await dataProvider.createShidduch({
            single_id: singleId,
            shadchan_id: effectiveShadchanId,
            name_en: null,
            suggested_by_name: effectiveSuggestedByName,
            suggested_by_phone: effectiveSuggestedByPhone,
            origin: item.source === "shadchan" ? "shadchan" : "channel",
            initial_state: "new",
            visibility: "shared",
            kohen_status: "unknown",
            redt_date: item.created_at.split("T")[0],
          });
          targetShidduch = precreatedShidduch;
        }
      } else {
        if (shidduchimId == null) throw new Error("Choose a suggestion first.");
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
        // A same-item, different-child race can leave this visible attachment
        // on the losing target; atomic claim+attach is deferred to
        // myshadchan-5qi. Keep the file rather than risking destructive cleanup.
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
        if (!preAttachedFile) throw new Error("Could not attach this resume.");
      }
    }

    const lockedItem = await acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      resolutionInput,
      { claimFromStatuses: ["unresolved"] },
    );
    if (lockedItem.status === "dismissed") {
      throw new ResolutionTerminalError();
    }
    if (lockedItem.status === "resolved") {
      if (!lockedItem.resolved_shidduchim_id) {
        throw new Error("This Inbox item is already resolved.");
      }
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
        resumeCreatedByAttempt: false,
        entityFiles: [],
        entityFilesCreatedByAttempt: [],
        resolutionAttemptId: attemptId,
        // A terminal Inbox row already completed this action. Do not infer a
        // new file's read state from the resume's older parsed content.
        readCompleted: true,
      };
    }

    const stashed = (lockedItem.resolution_input ?? {}) as Extract<
      ResolutionInput,
      { action: "resume_new" | "resume_attach" }
    > & {
      resolved_shidduchim_id?: Identifier;
      resume_id?: Identifier;
      resume_file_path?: string;
      resume_created?: boolean;
      shadchan_id?: Identifier | null;
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
            shadchan_id: stashed.shadchan_id ?? effectiveShadchanId,
            name_en: null,
            suggested_by_name:
              stashed.suggested_by_name ?? effectiveSuggestedByName,
            suggested_by_phone: suggestedByPhoneForName(
              stashed.suggested_by_name ?? effectiveSuggestedByName,
              stashed.suggested_by_phone ?? effectiveSuggestedByPhone,
            ),
            origin: item.source === "shadchan" ? "shadchan" : "channel",
            initial_state: "new",
            visibility: "shared",
            kohen_status: "unknown",
            redt_date: item.created_at.split("T")[0],
          });
        }
        assertTargetMatchesSelection(shidduch);
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
    const resumeCreatedByAttempt = stashed.resume_created === true;
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
    options: {
      shidduchimId?: Identifier;
      singleId?: Identifier;
      suggestedByName?: string | null;
      suggestedByPhone?: string | null;
      shadchanId?: Identifier | null;
    },
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
    try {
      preparation = await prepareInboxResume(
        item,
        action,
        options.shidduchimId,
        options.singleId,
        options.shadchanId,
        options.suggestedByName,
        options.suggestedByPhone,
        attemptId,
      );
      let outcome: ResumeReadOutcome = "completed";
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

      // No client-side compensation is safe here: the suggestion may already
      // be referenced by this or another attempt after an ambiguous failure.
      // Leave it visible and retain the provenance stash for retry/Undo.
      const suggestionKept = true;
      await releaseInboxResolution(item, {
        attemptId,
        preserveInput: suggestionKept,
      });
      return { outcome, shidduch: null, suggestionKept };
    } catch (error) {
      await releaseInboxResolution(item, {
        preserveInput: true,
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
