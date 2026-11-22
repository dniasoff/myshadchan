import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { AttachmentViewerDialog } from "../../attachments/AttachmentViewerDialog";
import type { CrmDataProvider } from "../../providers/types";
import type {
  EntityFileSummary,
  EntityFileVisibility,
  EntityTargetType,
} from "../../types";
import { isEntityFileDeleteChangedError } from "../../providers/entityFileDeleteErrors";
import {
  CHILD_DOCUMENT_ACCEPT,
  MAX_CHILD_PAPERS,
  validateChildDocument,
} from "../../singles/ChildDocuments/childDocuments";
import { formatTimelineDate } from "./interactionLabels";
import type { UniversalTabProps } from "./types";

/**
 * The universal Files tab (Story 3.7, contract §8, AC 6). Takes exactly
 * `UniversalTabProps` — no extra props, no per-entity variants — and sits
 * beside `ActivityTab.tsx` / `NotesTab.tsx` / `TasksTab.tsx`.
 *
 * Reads `entity_files_summary` (uploader identity resolved server-side);
 * writes through `uploadEntityFile` / `deleteEntityFile` / the
 * `entity_files` table's `visibility` column directly (AD-10). Every file
 * I/O call goes through `useDataProvider()` — there is no `getSupabaseClient()`
 * import anywhere under `entity360/`.
 */

/** Human-readable size, matching the precision the tab's rows need — no
 * external dependency for something this small. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** AC 6(e): the visibility control renders only for `shidduch`/`single`
 * targets, matching `entity_files_visibility_target_check`. */
function isVisibilityEligible(targetType: EntityTargetType): boolean {
  return targetType === "shidduch" || targetType === "single";
}

const VISIBILITY_OPTIONS: readonly EntityFileVisibility[] = [
  "shared",
  "private_parent",
  "private_single",
];

function FilesSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

/** AC 6(f) — an inline translated empty message; the upload control above it
 * stays usable. */
function FilesEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.files.empty", { _: "No files yet." })}
    </p>
  );
}

/** AC 6(f) — a translated fetch-error message; never a blank tab, and the
 * upload control above it stays usable. */
function FilesError({ onRetry }: { onRetry: () => void }): ReactElement {
  const translate = useTranslate();
  return (
    <div
      role="alert"
      className="flex items-center gap-3 text-sm text-destructive"
    >
      <p>
        {translate("crm.entity360.files.error", {
          _: "Could not load the files.",
        })}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-11"
        onClick={onRetry}
      >
        {translate("crm.entity360.files.retry", { _: "Retry" })}
      </Button>
    </div>
  );
}

/**
 * AC 6(e): a per-row `shared / private_parent / private_single` control,
 * issuing `dataProvider.update("entity_files", ...)` — the only column the
 * grant permits (AC 2e).
 */
