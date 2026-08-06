import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import { insertNoteInteraction } from "../entity360/tabs/insertNoteInteraction";
import type { CrmDataProvider } from "../providers/types";
import {
  copyInboxAttachmentToResumeFile,
  removeResumeFileObjects,
  type CopiedResumeFile,
} from "../providers/supabase/resumes";
import type {
  CreateShidduchInput,
  InboxAttachment,
  InboxItem,
  Resume,
  Shidduch,
} from "../types";
import {
  acquireResolutionLock,
  finalizePayload,
  generateAttemptId,
  type ResolutionInput,
  type ResumeDraft,
} from "./resolveInboxItemLock";

// Re-exported for backward compatibility: this hook's public surface used
// to define `ResumeDraft` itself before it moved into
// `resolveInboxItemLock.ts` alongside the rest of the lock protocol
// (coding-style.md's ~400-line typical ceiling).
export type { ResumeDraft };

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
    );

    // Already resolved — return the linked shidduch (idempotent no-op).
    if (lockedItem.status === "resolved" && lockedItem.resolved_shidduchim_id) {
      const { data } = await dataProvider.getOne<Shidduch>("shidduchim", {
        id: lockedItem.resolved_shidduchim_id,
      });
      return data;
    }

    const stashed = (lockedItem.resolution_input ?? {}) as ResolutionInput & {
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
      // finalize step fails.
      await dataProvider.update<InboxItem>("inbox_items", {
        id: item.id,
        data: {
          resolution_input: {
            ...resolutionInput,
            resolved_shidduchim_id: created.id,
          } as Record<string, unknown>,
        },
        previousData: lockedItem,
      });
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
    const draftProgress = stashed as ResolutionInput & {
      resume_draft?: ResumeDraft;
      resume_created?: boolean;
    };
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
          pagination: { page: 1, perPage: 1 },
          sort: { field: "id", order: "ASC" },
        },
      );

      if (existingResumes.length === 0) {
        let copiedFile: CopiedResumeFile | undefined;
        try {
          copiedFile = await copyInboxAttachmentToResumeFile({
            shidduchimId: created.id,
            attachmentPath: savedDraft.attachment.path,
            fileName: savedDraft.attachment.title,
          });
          await dataProvider.create<Resume>("resumes", {
            data: {
              shidduchim_id: created.id,
              files: [
                {
                  path: copiedFile.storagePath,
                  filename: savedDraft.attachment.title,
                  mime_type: savedDraft.attachment.type,
                  uploaded_at: new Date().toISOString(),
                  uploaded_by: null,
                  size: copiedFile.size,
                },
              ],
              extracted: savedDraft.rawDraft,
              sections: savedDraft.sections,
            },
          });
        } catch (creationError) {
          // Mirrors `uploadResumeFile`'s "no object without a row" ordering:
          // the copy already landed in `documents` when the row write failed,
          // so remove it rather than leaving an orphaned, never-referenced
          // object behind.
          if (copiedFile) {
            await removeResumeFileObjects([copiedFile.storagePath]);
          }
          throw creationError;
        }
      }

      await dataProvider.update<InboxItem>("inbox_items", {
        id: item.id,
        data: {
          resolution_input: {
            ...draftProgress,
            resolved_shidduchim_id: created.id,
            resume_created: true,
          } as Record<string, unknown>,
        },
        previousData: lockedItem,
      });
    }

    await dataProvider.update<InboxItem>("inbox_items", {
      id: item.id,
      data: finalizePayload("resolved", {
        resolved_shidduchim_id: created.id,
        single_id: input.single_id,
        shadchan_id: input.shadchan_id ?? null,
      }),
      previousData: lockedItem,
    });
    return created;
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
    );

    if (lockedItem.status === "resolved") {
      return;
    }

    const stashed = (lockedItem.resolution_input ?? {}) as ResolutionInput & {
      note_inserted?: boolean;
    };

    if (!stashed.note_inserted) {
      await insertNoteInteraction(
        dataProvider,
        "shidduch",
        shidduchimId,
        item.raw_text ?? "",
        { source: "inbox_item", inbox_item_id: item.id },
      );
      await dataProvider.update<InboxItem>("inbox_items", {
        id: item.id,
        data: {
          resolution_input: {
            ...resolutionInput,
            note_inserted: true,
          } as Record<string, unknown>,
        },
        previousData: lockedItem,
      });
    }

    // Story 10.4: carry any capture attachments into the linked shidduch's
    // Files tab so they remain reachable after the inbox item is resolved.
    const attachments = (item.attachments ?? []) as InboxAttachment[];
    if (attachments.length > 0) {
      await dataProvider.copyInboxAttachmentsToEntityFiles({
        baseDataProvider: dataProvider,
        attachments,
        targetType: "shidduch",
        targetId: shidduchimId,
        visibility: "shared",
      });
    }

    await dataProvider.update<InboxItem>("inbox_items", {
      id: item.id,
      data: finalizePayload("resolved", {
        resolved_shidduchim_id: shidduchimId,
      }),
      previousData: lockedItem,
    });
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
    );

    if (lockedItem.status === "dismissed") {
      return;
    }

    await dataProvider.update<InboxItem>("inbox_items", {
      id: item.id,
      data: finalizePayload("dismissed"),
      previousData: lockedItem,
    });
  };

  return { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem };
}
