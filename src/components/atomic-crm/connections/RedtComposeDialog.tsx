import { useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { CancelButton } from "@/components/admin/cancel-button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import { INBOX_PRIMARY_CTA_CLASS } from "../inbox/inboxMeta";

/**
 * Story 8.3 (AC-1, AC-2, AC-3, Task 6): the shadchan-side compose surface for
 * sending a redt into a connected family's pipeline from inside the
 * platform. Same shape as `inbox/AddToInboxDialog.tsx`'s manual capture
 * form — subject + free text — calling `dataProvider.redtViaConnection()`
 * instead of a raw `dataProvider.create("inbox_items", …)`, since a shadchan
 * holds no table-level write path into the household's `inbox_items` at all
 * ("Inbox items scoped to account", 05_policies.sql, keys strictly on
 * `account_id = current_context_id()`).
 *
 * This story owns only the dialog itself — Story 8.5 owns WHERE it is
 * launched from (a button on the Connection 360, per the story's own Dev
 * Notes).
 *
 * No attachment upload yet: the `attachments` storage bucket's RLS
 * (`07_storage.sql`, "Attachments … within account") scopes strictly to the
 * uploader's OWN `current_context_id()`, with no connection-axis carve-out —
 * a shadchan-uploaded object would be permanently unreadable by the
 * household side reading it under their own context. `redt_via_connection()`'s
 * `p_attachments` parameter exists for the day that policy gap is closed (a
 * separate, deliberate change to `07_storage.sql`, out of this story's
 * declared file set); until then this dialog always sends
 * `attachments: null` rather than shipping a control that silently produces
 * links the recipient can never open.
 */
export const RedtComposeDialog = ({
  connectionId,
  open,
  onClose,
}: {
  connectionId: Identifier;
  open: boolean;
  onClose: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [subject, setSubject] = useState("");
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setSubject("");
    setRawText("");
    onClose();
  };

  const onSave = async () => {
    if (!rawText.trim()) return;
    setSaving(true);
    try {
      await dataProvider.redtViaConnection({
        connection_id: connectionId,
        subject: subject.trim() || null,
        raw_text: rawText.trim(),
        attachments: null,
      });
      notify(translate("crm.redt_compose.success", { _: "Redt sent" }), {
        type: "info",
      });
      handleClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.redt_compose.error", {
              _: "Couldn't send that redt. Try again.",
            }),
        { type: "error" },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="bg-popover border-border shadow-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            {translate("crm.redt_compose.title", { _: "Send a redt" })}
          </DialogTitle>
          <DialogDescription>
            {translate("crm.redt_compose.description", {
              _: "Describe the suggestion — the family confirms it on their side before it enters their pipeline.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="redt-subject">
              {translate("crm.redt_compose.subject_label", {
                _: "Subject (optional)",
              })}
            </Label>
            <Input
              id="redt-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={translate("crm.redt_compose.subject_placeholder", {
                _: "e.g. A suggestion for Rivky",
              })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="redt-text">
              {translate("crm.redt_compose.text_label", {
                _: "The suggestion",
              })}
            </Label>
            <Textarea
              id="redt-text"
              rows={5}
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder={translate("crm.redt_compose.text_placeholder", {
                _: "Who you have in mind, and why it's a fit…",
              })}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-row justify-end gap-2">
          <CancelButton className="h-11" onClick={handleClose} />
          <button
            type="button"
            disabled={!rawText.trim() || saving}
            onClick={onSave}
            className={INBOX_PRIMARY_CTA_CLASS + " disabled:opacity-60"}
          >
            {translate("crm.redt_compose.submit", { _: "Send redt" })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
