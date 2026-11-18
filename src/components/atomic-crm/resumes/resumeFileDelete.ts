import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Identifier } from "ra-core";

import type { MemberRole, ResumeFileVersion } from "../types";

export const RESUME_FILE_DELETE_UNDO_MS = 10_000;

export type PendingResumeFileDelete = {
  resumeId: Identifier;
  file: ResumeFileVersion;
  deadline: number;
  token: string;
  resumeToken?: string;
};

export type PendingResumeFileDeleteMarker = {
  token: string;
  resumeToken: string;
  deadline: number;
};

export const RESUME_FILE_DELETE_MARKER_KEY =
  "myshadchan:pending-resume-file-delete";
export const RESUME_READ_STATE_CHANGED_EVENT =
  "myshadchan:resume-read-state-changed";

export function dispatchResumeReadStateChanged(
  resumeId: Identifier,
  path: string,
  inProgress: boolean,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(RESUME_READ_STATE_CHANGED_EVENT, {
      detail: { resumeId: String(resumeId), path, inProgress },
    }),
  );
}

const markerKeyPrefix = `${RESUME_FILE_DELETE_MARKER_KEY}:`;

/** Runtime details for the currently visible Resume tab. */
export const pendingResumeFileDeletes = new Map<
  string,
  PendingResumeFileDelete
>();

const pendingResumeFileDeleteTimers = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshotVersion = 0;
const tabOwner =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const notify = (): void => {
  snapshotVersion += 1;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): number => snapshotVersion;

const markerStorageKey = (token: string): string =>
  `${markerKeyPrefix}${token}`;

const readMarker = (key: string): PendingResumeFileDeleteMarker | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingResumeFileDeleteMarker>;
    if (
      !parsed ||
      typeof parsed.token !== "string" ||
      typeof parsed.resumeToken !== "string" ||
      typeof parsed.deadline !== "number"
    ) {
      return null;
    }
    return parsed as PendingResumeFileDeleteMarker;
  } catch {
    return null;
  }
};

const markerStorageKeys = (): string[] => {
  try {
    return Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string => key?.startsWith(markerKeyPrefix) === true);
  } catch {
    return [];
  }
};

const readMarkerCollection = (): PendingResumeFileDeleteMarker[] => {
  // Remove the pre-review shared read/modify/write format. It cannot be
  // merged safely with independent tabs and contains no resumable identity.
  try {
    window.localStorage.removeItem(RESUME_FILE_DELETE_MARKER_KEY);
  } catch {
    // Storage may be unavailable; the in-memory path remains usable.
  }
  return markerStorageKeys()
    .map(readMarker)
    .filter(
      (marker): marker is PendingResumeFileDeleteMarker => marker != null,
    );
};

