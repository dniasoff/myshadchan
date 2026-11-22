import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { useDataProvider, useGetList, useNotify, useRefresh } from "ra-core";
import type { Identifier } from "ra-core";

import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { CrmDataProvider } from "../../providers/types";
import type {
  EntityFileSummary,
  Resume,
  ResumeFileVersion,
  ResumePhoto,
  Single,
} from "../../types";
import { sortResumeFilesNewestFirst } from "../../resumes/useLatestResumeFile";
import { buildResumeSharePayload } from "../../resumes/resumeSharePayload";
import {
  clearPendingResumeFileDelete,
  pendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteKey,
  resumeFileDeleteMarkerToken,
  schedulePendingResumeFileDelete,
  type PendingResumeFileDelete,
} from "../../resumes/resumeFileDelete";
import {
  CHILD_DOCUMENT_ACCEPT,
  CHILD_DOCUMENT_MAX_SIZE_LABEL,
  fileExtension,
  MAX_CHILD_DOCUMENTS,
  MAX_CHILD_PAPERS,
  validateChildDocument,
  type ChildPaperSlot,
} from "./childDocuments";

type DocumentKind = "resume" | "picture" | "paper";
type DeleteTarget =
  | { kind: "resume"; resumeId: Identifier; file: ResumeFileVersion }
  | { kind: "picture"; photo: ResumePhoto }
  | { kind: "paper"; file: EntityFileSummary };
type ReplaceTarget =
  | { kind: "resume"; file: ResumeFileVersion }
  | { kind: "picture"; photo: ResumePhoto }
  | { kind: "paper"; file: EntityFileSummary }
  | null;
type PendingDelete = {
  kind: DocumentKind;
  id: Identifier;
  token: string;
  until: number;
};

type ShareFile = {
  name: string;
  url: string;
};

const FILE_DELETE_UNDO_MS = 10_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoFileName(path: string): string {
  const tail = path.split("/").pop() ?? "picture.jpg";
  return tail.replace(/^[0-9a-f-]{20,}-/i, "") || "picture.jpg";
}

function isWordFile(name: string, mimeType: string): boolean {
  return (
    /\.docx?$/i.test(name) ||
    mimeType === "application/msword" ||
    mimeType.includes("wordprocessingml")
  );
}