function FileVisibilityControl({
  file,
  onChanged,
}: {
  file: EntityFileSummary;
  onChanged: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = async (value: string) => {
    setIsSaving(true);
    try {
      await dataProvider.update("entity_files", {
        id: file.id,
        data: { visibility: value as EntityFileVisibility },
        previousData: file,
      });
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.files.visibilityError", {
              _: "Failed to update visibility",
            }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Select
      value={file.visibility}
      onValueChange={handleChange}
      disabled={isSaving}
    >
      <SelectTrigger
        className="min-h-11 w-36 md:min-h-11"
        aria-label={translate("crm.entity360.files.visibility", {
          _: "Visibility",
        })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VISIBILITY_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {translate(`crm.entity360.files.visibilityOption.${option}`, {
              _: option,
            })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FileRowView({
  file,
  existingFiles,
  targetType,
  targetId,
  onChanged,
}: {
  file: EntityFileSummary;
  existingFiles: readonly EntityFileSummary[];
  targetType: EntityTargetType;
  targetId: Identifier;
  onChanged: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    token: string;
    until: number;
  } | null>(null);
  const undoInFlightRef = useRef(false);

  const restoreFocus = () => {
    window.setTimeout(() => {
      if (focusReturnRef.current?.isConnected) {
        focusReturnRef.current.focus();
      } else if (undoButtonRef.current?.isConnected) {
        undoButtonRef.current.focus();
      }
      focusReturnRef.current = null;
    }, 0);
  };

  useEffect(() => {
    if (!pendingDelete) return;
    const remaining = Math.max(0, pendingDelete.until - Date.now());
    const timer = window.setTimeout(async () => {
      try {
        await dataProvider.finalizeEntityFileDelete({
          id: file.id,
          deleteToken: pendingDelete.token,
        });
      } catch (error) {
        // Undo can win the deadline race. The server then rejects this stale
        // token by design; that expected outcome must not become an unhandled
        // promise rejection or an error toast after the user restored the row.
        if (!isEntityFileDeleteChangedError(error)) {
          notify(
            error instanceof Error
              ? error.message
              : translate("crm.entity360.files.deleteError", {
                  _: "Failed to delete the file",
                }),
            { type: "error" },
          );
        }
      } finally {
        setPendingDelete(null);
        onChanged();
        restoreFocus();
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [dataProvider, file.id, notify, onChanged, pendingDelete, translate]);

  // Stable across renders so the viewer's mint-on-open effect does not
  // re-sign the URL on every parent render while the dialog is open.
  const signUrl = useCallback(
    ({ inline }: { inline: boolean }) =>
      dataProvider.signEntityFileUrl({
        storagePath: file.storage_path,
        fileName: file.file_name,
        inline,
      }),
    [dataProvider, file.storage_path, file.file_name],
  );

  const handleDownload = async () => {
    try {
      const url = await signUrl({ inline: false });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.files.downloadError", {
              _: "Failed to get a download link",
            }),
        { type: "error" },
      );
    }
  };

  // Reached only from the confirm dialog. The server soft-deletes first, so
  // the object remains available during the ten-second Undo window.
  const handleDelete = async () => {
    setIsBusy(true);
    try {
      if (targetType !== "single") {
        await dataProvider.deleteEntityFile({
          id: file.id,
          storagePath: file.storage_path,
        });
        await dataProvider.finalizeExpiredEntityFileDeletes();
        setIsConfirmingDelete(false);
        onChanged();
        restoreFocus();
        return;
      }
      const result = await dataProvider.softDeleteEntityFile({ id: file.id });
      setIsConfirmingDelete(false);
      setPendingDelete({
        token: result.delete_token,
        until: new Date(result.undo_until).getTime(),
      });
      await dataProvider.finalizeExpiredEntityFileDeletes();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.files.deleteError", {
              _: "Failed to delete the file",
            }),
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  // Upload first, then atomically swap the catalog row. A failed upload leaves
  // the old file untouched.
  const handleReplace = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile || isBusy) return;

    setIsBusy(true);
    try {
      if (targetType === "single") {
        const validationError = validateChildDocument(nextFile);
        if (validationError) throw new Error(validationError);
        const slot = (["paper_1", "paper_2"] as const).find(
          (candidate) =>
            candidate === file.slot ||
            !existingFiles.some(
              (existing) =>
                existing.id !== file.id && existing.slot === candidate,
            ),
        );
        if (!slot)
          throw new Error(`You can store up to ${MAX_CHILD_PAPERS} papers.`);
        await dataProvider.replaceEntityFile({
          oldId: file.id,
          targetType,
          targetId,
          file: nextFile,
          visibility: file.visibility,
          slot,
        });
      } else {
        await dataProvider.uploadEntityFile({
          targetType,
          targetId,
          file: nextFile,
          visibility: file.visibility,
        });
        await dataProvider.deleteEntityFile({
          id: file.id,
          storagePath: file.storage_path,
        });
      }
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.files.replaceError", {
              _: "Failed to replace the file",
            }),
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const replaceLabel = translate("crm.entity360.files.replace", {
    _: "Replace",
  });

  return (
    <li className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p dir="auto" className="truncate text-sm font-medium">
          {file.file_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {file.mime_type} · {formatFileSize(file.size_bytes)} ·{" "}
          {file.uploaded_by_name ??
            translate("crm.entity360.notes.unknownAuthor", {
              _: "Unknown",
            })}{" "}
          · {formatTimelineDate(file.created_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isVisibilityEligible(targetType) ? (
          <FileVisibilityControl file={file} onChanged={onChanged} />
        ) : null}
        {/*
         * Offered on every row, not only on rows whose `mime_type` says they
         * can be previewed. That column is client-supplied and frequently
         * `application/octet-stream`, so gating the button on it would hide
         * "View" from real PDFs; the dialog resolves the type itself and
         * explains when it cannot show one, which is the more useful answer
         * than a button that quietly is not there.
         */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-11"
          aria-label={`View ${file.file_name}`}
          disabled={isBusy}
          onClick={() => setIsViewerOpen(true)}
        >
          {translate("crm.entity360.files.view", { _: "View" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-11"
          aria-label={`Download ${file.file_name}`}
          disabled={isBusy}
          onClick={handleDownload}
        >
          {translate("crm.entity360.files.download", { _: "Download" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-11"
          aria-label={`Replace ${file.file_name}`}
          disabled={isBusy || pendingDelete != null}
          onClick={() => replaceInputRef.current?.click()}
        >
          {replaceLabel}
        </Button>
        <input
          ref={replaceInputRef}
          type="file"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={replaceLabel}
          accept={targetType === "single" ? CHILD_DOCUMENT_ACCEPT : undefined}
          onChange={handleReplace}
        />
        {/* Reads as destructive BEFORE it is pressed — the four row actions
         * are otherwise identical ghost buttons in one wrapping row. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 text-destructive hover:text-destructive md:min-h-11"
          aria-label={`Delete ${file.file_name}`}
          disabled={isBusy || pendingDelete != null}
          onClick={(event) => {
            focusReturnRef.current = event.currentTarget;
            setIsConfirmingDelete(true);
          }}
        >
          {translate("crm.entity360.files.delete", { _: "Delete" })}
        </Button>
      </div>
      <AttachmentViewerDialog
        open={isViewerOpen}
        onOpenChange={setIsViewerOpen}
        fileName={file.file_name}
        mimeType={file.mime_type}
        signUrl={signUrl}
      />
      {/* `@/components/admin/confirm` rather than a hand-rolled dialog: it is
       * the repo's existing confirmation primitive for destructive actions,
       * and `resumes/PhotoRevealCard.tsx` gates its own irreversible "Hide"
       * on the same component, so the two cannot drift. */}
      <Confirm
        isOpen={isConfirmingDelete}
        loading={isBusy}
        title={translate("crm.entity360.files.deleteConfirmTitle", {
          _: "Delete this file?",
        })}
        content={translate("crm.entity360.files.deleteConfirmBody", {
          _: "%{fileName} will be hidden for 10 seconds so you can Undo.",
          fileName: file.file_name,
        })}
        confirm={translate("crm.entity360.files.deleteConfirmAction", {
          _: "Delete file",
        })}
        confirmColor="warning"
        onConfirm={handleDelete}
        onClose={() => {
          setIsConfirmingDelete(false);
          restoreFocus();
        }}
      />
      {pendingDelete ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span>Deleted. Undo is available for 10 seconds.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-11"
            ref={undoButtonRef}
            onClick={async () => {
              if (undoInFlightRef.current) return;
              undoInFlightRef.current = true;
              setIsBusy(true);
              try {
                await dataProvider.undoEntityFileDelete({
                  id: file.id,
                  deleteToken: pendingDelete.token,
                });
                setPendingDelete(null);
                onChanged();
                restoreFocus();
              } catch (error) {
                notify(
                  error instanceof Error
                    ? error.message
                    : "Could not undo the deletion.",
                  { type: "error" },
                );
              } finally {
                undoInFlightRef.current = false;
                setIsBusy(false);
              }
            }}
            aria-label={`Undo delete ${file.file_name}`}
          >
            Undo
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function FilesTab({
  targetType,
  targetId,
}: UniversalTabProps): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const refresh = useRefresh();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data, error, isPending, refetch } = useGetList<EntityFileSummary>(
    "entity_files_summary",
    {
      filter: { target_type: targetType, target_id: targetId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
  );
  useEffect(() => {
    void dataProvider
      .finalizeExpiredEntityFileDeletes()
      .then(() => refresh())
      .catch(() => {
        // A cleanup outage does not make the existing file list unreadable.
      });
  }, [dataProvider, refresh, targetId, targetType]);
  const files = data ?? [];

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isUploading) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      if (targetType === "single") {
        const validationError = validateChildDocument(file);
        if (validationError) throw new Error(validationError);
      }
      const usedPaperSlots = new Set(
        files
          .filter((candidate) => candidate.slot)
          .map((candidate) => candidate.slot),
      );
      const slot =
        targetType === "single"
          ? (["paper_1", "paper_2"] as const).find(
              (candidate) => !usedPaperSlots.has(candidate),
            )
          : undefined;
      if (targetType === "single" && !slot) {
        throw new Error(`You can store up to ${MAX_CHILD_PAPERS} papers.`);
      }
      await dataProvider.uploadEntityFile({
        targetType,
        targetId,
        file,
        ...(slot ? { slot } : {}),
      });
      refresh();
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : translate("crm.entity360.files.uploadError", {
              _: "Failed to upload the file",
            });
      setUploadError(message);
      notify(message, { type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const uploadLabel = translate("crm.entity360.files.upload", {
    _: "Upload a file",
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          type="button"
          className="min-h-11 md:min-h-11"
          disabled={isUploading}
          onClick={() => uploadInputRef.current?.click()}
        >
          {uploadLabel}
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={uploadLabel}
          accept={targetType === "single" ? CHILD_DOCUMENT_ACCEPT : undefined}
          onChange={handleUpload}
        />
      </div>
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          {uploadError}
        </p>
      ) : null}

      {isPending ? (
        <FilesSkeleton />
      ) : error ? (
        <FilesError onRetry={() => void refetch()} />
      ) : files.length === 0 ? (
        <FilesEmpty />
      ) : (
        <ul className="flex flex-col gap-3">
          {files.map((file) => (
            <FileRowView
              key={String(file.id)}
              file={file}
              existingFiles={files}
              targetType={targetType}
              targetId={targetId}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
