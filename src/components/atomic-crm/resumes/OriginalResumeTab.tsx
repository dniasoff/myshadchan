import type { ReactNode } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { buildTabPath } from "../entity360/entityPaths";
import type { InboxAttachment, InboxItem, ShidduchSummary } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { signInboxAttachmentUrl } from "../providers/supabase/inboxAttachments";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeDocument } from "./ResumeDocument";
import { canRereadResume } from "./resumeReferenceVisibility";
import { canDeleteResumeFile as canDeleteResumeFileForRole } from "./resumeFileDelete";
import { parseWhatsAppText } from "../inbox/whatsappText";

function isPictureAttachment(attachment: InboxAttachment): boolean {
  return (
    (attachment.type ?? "").toLowerCase().startsWith("image/") ||
    /\.(gif|heic|heif|jpeg|jpg|png|webp)$/iu.test(attachment.title ?? "")
  );
}

function WhatsAppTextSource({
  record,
  capture,
}: {
  record: ShidduchSummary;
  capture: InboxItem;
}): ReactNode {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [suggestedName, setSuggestedName] = useState(
    parseWhatsAppText(capture.raw_text ?? "").firstBoldText ?? "",
  );
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(capture.raw_text ?? "");
      notify("Copied the original text", { type: "info" });
    } catch {
      notify("Couldn’t copy the original text", { type: "error" });
    }
  };

  const handleUseAsPhoto = async (attachment: InboxAttachment) => {
    setPhotoBusy(attachment.path);
    try {
      const url = attachment.src.startsWith("data:")
        ? attachment.src
        : await signInboxAttachmentUrl(attachment.path);
      const response = await fetch(url);
      if (!response.ok) throw new Error("photo download failed");
      const blob = await response.blob();
      const file = new File([blob], attachment.title, {
        type: attachment.type || blob.type,
      });
      await dataProvider.uploadResumePhoto({
        shidduchimId: record.id,
        file,
        visibility: "shared",
      });
      notify("This picture is now the Photo", { type: "info" });
    } catch {
      notify(
        "We couldn’t use this picture as Photo yet. It is still safe in Files.",
        {
          type: "error",
        },
      );
    } finally {
      setPhotoBusy(null);
    }
  };

  const parsed = parseWhatsAppText(capture.raw_text ?? "");
  const pictures = (capture.attachments ?? []).filter(isPictureAttachment);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-secondary/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">This resume arrived as text. Here it is.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void copySource()}
        >
          Copy
        </Button>
      </div>
      <p
        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
        dir="auto"
      >
        {parsed.parts.map((part, index) =>
          part.bold ? (
            <strong key={index}>{part.text}</strong>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      {parsed.firstBoldText ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="suggested-name" className="text-sm font-medium">
            Suggested name
          </label>
          <Input
            id="suggested-name"
            value={suggestedName}
            onChange={(event) => setSuggestedName(event.target.value)}
            className="min-h-11"
          />
          <p className="text-xs text-muted-foreground">
            Taken from the first bold words. You can change it.
          </p>
        </div>
      ) : null}
      {pictures.map((attachment) => (
        <div
          key={attachment.path}
          className="rounded-xl border border-border p-3"
        >
          <p className="text-sm font-semibold">Picture from WhatsApp</p>
          <p className="text-sm text-muted-foreground">
            Shared picture — not a file
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing was turned into a file.
          </p>
          <Button
            type="button"
            className="mt-3 min-h-11"
            disabled={photoBusy === attachment.path}
            onClick={() => void handleUseAsPhoto(attachment)}
          >
            {photoBusy === attachment.path
              ? "Using this picture…"
              : "Use this picture as Photo"}
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * The original-file surface is deliberately separate from `ResumeTab`: the
 * Resume tab owns upload/inbox and parsed facts, while this tab owns the one
 * full-width original viewer. `ResumeDocument` remains the single preview
 * host, so switching tabs cannot mount a second PDF preview or signed fetch.
 */
export function OriginalResumeTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  const { role, isPending: isRolePending } = useViewerRole();
  const recordId = record?.id;
  const { data: captures = [] } = useGetList<InboxItem>(
    "inbox_items",
    {
      filter: { resolved_shidduchim_id: recordId },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: recordId != null },
  );
  if (!record) return null;

  const canReread = canRereadResume(role, isRolePending);
  const canDelete = canDeleteResumeFileForRole(role, isRolePending);
  const textCapture = captures.find(
    (capture) =>
      typeof capture.raw_text === "string" &&
      capture.raw_text.trim().length > 0,
  );

  return (
    <section
      aria-labelledby="original-resume-heading"
      className="flex min-w-0 max-w-full flex-col gap-4"
    >
      <h2 id="original-resume-heading" className="text-xl font-semibold">
        Original resume
      </h2>
      {textCapture ? (
        <WhatsAppTextSource record={record} capture={textCapture} />
      ) : null}
      <ResumeDocument
        shidduchimId={record.id}
        canReread={canReread}
        canDelete={canDelete}
        presentation="picker"
        emptyActionHref={buildTabPath("shidduchim", record.id, "resume")}
      />
    </section>
  );
}
