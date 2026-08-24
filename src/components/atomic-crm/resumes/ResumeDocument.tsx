import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";

import { AttachmentPreview } from "../attachments/AttachmentPreview";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import { resumeSubjectFilter, type ResumeSubject } from "./resumeSubject";
import { ResumeVersionList } from "./ResumeVersionList";
import { sortResumeFilesNewestFirst } from "./useLatestResumeFile";

/**
 * Tall enough to read a page of a resume without scrolling the frame itself,
 * and expressed in viewport height so a laptop gets a usable document and a
 * phone does not get a letterbox. The floor matters more than the ratio: at
 * `70vh` alone, a short landscape window would render a two-inch strip.
 */
const EMBED_HEIGHT = "h-[70vh] min-h-[24rem]";

/**
 * The Resume tab, whole: the document itself, then the versions beneath it.
 *
 * It used to be an upload button and a one-line file row, with the resume
 * hidden behind a "View" that opened a dialog — a page whose entire subject
 * is one document, showing everything except that document. The resume is
 * embedded now and the dialog is gone from this surface. `FilesTab` keeps
 * the dialog, and correctly: a target there has an arbitrary list of files
 * and no one of them is "the" document, so opening one over the page is the
 * right affordance. Both go through the same `AttachmentPreview`, so the two
 * cannot drift on what they render or refuse.
 *
 * The `resumes` read here is the same filter/pagination/sort
 * `ResumeVersionList` performs, so React Query serves both from one request
 * — the dedupe this folder already relies on (`useLatestResumeFile`'s own
 * doc comment).
 */
export function ResumeDocument(subject: ResumeSubject): ReactElement | null {
  const { data } = useGetList<Resume>("resumes", {
    filter: resumeSubjectFilter(subject),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });

  /**
   * `null` means "whichever is newest", deliberately, rather than resolving
   * the newest path into state on mount. Uploading a new version then moves
   * the embed to it on its own, because the list re-sorts and `null` still
   * resolves to the head; a path captured at mount would silently pin the
   * reader to the version they arrived on.
   */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const versions = sortResumeFilesNewestFirst(data?.[0]?.files ?? []);
  const shown =
    versions.find((version) => version.path === selectedPath) ?? versions[0];

  return (
    <div className="flex flex-col gap-4">
      {shown ? <ResumeEmbed version={shown} /> : null}
      <ResumeVersionList
        {...subject}
        shownPath={shown?.path}
        onShow={versions.length > 1 ? setSelectedPath : undefined}
      />
    </div>
  );
}

/**
 * Split out so the height lives in exactly one place: `AttachmentPreview`
 * fills its parent in every state — pending skeleton included — and this is
 * that parent. A skeleton whose height does not match its content IS a
 * layout shift, which this repo has already paid for once (see
 * `dashboard/ParentFocusCards.tsx` and the e2e CLS spec that caught it).
 */
function ResumeEmbed({
  version,
}: {
  version: ResumeFileVersion;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();

  // Stable across renders, so the preview's mint-on-mount effect does not
  // re-sign the URL every time the parent re-renders.
  const signUrl = useCallback(
    ({ inline }: { inline: boolean }) =>
      dataProvider.signResumeFileUrl({
        storagePath: version.path,
        fileName: version.filename,
        inline,
      }),
    [dataProvider, version.path, version.filename],
  );

  const handleDownload = async () => {
    try {
      const url = await signUrl({ inline: false });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.resume.downloadError", {
              _: "Failed to get a download link",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <div
      className={`${EMBED_HEIGHT} overflow-hidden rounded-md border border-border bg-muted/40`}
    >
      <AttachmentPreview
        key={version.path}
        fileName={version.filename}
        mimeType={version.mime_type}
        signUrl={signUrl}
        onDownload={handleDownload}
      />
    </div>
  );
}
