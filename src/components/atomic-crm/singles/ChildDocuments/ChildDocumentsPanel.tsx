import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, ReactElement } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../../providers/types";
import { useViewerRole } from "../../entity360/useViewerRole";
import { canUseNativeFileShare } from "./childDocumentUtils";
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
  hydratePendingResumeFileDeletes,
  type PendingResumeFileDelete,
} from "../../resumes/resumeFileDelete";
import { canDeleteResumeFile } from "../../resumes/resumeFileDelete";
import {
  CHILD_DOCUMENT_ACCEPT,
  CHILD_DOCUMENT_MAX_BYTES,
  CHILD_DOCUMENT_MAX_SIZE_LABEL,
  fileExtension,
  MAX_CHILD_DOCUMENTS,
  MAX_CHILD_PAPERS,
  validateChildDocument,
  validateChildPhotoType,
  type ChildPaperSlot,
} from "./childDocuments";
import { makeSmallerPhoto, PHOTO_RESIZE_ERROR_MESSAGE } from "./photoResize";

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
  label: string;
  fileName: string;
  slot?: ChildPaperSlot;
};

type ShareFile = {
  name: string;
  url: string;
  revoke?: () => void;
};

type PhotoUploadCandidate = {
  file: File;
  replacement: Extract<ReplaceTarget, { kind: "picture" }> | null;
};

type PhotoForwardMode = "full" | "smaller";

const FILE_DELETE_UNDO_MS = 10_000;
const DOCUMENT_SLOT_UNAVAILABLE_MESSAGE =
  "Can't check this right now - tap Retry.";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoFileName(path: string): string {
  const tail = path.split("/").pop() ?? "picture.jpg";
  return tail.replace(/^[0-9a-f-]{20,}-/i, "") || "picture.jpg";
}

