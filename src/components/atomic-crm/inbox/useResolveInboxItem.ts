import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import { insertNoteInteraction } from "../entity360/tabs/insertNoteInteraction";
import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  InboxAttachment,
  InboxItem,
  Resume,
  Shidduch,
} from "../types";

/**
 * Story 11.2: optional resume draft captured by the parse Worker. When
 * present, `resolveAsNewShidduch` also creates a `resumes` row attached to
 * the new shidduch so the original attachment and extracted draft are kept.
 */
export type ResumeDraft = {
  attachment: InboxAttachment;
  rawDraft: unknown;
  sections: unknown;
};

/**
 * Story 10.5: idempotency token + stashed inputs for the resolve window.
 * Stored on `inbox_items.resolution_input` as JSONB so a retry can complete
 * a partially-failed resolve without re-running domain mutations.
 */
type ResolutionInput =
  | {
      action: "new";
      input: CreateShidduchInput;
      resolved_shidduchim_id?: Identifier;
      resume_draft?: ResumeDraft;
    }
  | {
      action: "link";
      shidduchim_id: Identifier;
      note_inserted?: boolean;
    }
  | {
      action: "dismiss";
    };

const MAX_LOCK_RETRIES = 3;

function generateAttemptId(): string {
  return crypto.randomUUID();
}

function inputsAreCompatible(a: ResolutionInput, b: ResolutionInput): boolean {
  if (a.action !== b.action) return false;
  if (a.action === "dismiss" && b.action === "dismiss") return true;
  if (a.action === "new" && b.action === "new") {
    return (
      a.input.single_id === b.input.single_id &&
      a.input.shadchan_id === b.input.shadchan_id &&
      a.input.origin === b.input.origin &&
      a.resume_draft?.attachment.path === b.resume_draft?.attachment.path
    );
  }
  if (a.action === "link" && b.action === "link") {
    return a.shidduchim_id === b.shidduchim_id;
  }
  return false;
}

/**
 * Acquire the resolve lock for an inbox item. Returns the current row state.
 *
 * Protocol:
 *   1. Try to move `unresolved` -> `resolving` with our attempt id + input.
 *   2. If that fails (status changed concurrently), fetch the current row.
 *   3. If the item is already `resolved` or `dismissed`, return it as a
 *      no-op (idempotent).
 *   4. If the item is `resolving` with the SAME attempt id or a COMPATIBLE
 *      input, take over the lock and return the row.
 *   5. If the item is `resolving` with a different, incompatible attempt,
 *      throw — another resolution is in flight.
 *   6. If the item is somehow still `unresolved` (race), retry a bounded
 *      number of times.
 *
 * This is client-side compare-and-swap. It is not strictly serializable
 * against concurrent callers, but it closes the double-click / double-call
 * and partial-retry duplication vectors that matter in practice. A future
 * backend RPC can tighten the guarantee.
 */
async function acquireResolutionLock(
  dataProvider: CrmDataProvider,
  item: InboxItem,
  attemptId: string,
  input: ResolutionInput,
  retryCount = 0,
): Promise<InboxItem> {
  const { data: current } = await dataProvider.getOne<InboxItem>(
    "inbox_items",
    { id: item.id },
  );
  if (!current) {
    throw new Error(`Inbox item ${item.id} not found`);
  }

  if (current.status === "resolved" || current.status === "dismissed") {
    return current;
  }

  if (current.status === "resolving") {
    const currentInput = (current.resolution_input ?? {}) as ResolutionInput;
    const sameAttempt = current.resolution_attempt_id === attemptId;
    const compatible = inputsAreCompatible(input, currentInput);

    if (sameAttempt || compatible) {
      const { data } = await dataProvider.update<InboxItem>("inbox_items", {
        id: item.id,
        data: {
          resolution_attempt_id: attemptId,
          resolution_input: input as Record<string, unknown>,
        },
        previousData: current,
      });
      return data ?? current;
    }

    throw new Error(
      `Another resolution is already in progress for inbox item ${item.id}.`,
    );
  }

  // current.status === "unresolved": try to acquire the lock.
  try {
    const { data } = await dataProvider.update<InboxItem>("inbox_items", {
      id: item.id,
      data: {
        status: "resolving",
        resolution_attempt_id: attemptId,
        resolution_input: input as Record<string, unknown>,
      },
      previousData: current,
    });
    return data ?? current;
  } catch {
    if (retryCount >= MAX_LOCK_RETRIES) {
      throw new Error(
        `Could not acquire resolution lock for inbox item ${item.id}`,
      );
    }
    return acquireResolutionLock(
      dataProvider,
      item,
      attemptId,
      input,
      retryCount + 1,
    );
  }
}

function finalizePayload(
  status: "resolved" | "dismissed",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status,
    resolution_attempt_id: null,
    resolution_input: null,
    ...extra,
  };
}

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
    const savedDraft = (
      stashed as ResolutionInput & { resume_draft?: ResumeDraft }
    ).resume_draft;
    if (savedDraft) {
      await dataProvider.create<Resume>("resumes", {
        data: {
          shidduchim_id: created.id,
          files: [
            {
              path: savedDraft.attachment.path,
              filename: savedDraft.attachment.title,
              mime_type: savedDraft.attachment.type,
              uploaded_at: new Date().toISOString(),
              uploaded_by: null,
              size: 0,
            },
          ],
          extracted: savedDraft.rawDraft,
          sections: savedDraft.sections,
        },
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
