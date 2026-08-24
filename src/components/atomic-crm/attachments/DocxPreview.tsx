import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { SignAttachmentUrl } from "./AttachmentPreview";
import { convertDocxToSafeHtml } from "./docxSanitizer";

type DocxState =
  | { status: "pending" }
  | { status: "ready"; html: string }
  | { status: "empty" }
  | { status: "error" };

/**
 * Renders a Word document in the page, without it ever leaving the browser.
 *
 * The obvious way to preview a `.docx` on the web is Google Docs Viewer or
 * Office Online — hand them a URL and they render it. That would mean sending
 * a signed link to a family's resume (names, ages, family details, a photo)
 * to a third party on every open, and this product's whole promise is that
 * records stay per-family. So the conversion happens here instead: the bytes
 * are fetched from our own storage, converted by `mammoth` in this tab, and
 * never sent anywhere.
 *
 * Both libraries are `import()`ed, not imported at module scope. `mammoth` is
 * a few hundred KB and only a minority of resumes are Word documents; loading
 * it eagerly would tax every page load in the app for a case most users never
 * hit.
 */

export interface DocxPreviewProps {
  fileName: string;
  signUrl: SignAttachmentUrl;
  active: boolean;
  onDownload: () => void;
}

export function DocxPreview({
  fileName,
  signUrl,
  active,
  onDownload,
}: DocxPreviewProps): ReactElement {
  const translate = useTranslate();
  const [state, setState] = useState<DocxState>({ status: "pending" });

  useEffect(() => {
    if (!active) {
      setState({ status: "pending" });
      return;
    }

    let cancelled = false;
    setState({ status: "pending" });

    (async () => {
      const url = await signUrl({ inline: true });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`storage responded ${response.status}`);
      }
      const html = await convertDocxToSafeHtml(await response.arrayBuffer());
      if (cancelled) return;
      setState(
        html.trim().length === 0
          ? { status: "empty" }
          : { status: "ready", html },
      );
    })().catch(() => {
      if (!cancelled) setState({ status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [active, signUrl]);

  if (state.status === "pending") {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-6" aria-busy="true">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (state.status === "error" || state.status === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p
          role={state.status === "error" ? "alert" : undefined}
          className="text-sm text-muted-foreground"
        >
          {state.status === "error"
            ? translate("crm.attachments.viewer.docxError", {
                _: "Could not read this Word document here.",
              })
            : translate("crm.attachments.viewer.docxEmpty", {
                _: "This Word document has no text to show.",
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

  return (
    <div className="h-full w-full overflow-auto bg-background">
      {/*
       * `prose` gives Word's semantic output (headings, lists, tables) a
       * readable rhythm without the document carrying any styling of its own —
       * every style attribute was stripped by the sanitiser above.
       */}
      <article
        className="prose prose-sm dark:prose-invert mx-auto max-w-3xl px-6 py-8 prose-table:text-sm"
        aria-label={fileName}
        // Sanitised immediately above by DOMPurify against a narrow
        // allow-list; see this file's header for why this path exists at all.
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    </div>
  );
}