function photoMimeType(path: string): string {
  return /\.png$/i.test(path) ? "image/png" : "image/jpeg";
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
  slotName,
  canManage,
  disabled,
  onOpen,
  onReplace,
  onForward,
  onDelete,
}: {
  slotName: string;
  canManage: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onReplace: () => void;
  onForward: () => void;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-11"
        aria-label={`Open ${slotName}`}
        disabled={disabled}
        onClick={onOpen}
      >
        Open
      </Button>
      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-11"
          aria-label={`Replace ${slotName}`}
          disabled={disabled}
          onClick={onReplace}
        >
          Replace
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-11"
        aria-label={`Forward ${slotName}`}
        disabled={disabled}
        onClick={onForward}
      >
        Forward
      </Button>
      {canManage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 text-destructive hover:text-destructive md:min-h-11"
          aria-label={`Delete ${slotName}`}
          disabled={disabled}
          onClick={onDelete}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function EmptySlot({
  label,
  slotName,
  canAdd,
  disabled,
  pending,
  unavailableMessage,
  onAdd,
}: {
  label: string;
  slotName: string;
  canAdd: boolean;
  disabled?: boolean;
  pending?: boolean;
  unavailableMessage?: string;
  onAdd: () => void;
}): ReactElement {
  const actionLabel = label.startsWith("Papers")
    ? "Add paper"
    : `Add ${label.toLowerCase()}`;
  return (
    <div className="flex min-h-28 flex-col justify-between rounded-xl border border-dashed border-border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {unavailableMessage ??
            (pending
              ? "Undo is available for 10 seconds."
              : "No file added yet.")}
        </p>
      </div>
      {canAdd ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-11 self-start md:min-h-11"
          aria-label={`Add ${slotName}`}
          disabled={disabled || unavailableMessage != null}
          onClick={onAdd}
        >
          {actionLabel}
        </Button>
      ) : null}
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
  const { role, isPending: isRolePending } = useViewerRole();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadActiveRef = useRef(false);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const undoButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreTargetRefs = useRef(new Map<string, HTMLElement>());
  const expiredDeleteSweepStartedRef = useRef(false);
  const [uploadKind, setUploadKind] = useState<DocumentKind | null>(null);
  const [uploadSlot, setUploadSlot] = useState<ChildPaperSlot | null>(null);
  const [uploadReplaceTarget, setUploadReplaceTarget] =
    useState<ReplaceTarget>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isRetryingDocuments, setIsRetryingDocuments] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<
    Map<string, PendingDelete>
  >(() => new Map());
  const [shareFile, setShareFile] = useState<ShareFile | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoUploadCandidate, setPhotoUploadCandidate] =
    useState<PhotoUploadCandidate | null>(null);
  const [isResizingPhoto, setIsResizingPhoto] = useState(false);
  const [forwardPhotoTarget, setForwardPhotoTarget] =
    useState<ResumePhoto | null>(null);
  const [isPreparingSmallerShare, setIsPreparingSmallerShare] = useState(false);

  const {
    data: resumes,
    error: resumesError,
    isPending: resumesPending,
    isFetching: resumesFetching,
    refetch: refetchResumes,
  } = useGetList<Resume>(
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
  const {
    data: photos,
    error: photosError,
    isPending: photosPending,
    isFetching: photosFetching,
    refetch: refetchPhotos,
  } = useGetList<ResumePhoto>(
    "resume_photos",
    {
      filter: { resume_id: resume?.id, "hidden_at@is": null },
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
  const {
    data: entityFiles,
    error: entityFilesError,
    isPending: entityFilesPending,
    isFetching: entityFilesFetching,
    refetch: refetchEntityFiles,
  } = useGetList<EntityFileSummary>(
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
  const documentsFetching =
    resumesFetching ||
    entityFilesFetching ||
    (resume?.id != null && photosFetching);

  const documentsPending =
    open &&
    (resumesPending ||
      entityFilesPending ||
      (resume?.id != null && photosPending) ||
      isRetryingDocuments);
  const documentsError = resumesError ?? entityFilesError ?? photosError;
  const retryDocuments = () => {
    if (isRetryingDocuments || documentsFetching) return;
    setUploadError(null);
    setIsRetryingDocuments(true);
    const refetches: Array<Promise<unknown>> = [
      refetchResumes(),
      refetchEntityFiles(),
    ];
    if (resume?.id != null) refetches.push(refetchPhotos());
    void Promise.allSettled(refetches).finally(() => {
      setIsRetryingDocuments(false);
    });
  };
  const sweepExpiredDeletes = useCallback(async () => {
    try {
      const finalized = await dataProvider.finalizeExpiredEntityFileDeletes();
      if (finalized > 0) refresh();
    } catch {
      // A cleanup outage must not turn a readable document list into an error.
    }
  }, [dataProvider, refresh]);
  const canManageResumePicture = canDeleteResumeFile(role, isRolePending);
  const canManagePaper =
    !isRolePending &&
    (role === "parent_admin" ||
      role === "self_manager" ||
      role === "helper" ||
      role === "shadchan");

  const restoreFocus = () => {
    window.setTimeout(() => {
      const original = focusReturnRef.current;
      if (original?.isConnected) {
        original.focus();
      }
      focusReturnRef.current = null;
    }, 0);
  };

  const restorePendingFocus = (key: string) => {
    window.setTimeout(() => {
      const target = restoreTargetRefs.current.get(key);
      if (target?.isConnected) target.focus();
      restoreTargetRefs.current.delete(key);
      undoButtonRefs.current.delete(key);
    }, 0);
  };

  const hasPendingKind = (kind: DocumentKind) =>
    [...pendingDeletes.values()].some((pending) => pending.kind === kind);
  const visibleResume = hasPendingKind("resume") ? null : latestResume;
  const visiblePhoto = hasPendingKind("picture") ? null : currentPhoto;
  const pendingResume = hasPendingKind("resume") ? 1 : 0;
  const pendingPicture = hasPendingKind("picture") ? 1 : 0;
  const pendingPaperSlots = new Set(
    [...pendingDeletes.values()]
      .filter(
        (pending): pending is PendingDelete & { slot: ChildPaperSlot } =>
          pending.kind === "paper" && pending.slot != null,
      )
      .map((pending) => pending.slot),
  );
  const paperSlotsInUse = new Set([
    ...papers.map((file) => file.slot),
    ...pendingPaperSlots,
  ]);
  const usedCount =
    (visibleResume ? 1 : pendingResume) +
    (visiblePhoto ? 1 : pendingPicture) +
    paperSlotsInUse.size;

  useEffect(() => {
    if (!open || !visiblePhoto) {
      setPhotoPreviewUrl(null);
      return;
    }
    let cancelled = false;
    setPhotoPreviewUrl(null);
    void dataProvider
      .signResumePhotoUrl({ storagePath: visiblePhoto.path })
      .then((url) => {
        if (!cancelled) setPhotoPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPhotoPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataProvider, open, visiblePhoto]);

  useEffect(() => {
    return () => shareFile?.revoke?.();
  }, [shareFile]);

  useEffect(() => {
    const timers = [...pendingDeletes.entries()].map(([key, pending]) =>
      window.setTimeout(
        async () => {
          try {
            if (pending.kind === "paper") {
              await dataProvider.finalizeEntityFileDelete({
                id: pending.id,
                deleteToken: pending.token,
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
            setPendingDeletes((current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            });
            refresh();
            restorePendingFocus(key);
          }
        },
        Math.max(0, pending.until - Date.now()),
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dataProvider, notify, pendingDeletes, refresh]);

  useEffect(() => {
    if (!open) {
      expiredDeleteSweepStartedRef.current = false;
      return;
    }
    if (expiredDeleteSweepStartedRef.current) return;
    expiredDeleteSweepStartedRef.current = true;
    void sweepExpiredDeletes();
  }, [open, sweepExpiredDeletes]);

  useEffect(() => {
    if (!open || resume?.id == null) return;
    void (async () => {
      await hydratePendingResumeFileDeletes(resume.id, resume.files ?? []);
      for (const marker of pendingResumeFileDeletes.values()) {
        if (String(marker.resumeId) !== String(resume.id)) continue;
        schedulePendingResumeFileDelete(marker, async () => {
          try {
            await dataProvider.removeResumeFile({
              resumeId: marker.resumeId,
              path: marker.file.path,
              size: marker.file.size,
              uploadedAt: marker.file.uploaded_at,
              deleteToken: marker.token,
            });
          } finally {
            clearPendingResumeFileDelete(marker.token);
            refresh();
          }
        });
      }
    })();
  }, [dataProvider, open, refresh, resume?.files, resume?.id]);

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
    if (isBusy || uploadKind != null || uploadActiveRef.current) return;
    uploadActiveRef.current = true;
    setUploadKind(kind);
    setUploadSlot(slot ?? null);
    setUploadReplaceTarget(replaceTarget);
    window.setTimeout(() => inputRef.current?.click(), 0);
  };

  const clearUploadState = () => {
    uploadActiveRef.current = false;
    setUploadKind(null);
    setUploadSlot(null);
    setUploadReplaceTarget(null);
  };

  const uploadPicture = async (
    file: File,
    replacement: PhotoUploadCandidate["replacement"],
  ) => {
    await dataProvider.uploadResumePhoto({
      singleId: single.id,
      file,
      visibility: "shared",
    });
    if (replacement) {
      await dataProvider.hideResumePhoto({ id: replacement.photo.id });
    }
    refresh();
  };

  const choosePhotoUpload = async (makeSmaller: boolean) => {
    const candidate = photoUploadCandidate;
    if (!candidate || isBusy) return;
    if (!makeSmaller && candidate.file.size > CHILD_DOCUMENT_MAX_BYTES) return;
    setUploadError(null);
    setIsBusy(true);
    setIsResizingPhoto(makeSmaller);
    try {
      const prepared = makeSmaller
        ? await makeSmallerPhoto(candidate.file)
        : { file: candidate.file };
      await uploadPicture(prepared.file, candidate.replacement);
      setPhotoUploadCandidate(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : PHOTO_RESIZE_ERROR_MESSAGE;
      setUploadError(message);
      notify(message, { type: "error" });
    } finally {
      setIsResizingPhoto(false);
      setIsBusy(false);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !uploadKind) {
      clearUploadState();
      return;
    }
    if (isBusy) return;
    setUploadError(null);
    const validationError =
      uploadKind === "picture"
        ? validateChildPhotoType(file)
        : validateChildDocument(file);
    if (validationError) {
      setUploadError(validationError);
      notify(validationError, { type: "error" });
      clearUploadState();
      return;
    }
    if (uploadKind === "picture") {
      const replacement =
        uploadReplaceTarget?.kind === "picture" ? uploadReplaceTarget : null;
      clearUploadState();
      setPhotoUploadCandidate({ file, replacement });
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
      setUploadError(
        error instanceof Error ? error.message : "Could not add this file.",
      );
      notify(
        error instanceof Error ? error.message : "Could not add this file.",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
      clearUploadState();
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
        mimeType = photoMimeType(photo.path);
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
    photoMode: PhotoForwardMode = "full",
  ) => {
    const makeSmaller = kind === "picture" && photoMode === "smaller";
    setIsPreparingSmallerShare(makeSmaller);
    try {
      let url: string;
      let name: string;
      let mimeType: string;
      let fetchedBlob: Blob | null = null;
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
        mimeType = photoMimeType(photo.path);
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
      let smallerFile: File | null = null;
      if (makeSmaller) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Could not download this picture for sharing.");
        }
        fetchedBlob = await response.blob();
        smallerFile = (
          await makeSmallerPhoto(
            new File([fetchedBlob], name, { type: mimeType }),
          )
        ).file;
      }
      if (canUseNativeFileShare()) {
        if (!fetchedBlob) {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error("Could not download this file for sharing.");
          }
          fetchedBlob = await response.blob();
        }
        const payload = buildResumeSharePayload(smallerFile ?? fetchedBlob, {
          filename: smallerFile?.name ?? name,
          mime_type: smallerFile?.type ?? mimeType,
        });
        if (navigator.canShare(payload)) {
          await navigator.share(payload);
          return;
        }
      }
      if (smallerFile) {
        const smallerUrl = URL.createObjectURL(smallerFile);
        setShareFile({
          name: smallerFile.name,
          url: smallerUrl,
          revoke: () => URL.revokeObjectURL(smallerUrl),
        });
      } else {
        setShareFile({ name, url });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(
        error instanceof Error ? error.message : "Could not forward this file.",
        { type: "error" },
      );
    } finally {
      setIsPreparingSmallerShare(false);
    }
  };

  const confirmDelete = async () => {
    if (isBusy || !deleteTarget) return;
    const returnTarget = focusReturnRef.current;
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
        setPendingDeletes((current) =>
          new Map(current).set(`resume:${deleteTarget.file.path}`, {
            kind: "resume",
            id: deleteTarget.resumeId,
            token,
            until: deadline,
            label: "Resume",
            fileName: deleteTarget.file.filename,
          }),
        );
        restoreTargetRefs.current.set(
          `resume:${deleteTarget.file.path}`,
          focusReturnRef.current ?? document.body,
        );
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
            setPendingDeletes((current) => {
              const next = new Map(current);
              next.delete(`resume:${marker.file.path}`);
              return next;
            });
            restorePendingFocus(`resume:${marker.file.path}`);
          }
        });
      } else if (deleteTarget.kind === "picture") {
        const key = `picture:${deleteTarget.photo.id}`;
        await dataProvider.hideResumePhoto({ id: deleteTarget.photo.id });
        setPendingDeletes((current) =>
          new Map(current).set(key, {
            kind: "picture",
            id: deleteTarget.photo.id,
            token: "photo",
            until: Date.now() + FILE_DELETE_UNDO_MS,
            label: "Picture",
            fileName: photoFileName(deleteTarget.photo.path),
          }),
        );
        if (returnTarget) restoreTargetRefs.current.set(key, returnTarget);
      } else {
        const key = String(deleteTarget.file.id);
        const result = await dataProvider.softDeleteEntityFile({
          id: deleteTarget.file.id,
        });
        setPendingDeletes((current) =>
          new Map(current).set(key, {
            kind: "paper",
            id: deleteTarget.file.id,
            token: result.delete_token,
            until: new Date(result.undo_until).getTime(),
            label: `Paper ${deleteTarget.file.slot === "paper_2" ? 2 : 1}`,
            fileName: deleteTarget.file.file_name,
            slot: deleteTarget.file.slot ?? undefined,
          }),
        );
        if (returnTarget) restoreTargetRefs.current.set(key, returnTarget);
      }
      setDeleteTarget(null);
      await sweepExpiredDeletes();
      refresh();
      restoreFocus();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not delete this file.",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const undoDelete = async (key: string) => {
    const pendingDelete = pendingDeletes.get(key);
    if (isBusy || !pendingDelete) return;
    setIsBusy(true);
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
      setPendingDeletes((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      refresh();
      restorePendingFocus(key);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not undo the deletion.",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
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

  if (isRolePending || role === "single") return <></>;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl [&>button]:min-h-11 [&>button]:min-w-11"
      >
        <SheetHeader className="border-b border-border px-5 pb-4 pt-6 pr-14">
          <SheetTitle className="text-xl">Documents</SheetTitle>
          <SheetDescription>
            Resume, picture, and papers for {displayName(single)}.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 pb-8 pt-5">
          {documentsPending ? (
            <p
              role="status"
              aria-busy="true"
              className="text-sm text-muted-foreground"
            >
              Loading documents…
            </p>
          ) : (
            <>
              {documentsError ? (
                <div role="alert" className="flex flex-col gap-3 text-sm">
                  <p>
                    Could not load some documents. Your files are unchanged.
                  </p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {resumesError ? <li>Resume is unavailable.</li> : null}
                    {photosError ? <li>Picture is unavailable.</li> : null}
                    {entityFilesError ? <li>Papers are unavailable.</li> : null}
                  </ul>
                  <Button
                    type="button"
                    className="min-h-11 self-start"
                    onClick={retryDocuments}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
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
              {usedCount >= MAX_CHILD_DOCUMENTS ? (
                <p className="text-sm text-muted-foreground">
                  To add another file, Replace one first.
                </p>
              ) : null}
              {uploadError ? (
                <p role="alert" className="text-sm text-destructive">
                  {uploadError}
                </p>
              ) : null}

              <section
                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                aria-label="Child document slots"
              >
                <DocumentSlot
                  label="Resume"
                  slotName="Resume"
                  unavailableMessage={
                    resumesError ? DOCUMENT_SLOT_UNAVAILABLE_MESSAGE : undefined
                  }
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
                  onDelete={(event) =>
                    visibleResume &&
                    (() => {
                      focusReturnRef.current = event.currentTarget;
                      setDeleteTarget({
                        kind: "resume",
                        resumeId: resumeId!,
                        file: visibleResume,
                      });
                    })()
                  }
                  disabled={isBusy || uploadKind != null || pendingResume > 0}
                  canAdd={canManageResumePicture}
                  canManage={canManageResumePicture}
                  pending={pendingResume > 0}
                />
                <DocumentSlot
                  label="Picture"
                  slotName="Picture"
                  unavailableMessage={
                    resumesError || photosError
                      ? DOCUMENT_SLOT_UNAVAILABLE_MESSAGE
                      : undefined
                  }
                  file={
                    visiblePhoto
                      ? {
                          name: photoFileName(visiblePhoto.path),
                          detail: "Photo",
                          kind: "picture" as const,
                        }
                      : null
                  }
                  previewUrl={photoPreviewUrl ?? undefined}
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
                    visiblePhoto && setForwardPhotoTarget(visiblePhoto)
                  }
                  onDelete={(event) =>
                    visiblePhoto &&
                    (() => {
                      focusReturnRef.current = event.currentTarget;
                      setDeleteTarget({ kind: "picture", photo: visiblePhoto });
                    })()
                  }
                  disabled={isBusy || uploadKind != null || pendingPicture > 0}
                  canAdd={canManageResumePicture}
                  canManage={canManageResumePicture}
                  pending={pendingPicture > 0}
                />
                {(["paper_1", "paper_2"] as const).map((slot, index) => {
                  const file = paperFor(slot);
                  return (
                    <DocumentSlot
                      key={slot}
                      label={`Papers · ${index + 1} of ${MAX_CHILD_PAPERS}`}
                      slotName={`Paper ${index + 1}`}
                      unavailableMessage={
                        entityFilesError
                          ? DOCUMENT_SLOT_UNAVAILABLE_MESSAGE
                          : undefined
                      }
                      file={
                        file
                          ? {
                              name: file.file_name,
                              detail: formatBytes(file.size_bytes),
                              kind: "paper" as const,
                            }
                          : null
                      }
                      onAdd={() => {
                        if (!pendingPaperSlots.has(slot))
                          beginUpload("paper", slot);
                      }}
                      onOpen={() => file && void openFile("paper", file)}
                      onReplace={() => file && replacePaper(file)}
                      onForward={() => file && void forwardFile("paper", file)}
                      onDelete={(event) =>
                        file &&
                        (() => {
                          focusReturnRef.current = event.currentTarget;
                          setDeleteTarget({ kind: "paper", file });
                        })()
                      }
                      disabled={
                        isBusy ||
                        uploadKind != null ||
                        pendingPaperSlots.has(slot)
                      }
                      canAdd={canManagePaper}
                      canManage={canManagePaper}
                      pending={pendingPaperSlots.has(slot)}
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
                        <span dir="auto" className="min-w-0 truncate">
                          {file.file_name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 md:min-h-11"
                          aria-label={`Open ${file.file_name}`}
                          onClick={() => void openFile("paper", file)}
                        >
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {[...pendingDeletes.entries()].map(([key, pending]) => (
                <div
                  key={key}
                  role="status"
                  aria-live="polite"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900"
                >
                  <span>
                    Deleted {pending.label}: {pending.fileName}. Undo is
                    available for 10 seconds.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 md:min-h-11"
                    ref={(element) => {
                      if (element) undoButtonRefs.current.set(key, element);
                      else undoButtonRefs.current.delete(key);
                    }}
                    disabled={isBusy}
                    aria-label={`Undo delete ${pending.label}: ${pending.fileName}`}
                    onClick={() => void undoDelete(key)}
                  >
                    Undo
                  </Button>
                </div>
              ))}
              {shareFile ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm">
                  <p className="font-medium">
                    {shareFile.name} is ready to share.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Download it, then attach it yourself.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary md:min-h-11"
                      href={shareFile.url}
                      download={shareFile.name}
                    >
                      Download
                    </a>
                    <a
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary md:min-h-11"
                      href={`mailto:?subject=${encodeURIComponent(shareFile.name)}&body=${encodeURIComponent("Please attach the downloaded file.")}`}
                    >
                      Email
                    </a>
                    <a
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-primary md:min-h-11"
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
                The Resume, Photo, and Files tabs show these same files. Nothing
                is copied.
              </p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          aria-label="Upload child document"
          accept={CHILD_DOCUMENT_ACCEPT}
          onChange={handleUpload}
        />
      </SheetContent>
      <Dialog
        open={photoUploadCandidate != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isBusy) {
            setPhotoUploadCandidate(null);
            setUploadError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose picture size</DialogTitle>
            <DialogDescription>
              Keep the clear original, or make a smaller copy that stays sharp
              on a full printed page.
            </DialogDescription>
          </DialogHeader>
          {photoUploadCandidate ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Original size: {formatBytes(photoUploadCandidate.file.size)}.
                <br />
                Smaller copy: About 3 MB, still sharp on a full printed page.
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-14 w-full justify-start px-4 text-left text-base"
                disabled={
                  isBusy ||
                  photoUploadCandidate.file.size > CHILD_DOCUMENT_MAX_BYTES
                }
                onClick={() => void choosePhotoUpload(false)}
              >
                <span>
                  <span className="block font-semibold">Keep full size</span>
                  <span className="block text-sm font-normal text-muted-foreground">
                    Save the original photo bytes.
                  </span>
                </span>
              </Button>
              {photoUploadCandidate.file.size > CHILD_DOCUMENT_MAX_BYTES ? (
                <p className="text-sm text-muted-foreground">
                  Not available for this photo. It is over the 8 MiB limit.
                  <br />
                  The full-size photo is too large to save here. Make a smaller
                  copy first.
                </p>
              ) : null}
              <Button
                type="button"
                className="min-h-14 w-full justify-start px-4 text-left text-base"
                disabled={isBusy}
                autoFocus={
                  photoUploadCandidate.file.size > CHILD_DOCUMENT_MAX_BYTES
                }
                onClick={() => void choosePhotoUpload(true)}
              >
                <span>
                  <span className="block font-semibold">
                    Make smaller (recommended)
                  </span>
                  <span className="block text-sm font-normal opacity-90">
                    Make a smaller JPEG copy for saving.
                  </span>
                </span>
              </Button>
              {isResizingPhoto ? (
                <p role="status" aria-live="polite" className="text-sm">
                  Making your photo smaller…
                </p>
              ) : null}
              {uploadError ? (
                <p role="alert" className="text-sm text-destructive">
                  {uploadError}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={forwardPhotoTarget != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isPreparingSmallerShare)
            setForwardPhotoTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Forward picture</DialogTitle>
            <DialogDescription>
              Choose whether to send the saved original or a smaller copy.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-14 w-full justify-start px-4 text-left text-base"
              onClick={() => {
                const photo = forwardPhotoTarget;
                setForwardPhotoTarget(null);
                if (photo) void forwardFile("picture", photo, "full");
              }}
            >
              <span>
                <span className="block font-semibold">Send full size</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  Send the saved original bytes.
                </span>
              </span>
            </Button>
            <Button
              type="button"
              className="min-h-14 w-full justify-start px-4 text-left text-base"
              disabled={isPreparingSmallerShare}
              onClick={() => {
                const photo = forwardPhotoTarget;
                setForwardPhotoTarget(null);
                if (photo) void forwardFile("picture", photo, "smaller");
              }}
            >
              <span>
                <span className="block font-semibold">Send smaller</span>
                <span className="block text-sm font-normal opacity-90">
                  Make a smaller copy only for this send.
                </span>
              </span>
            </Button>
            <p className="text-sm text-muted-foreground">
              Making it smaller will not make it clearer. Please ask for a
              clearer picture.
            </p>
            {isPreparingSmallerShare ? (
              <p role="status" aria-live="polite" className="text-sm">
                Making your photo smaller…
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Confirm
        isOpen={deleteTarget != null}
        loading={isBusy}
        title="Delete this file?"
        content="The file will be hidden first. Undo is available for 10 seconds."
        confirm="Delete file"
        confirmColor="warning"
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          setDeleteTarget(null);
          restoreFocus();
        }}
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
  slotName,
  canAdd,
  canManage,
  disabled,
  pending,
  unavailableMessage,
  previewUrl,
}: {
  label: string;
  slotName: string;
  canAdd: boolean;
  canManage: boolean;
  pending?: boolean;
  file: { name: string; detail: string; kind: DocumentKind } | null;
  onAdd: () => void;
  onOpen: () => void;
  onReplace: () => void;
  onForward: () => void;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
  unavailableMessage?: string;
  previewUrl?: string;
}): ReactElement {
  if (unavailableMessage)
    return (
      <EmptySlot
        label={label}
        slotName={slotName}
        canAdd={canAdd}
        disabled
        unavailableMessage={unavailableMessage}
        onAdd={onAdd}
      />
    );
  if (!file)
    return (
      <EmptySlot
        label={label}
        slotName={slotName}
        canAdd={canAdd}
        disabled={disabled}
        pending={pending}
        onAdd={onAdd}
      />
    );
  return (
    <div className="flex min-h-28 flex-col justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          {file.kind === "picture" && previewUrl ? (
            <button
              type="button"
              className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Open full-size picture preview"
              disabled={disabled}
              onClick={onOpen}
            >
              <img
                src={previewUrl}
                alt="Picture preview"
                className="size-full object-cover"
              />
            </button>
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-bold">
              {fileExtension(file.name)}
            </span>
          )}
          <span dir="auto" className="min-w-0 truncate text-sm font-medium">
            {file.name}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{file.detail}</p>
      </div>
      <DocumentActions
        slotName={slotName}
        canManage={canManage}
        disabled={disabled}
        onOpen={onOpen}
        onReplace={onReplace}
        onForward={onForward}
        onDelete={onDelete}
      />
    </div>
  );
}
