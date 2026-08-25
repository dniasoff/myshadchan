import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { resolveAttachmentPreviewMode } from "./attachmentPreview";
import { DocxPreview } from "./DocxPreview";
import { PdfPreview } from "./PdfPreview";

/** Mints the URL. `inline: true` asks for a URL served for viewing rather
 * than saving; the caller supplies it because a resume and an entity file
 * live in different buckets behind different data-provider methods. */
export type SignAttachmentUrl = (options: {
  inline: boolean;
}) => Promise<string>;

export interface AttachmentPreviewProps {
  fileName: string;
  mimeType: string | null | undefined;
  signUrl: SignAttachmentUrl;
  /**
   * `false` suspends everything: no URL is minted and nothing is rendered but
   * the resting state. The dialog passes its own `open` here, so a viewer
   * mounted once per row costs nothing until someone opens it.
   */
  active?: boolean;
  /** Shown by the error and no-preview panels, which are the two states
   * where saving the file is the only way to read it. */
  onDownload: () => void;
}

/**
 * The bytes are never fetched until the preview is actually active, the URL
 * is dropped again when it stops being active, and nothing is signed at all
 * for a file that has no preview to render — the same "minted per use, never
 * persisted" rule the download path has always followed. `enabled` is what
 * keeps a signed link from being minted for a Word document that is only ever
 * going to show a download button.
 */
function useSignedPreviewUrl(
  active: boolean,
  enabled: boolean,
  signUrl: SignAttachmentUrl,
): { url: string | null; error: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active || !enabled) {
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
  }, [active, enabled, signUrl]);

  return { url, error };
}

/**
 * The rendering surface for a stored file, shared by the modal viewer
 * (`AttachmentViewerDialog`, used by the Files tab) and the embedded one
 * (`resumes/ResumeDocument`, where the resume is the point of the page).
 * Both must show a PDF the same way, refuse the same types and fail the same
 * way, which is why this is one component and not two.
 *
 * It fills its parent — every state, including the skeleton — so the caller
 * owns the height. That is deliberate: a skeleton whose height does not match
 * its content IS a layout shift, and this repo has already paid for that once
 * (see `dashboard/ParentFocusCards.tsx`, and the e2e CLS spec that caught it).
 *
 * Word documents take a third path (`DocxPreview`): converted to sanitised
 * HTML inside this tab, never handed to Google Docs Viewer or Office Online.
 * Those are the usual answer and would send a signed link to a family's
 * resume — names, ages, family details, a photo — to a third party on every
 * open, which is exactly what this product promises not to do.
 *
 * A PDF is not handed to the browser either (`PdfPreview`): `<iframe
 * src="….pdf">` depends on a PDF viewer plugin, and Chrome for Android has
 * none — reproduced, it swaps in a placeholder page with an "Open" button
 * instead of the document, which is the grey box a reader on a phone was
 * seeing. pdf.js parses the file and paints it to a canvas, which every
 * browser can do. See `PdfPreview.tsx` for the full evidence, including why
 * mobile emulation cannot reproduce the failure OR confirm the fix.
 *
 * So only images now take the signed-URL path, and `<img>` is the one element
 * here that renders a remote file directly. That is safe for the reason the
 * allow-list exists: every admitted image type is decoded by the image
 * pipeline and cannot express script, and `image/svg+xml` — a document format
 * that can carry `<script>` — is refused explicitly.
 */
export function AttachmentPreview({
  fileName,
  mimeType,
  signUrl,
  active = true,
  onDownload,
}: AttachmentPreviewProps): ReactElement {
  const mode = resolveAttachmentPreviewMode(mimeType, fileName);
  // Only an image is displayed straight from a signed URL. A Word document
  // and a PDF each fetch their own bytes (to convert, or to parse), so
  // minting a display URL for them here would sign the same file twice.
  const { url, error } = useSignedPreviewUrl(active, mode === "image", signUrl);

  if (mode === "none") {
    return <NoPreview fileName={fileName} onDownload={onDownload} />;
  }
  if (mode === "pdf") {
    return (
      <PdfPreview
        fileName={fileName}
        signUrl={signUrl}
        active={active}
        onDownload={onDownload}
      />
    );
  }
  if (mode === "docx") {
    return (
      <DocxPreview
        fileName={fileName}
        signUrl={signUrl}
        active={active}
        onDownload={onDownload}
      />
    );
  }
  if (error) {
    return <PreviewError onDownload={onDownload} />;
  }
  if (url === null) {
    return <PreviewPending />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-2">
      <img
        src={url}
        alt={fileName}
        referrerPolicy="no-referrer"
        className="max-h-full max-w-full object-contain"
      />
    </div>
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
          _: "This file type cannot be shown here — PDFs, images and Word documents can.",
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
