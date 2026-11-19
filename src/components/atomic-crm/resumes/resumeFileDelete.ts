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
const FALLBACK_CLAIM_LEASE_MS = 60_000;
const FALLBACK_CLAIM_RENEW_MS = 5_000;
const FALLBACK_CLAIM_DB_NAME = "myshadchan:resume-file-delete-claims";
const FALLBACK_CLAIM_STORE_NAME = "claims";

/** Runtime details for the currently visible Resume tab. */
export const pendingResumeFileDeletes = new Map<
  string,
  PendingResumeFileDelete
>();

const pendingResumeFileDeleteTimers = new Map<string, number>();
type FinalizationState = {
  deadline: number;
  status: "in_flight" | "completed";
};

type FinalizationRetry = {
  deadline: number;
  timer: number;
};

// The marker is durable across reloads, while this state prevents the same
// page from re-invoking the provider when several Resume-tab effects observe
// the same expired marker. A new deadline represents a new user action.
const finalizationStates = new Map<string, FinalizationState>();
const finalizationRetries = new Map<string, FinalizationRetry>();
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
  removePendingResumeFileDeleteRuntimeState(token);
  try {
    window.localStorage.removeItem(markerStorageKey(token));
    window.localStorage.removeItem(`${markerStorageKey(token)}:claim`);
  } catch {
    // Continue clearing runtime state when storage is unavailable.
  }
  notify();
};

const removePendingResumeFileDeleteRuntimeState = (token: string): boolean => {
  let changed = false;
  for (const [key, pending] of pendingResumeFileDeletes) {
    if (pending.token === token) {
      pendingResumeFileDeletes.delete(key);
      changed = true;
    }
  }
  const timer = pendingResumeFileDeleteTimers.get(token);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingResumeFileDeleteTimers.delete(token);
    changed = true;
  }
  const retry = finalizationRetries.get(token);
  if (retry !== undefined) {
    window.clearTimeout(retry.timer);
    finalizationRetries.delete(token);
    changed = true;
  }
  if (finalizationStates.delete(token)) changed = true;
  return changed;
};

const hasMarker = (token: string): boolean =>
  readMarker(markerStorageKey(token))?.token === token;

type FallbackClaim = {
  mode: "indexeddb" | "localstorage";
  claimKey: string;
  release: () => Promise<void>;
  renew: () => Promise<void>;
};

type IndexedDbClaimRecord = {
  token: string;
  owner: string;
  expires: number;
};

let fallbackClaimDb: Promise<IDBDatabase | null> | null = null;

