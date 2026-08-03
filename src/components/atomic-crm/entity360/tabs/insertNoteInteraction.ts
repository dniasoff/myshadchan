import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../../providers/types";
import type { EntityTargetType, Interaction } from "../../types";

/**
 * AC 6's AD-3 scope discriminator, per target type. `shidduch` notes derive
 * visibility from the shidduch itself; every other universal target has no
 * single shidduch parent to derive from, so AC 1 forces it into the
 * account-scoped bucket — legal for `single` / `shadchan` only because of
 * 3.5's fourth `interactions_scope_link_check` branch
 * (01_tables.sql:473-477).
 */
function noteScopeFor(targetType: EntityTargetType): {
  scope: "shidduch" | "account";
  reference_link_id: null;
} {
  return targetType === "shidduch"
    ? { scope: "shidduch", reference_link_id: null }
    : { scope: "account", reference_link_id: null };
}

/**
 * The sole INSERT path for a `kind: "note"` interaction (contract §8,
 * Story 10.1 Task 2). `entity360/tabs/NotesTab.tsx`'s `AddNoteForm` and
 * `inbox/useResolveInboxItem.ts`'s `resolveAsLinkToExisting` both call this
 * — neither calls `dataProvider.create("interactions", …)` directly — so
 * there is exactly one place deciding a note's scope / `reference_link_id`
 * shape (AD-4's single-creation-path rule, extended here to notes: "one
 * place decides new-vs-existing" applies just as much to "one place decides
 * how a note is shaped").
 *
 * `actor_member_id` is never sent: `set_interaction_actor_member_id`
 * (Story 3.5) stamps it server-side and overwrites any client-supplied
 * value regardless.
 */
export async function insertNoteInteraction(
  dataProvider: CrmDataProvider,
  targetType: EntityTargetType,
  targetId: Identifier,
  body: string,
  metadata?: Record<string, unknown>,
): Promise<Interaction> {
  const { data } = await dataProvider.create<Interaction>("interactions", {
    data: {
      target_type: targetType,
      target_id: targetId,
      kind: "note",
      body,
      ...noteScopeFor(targetType),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  });
  return data;
}
