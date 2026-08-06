import { summarizeErrorForLog } from "./safeLog";

/**
 * Story 12.2 (Task 4): the ONE place in this repo that calls Resend. Before
 * this file existed nothing in the tree sent an outbound email at all —
 * `RESEND_API_KEY` was plumbed all the way to the cron Worker's own
 * wrangler.toml and never read.
 *
 * Coordination with Story 7.5 (unbuilt at the time this file was written):
 * that story's own Task 4 declares this SAME path for the same reason (its
 * `message_notifications` email channel needs an email transport too).
 * Whichever of the two lands first creates this file; the other consumes it
 * unchanged and adds no second wrapper — see this story's Dev Notes,
 * "Declared file set", F9.
 *
 * `sendEmail` never throws — a transport failure (fetch itself rejecting)
 * or a non-2xx response from Resend both reduce to `{ ok: false, error }`,
 * so a caller (sweepReminders.ts) can settle the offending
 * `task_notifications` row `'failed'` with the reason and continue the
 * batch, rather than losing every remaining claimed row to one bad send.
 * `error` is free text — safe to store on a row no client can ever read
 * (task_notifications' AC-8 posture: RLS enabled, no policy for
 * `authenticated` at all) — but it is NEVER passed to `console.error`
 * itself; every console line here routes through `summarizeErrorForLog`
 * (`.claude/rules/typescript.md`, `workers/shared/safeLog.ts`'s own
 * denylist), because a raw Resend error or a raw caught exception can echo
 * back request content this Worker must not log.
 *
 * The API key travels as a parameter, not a module-level read of `env` —
 * this file has no Cloudflare Worker binding of its own, so the caller
 * (which does) is the only place that can supply it.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Free-text detail truncated before it is ever stored, so one very long
 * (or adversarially long) provider response cannot bloat a row indefinitely
 * — this is a practical cap, not a security boundary (see this file's own
 * header on why the raw text is safe to store here at all). */
const MAX_STORED_ERROR_LENGTH = 500;

export interface SendEmailInput {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type SendEmailResult =
  { ok: true; id: string } | { ok: false; error: string };

function truncate(value: string): string {
  return value.length > MAX_STORED_ERROR_LENGTH
    ? `${value.slice(0, MAX_STORED_ERROR_LENGTH)}…`
    : value;
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  text,
}: SendEmailInput): Promise<SendEmailResult> {
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
  } catch (error) {
    console.error(
      "resend.sendEmail.transportError",
      summarizeErrorForLog(error),
    );
    return { ok: false, error: "transport error contacting Resend" };
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // No readable body — fall through with the status alone.
    }
    console.error("resend.sendEmail.httpError", { status: response.status });
    return {
      ok: false,
      error: truncate(
        bodyText
          ? `Resend responded ${response.status}: ${bodyText}`
          : `Resend responded ${response.status}`,
      ),
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    console.error(
      "resend.sendEmail.unparseableResponse",
      summarizeErrorForLog(error),
    );
    return { ok: false, error: "Resend response body was not valid JSON" };
  }

  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    console.error("resend.sendEmail.unexpectedShape", { dataType: typeof id });
    return { ok: false, error: "Resend response did not include an id" };
  }

  return { ok: true, id };
}
