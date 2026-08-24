import { useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";

import { resolveAttachmentPreviewMode } from "./attachmentPreview";

export interface AttachmentViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  mimeType: string | null | undefined;
  /**
   * Mints the URL. `inline: true` asks for a URL served for viewing rather
   * than saving; the caller supplies it because a resume and an entity file
   * live in different buckets behind different data-provider methods.
   */
  signUrl: (options: { inline: boolean }) => Promise<string>;
}

/**
 * The bytes are never fetched until the dialog is actually opened, the URL is
 * dropped again on close, and nothing is signed at all for a file that has no
 * preview to render — same "minted per use, never persisted" rule the
 * download path has always followed, and `enabled` keeps a signed link from
 * being minted for a Word document that is only ever going to show a
 * download button.
 */
function useSignedPreviewUrl(
  open: boolean,
  enabled: boolean,
  signUrl: AttachmentViewerDialogProps["signUrl"],
): { url: string | null; error: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !enabled) {
      setUrl(null);
      setError(false);
      return;
    }

    let cancelled = false;
    setError(false);
    signUrl({ inline: true })
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, enabled, signUrl]);

  return { url, error };
}

/**
 * Reading a resume should not require saving it first. This renders the file
 * in the page for the types a browser can show natively, and says so plainly
 * for the types it cannot.
 *
 * Word documents fall in the second group deliberately. The usual way to
 * preview a `.docx` in a web app is to hand its URL to Google Docs Viewer or
 * Office Online, and that would mean sending a signed link to a family's
 * resume — names, ages, family details, a photo — to a third party on every
 * open. An honest "download to open this one" is the better trade here. A
 * client-side renderer that never leaves the browser would be the way to
 * close the gap properly, and is a deliberate non-goal for now.
 *
 * The PDF frame carries no `sandbox`, and that is measured rather than
 * conceded. Chromium implements its PDF viewer as an extension frame, and
 * ANY `sandbox` attribute stops it loading: probed headed under Xvfb against
 * a real cross-origin PDF, `sandbox=""`, `allow-scripts`, `allow-same-origin`
 * and `allow-scripts allow-same-origin` all landed on
 * `chrome-error://chromewebdata/` with a blank frame, while the unsandboxed
 * one loaded `chrome-extension://…/index.html` and rendered. Shipping the
 * attribute would have shipped an empty viewer.
 *
 * What actually contains this is not the attribute:
 *
 * - The allow-list in `attachmentPreview.ts` decides what reaches the frame,
 *   and only `application/pdf` ever does.
 * - Supabase serves these bytes from its own storage origin, so the frame is
 *   cross-origin and cannot read the app's DOM, cookies or storage.
 * - The `mime_type` this checks and the `Content-Type` storage returns both
 *   derive from the same value recorded at upload, so they cannot disagree:
 *   an HTML file uploaded as `application/pdf` is also SERVED as
 *   `application/pdf` and is handed to the PDF renderer, not the HTML parser.
 *
 * `allow=""` and `referrerPolicy="no-referrer"` are kept — the same probe
 * confirmed both render fine — so the frame is granted no permission-policy
 * features and leaks no referrer.
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
  const mode = resolveAttachmentPreviewMode(mimeType, fileName);
  const { url, error } = useSignedPreviewUrl(open, mode !== "none", signUrl);

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
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[min(92vw,64rem)] max-w-[min(92vw,64rem)] flex-col gap-3 sm:max-w-[min(92vw,64rem)]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate text-left">{fileName}</DialogTitle>
          <DialogDescription className="text-left">
            {translate("crm.attachments.viewer.description", {
              _: "Opened for reading. Nothing has been saved to your computer.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/40">
          {mode === "none" ? (
            <NoPreview fileName={fileName} onDownload={handleDownload} />
          ) : error ? (
            <PreviewError onDownload={handleDownload} />
          ) : url === null ? (
            <PreviewPending />
          ) : mode === "pdf" ? (
            <iframe
              allow=""
              referrerPolicy="no-referrer"
              src={url}
              title={fileName}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-2">
              <img
                src={url}
                alt={fileName}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
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

function PreviewPending(): ReactElement {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4" aria-busy="true">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function PreviewError({
  onDownload,
}: {
  onDownload: () => void;
}): ReactElement {
  const translate = useTranslate();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p role="alert" className="text-sm text-destructive">
        {translate("crm.attachments.viewer.error", {
          _: "Could not open this file for reading.",
        })}
      </p>
      <Button type="button" variant="outline" onClick={onDownload}>
        {translate("crm.attachments.viewer.download", {
          _: "Download a copy",
        })}
      </Button>
    </div>
  );
}

/**
 * Names the file type rather than saying "unsupported", so the reader knows
 * why this one behaves differently from the resume PDF next to it.
 */
function NoPreview({
  fileName,
  onDownload,
}: {
  fileName: string;
  onDownload: () => void;
}): ReactElement {
  const translate = useTranslate();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {translate("crm.attachments.viewer.noPreview", {
          _: "This file type cannot be shown here — PDFs and images can.",
        })}
      </p>
      <p className="max-w-full truncate text-xs text-muted-foreground">
        {fileName}
      </p>
      <Button type="button" onClick={onDownload}>
        {translate("crm.attachments.viewer.download", {
          _: "Download a copy",
        })}
      </Button>
    </div>
  );
}
