import { useState } from "react";
import type { ReactElement } from "react";
import { useCreate, useNotify, useRefresh, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useViewerRole } from "../entity360/useViewerRole";

/**
 * Story 6.4 (AC 1, AC 6): the single's own write surface on a suggestion —
 * "give my view... attributed to me... visible to my parent" (the epic AC).
 * A Tasks-tab-shaped mutation surface, mounted in `ShidduchOverviewTab.tsx`
 * above `ShidduchCatchSection` — never the right rail. Ruling 2 (contract
 * §11) makes the rail a read-only summary and `ShidduchRightRail.guard.
 * test.ts` enforces it mechanically (AC 6); this form is the ONLY place a
 * `single_input` row is created.
 *
 * `useViewerRole().role === "single"` is a UX gate, not the boundary
 * (AD-1) — the real boundary is the database's "Single adds input on a
 * visible suggestion" policy (05_policies.sql), which independently proves
 * this exact suggestion is in the single's own visible set. Any other
 * viewer never reaches this form; nothing here re-derives that visibility
 * join. Renders nothing at all while the role is still resolving
 * (`isPending`) — the same fail-closed idiom `ShidduchRightRail`/
 * `EntityShow` use elsewhere for a role that has not settled yet — and
 * nothing for any resolved role other than `single`.
 *
 * Writes through the standard `useCreate` hook (AD-10) — no bespoke RPC
 * (Dev Notes "Why no new RPC"): the policy's `WITH CHECK` performs every bit
 * of validation a function would. Never sends `actor_member_id` or
 * `account_id` — both are server-set (the `set_interaction_actor_member_id`
 * trigger unconditionally overwrites the former; `set_account_id_default`
 * sets the latter).
 *
 * After a successful create, `useRefresh()` invalidates every active query
 * (the same remedy `NotesTab.tsx`'s `AddNoteForm` uses) so the right rail's
 * `SingleInputPanel` — a sibling component elsewhere in the same 360 view,
 * reading the same `interactions` resource through the single's own new
 * read policy — shows the submission immediately.
 */
export function SingleInputForm({
  shidduchId,
}: {
  shidduchId: Identifier;
}): ReactElement | null {
  const { role, isPending: isRolePending } = useViewerRole();
  const [create, { isPending: isSaving }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [body, setBody] = useState("");

  if (isRolePending || role !== "single") return null;

  const handleSubmit = async () => {
    const text = body.trim();
    if (text === "") return;

    try {
      await create(
        "interactions",
        {
          data: {
            target_type: "shidduch",
            target_id: shidduchId,
            scope: "shidduch",
            kind: "single_input",
            body: text,
          },
        },
        { returnPromise: true },
      );
      setBody("");
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.overview.singleInput.error", {
              _: "Failed to send your input",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="single-input-body">
        {translate("crm.entity360.overview.singleInput.heading", {
          _: "Share your input",
        })}
      </Label>
      <Textarea
        id="single-input-body"
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder={translate(
          "crm.entity360.overview.singleInput.placeholder",
          {
            _: "What do you think of this suggestion?",
          },
        )}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={isSaving || body.trim() === ""}
          onClick={handleSubmit}
        >
          {translate("crm.entity360.overview.singleInput.submit", {
            _: "Send",
          })}
        </Button>
      </div>
    </div>
  );
}
