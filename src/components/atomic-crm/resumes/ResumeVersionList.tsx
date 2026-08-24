import type { ReactElement } from "react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import { resumeSubjectFilter, type ResumeSubject } from "./resumeSubject";
import { sortResumeFilesNewestFirst } from "./useLatestResumeFile";

function ResumeListSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** AC 3 — no `resumes` row yet, or a row with an empty `files` array: the
 * SAME empty state either way, and it renders no fabricated content. */
function ResumeEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.resume.empty", {
        _: "No resume uploaded yet.",
      })}
    </p>
  );
}

function ResumeError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.resume.error", {
        _: "Could not load the resume.",
      })}
    </p>
  );
}

/** AC 5: a per-click signed URL, minted fresh on every download — never
 * cached in component state, never persisted on the row.
 *
 * There is no "View" here any more, and no dialog. The resume is embedded
 * above this list (`ResumeDocument`), so a row's job is to say which version
 * this is, let you swap the embed to it, and let you keep a copy. "Show"
 * appears only when there is more than one version — with a single version
 * there is nothing to swap to, and a button that cannot change anything is
 * the same defect as pagination on a one-page list. */
function ResumeVersionRow({
  version,
  isShown,
  onShow,
}: {
  version: ResumeFileVersion;
  isShown: boolean;
  onShow?: (path: string) => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();

  const handleDownload = async () => {
    try {
      const url = await dataProvider.signResumeFileUrl({
        storagePath: version.path,
        fileName: version.filename,
        inline: false,
      });
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
    <li
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-b-0"
      aria-current={isShown ? "true" : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {version.filename}
          {isShown ? (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {translate("crm.entity360.resume.shownNow", { _: "· shown" })}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatTimelineDate(version.uploaded_at)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onShow && !isShown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onShow(version.path)}
          >
            {translate("crm.entity360.resume.show", { _: "Show" })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownload}
        >
          {translate("crm.entity360.resume.download", { _: "Download" })}
        </Button>
      </div>
    </li>
  );
}

/**
 * AC 1 / AC 3: reads the subject's single `resumes` row — unique on
 * `shidduchim_id` OR `single_id` (01_tables.sql, widened by Story 5.8 AC 2),
 * so at most one row ever exists — and renders its `files` newest-first.
 * The array is append-only (`add_resume_file`, AC 2), not stored sorted, so
 * this sorts client-side rather than trusting insertion order.
 */
export type ResumeVersionListProps = ResumeSubject & {
  /** Which version the embed above is currently showing, so the list can
   * mark it rather than leaving the reader to guess. */
  shownPath?: string;
  /** Omitted when there is only one version — see `ResumeVersionRow`. */
  onShow?: (path: string) => void;
};

export function ResumeVersionList({
  shownPath,
  onShow,
  ...subject
}: ResumeVersionListProps): ReactElement {
  const { data, error, isPending } = useGetList<Resume>("resumes", {
    filter: resumeSubjectFilter(subject as ResumeSubject),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });

  if (isPending) return <ResumeListSkeleton />;
  if (error) return <ResumeError />;

  const versions = sortResumeFilesNewestFirst(data?.[0]?.files ?? []);

  if (versions.length === 0) return <ResumeEmpty />;

  return (
    <ul className="flex flex-col gap-3">
      {versions.map((version) => (
        <ResumeVersionRow
          key={version.path}
          version={version}
          isShown={version.path === shownPath}
          onShow={onShow}
        />
      ))}
    </ul>
  );
}
