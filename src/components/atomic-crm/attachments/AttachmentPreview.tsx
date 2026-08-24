import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { resolveAttachmentPreviewMode } from "./attachmentPreview";
import { DocxPreview } from "./DocxPreview";

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
 * The PDF frame carries no `sandbox`, and that is measured rather than
 * conceded. Chromium implements its PDF viewer as an extension frame, and ANY
 * `sandbox` attribute stops it loading: probed headed under Xvfb against a
 * real cross-origin PDF, `sandbox=""`, `allow-scripts`, `allow-same-origin`
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
export function AttachmentPreview({
  fileName,
  mimeType,
  signUrl,
  active = true,
  onDownload,
}: AttachmentPreviewProps): ReactElement {
  const mode = resolveAttachmentPreviewMode(mimeType, fileName);
  // A Word document is not fetched as a URL for the browser to display — it
  // is downloaded, converted and sanitised inside `DocxPreview`, which owns
  // its own fetch. Minting a display URL here as well would sign twice.
  const { url, error } = useSignedPreviewUrl(
    active,
    mode !== "none" && mode !== "docx",
    signUrl,
  );

  if (mode === "none") {
    return <NoPreview fileName={fileName} onDownload={onDownload} />;
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
  if (mode === "pdf") {
    return (
      <iframe
        allow=""
        referrerPolicy="no-referrer"
        src={url}
        title={fileName}
        className="h-full w-full border-0"
      />
    );
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
