import type { Identifier } from "ra-core";

import type { MemberRole, ResumeFileVersion } from "../types";

export const RESUME_FILE_DELETE_UNDO_MS = 10_000;

export type PendingResumeFileDelete = {
  resumeId: Identifier;
  file: ResumeFileVersion;
  deadline: number;
};

export type PendingResumeFileDeleteMarker = {
  token: string;
  deadline: number;
};

export const RESUME_FILE_DELETE_MARKER_KEY =
  "myshadchan:pending-resume-file-delete";

/** Runtime details for the currently visible Resume tab. */
export const pendingResumeFileDeletes = new Map<
  string,
  PendingResumeFileDelete
>();

const pendingResumeFileDeleteTimers = new Map<string, number>();

const markerToken = (resumeId: Identifier, path: string): string => {
  let hash = 2166136261;
  for (const character of `${String(resumeId)}\u0000${path}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const readMarkerCollection = (): Record<
  string,
  PendingResumeFileDeleteMarker
> => {
  try {
    const raw = window.localStorage.getItem(RESUME_FILE_DELETE_MARKER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(
        ([key, value]) => {
          if (!value || typeof value !== "object") return [];
          const marker = value as Partial<PendingResumeFileDeleteMarker>;
          if (
            typeof marker.token !== "string" ||
            typeof marker.deadline !== "number"
          ) {
            return [];
          }
          return [[key, marker as PendingResumeFileDeleteMarker]];
        },
      ),
    );
  } catch {
    return {};
  }
};

const writeMarkerCollection = (
  markers: Record<string, PendingResumeFileDeleteMarker>,
): boolean => {
  try {
    if (Object.keys(markers).length === 0) {
      window.localStorage.removeItem(RESUME_FILE_DELETE_MARKER_KEY);
    } else {
      window.localStorage.setItem(
        RESUME_FILE_DELETE_MARKER_KEY,
        JSON.stringify(markers),
      );
    }
    return true;
  } catch {
    return false;
  }
};

export const readPendingResumeFileDeletes =
  (): PendingResumeFileDeleteMarker[] => Object.values(readMarkerCollection());

export const rememberPendingResumeFileDelete = (
  marker: Pick<PendingResumeFileDelete, "resumeId" | "deadline"> & {
    file: Pick<ResumeFileVersion, "path">;
  },
): boolean => {
  const markers = readMarkerCollection();
  const token = markerToken(marker.resumeId, marker.file.path);
  markers[token] = { token, deadline: marker.deadline };
  return writeMarkerCollection(markers);
};

export const clearPendingResumeFileDelete = (
  resumeId: Identifier,
  path: string,
): void => {
  const key = resumeFileDeleteKey(resumeId, path);
  const timer = pendingResumeFileDeleteTimers.get(key);
  if (timer !== undefined) window.clearTimeout(timer);
  pendingResumeFileDeleteTimers.delete(key);
  const markers = readMarkerCollection();
  delete markers[markerToken(resumeId, path)];
  writeMarkerCollection(markers);
};

export const resumeFileDeleteMarkerToken = (
  resumeId: Identifier,
  path: string,
): string => markerToken(resumeId, path);

/**
 * Keep the expiry timer outside the tab component. A route change must not
 * cancel the pending action; a reload rehydrates the marker and schedules it
 * again. Local storage carries only a deterministic opaque token and
 * deadline, never a filename, path or id.
 */
export const schedulePendingResumeFileDelete = (
  marker: Pick<PendingResumeFileDelete, "resumeId" | "deadline"> & {
    file: Pick<ResumeFileVersion, "path">;
  },
  onExpire: () => void,
): void => {
  const key = resumeFileDeleteKey(marker.resumeId, marker.file.path);
  const previous = pendingResumeFileDeleteTimers.get(key);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(
    () => {
      pendingResumeFileDeleteTimers.delete(key);
      onExpire();
    },
    Math.max(0, marker.deadline - Date.now()),
  );
  pendingResumeFileDeleteTimers.set(key, timer);
};

export function resumeFileDeleteKey(
  resumeId: Identifier,
  path: string,
): string {
  return `${String(resumeId)}\u0000${path}`;
}

export function canDeleteResumeFile(
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean {
  return !isRolePending && (role === "parent_admin" || role === "self_manager");
}

export function resumeFileTypeLabel(
  mimeType: string | null | undefined,
  filename: string,
): string {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  if (normalizedMimeType === "application/pdf" || /\.pdf$/i.test(filename)) {
    return "PDF";
  }
  if (
    normalizedMimeType === "application/msword" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx?$/i.test(filename)
  ) {
    return "Word";
  }
  if (
    normalizedMimeType.startsWith("image/") ||
    /\.(gif|jpe?g|png|webp|heic|heif)$/i.test(filename)
  ) {
    return "Photo";
  }
  return "File";
}
