import { useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../../providers/types";
import type {
  EntityFileSummary,
  EntityFileVisibility,
  EntityTargetType,
} from "../../types";
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
function FilesError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.files.error", {
        _: "Could not load the files.",
      })}
    </p>
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
        className="w-36"
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
  targetType,
  targetId,
  onChanged,
}: {
  file: EntityFileSummary;
  targetType: EntityTargetType;
  targetId: Identifier;
  onChanged: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleDownload = async () => {
    try {
      const url = await dataProvider.signEntityFileUrl({
        storagePath: file.storage_path,
        fileName: file.file_name,
      });
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

  const handleDelete = async () => {
    setIsBusy(true);
    try {
      await dataProvider.deleteEntityFile({
        id: file.id,
        storagePath: file.storage_path,
      });
      onChanged();
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

  // AC 6(c): replace = delete then upload, sharing one UI action, carrying
  // the previous row's visibility forward. No in-place object rename.
  const handleReplace = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;

    setIsBusy(true);
    try {
      await dataProvider.deleteEntityFile({
        id: file.id,
        storagePath: file.storage_path,
      });
      await dataProvider.uploadEntityFile({
        targetType,
        targetId,
        file: nextFile,
        visibility: file.visibility,
      });
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
        <p className="truncate text-sm font-medium">{file.file_name}</p>
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={handleDownload}
        >
          {translate("crm.entity360.files.download", { _: "Download" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
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
          onChange={handleReplace}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={handleDelete}
        >
          {translate("crm.entity360.files.delete", { _: "Delete" })}
        </Button>
      </div>
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

  const { data, error, isPending } = useGetList<EntityFileSummary>(
    "entity_files_summary",
    {
      filter: { target_type: targetType, target_id: targetId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      await dataProvider.uploadEntityFile({ targetType, targetId, file });
      refresh();
    } catch (uploadError) {
      notify(
        uploadError instanceof Error
          ? uploadError.message
          : translate("crm.entity360.files.uploadError", {
              _: "Failed to upload the file",
            }),
        { type: "error" },
      );
    } finally {
      setIsUploading(false);
    }
  };

  const uploadLabel = translate("crm.entity360.files.upload", {
    _: "Upload a file",
  });
  const files = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          type="button"
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
          onChange={handleUpload}
        />
      </div>

      {isPending ? (
        <FilesSkeleton />
      ) : error ? (
        <FilesError />
      ) : files.length === 0 ? (
        <FilesEmpty />
      ) : (
        <ul className="flex flex-col gap-3">
          {files.map((file) => (
            <FileRowView
              key={String(file.id)}
              file={file}
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
