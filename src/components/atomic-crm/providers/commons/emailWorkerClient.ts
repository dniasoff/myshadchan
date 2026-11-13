import { getSupabaseClient } from "../supabase/supabase";

export type EmailWorkerResponse = {
  status: "accepted";
};

export type EmailWorkerConfig = {
  replyTo: string;
};

export type EmailWorkerErrorCode =
  | "rate_limited"
  | "rejected"
  | "prepare_failed"
  | "no_email"
  | "too_large"
  | "unavailable"
  | "ambiguous";

export class EmailWorkerError extends Error {
  readonly status: number;
  readonly code: EmailWorkerErrorCode;

  constructor(message: string, status: number, code: EmailWorkerErrorCode) {
    super(message);
    this.name = "EmailWorkerError";
    this.status = status;
    this.code = code;
  }
}

function codeFor(status: number, value: unknown): EmailWorkerErrorCode {
  if (
    value === "rate_limited" ||
    value === "rejected" ||
    value === "prepare_failed" ||
    value === "no_email" ||
    value === "too_large" ||
    value === "unavailable" ||
    value === "ambiguous"
  ) {
    return value;
  }
  if (status === 429) return "rate_limited";
  if (status === 422) return "rejected";
  if (status === 503) return "unavailable";
  if (status === 400 || status === 401 || status === 403) {
    return "unavailable";
  }
  return "ambiguous";
}

/** The only browser call surface for the authenticated outbound-email Worker. */
export async function callEmailWorker(
  url: string,
  body: unknown,
): Promise<EmailWorkerResponse> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new EmailWorkerError("Not authenticated", 401, "unavailable");
  }

  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EmailWorkerError(
      "Email result could not be confirmed",
      0,
      "ambiguous",
    );
  }

  let envelope: {
    success: boolean;
    data?: EmailWorkerResponse;
    error?: string;
    meta?: { code?: unknown };
  };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    throw new EmailWorkerError(
      "Email result could not be confirmed",
      response.status,
      "ambiguous",
    );
  }
  if (!response.ok || !envelope.success) {
    throw new EmailWorkerError(
      envelope.error ?? "Email request failed",
      response.status,
      codeFor(response.status, envelope.meta?.code),
    );
  }
  if (envelope.data?.status !== "accepted") {
    throw new EmailWorkerError(
      "Email result could not be confirmed",
      response.status,
      "ambiguous",
    );
  }
  return envelope.data;
}

/** Read the server's resolved Reply-To so the review dialog cannot display a
 * build-time address that differs from the Worker secret. */
export async function readEmailWorkerConfig(
  url: string,
): Promise<EmailWorkerConfig> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new EmailWorkerError("Not authenticated", 401, "unavailable");
  }

  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}/config`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch {
    throw new EmailWorkerError(
      "Email configuration could not be confirmed",
      0,
      "unavailable",
    );
  }

  let envelope: {
    success: boolean;
    data?: { reply_to?: unknown };
    error?: string;
    meta?: { code?: unknown };
  };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    throw new EmailWorkerError(
      "Email configuration could not be confirmed",
      response.status,
      "unavailable",
    );
  }
  const replyTo = envelope.data?.reply_to;
  if (
    !response.ok ||
    !envelope.success ||
    typeof replyTo !== "string" ||
    replyTo.trim() === ""
  ) {
    throw new EmailWorkerError(
      envelope.error ?? "Email configuration is unavailable",
      response.status,
      codeFor(response.status, envelope.meta?.code),
    );
  }
  return { replyTo: replyTo.trim() };
}
