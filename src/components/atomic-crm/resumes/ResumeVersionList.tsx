import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import {
  isAutomaticallyReadableResume,
  RESUME_AUTO_READ_COPY,
} from "./resumeAutoReadHelpers";
import {
  clearPendingResumeFileDelete,
  RESUME_READ_STATE_CHANGED_EVENT,
  pendingResumeFileDeletes,
  readPendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteKey,
  resumeFileDeleteMarkerToken,
  resumeFileTypeLabel,
  RESUME_FILE_DELETE_UNDO_MS,
  schedulePendingResumeFileDelete,
  usePendingResumeFileDeletes,
  type PendingResumeFileDelete,
} from "./resumeFileDelete";
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
    <div>
      <p className="text-sm text-muted-foreground">
        {translate("crm.entity360.resume.empty", {
          _: "No resume attached",
        })}
      </p>
      <p className="mt-2 max-w-sm text-sm leading-5 text-muted-foreground">
        Choose the resume file (PDF or Word; a photo of a resume also works).
        Profile pictures go on the Photos tab.
      </p>
    </div>
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
  canReread,
  canDelete,
  isReadInProgress,
  onDelete,
  deleteButtonRef,
}: {
  version: ResumeFileVersion;
  isShown: boolean;
  onShow?: (version: ResumeFileVersion) => void;
  canReread: boolean;
  canDelete: boolean;
  isReadInProgress: boolean;
  onDelete?: (version: ResumeFileVersion) => void;
  deleteButtonRef?: (element: HTMLButtonElement | null) => void;
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
          <span dir="auto" title={version.filename}>
            {version.filename}
          </span>
          {isShown ? (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {translate("crm.entity360.resume.shownNow", { _: "· shown" })}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {resumeFileTypeLabel(version.mime_type, version.filename)} ·{" "}
          {version.size} B · {formatTimelineDate(version.uploaded_at)}
        </p>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto">
        {onShow && !isShown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onShow(version)}
          >
            {translate("crm.entity360.resume.show", { _: "Show" })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 w-full sm:w-auto"
          onClick={handleDownload}
          aria-label={`Download ${version.filename}`}
        >
          {translate("crm.entity360.resume.download", { _: "Download" })}
        </Button>
        {canDelete ? (
          <Button
            ref={deleteButtonRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
            disabled={isReadInProgress}
            onClick={() => onDelete?.(version)}
            aria-label={`Delete ${version.filename}`}
          >
            Delete
          </Button>
        ) : null}
        {canReread && !isAutomaticallyReadableResume(version) ? (
          <p className="text-xs text-muted-foreground">
            {RESUME_AUTO_READ_COPY.unsupported}
          </p>
        ) : null}
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
  shownFileKey?: string;
  /** Omitted when there is only one version — see `ResumeVersionRow`. */
  onShow?: (version: ResumeFileVersion) => void;
  /** Only manager roles may invoke the deployed re-read route. */
  canReread?: boolean;
  /** Only parent_admin/self_manager may see the per-file Delete action. */
  canDelete?: boolean;
};

export function ResumeVersionList({
  shownFileKey,
  onShow,
  canReread = false,
  canDelete = false,
  ...subject
}: ResumeVersionListProps): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const isMobile = useIsMobile();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const finalizePendingRef = useRef<
    ((marker: PendingResumeFileDelete) => Promise<void>) | null
  >(null);
  const [confirming, setConfirming] = useState<ResumeFileVersion | null>(null);
  const [pending, setPending] = useState<PendingResumeFileDelete[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [readInProgressKeys, setReadInProgressKeys] = useState<Set<string>>(
    new Set(),
  );
  const [purgePending, setPurgePending] = useState(false);
  const { data, error, isPending } = useGetList<Resume>("resumes", {
    filter: resumeSubjectFilter(subject as ResumeSubject),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });

  const resumeFiles = data?.[0]?.files;
  const versions = useMemo(
    () => sortResumeFilesNewestFirst(resumeFiles ?? []),
    [resumeFiles],
  );
  const resumeId = data?.[0]?.id;
  const hydratedPending = usePendingResumeFileDeletes(resumeId, versions);
  useEffect(() => {
    setPending(hydratedPending);
    hydratedPending.forEach((marker) => {
      schedulePendingResumeFileDelete(
        marker,
        () => finalizePendingRef.current?.(marker) ?? Promise.resolve(),
      );
    });
  }, [hydratedPending]);

  useEffect(() => {
    if (!canDelete || resumeId == null) {
      setReadInProgressKeys(new Set());
      return;
    }
    const getReadState = dataProvider.getResumeReadState;
    if (typeof getReadState !== "function") {
      setReadInProgressKeys(new Set());
      return;
    }
    let mounted = true;
    const currentResumeId = resumeId;
    const refreshReadStates = () => {
      const readStates = Promise.all(
        versions.map(async (version) => ({
          key: resumeFileDeleteKey(currentResumeId, version),
          state: await getReadState(currentResumeId, version.path),
        })),
      );
      void readStates
        .then((states) => {
          if (mounted) {
            setReadInProgressKeys(
              new Set(
                states
                  .filter(({ state }) => state.inProgress)
                  .map(({ key }) => key),
              ),
            );
          }
        })
        .catch(() => {
          if (mounted) setReadInProgressKeys(new Set());
        });
    };
    refreshReadStates();
    const onReadStateChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          resumeId?: string;
          path?: string;
        }>
      ).detail;
      if (detail?.resumeId === String(currentResumeId) && detail.path != null) {
        refreshReadStates();
      }
    };
    window.addEventListener(
      RESUME_READ_STATE_CHANGED_EVENT,
      onReadStateChanged,
    );
    window.addEventListener("focus", refreshReadStates);
    document.addEventListener("visibilitychange", refreshReadStates);
    return () => {
      mounted = false;
      window.removeEventListener(
        RESUME_READ_STATE_CHANGED_EVENT,
        onReadStateChanged,
      );
      window.removeEventListener("focus", refreshReadStates);
      document.removeEventListener("visibilitychange", refreshReadStates);
    };
  }, [canDelete, dataProvider, resumeId, versions]);

  const focusAfterDelete = useCallback(
    (removedFile: ResumeFileVersion) => {
      const removedKey = resumeFileDeleteKey(resumeId ?? "", removedFile);
      const next = versions.find(
        (version) =>
          resumeFileDeleteKey(resumeId ?? "", version) !== removedKey &&
          !pending.some(
            (marker) =>
              resumeFileDeleteKey(marker.resumeId, marker.file) ===
              resumeFileDeleteKey(resumeId ?? "", version),
          ),
      );
      window.requestAnimationFrame(() => {
        const nextButton =
          next &&
          deleteButtonRefs.current.get(
            resumeFileDeleteKey(resumeId ?? "", next),
          );
        if (nextButton && document.contains(nextButton)) nextButton.focus();
        else headingRef.current?.focus();
      });
    },
    [pending, resumeId, versions],
  );

  const finalizePending = useCallback(
    async (marker: PendingResumeFileDelete) => {
      const key = resumeFileDeleteKey(marker.resumeId, marker.file);
      const current = readPendingResumeFileDeletes().find(
        (candidate) =>
          candidate.token === marker.token &&
          candidate.deadline === marker.deadline,
      );
      if (!current) return;
      try {
        const result = await dataProvider.removeResumeFile({
          resumeId: marker.resumeId,
          path: marker.file.path,
          size: marker.file.size,
          uploadedAt: marker.file.uploaded_at,
          deleteToken: marker.token,
        });
        pendingResumeFileDeletes.delete(key);
        clearPendingResumeFileDelete(marker.token);
        setPending((value) =>
          value.filter(
            (candidate) =>
              resumeFileDeleteKey(candidate.resumeId, candidate.file) !== key,
          ),
        );
        setPurgePending(result.purgePending);
        refresh();
        focusAfterDelete(marker.file);
      } catch (error) {
        pendingResumeFileDeletes.delete(key);
        clearPendingResumeFileDelete(marker.token);
        setPending((value) =>
          value.filter(
            (candidate) =>
              resumeFileDeleteKey(candidate.resumeId, candidate.file) !== key,
          ),
        );
        notify(
          error instanceof Error &&
            error.message ===
              "Please wait: this resume is being made easy to read."
            ? error.message
            : "Could not delete. Nothing was changed.",
          { type: "error" },
        );
        refresh();
        window.requestAnimationFrame(() =>
          deleteButtonRefs.current
            .get(resumeFileDeleteKey(marker.resumeId, marker.file))
            ?.focus(),
        );
      }
    },
    [dataProvider, focusAfterDelete, notify, refresh],
  );

  finalizePendingRef.current = finalizePending;

  useEffect(() => {
    if (pending.length === 0) return;
    pending.forEach((marker) => {
      schedulePendingResumeFileDelete(
        marker,
        () => finalizePendingRef.current?.(marker) ?? Promise.resolve(),
      );
    });
  }, [pending]);

  useEffect(() => {
    if (pending.length === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [pending.length]);

  const closeConfirmation = () => {
    const file = confirming;
    setConfirming(null);
    if (file) {
      window.requestAnimationFrame(() =>
        deleteButtonRefs.current
          .get(resumeFileDeleteKey(resumeId ?? "", file))
          ?.focus(),
      );
    }
  };

  const requestDelete = (version: ResumeFileVersion) => {
    if (
      !canDelete ||
      readInProgressKeys.has(resumeFileDeleteKey(resumeId ?? "", version)) ||
      resumeId == null
    )
      return;
    setPurgePending(false);
    setConfirming(version);
  };

  const confirmDelete = () => {
    if (
      !confirming ||
      !canDelete ||
      readInProgressKeys.has(resumeFileDeleteKey(resumeId ?? "", confirming)) ||
      resumeId == null
    ) {
      return;
    }
    const marker = {
      resumeId,
      file: confirming,
      deadline: Date.now() + RESUME_FILE_DELETE_UNDO_MS,
    };
    const key = resumeFileDeleteKey(marker.resumeId, marker.file);
    void rememberPendingResumeFileDelete(marker).then(async (remembered) => {
      if (!remembered) {
        notify("Could not delete. Nothing was changed.", { type: "error" });
        return;
      }
      const token = await resumeFileDeleteMarkerToken(
        marker.resumeId,
        marker.file,
      );
      const pendingMarker: PendingResumeFileDelete = { ...marker, token };
      pendingResumeFileDeletes.set(key, pendingMarker);
      setPending((value) => [...value, pendingMarker]);
      schedulePendingResumeFileDelete(
        pendingMarker,
        () => finalizePendingRef.current?.(pendingMarker) ?? Promise.resolve(),
      );
    });
    setConfirming(null);
  };

  const undo = (marker: PendingResumeFileDelete) => {
    const key = resumeFileDeleteKey(marker.resumeId, marker.file);
    pendingResumeFileDeletes.delete(key);
    clearPendingResumeFileDelete(marker.token);
    setPending((value) =>
      value.filter(
        (candidate) =>
          resumeFileDeleteKey(candidate.resumeId, candidate.file) !== key,
      ),
    );
  };

  const pendingKeys = new Set(
    pending.map((marker) => resumeFileDeleteKey(marker.resumeId, marker.file)),
  );
  const visibleVersions = versions.filter(
    (version) => !pendingKeys.has(resumeFileDeleteKey(resumeId ?? "", version)),
  );

  if (isPending) return <ResumeListSkeleton />;
  if (error) return <ResumeError />;

  const dialogDescription = confirming
    ? `${resumeFileTypeLabel(confirming.mime_type, confirming.filename)} · ${confirming.filename}. The stored file will be removed. The Easy to read cards and readings stay. If this is the only file, the reading stays and Original resume shows as removed.`
    : "";
  const content =
    visibleVersions.length === 0 ? (
      <ResumeEmpty />
    ) : (
      <ul className="flex flex-col gap-3">
        {visibleVersions.map((version) => (
          <ResumeVersionRow
            key={resumeFileDeleteKey(resumeId ?? "", version)}
            version={version}
            isShown={
              resumeFileDeleteKey(resumeId ?? "", version) === shownFileKey
            }
            onShow={onShow}
            canReread={
              canReread &&
              resumeId != null &&
              resumeFileDeleteKey(resumeId ?? "", version) ===
                resumeFileDeleteKey(
                  resumeId ?? "",
                  visibleVersions[0] ?? version,
                )
            }
            canDelete={canDelete}
            isReadInProgress={readInProgressKeys.has(
              resumeFileDeleteKey(resumeId ?? "", version),
            )}
            onDelete={requestDelete}
            deleteButtonRef={(element) => {
              const key = resumeFileDeleteKey(resumeId ?? "", version);
              if (element) deleteButtonRefs.current.set(key, element);
              else deleteButtonRefs.current.delete(key);
            }}
          />
        ))}
      </ul>
    );

  return (
    <section
      aria-labelledby="resume-files-heading"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
      <div>
        <h2
          ref={headingRef}
          id="resume-files-heading"
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          Resume files
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Files attached to this suggestion.
        </p>
      </div>
      {canDelete && readInProgressKeys.size > 0 ? (
        <p role="status" className="text-xs text-muted-foreground">
          Please wait: this resume is being made easy to read.
        </p>
      ) : null}
      {content}
      {purgePending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Files are being removed shortly.
        </p>
      ) : null}
      {pending.map((marker) => {
        const undoRemaining = Math.max(0, marker.deadline - now);
        const undoProgress = Math.max(
          0,
          Math.min(100, (undoRemaining / RESUME_FILE_DELETE_UNDO_MS) * 100),
        );
        return (
          <div
            key={resumeFileDeleteKey(marker.resumeId, marker.file)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Deleted.</p>
                <p className="text-xs text-muted-foreground">
                  Undo is available for 10 seconds.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                onClick={() => undo(marker)}
                disabled={undoRemaining === 0}
              >
                Undo
              </Button>
            </div>
            <div
              className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted motion-reduce:transition-none"
              role="progressbar"
              aria-label="Undo time remaining"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={undoProgress}
            >
              <div
                className="h-full bg-primary transition-[width] motion-reduce:transition-none"
                style={{ width: `${undoProgress}%` }}
              />
            </div>
          </div>
        );
      })}
      {isMobile ? (
        <Sheet
          open={confirming != null}
          onOpenChange={(open) => {
            if (!open) closeConfirmation();
          }}
        >
          <SheetContent
            side="bottom"
            hideClose
            className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none"
          >
            <SheetHeader>
              <SheetTitle>Delete this file?</SheetTitle>
              <SheetDescription>{dialogDescription}</SheetDescription>
            </SheetHeader>
            <SheetFooter className="flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                onClick={closeConfirmation}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="min-h-11 w-full"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog
          open={confirming != null}
          onOpenChange={(open) => {
            if (!open) closeConfirmation();
          }}
        >
          <DialogContent
            hideClose
            className="sm:max-w-md motion-reduce:animate-none"
          >
            <DialogHeader>
              <DialogTitle>Delete this file?</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                onClick={closeConfirmation}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="min-h-11 w-full sm:w-auto"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