const sha256 = async (value: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure resume delete identity is unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const fileIdentity = (
  resumeId: Identifier,
  file: Pick<ResumeFileVersion, "path" | "size" | "uploaded_at">,
): string =>
  JSON.stringify([String(resumeId), file.path, file.size, file.uploaded_at]);

export const resumeFileDeleteMarkerToken = (
  resumeId: Identifier,
  file: Pick<ResumeFileVersion, "path" | "size" | "uploaded_at">,
): Promise<string> => sha256(fileIdentity(resumeId, file));

const resumeToken = (resumeId: Identifier): Promise<string> =>
  sha256(`resume:${String(resumeId)}`);

export const readPendingResumeFileDeletes =
  (): PendingResumeFileDeleteMarker[] => readMarkerCollection();

export const rememberPendingResumeFileDelete = async (
  marker: Pick<PendingResumeFileDelete, "resumeId" | "deadline"> & {
    file: Pick<ResumeFileVersion, "path" | "size" | "uploaded_at">;
  },
): Promise<boolean> => {
  try {
    const [token, markerResumeToken] = await Promise.all([
      resumeFileDeleteMarkerToken(marker.resumeId, marker.file),
      resumeToken(marker.resumeId),
    ]);
    window.localStorage.setItem(
      markerStorageKey(token),
      JSON.stringify({
        token,
        resumeToken: markerResumeToken,
        deadline: marker.deadline,
      }),
    );
    notify();
    return true;
  } catch {
    return false;
  }
};

export const clearPendingResumeFileDelete = (token: string): void => {
  const timer = pendingResumeFileDeleteTimers.get(token);
  if (timer !== undefined) window.clearTimeout(timer);
  pendingResumeFileDeleteTimers.delete(token);
  try {
    window.localStorage.removeItem(markerStorageKey(token));
    window.localStorage.removeItem(`${markerStorageKey(token)}:claim`);
  } catch {
    // Continue clearing runtime state when storage is unavailable.
  }
  notify();
};

const hasMarker = (token: string): boolean =>
  readMarker(markerStorageKey(token))?.token === token;

const runWithCrossTabClaim = async (
  token: string,
  callback: () => Promise<void>,
): Promise<void> => {
  const lockManager = globalThis.navigator?.locks;
  if (lockManager) {
    await lockManager.request(`resume-file-delete:${token}`, async (lock) => {
      if (!lock || !hasMarker(token)) return;
      await callback();
    });
    return;
  }

  // Safari/older WebViews have no Web Locks. This marker claim is a fallback;
  // the read-back makes the winner explicit and the expiry lets a crashed tab
  // recover without losing the durable delete.
  const claimKey = `${markerStorageKey(token)}:claim`;
  const claim = JSON.stringify({
    owner: tabOwner,
    expires: Date.now() + 15_000,
  });
  try {
    const existing = (() => {
      try {
        return JSON.parse(window.localStorage.getItem(claimKey) ?? "null") as {
          owner?: string;
          expires?: number;
        } | null;
      } catch {
        return null;
      }
    })();
    if (
      existing?.expires &&
      existing.expires > Date.now() &&
      existing.owner !== tabOwner
    )
      return;
    window.localStorage.setItem(claimKey, claim);
    const won = window.localStorage.getItem(claimKey) === claim;
    if (won && hasMarker(token)) await callback();
  } finally {
    if (window.localStorage.getItem(claimKey) === claim) {
      window.localStorage.removeItem(claimKey);
    }
  }
};

export const schedulePendingResumeFileDelete = (
  marker: PendingResumeFileDelete,
  onExpire: () => Promise<void> | void,
): void => {
  const previous = pendingResumeFileDeleteTimers.get(marker.token);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(
    () => {
      pendingResumeFileDeleteTimers.delete(marker.token);
      void runWithCrossTabClaim(marker.token, async () => {
        await onExpire();
      });
    },
    Math.max(0, marker.deadline - Date.now()),
  );
  pendingResumeFileDeleteTimers.set(marker.token, timer);
};

export const hydratePendingResumeFileDeletes = async (
  resumeId: Identifier | undefined,
  files: readonly ResumeFileVersion[],
): Promise<void> => {
  if (resumeId == null) return;
  const currentResumeToken = await resumeToken(resumeId);
  const markers = readMarkerCollection();
  const resumeMarkers = markers.filter(
    (marker) => marker.resumeToken === currentResumeToken,
  );
  const matchedTokens = new Set<string>();
  let changed = false;
  for (const file of files) {
    const token = await resumeFileDeleteMarkerToken(resumeId, file);
    const marker = resumeMarkers.find((candidate) => candidate.token === token);
    if (!marker || marker.deadline <= Date.now()) {
      if (marker) {
        for (const [key, pending] of pendingResumeFileDeletes) {
          if (pending.token === marker.token) {
            pendingResumeFileDeletes.delete(key);
            changed = true;
          }
        }
        clearPendingResumeFileDelete(marker.token);
      }
      continue;
    }
    matchedTokens.add(token);
    const pending: PendingResumeFileDelete = {
      resumeId,
      file,
      deadline: marker.deadline,
      token,
      resumeToken: currentResumeToken,
    };
    const key = resumeFileDeleteKey(resumeId, file.path);
    const previous = pendingResumeFileDeletes.get(key);
    if (
      !previous ||
      previous.token !== pending.token ||
      previous.deadline !== pending.deadline
    ) {
      pendingResumeFileDeletes.set(key, pending);
      changed = true;
    }
  }
  for (const marker of resumeMarkers) {
    if (!matchedTokens.has(marker.token)) {
      for (const [key, pending] of pendingResumeFileDeletes) {
        if (pending.token === marker.token) {
          pendingResumeFileDeletes.delete(key);
          changed = true;
        }
      }
      clearPendingResumeFileDelete(marker.token);
    }
  }
  if (changed) notify();
};

export const usePendingResumeFileDeletes = (
  resumeId: Identifier | undefined,
  files: readonly ResumeFileVersion[],
): PendingResumeFileDelete[] => {
  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const fileSignature = useMemo(
    () =>
      files
        .map((file) => `${file.path}:${file.size}:${file.uploaded_at}`)
        .join("\u0001"),
    [files],
  );
  useEffect(() => {
    void hydratePendingResumeFileDeletes(resumeId, files);
  }, [fileSignature, files, resumeId, version]);
  return useMemo(() => {
    void version;
    return [...pendingResumeFileDeletes.values()].filter(
      (pending) => String(pending.resumeId) === String(resumeId),
    );
  }, [resumeId, version]);
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
  if (normalizedMimeType === "application/pdf" || /\.pdf$/i.test(filename))
    return "PDF";
  if (
    normalizedMimeType === "application/msword" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx?$/i.test(filename)
  )
    return "Word";
  if (
    normalizedMimeType.startsWith("image/") ||
    /\.(gif|jpe?g|png|webp|heic|heif)$/i.test(filename)
  )
    return "Photo";
  return "File";
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(markerKeyPrefix) === true) notify();
  });
}