function displayName(single: Single): string {
  return (
    [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
    "this child"
  );
}

function DocumentActions({
  disabled,
  onOpen,
  onReplace,
  onForward,
  onDelete,
}: {
  disabled?: boolean;
  onOpen: () => void;
  onReplace: () => void;
  onForward: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={disabled}
        onClick={onOpen}
      >
        Open
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={disabled}
        onClick={onReplace}
      >
        Replace
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={disabled}
        onClick={onForward}
      >
        Forward
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 text-destructive hover:text-destructive"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete
      </Button>
    </div>
  );
}

function EmptySlot({
  label,
  onAdd,
}: {
  label: string;
  onAdd: () => void;
}): ReactElement {
  const actionLabel = label.startsWith("Papers")
    ? "Add paper"
    : `Add ${label.toLowerCase()}`;
  return (
    <div className="flex min-h-28 flex-col justify-between rounded-xl border border-dashed border-border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">No file added yet.</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3 min-h-11 self-start"
        onClick={onAdd}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

export function ChildDocumentsPanel({
  single,
  open,
  onOpenChange,
}: {
  single: Single;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<DocumentKind | null>(null);
  const [uploadSlot, setUploadSlot] = useState<ChildPaperSlot | null>(null);
  const [uploadReplaceTarget, setUploadReplaceTarget] =
    useState<ReplaceTarget>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [shareFile, setShareFile] = useState<ShareFile | null>(null);

  const { data: resumes } = useGetList<Resume>(
    "resumes",
    {
      filter: { single_id: single.id },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: open },
  );
  const resume = resumes?.[0];
  const latestResume =
    sortResumeFilesNewestFirst(resume?.files ?? [])[0] ?? null;
  const { data: photos } = useGetList<ResumePhoto>(
    "resume_photos",
    {
      filter: { resume_id: resume?.id, hidden_at: null },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "uploaded_at", order: "DESC" },
    },
    { enabled: open && resume?.id != null },
  );
  const currentPhoto = useMemo(
    () =>
      [...(photos ?? [])].sort((a, b) =>
        b.uploaded_at.localeCompare(a.uploaded_at),
      )[0] ?? null,
    [photos],
  );
  const { data: entityFiles } = useGetList<EntityFileSummary>(
    "entity_files_summary",
    {
      filter: { target_type: "single", target_id: single.id },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: open },
  );
  const papers = (entityFiles ?? []).filter(
    (file) => file.slot === "paper_1" || file.slot === "paper_2",
  );
  const olderFiles = (entityFiles ?? []).filter((file) => file.slot == null);

  const visibleResume = pendingDelete?.kind === "resume" ? null : latestResume;
  const visiblePhoto = pendingDelete?.kind === "picture" ? null : currentPhoto;
  const usedCount =
    (visibleResume ? 1 : 0) + (visiblePhoto ? 1 : 0) + papers.length;

  useEffect(() => {
    if (!pendingDelete) return;
    const timer = window.setTimeout(
      async () => {
        try {
          if (pendingDelete.kind === "paper") {
            await dataProvider.finalizeEntityFileDelete({
              id: pendingDelete.id,
              deleteToken: pendingDelete.token,
            });
          }
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message
              : "Could not finish deleting the file.",
            { type: "error" },
          );
        } finally {
          setPendingDelete(null);
          refresh();
        }
      },
      Math.max(0, pendingDelete.until - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [dataProvider, notify, pendingDelete, refresh]);

  const queueResumeDelete = async (
    resumeId: Identifier,
    file: ResumeFileVersion,
  ) => {
    const deadline = Date.now() + FILE_DELETE_UNDO_MS;
    const marker: PendingResumeFileDelete = {
      resumeId,
      file,
      deadline,
      token: await resumeFileDeleteMarkerToken(resumeId, file),
    };
    if (!(await rememberPendingResumeFileDelete(marker))) {
      throw new Error("Could not prepare the previous resume for deletion.");
    }
    const key = resumeFileDeleteKey(resumeId, file);
    pendingResumeFileDeletes.set(key, marker);
    schedulePendingResumeFileDelete(marker, async () => {
      try {
        await dataProvider.removeResumeFile({
          resumeId: marker.resumeId,
          path: marker.file.path,
          size: marker.file.size,
          uploadedAt: marker.file.uploaded_at,
          deleteToken: marker.token,
        });
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Could not finish deleting the previous resume.",
          { type: "error" },
        );
      } finally {
        pendingResumeFileDeletes.delete(key);
        clearPendingResumeFileDelete(marker.token);
        refresh();
      }
    });
  };

  const beginUpload = (
    kind: DocumentKind,
    slot?: ChildPaperSlot,
    replaceTarget: ReplaceTarget = null,
  ) => {
    setUploadKind(kind);
    setUploadSlot(slot ?? null);
    setUploadReplaceTarget(replaceTarget);
    window.setTimeout(() => inputRef.current?.click(), 0);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !uploadKind) return;
    const validationError = validateChildDocument(file);
    if (validationError) {
      notify(validationError, { type: "error" });
      return;
    }
    setIsBusy(true);
    try {
      const replacement = uploadReplaceTarget;
      if (uploadKind === "resume") {
        await dataProvider.uploadResumeFile({ singleId: single.id, file });
        if (replacement?.kind === "resume" && resume) {
          await queueResumeDelete(resume.id, replacement.file);
        }
      } else if (uploadKind === "picture") {
        await dataProvider.uploadResumePhoto({
          singleId: single.id,
          file,
          visibility: "shared",
        });
        if (replacement?.kind === "picture") {
          await dataProvider.hideResumePhoto({ id: replacement.photo.id });
        }
      } else if (uploadSlot) {
        if (replacement?.kind === "paper") {
          await dataProvider.replaceEntityFile({
            oldId: replacement.file.id,
            targetType: "single",
            targetId: single.id,
            file,
            slot: uploadSlot,
            visibility: replacement.file.visibility,
          });
        } else {
          await dataProvider.uploadEntityFile({
            targetType: "single",
            targetId: single.id,
            file,
            slot: uploadSlot,
          });
        }
      }
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not add this file.",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
      setUploadKind(null);
      setUploadSlot(null);
      setUploadReplaceTarget(null);
    }
  };

  const openFile = async (
    kind: DocumentKind,
    file: ResumeFileVersion | ResumePhoto | EntityFileSummary,
  ) => {
    try {
      let url: string;
      let name: string;
      let mimeType: string;
      if (kind === "resume") {
        const resumeFile = file as ResumeFileVersion;
        name = resumeFile.filename;
        mimeType = resumeFile.mime_type;
        url = await dataProvider.signResumeFileUrl({
          storagePath: resumeFile.path,
          fileName: name,
          inline: !isWordFile(name, mimeType),
        });
      } else if (kind === "picture") {
        const photo = file as ResumePhoto;
        name = photoFileName(photo.path);
        mimeType = "image/jpeg";
        url = await dataProvider.signResumePhotoUrl({
          storagePath: photo.path,
        });
      } else {
        const entityFile = file as EntityFileSummary;
        name = entityFile.file_name;
        mimeType = entityFile.mime_type;
        url = await dataProvider.signEntityFileUrl({
          storagePath: entityFile.storage_path,
          fileName: name,
          inline: !isWordFile(name, mimeType),
        });
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not open this file.",
        { type: "error" },
      );
    }
  };

  const forwardFile = async (
    kind: DocumentKind,
    file: ResumeFileVersion | ResumePhoto | EntityFileSummary,
  ) => {
    try {
      let url: string;
      let name: string;
      let mimeType: string;
      if (kind === "resume") {
        const resumeFile = file as ResumeFileVersion;
        name = resumeFile.filename;
        mimeType = resumeFile.mime_type;
        url = await dataProvider.signResumeFileUrl({
          storagePath: resumeFile.path,
          fileName: name,
        });
      } else if (kind === "picture") {
        const photo = file as ResumePhoto;
        name = photoFileName(photo.path);
        mimeType = "image/jpeg";
        url = await dataProvider.signResumePhotoUrl({
          storagePath: photo.path,
        });
      } else {
        const entityFile = file as EntityFileSummary;
        name = entityFile.file_name;
        mimeType = entityFile.mime_type;
        url = await dataProvider.signEntityFileUrl({
          storagePath: entityFile.storage_path,
          fileName: name,
        });
      }
      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function";
      if (canShareFiles) {
        const response = await fetch(url);
        const payload = buildResumeSharePayload(await response.blob(), {
          filename: name,
          mime_type: mimeType,
        });
        if (navigator.canShare(payload)) {
          await navigator.share(payload);
          return;
        }
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setShareFile({ name, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(
        error instanceof Error ? error.message : "Could not forward this file.",
        { type: "error" },
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsBusy(true);
    try {
      if (deleteTarget.kind === "resume") {
        const token = await resumeFileDeleteMarkerToken(
          deleteTarget.resumeId,
          deleteTarget.file,
        );
        const deadline = Date.now() + FILE_DELETE_UNDO_MS;
        const marker: PendingResumeFileDelete = {
          resumeId: deleteTarget.resumeId,
          file: deleteTarget.file,
          deadline,
          token,
        };
        if (!(await rememberPendingResumeFileDelete(marker))) {
          throw new Error("Could not prepare this file for deletion.");
        }
        const key = resumeFileDeleteKey(
          deleteTarget.resumeId,
          deleteTarget.file,
        );
        pendingResumeFileDeletes.set(key, marker);
        setPendingDelete({
          kind: "resume",
          id: deleteTarget.resumeId,
          token,
          until: deadline,
        });
        schedulePendingResumeFileDelete(marker, async () => {
          try {
            await dataProvider.removeResumeFile({
              resumeId: marker.resumeId,
              path: marker.file.path,
              size: marker.file.size,
              uploadedAt: marker.file.uploaded_at,
              deleteToken: marker.token,
            });
          } catch (error) {
            notify(
              error instanceof Error
                ? error.message
                : "Could not finish deleting the file.",
              { type: "error" },
            );
          } finally {
            pendingResumeFileDeletes.delete(key);
            clearPendingResumeFileDelete(marker.token);
            refresh();
            setPendingDelete((current) =>
              current?.token === marker.token ? null : current,
            );
          }
        });
      } else if (deleteTarget.kind === "picture") {
        await dataProvider.hideResumePhoto({ id: deleteTarget.photo.id });
        setPendingDelete({
          kind: "picture",
          id: deleteTarget.photo.id,
          token: "photo",
          until: Date.now() + FILE_DELETE_UNDO_MS,
        });
      } else {
        const result = await dataProvider.softDeleteEntityFile({
          id: deleteTarget.file.id,
        });
        setPendingDelete({
          kind: "paper",
          id: deleteTarget.file.id,
          token: result.delete_token,
          until: new Date(result.undo_until).getTime(),
        });
      }
      setDeleteTarget(null);
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not delete this file.",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const undoDelete = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "resume") {
        pendingResumeFileDeletes.forEach((candidate, key) => {
          if (candidate.token === pendingDelete.token) {
            pendingResumeFileDeletes.delete(key);
          }
        });
        clearPendingResumeFileDelete(pendingDelete.token);
      } else if (pendingDelete.kind === "picture") {
        await dataProvider.restoreResumePhoto({ id: pendingDelete.id });
      } else if (pendingDelete.kind === "paper") {
        await dataProvider.undoEntityFileDelete({
          id: pendingDelete.id,
          deleteToken: pendingDelete.token,
        });
      }
      setPendingDelete(null);
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not undo the deletion.",
        { type: "error" },
      );
    }
  };

  const replacePaper = (file: EntityFileSummary) =>
    beginUpload("paper", (file.slot as ChildPaperSlot) ?? "paper_1", {
      kind: "paper",
      file,
    });
  const paperFor = (slot: ChildPaperSlot) =>
    papers.find((file) => file.slot === slot);
  const resumeId = resume?.id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 pb-4 pt-6 pr-14">
          <SheetTitle className="text-xl">Documents</SheetTitle>
          <SheetDescription>
            Resume, picture, and papers for {displayName(single)}.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 pb-8 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                At most {MAX_CHILD_DOCUMENTS} files
              </p>
              <p className="text-base font-semibold">
                {usedCount} of {MAX_CHILD_DOCUMENTS} used
              </p>
            </div>
            <p className="max-w-[13rem] text-right text-xs text-muted-foreground">
              PDF, Word, JPEG, or PNG · {CHILD_DOCUMENT_MAX_SIZE_LABEL} each
            </p>
          </div>

          <section
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Child document slots"
          >
            <DocumentSlot
              label="Resume"
              file={
                visibleResume
                  ? {
                      name: visibleResume.filename,
                      detail: formatBytes(visibleResume.size),
                      kind: "resume" as const,
                    }
                  : null
              }
              onAdd={() => beginUpload("resume")}
              onOpen={() =>
                visibleResume && void openFile("resume", visibleResume)
              }
              onReplace={() =>
                visibleResume &&
                beginUpload("resume", undefined, {
                  kind: "resume",
                  file: visibleResume,
                })
              }
              onForward={() =>
                visibleResume && void forwardFile("resume", visibleResume)
              }
              onDelete={() =>
                visibleResume &&
                setDeleteTarget({
                  kind: "resume",
                  resumeId: resumeId!,
                  file: visibleResume,
                })
              }
              disabled={isBusy}
            />
            <DocumentSlot
              label="Picture"
              file={
                visiblePhoto
                  ? {
                      name: photoFileName(visiblePhoto.path),
                      detail: "Photo",
                      kind: "picture" as const,
                    }
                  : null
              }
              onAdd={() => beginUpload("picture")}
              onOpen={() =>
                visiblePhoto && void openFile("picture", visiblePhoto)
              }
              onReplace={() =>
                visiblePhoto &&
                beginUpload("picture", undefined, {
                  kind: "picture",
                  photo: visiblePhoto,
                })
              }
              onForward={() =>
                visiblePhoto && void forwardFile("picture", visiblePhoto)
              }
              onDelete={() =>
                visiblePhoto &&
                setDeleteTarget({ kind: "picture", photo: visiblePhoto })
              }
              disabled={isBusy}
            />
            {(["paper_1", "paper_2"] as const).map((slot, index) => {
              const file = paperFor(slot);
              return (
                <DocumentSlot
                  key={slot}
                  label={`Papers · ${index + 1} of ${MAX_CHILD_PAPERS}`}
                  file={
                    file
                      ? {
                          name: file.file_name,
                          detail: formatBytes(file.size_bytes),
                          kind: "paper" as const,
                        }
                      : null
                  }
                  onAdd={() => beginUpload("paper", slot)}
                  onOpen={() => file && void openFile("paper", file)}
                  onReplace={() => file && replacePaper(file)}
                  onForward={() => file && void forwardFile("paper", file)}
                  onDelete={() =>
                    file && setDeleteTarget({ kind: "paper", file })
                  }
                  disabled={isBusy}
                />
              );
            })}
          </section>

          {olderFiles.length > 0 ? (
            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer py-1 text-sm font-medium">
                Older files ({olderFiles.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                {olderFiles.map((file) => (
                  <li
                    key={String(file.id)}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{file.file_name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() => void openFile("paper", file)}
                    >
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {pendingDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900">
              <span>Deleted. Undo is available for 10 seconds.</span>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void undoDelete()}
              >
                Undo
              </Button>
            </div>
          ) : null}
          {shareFile ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm">
              <p className="font-medium">{shareFile.name} is ready to share.</p>
              <p className="mt-1 text-muted-foreground">
                Download it, then attach it yourself.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary"
                  href={shareFile.url}
                  download={shareFile.name}
                >
                  Download
                </a>
                <a
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary"
                  href={`mailto:?subject=${encodeURIComponent(shareFile.name)}&body=${encodeURIComponent("Please attach the downloaded file.")}`}
                >
                  Email
                </a>
                <a
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(`Please attach ${shareFile.name} after downloading it.`)}`}
                >
                  WhatsApp
                </a>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            The Resume, Photo, and Files tabs show these same files. Nothing is
            copied.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={CHILD_DOCUMENT_ACCEPT}
          onChange={handleUpload}
        />
      </SheetContent>
      <Confirm
        isOpen={deleteTarget != null}
        loading={isBusy}
        title="Delete this file?"
        content="The file will be hidden first. Undo is available for 10 seconds."
        confirm="Delete file"
        confirmColor="warning"
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </Sheet>
  );
}

function DocumentSlot({
  label,
  file,
  onAdd,
  onOpen,
  onReplace,
  onForward,
  onDelete,
  disabled,
}: {
  label: string;
  file: { name: string; detail: string; kind: DocumentKind } | null;
  onAdd: () => void;
  onOpen: () => void;
  onReplace: () => void;
  onForward: () => void;
  onDelete: () => void;
  disabled: boolean;
}): ReactElement {
  if (!file) return <EmptySlot label={label} onAdd={onAdd} />;
  return (
    <div className="flex min-h-28 flex-col justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-bold">
            {fileExtension(file.name)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">
            {file.name}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{file.detail}</p>
      </div>
      <DocumentActions
        disabled={disabled}
        onOpen={onOpen}
        onReplace={onReplace}
        onForward={onForward}
        onDelete={onDelete}
      />
    </div>
  );
}
