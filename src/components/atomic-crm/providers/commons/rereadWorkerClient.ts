import { getSupabaseClient } from "../supabase/supabase";
import type { Identifier } from "ra-core";

export const REREAD_REQUEST_TIMEOUT_MS = 90_000;

export type ResumeRereadParams = {
  resumeId: Identifier;
  requestId: string;
  /** The file version the caller deliberately confirmed. */
  fileIdentity?: string;
  mode?: "reread";
  /** The control aborts this signal if its row unmounts. */
  signal?: AbortSignal;
};

export type ResumeReadParams = Omit<
  ResumeRereadParams,
  "mode" | "fileIdentity"
> & {
  mode: "fill_empty";
  fileIdentity: string;
};

export type ResumeReadOutcome =
  | "completed"
  | "empty"
  | "no_allowance"
  | "not_entitled"
  | "already_reading"
  | "stale_file"
  | "timeout"
  | "failed";

export type ResumeRereadOutcome = Extract<
  ResumeReadOutcome,
  | "completed"
  | "no_allowance"
  | "not_entitled"
  | "already_reading"
  | "failed"
  | "timeout"
>;

/**
 * The browser boundary for the already-deployed resume re-read route.
 *
 * The Worker deliberately returns more detail than the Resume tab should
 * expose. Reduce it here to the small, static outcome vocabulary the UI can
 * safely render; no server error text, account id, path or resume content
 * crosses this boundary.
 */
export async function requestResumeRead(
  url: string,
  params: ResumeReadParams | ResumeRereadParams,
): Promise<ResumeReadOutcome> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();
  if (sessionError || !session?.access_token) return "failed";

  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  if (params.signal?.aborted) {
    requestController.abort();
  } else {
    params.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(
    () => requestController.abort(),
    REREAD_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      signal: requestController.signal,
      body: JSON.stringify({
        resume_id: Number(params.resumeId),
        request_id: params.requestId,
        ...(params.mode === "fill_empty"
          ? { mode: params.mode, file_identity: params.fileIdentity }
          : params.fileIdentity
            ? { file_identity: params.fileIdentity }
            : {}),
      }),
    });
    let envelope: {
      success?: unknown;
      data?: unknown;
      meta?: { code?: unknown };
    };
    try {
      envelope = (await response.json()) as typeof envelope;
    } catch {
      return "failed";
    }

    if (response.ok && envelope.success === true) {
      return envelope.data &&
        typeof envelope.data === "object" &&
        !Array.isArray(envelope.data) &&
        (envelope.data as { empty?: unknown }).empty === true
        ? "empty"
        : "completed";
    }
    if (response.status === 402) {
      return envelope.meta?.code === "not_entitled"
        ? "not_entitled"
        : "no_allowance";
    }
    if (envelope.meta?.code === "already_reading") return "already_reading";
    if (envelope.meta?.code === "stale_file") return "stale_file";
    if (envelope.meta?.code === "timeout") return "timeout";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function requestResumeReread(
  url: string,
  params: ResumeRereadParams,
): Promise<ResumeRereadOutcome> {
  const outcome = await requestResumeRead(url, params);
  if (outcome === "stale_file") return "failed";
  return outcome === "empty" ? "completed" : outcome;
}
