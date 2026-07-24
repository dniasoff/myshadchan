import { useState } from "react";
import { useDataProvider, useNotify, useRefresh } from "ra-core";
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
import { INBOX_PRIMARY_CTA_CLASS } from "./inboxMeta";

/**
 * Manual capture (Epic 2 desktop path): paste a redt you received anywhere into
 * the inbox so it's filed while you remember, then resolve it later. account_id
 * is set server-side by the set_account_id_default trigger.
 */
export const AddToInboxDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setText("");
    setSender("");
    onClose();
  };

  const onSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await dataProvider.create("inbox_items", {
        data: {
          source: "upload",
          raw_text: text.trim(),
          sender: sender.trim() || null,
          status: "unresolved",
        },
      });
      notify("Added to your inbox", { type: "info" });
      refresh();
      handleClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't add that", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="bg-popover border-border shadow-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            Drop it in your inbox
          </DialogTitle>
          <DialogDescription>
            Paste a message or note now — decide who it's for later. Nothing is
            lost.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inbox-text">What arrived</Label>
            <Textarea
              id="inbox-text"
              rows={5}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the WhatsApp/text/email you received…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inbox-sender">From (optional)</Label>
            <Input
              id="inbox-sender"
              value={sender}
              onChange={(event) => setSender(event.target.value)}
              placeholder="e.g. Mrs. Feldman"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-row justify-end gap-2">
          <CancelButton className="h-11" onClick={handleClose} />
          <button
            type="button"
            disabled={!text.trim() || saving}
            onClick={onSave}
            className={INBOX_PRIMARY_CTA_CLASS + " disabled:opacity-60"}
          >
            Add to inbox
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
