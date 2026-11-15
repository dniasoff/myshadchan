import { getSupabaseClient } from "../supabase/supabase";
import type { Identifier } from "ra-core";

export type ResumeRereadParams = {
  resumeId: Identifier;
  requestId: string;
};

export type ResumeRereadOutcome =
  "completed" | "no_allowance" | "already_reading" | "failed";

/**
 * The browser boundary for the already-deployed resume re-read route.
 *
 * The Worker deliberately returns more detail than the Resume tab should
 * expose. Reduce it here to the small, static outcome vocabulary the UI can
 * safely render; no server error text, account id, path or resume content
 * crosses this boundary.
 */
export async function requestResumeReread(
  url: string,
  params: ResumeRereadParams,
): Promise<ResumeRereadOutcome> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();
  if (sessionError || !session?.access_token) return "failed";

  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resume_id: Number(params.resumeId),
        request_id: params.requestId,
      }),
    });
  } catch {
    return "failed";
  }

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

  if (response.ok && envelope.success === true) return "completed";
  if (response.status === 402) return "no_allowance";
  if (envelope.meta?.code === "already_reading") return "already_reading";
  return "failed";
}
