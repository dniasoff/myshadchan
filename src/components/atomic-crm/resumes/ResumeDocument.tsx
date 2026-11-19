import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";

import { AttachmentPreview } from "../attachments/AttachmentPreview";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import { resumeSubjectFilter, type ResumeSubject } from "./resumeSubject";
import { ResumeVersionList } from "./ResumeVersionList";
import {
  resumeFileDeleteKey,
  usePendingResumeFileDeletes,
} from "./resumeFileDelete";
import { sortResumeFilesNewestFirst } from "./useLatestResumeFile";

/**
 * Tall enough to read a page of a resume without scrolling the frame itself,
 * and expressed in viewport height so a laptop gets a usable document and a
 * phone does not get a letterbox. The floor matters more than the ratio: at
 * `70vh` alone, a short landscape window would render a two-inch strip.
 *
 * The phone value is `svh`, NOT `vh`, and that is the trap worth naming: on
 * a mobile browser `vh` measures the viewport with the chrome RETRACTED, so
 * `70vh` is more than 70% of what the reader can actually see. Combined with
 * the ~590px `MobileContent` leaves on a 390x844 handset, the embed filled
 * the whole content area — and because it is an iframe, dragging over it
 * scrolls the document rather than the page, so `ResumeVersionList` below
 * became hard to reach. `60svh` measures the SMALL viewport (chrome shown)
 * and leaves the version list visibly poking out, which is what makes the
 * page obviously scrollable past the frame.
 */
const EMBED_HEIGHT = "h-[60svh] min-h-[18rem] md:h-[70vh] md:min-h-[24rem]";

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
export function ResumeDocument(
  subject: ResumeSubject & { canDelete?: boolean; canReread?: boolean },
): ReactElement | null {
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
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);

  const versions = sortResumeFilesNewestFirst(data?.[0]?.files ?? []);
  const resumeId = data?.[0]?.id;
  const pendingDeletes = usePendingResumeFileDeletes(resumeId, versions);
  const pendingKeys = new Set(
    pendingDeletes.map((pending) =>
      resumeFileDeleteKey(pending.resumeId, pending.file),
    ),
  );
  const visibleVersions = versions.filter(
    (version) => !pendingKeys.has(resumeFileDeleteKey(resumeId ?? "", version)),
  );
  const resumeWasRemoved =
    data?.[0] != null &&
    Array.isArray(data[0].files) &&
    visibleVersions.length === 0;
  const shown =
    visibleVersions.find(
      (version) =>
        resumeFileDeleteKey(resumeId ?? "", version) === selectedFileKey,
    ) ?? visibleVersions[0];

  return (
    <div className="flex flex-col gap-4">
      {shown ? <ResumeEmbed resumeId={resumeId ?? ""} version={shown} /> : null}
      {resumeWasRemoved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Original resume · Removed
        </p>
      ) : null}
      <ResumeVersionList
        {...subject}
        canDelete={subject.canDelete}
        canReread={subject.canReread}
        shownFileKey={
          shown ? resumeFileDeleteKey(resumeId ?? "", shown) : undefined
        }
        onShow={
          visibleVersions.length > 1
            ? (version) =>
                setSelectedFileKey(resumeFileDeleteKey(resumeId ?? "", version))
            : undefined
        }
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
  resumeId,
  version,
}: {
  resumeId: Resume["id"];
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
        key={resumeFileDeleteKey(resumeId, version)}
        fileName={version.filename}
        mimeType={version.mime_type}
        signUrl={signUrl}
        onDownload={handleDownload}
      />
    </div>
  );
}