const openFallbackClaimDb = (): Promise<IDBDatabase | null> => {
  if (fallbackClaimDb) return fallbackClaimDb;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  fallbackClaimDb = new Promise((resolve) => {
    try {
      const request = indexedDB.open(FALLBACK_CLAIM_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(FALLBACK_CLAIM_STORE_NAME, {
          keyPath: "token",
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return fallbackClaimDb;
};

const runIndexedDbClaim = async (
  token: string,
): Promise<FallbackClaim | "claimed_elsewhere" | "missing" | null> => {
  const db = await openFallbackClaimDb();
  if (!db) return null;
  const won = await new Promise<boolean>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(FALLBACK_CLAIM_STORE_NAME, "readwrite");
      const store = transaction.objectStore(FALLBACK_CLAIM_STORE_NAME);
      const get = store.get(token);
      let shouldClaim = false;
      get.onsuccess = () => {
        const existing = get.result as IndexedDbClaimRecord | undefined;
        shouldClaim =
          existing == null ||
          existing.expires <= Date.now() ||
          existing.owner === tabOwner;
        if (shouldClaim) {
          store.put({
            token,
            owner: tabOwner,
            expires: Date.now() + FALLBACK_CLAIM_LEASE_MS,
          } satisfies IndexedDbClaimRecord);
        }
      };
      transaction.oncomplete = () => resolve(shouldClaim);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    } catch (error) {
      reject(error);
    }
  }).catch(() => null);
  if (won === null) return null;
  if (!won) return "claimed_elsewhere";
  if (!hasMarker(token)) {
    await releaseIndexedDbClaim(db, token);
    return "missing";
  }
  return {
    mode: "indexeddb",
    claimKey: token,
    release: () => releaseIndexedDbClaim(db, token),
    renew: () => renewIndexedDbClaim(db, token),
  };
};

const releaseIndexedDbClaim = async (
  db: IDBDatabase,
  token: string,
): Promise<void> => {
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(
        FALLBACK_CLAIM_STORE_NAME,
        "readwrite",
      );
      const store = transaction.objectStore(FALLBACK_CLAIM_STORE_NAME);
      const get = store.get(token);
      get.onsuccess = () => {
        const existing = get.result as IndexedDbClaimRecord | undefined;
        if (existing?.owner === tabOwner) store.delete(token);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

const renewIndexedDbClaim = async (
  db: IDBDatabase,
  token: string,
): Promise<void> => {
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(
        FALLBACK_CLAIM_STORE_NAME,
        "readwrite",
      );
      const store = transaction.objectStore(FALLBACK_CLAIM_STORE_NAME);
      const get = store.get(token);
      get.onsuccess = () => {
        const existing = get.result as IndexedDbClaimRecord | undefined;
        if (existing?.owner === tabOwner) {
          store.put({
            ...existing,
            expires: Date.now() + FALLBACK_CLAIM_LEASE_MS,
          });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

const runLocalStorageClaim = async (
  token: string,
): Promise<FallbackClaim | "claimed_elsewhere" | "missing"> => {
  const claimKey = `${markerStorageKey(token)}:claim`;
  let claim = JSON.stringify({
    owner: tabOwner,
    expires: Date.now() + FALLBACK_CLAIM_LEASE_MS,
  });
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
  if (existing?.expires && existing.expires > Date.now()) {
    return "claimed_elsewhere";
  }
  window.localStorage.setItem(claimKey, claim);
  const won = window.localStorage.getItem(claimKey) === claim;
  if (!won) return hasMarker(token) ? "claimed_elsewhere" : "missing";
  if (!hasMarker(token)) {
    window.localStorage.removeItem(claimKey);
    return "missing";
  }
  return {
    mode: "localstorage",
    claimKey,
    release: async () => {
      if (window.localStorage.getItem(claimKey) === claim) {
        window.localStorage.removeItem(claimKey);
      }
    },
    renew: async () => {
      if (window.localStorage.getItem(claimKey) !== claim) return;
      claim = JSON.stringify({
        owner: tabOwner,
        expires: Date.now() + FALLBACK_CLAIM_LEASE_MS,
      });
      window.localStorage.setItem(claimKey, claim);
    },
  };
};

const runWithCrossTabClaim = async (
  token: string,
  callback: () => Promise<void>,
): Promise<"executed" | "missing" | "claimed_elsewhere"> => {
  const lockManager = globalThis.navigator?.locks;
  if (lockManager) {
    let result: "executed" | "missing" = "missing";
    await lockManager.request(`resume-file-delete:${token}`, async (lock) => {
      if (!lock || !hasMarker(token)) return;
      result = "executed";
      await callback();
    });
    return result;
  }

  // Safari/older WebViews have no Web Locks. IndexedDB read/write
  // transactions supply the compare-and-swap that localStorage lacks, while
  // the lease still lets a crashed tab's durable delete recover.
  const claim =
    (await runIndexedDbClaim(token)) ?? (await runLocalStorageClaim(token));
  if (claim === "claimed_elsewhere" || claim === "missing") return claim;
  const renew = window.setInterval(() => {
    void claim.renew();
  }, FALLBACK_CLAIM_RENEW_MS);
  try {
    await callback();
  } finally {
    window.clearInterval(renew);
    await claim.release();
  }
  return "executed";
};

const retryAfterClaimLease = (
  marker: PendingResumeFileDelete,
  onExpire: () => Promise<void> | void,
): void => {
  const existing = finalizationRetries.get(marker.token);
  if (existing?.deadline === marker.deadline) return;
  if (existing !== undefined) window.clearTimeout(existing.timer);
  const timer = window.setTimeout(() => {
    finalizationRetries.delete(marker.token);
    schedulePendingResumeFileDelete(marker, onExpire);
  }, FALLBACK_CLAIM_LEASE_MS + 100);
  finalizationRetries.set(marker.token, { deadline: marker.deadline, timer });
};

export const schedulePendingResumeFileDelete = (
  marker: PendingResumeFileDelete,
  onExpire: () => Promise<void> | void,
): void => {
  const state = finalizationStates.get(marker.token);
  if (state?.deadline === marker.deadline) return;
  if (state !== undefined) finalizationStates.delete(marker.token);

  const retry = finalizationRetries.get(marker.token);
  if (retry?.deadline === marker.deadline) return;
  if (retry !== undefined) {
    window.clearTimeout(retry.timer);
    finalizationRetries.delete(marker.token);
  }

  const previous = pendingResumeFileDeleteTimers.get(marker.token);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(
    () => {
      pendingResumeFileDeleteTimers.delete(marker.token);
      const current = finalizationStates.get(marker.token);
      if (current?.deadline === marker.deadline) return;
      finalizationStates.set(marker.token, {
        deadline: marker.deadline,
        status: "in_flight",
      });
      void runWithCrossTabClaim(marker.token, async () => {
        await onExpire();
      })
        .then((result) => {
          if (result === "claimed_elsewhere") {
            finalizationStates.delete(marker.token);
            retryAfterClaimLease(marker, onExpire);
            return;
          }
          finalizationStates.set(marker.token, {
            deadline: marker.deadline,
            status: "completed",
          });
        })
        .catch(() => {
          // The callback owns the user-facing transport error and clears the
          // marker. Do not hot-retry a failed provider call in this page.
          finalizationStates.set(marker.token, {
            deadline: marker.deadline,
            status: "completed",
          });
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
  const durableTokens = new Set(resumeMarkers.map((marker) => marker.token));
  for (const [key, pending] of pendingResumeFileDeletes) {
    if (
      String(pending.resumeId) === String(resumeId) &&
      !durableTokens.has(pending.token)
    ) {
      pendingResumeFileDeletes.delete(key);
      removePendingResumeFileDeleteRuntimeState(pending.token);
      changed = true;
    }
  }
  for (const file of files) {
    const token = await resumeFileDeleteMarkerToken(resumeId, file);
    const marker = resumeMarkers.find((candidate) => candidate.token === token);
    if (!marker) {
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
    const key = resumeFileDeleteKey(resumeId, file);
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
      if (removePendingResumeFileDeleteRuntimeState(marker.token)) {
        changed = true;
      }
      try {
        window.localStorage.removeItem(markerStorageKey(marker.token));
        window.localStorage.removeItem(
          `${markerStorageKey(marker.token)}:claim`,
        );
      } catch {
        // Continue clearing stale runtime state when storage is unavailable.
      }
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
  file: Pick<ResumeFileVersion, "path" | "size" | "uploaded_at">,
): string {
  return (
    String(resumeId) +
    "\u0000" +
    file.path +
    "\u0000" +
    String(file.size) +
    "\u0000" +
    file.uploaded_at
  );
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
    if (!event.key?.startsWith(markerKeyPrefix) || event.key.endsWith(":claim"))
      return;
    if (event.newValue === null) {
      removePendingResumeFileDeleteRuntimeState(
        event.key.slice(markerKeyPrefix.length),
      );
    }
    notify();
  });
}
