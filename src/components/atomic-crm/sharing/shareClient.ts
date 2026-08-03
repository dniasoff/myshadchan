export interface SharedProfileFile {
  fileKey: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  /** A same-origin-to-the-Worker PATH (`/r/:token/file/:fileKey`) — never a
   * raw or signed Storage URL (AC-3, AC-4). Resolve to a fetchable URL with
   * `resolveShareFileUrl` below; never construct a Storage path yourself. */
  downloadUrl: string;
}

export interface SharedProfileData {
  single: {
    first_name_en: string | null;
    first_name_he: string | null;
  };
  files: SharedProfileFile[];
}

interface ShareEnvelope {
  success: boolean;
  data?: SharedProfileData;
  error?: string;
}

/**
 * The `share/` Worker's own deployed origin. `vite.config.ts`'s `define`
 * block is the only channel this reaches a production build through (see
 * that file's own comment — the same landmine `VITE_VAPID_PUBLIC_KEY`
 * already named for Story 7.5). Read at CALL time, not module-load time, so
 * `loadSharedProfile`/`resolveShareFileUrl` below stay testable via their
 * own `baseUrl` parameter without needing `vi.stubEnv` + module reset.
 */
export function getShareWorkerUrl(): string {
  const url = import.meta.env.VITE_SHARE_WORKER_URL as string | undefined;
  if (!url) {
    throw new Error("Share Worker URL is not configured");
  }
  return url;
}

/**
 * Loads a shared profile through the `share/` Worker's `GET /r/:token` —
 * never Supabase directly (`share_links`/`share_access_log` are never
 * anon-reachable, AC-10). Mirrors the retired token-portal's own client
 * loader (deleted, Epic 1 Story 1.4 — read it from git history)
 * null-for-not-found shape: a 404 (unknown, revoked, or expired token —
 * AC-7's no-oracle rule) resolves to `null`, the "inactive link" case. A
 * genuine transport/config error throws, so a misconfigured deploy fails
 * loudly in logs/monitoring rather than silently looking identical to
 * "link inactive" everywhere except there — `SharedProfilePage` still
 * renders the same calm inactive notice for both, per AC-7's no-oracle
 * rule.
 */
export const loadSharedProfile = async (
  token: string,
  baseUrl: string = getShareWorkerUrl(),
): Promise<SharedProfileData | null> => {
  const response = await fetch(`${baseUrl}/r/${encodeURIComponent(token)}`);

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load the shared profile (${response.status})`);
  }

  const body = (await response.json()) as ShareEnvelope;
  if (!body.success || !body.data) {
    return null;
  }
  return body.data;
};

/**
 * The one place a `downloadUrl` from the manifest is turned into something
 * the browser can actually fetch/navigate to — always the Worker's own
 * origin plus the opaque path the manifest already gave (AC-13: the client
 * never constructs or guesses a storage path itself, only follows the one
 * the server handed it).
 */
export const resolveShareFileUrl = (
  downloadUrl: string,
  baseUrl: string = getShareWorkerUrl(),
): string => `${baseUrl}${downloadUrl}`;
