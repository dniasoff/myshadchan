import type { ReactElement } from "react";
import { useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AttachmentPreview, type SignAttachmentUrl } from "./AttachmentPreview";

export interface AttachmentViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  mimeType: string | null | undefined;
  signUrl: SignAttachmentUrl;
}

/**
 * The modal form of the viewer, used by the universal Files tab — where a
 * target has an arbitrary list of files and no one of them is "the" document,
 * so opening one over the page is the right affordance.
 *
 * The resume does NOT use this. A resume tab has exactly one document and
 * showing it is the entire point of the page, so it embeds
 * `AttachmentPreview` directly (`resumes/ResumeDocument.tsx`) rather than
 * hiding it behind a click. Both go through the same `AttachmentPreview`, so
 * the two surfaces cannot drift on what they will render or refuse.
 *
 * `active={open}` is what keeps this cheap: one dialog is mounted per file
 * row, and a closed one mints nothing.
 */
export function AttachmentViewerDialog({
  open,
  onOpenChange,
  fileName,
  mimeType,
  signUrl,
}: AttachmentViewerDialogProps): ReactElement {
  const translate = useTranslate();
  const notify = useNotify();

  // Wrapped, exactly like `ResumeVersionRow` and `FileRowView`'s own
  // download handlers: a rejected `signUrl` here (expired session, network)
  // would otherwise make the button silently do nothing and leave an
  // unhandled rejection behind.
  const handleDownload = async () => {
    try {
      const downloadUrl = await signUrl({ inline: false });
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (downloadError) {
      notify(
        downloadError instanceof Error
          ? downloadError.message
          : translate("crm.attachments.viewer.downloadError", {
              _: "Failed to get a download link",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
       * `dvh`, never `vh`. A mobile browser resolves `vh` against the
       * viewport with its chrome RETRACTED, so an `85vh` dialog is taller
       * than the visible area and the "Download a copy" button at its foot
       * sits behind the toolbar. `dvh` tracks the chrome as it shows and
       * hides, which is what "85% of what the reader can see" actually
       * means. The padding steps down too: `p-6` (the DialogContent
       * default) spends 48px of a 360px screen on margin, leaving the
       * preview a thin band once the header and footer have taken theirs.
       */}
      <DialogContent className="flex h-[85dvh] max-h-[85dvh] w-[min(96vw,64rem)] max-w-[min(96vw,64rem)] flex-col gap-3 p-4 sm:w-[min(92vw,64rem)] sm:max-w-[min(92vw,64rem)] sm:p-6">
        {/* `pr-6` keeps the file name clear of the dialog's own close "X",
         * which `DialogContent` pins at `right-4` — inside the content box
         * once the padding drops to `p-4` on a phone. */}
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="truncate text-left">{fileName}</DialogTitle>
          <DialogDescription className="text-left">
            {translate("crm.attachments.viewer.description", {
              _: "Opened for reading. Nothing has been saved to your computer.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/40">
          <AttachmentPreview
            fileName={fileName}
            mimeType={mimeType}
            signUrl={signUrl}
            active={open}
            onDownload={handleDownload}
          />
        </div>

        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="outline" onClick={handleDownload}>
            {translate("crm.attachments.viewer.download", {
              _: "Download a copy",
            })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
