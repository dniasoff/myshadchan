import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";

import { insertNoteInteraction } from "../entity360/tabs/insertNoteInteraction";
import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, InboxItem, Shidduch } from "../types";

/**
 * The three ways a captured `inbox_items` row stops being unresolved (Story
 * 10.1 Task 2). Extracted out of `InboxResolveDialog.tsx` — the only place
 * that used to inline this — so `ShareTarget.tsx`'s new resolve screen (Task
 * 4) can reuse the exact same logic rather than forking a second copy (AD-4's
 * single-creation-path rule: one place decides new-vs-existing, reused by
 * every entry point).
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
  ): Promise<Shidduch> => {
    const created = await dataProvider.createShidduch(input);
    await dataProvider.update("inbox_items", {
      id: item.id,
      data: {
        status: "resolved",
        resolved_shidduchim_id: created.id,
        single_id: input.single_id,
        shadchan_id: input.shadchan_id ?? null,
      },
      previousData: item,
    });
    return created;
  };

  /**
   * AC 5 / AC 7: "link to an existing suggestion" never creates a second,
   * duplicate suggestion — it writes an `interactions` note against the
   * chosen `shidduchim` row instead, through `insertNoteInteraction.ts` (the
   * sole writer for a `kind: "note"` row), then marks the source item
   * resolved and linked to that same suggestion. The linked capture then
   * shows up in that suggestion's Notes/Activity tab automatically — no new
   * rendering path needed on the receiving end.
   */
  const resolveAsLinkToExisting = async (
    item: InboxItem,
    shidduchimId: Identifier,
  ): Promise<void> => {
    await insertNoteInteraction(
      dataProvider,
      "shidduch",
      shidduchimId,
      item.raw_text ?? "",
      { source: "inbox_item", inbox_item_id: item.id },
    );
    await dataProvider.update("inbox_items", {
      id: item.id,
      data: { status: "resolved", resolved_shidduchim_id: shidduchimId },
      previousData: item,
    });
  };

  /** AC 6: skipping never loses the capture — it stays an `unresolved` (now
   * `dismissed`) row, visible in the Inbox for later triage. The existing
   * dismiss update, unchanged. */
  const dismissInboxItem = async (item: InboxItem): Promise<void> => {
    await dataProvider.update("inbox_items", {
      id: item.id,
      data: { status: "dismissed" },
      previousData: item,
    });
  };

  return { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem };
}
