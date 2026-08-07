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
  /**
   * Epic 12 review fix (R4): Resend's own `Idempotency-Key` request header.
   * The caller (sweepReminders.ts) derives this from the reminder's own
   * natural key — (task_id, channel, due_date), the SAME tuple
   * task_notifications' unique constraint uses (01_tables.sql) — so a row
   * reclaimed after a stranded 'sending' lease (claim_due_task_notifications
   * ()'s recovery path, 02_functions.sql) resends through the identical
   * provider request identity instead of a second, distinct email. This is
   * what makes reminder delivery honestly "at-least-once, deduplicated by
   * Resend" rather than "exactly once" — see sweepReminders.ts's own header
   * for why no comment in this codebase should claim the latter. Omitted
   * (undefined) sends no header at all, so a caller that has no natural key
   * to offer degrades to plain at-least-once with no dedupe.
   */
  idempotencyKey?: string;
}

export type SendEmailResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      /**
       * Epic 12 review fix (R2): retryable-vs-terminal classification.
       * `true` for a transport failure or a 429/5xx response — nothing about
       * the recipient or the message is known to be wrong, so the SAME
       * attempt might succeed later. `false` for every other non-2xx
       * response (400/401/403/404/422 and friends) — Resend rejected this
       * exact request and will reject it identically on every future
       * attempt, so retrying is not a recovery, it's a guaranteed repeat.
       * sweepReminders.ts is what turns this into a `task_notifications`
       * 'pending' (re-armed) or terminal 'failed' row.
       */
      retryable: boolean;
    };

function truncate(value: string): string {
  return value.length > MAX_STORED_ERROR_LENGTH
    ? `${value.slice(0, MAX_STORED_ERROR_LENGTH)}…`
    : value;
}

/** R2: 429 (rate limited) and every 5xx (Resend's own failure) are
 * retryable — nothing here says the request itself was wrong. Every other
 * non-2xx status is a terminal rejection of THIS request. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  text,
  idempotencyKey,
}: SendEmailInput): Promise<SendEmailResult> {
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
  } catch (error) {
    console.error(
      "resend.sendEmail.transportError",
      summarizeErrorForLog(error),
    );
    // R2: a transport failure (fetch itself rejecting — DNS, network, TLS)
    // says nothing about this request being wrong; it is always retryable.
    return {
      ok: false,
      error: "transport error contacting Resend",
      retryable: true,
    };
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
      retryable: isRetryableStatus(response.status),
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
    // R2: a 2xx response with an unparseable body is Resend's contract
    // breaking, not this request being wrong — treated as retryable rather
    // than silently dropping a send that may have actually gone through.
    return {
      ok: false,
      error: "Resend response body was not valid JSON",
      retryable: true,
    };
  }

  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    console.error("resend.sendEmail.unexpectedShape", { dataType: typeof id });
    return {
      ok: false,
      error: "Resend response did not include an id",
      retryable: true,
    };
  }

  return { ok: true, id };
}
