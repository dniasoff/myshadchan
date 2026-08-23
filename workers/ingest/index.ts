import { createWorkerApp } from "../shared/createApp";
import {
  createRateLimitMiddleware,
  INGEST_IP_RATE_LIMIT,
} from "../shared/rateLimit";
import { deriveIpKey } from "../shared/callerIdentity";
import { forAccount } from "../shared/forAccount";
import type { BaseEnv } from "../shared/env";
import { buildInboxItemRow } from "./buildInboxItemRow";
import { classifySender } from "./classifySender";
import { extractOriginalSender } from "./forwardedSender";
import { parseEmail } from "./parseEmail";
import {
  claimDemoIngest,
  heartbeatDemoIngest,
  releaseDemoIngest,
  resolveAccountId,
} from "./resolveAccount";
import { removeUploadedAttachments, uploadAttachments } from "./attachments";

// E6 (Unified Inbox + channels) lands here — AD-6, AD-7. Every inbound
// channel creates an unfiled inbox_item and never writes straight to a
// suggestion.
type IngestEnv = BaseEnv & {
  RATE_LIMITING_ENFORCED?: string;
  INGEST_IP_RATE_LIMITER?: RateLimit;
};
const app = createWorkerApp<IngestEnv>("ingest");

/**
 * Middleware order (Story 15.4 / AD-17):
 * 1. CORS (handled by createWorkerApp -> securityHeaders)
 * 2. IP-scoped rate limiter (pre-auth backstop)
 * 3. Account resolution (via message.to in email handler)
 * 4. Caller-scoped rate limiter (post-auth backstop, per-account)
 * 5. Route handlers
 *
 * Note: The email() handler is the entry point, not fetch(). The fetch()
 * handler only serves /health. Rate limiting on the email path is applied
 * by wrapping handleInboundEmail with the limiters.
 */

// IP-scoped limiter: applies to all requests (including /health bypass)
app.use(
  "*",
  createRateLimitMiddleware<{ Bindings: IngestEnv }>({
    limiterName: "ingest-ip",
    config: INGEST_IP_RATE_LIMIT,
    getBinding: (env) => env.INGEST_IP_RATE_LIMITER,
    deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
    workerName: "ingest",
    surface: "ingest",
  }),
);

/**
 * The inbound-email pipeline, extracted so tests can call it directly — the
 * `email()` export below is the only production entry point and is a thin
 * try/catch wrapper around this (see that function's own doc comment for
 * why the wrapping is a separate layer).
 *
 * TENANCY (do not soften any of this):
 *   - The account is resolved ONLY from `message.to` (the recipient's
 *     token address) — never from the sender, never from body content
 *     (`resolveAccount.ts`). The retired Postmark path's F5 finding was
 *     exactly the failure mode of deriving account attribution from
 *     something other than a trusted, server-owned value.
 *   - Every tenant-table write goes through `forAccount(accountId, env)` so
 *     account_id is injected and asserted, never passed by hand (AD-7).
 *   - An unknown SENDER is classified, never gated: the email is stored
 *     either way, only its `status` differs (`buildInboxItemRow.ts`).
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: IngestEnv,
): Promise<void> {
  const accountId = await resolveAccountId(message.to, env);
  if (accountId === null) {
    // The one address-shaped rejection this feature's design permits —
    // every address that isn't a real household's inbound token. Never a
    // bounce for an unknown SENDER, only for an unresolvable recipient.
    message.setReject(`No MyShadchan household for recipient ${message.to}`);
    return;
  }

  // Claim before reading message.raw. Every ordinary account is admitted only
  // through this durable claim; every unfinished demo phase is rejected here.
  const ingestClaim = await claimDemoIngest(accountId, env);
  if (ingestClaim.outcome === "blocked") {
    message.setReject("Simulated demo inbound mail is not accepted");
    return;
  }

  const claim = ingestClaim.claim;
  let uploadedPaths: string[] = [];
  let committed = false;

  try {
    if (claim) await heartbeatDemoIngest(claim, env);

    const parsed = await parseEmail(message.raw);
    // `message.from` (the SMTP envelope sender) is always present at the
    // Worker layer; `parsed.fromEmail` (the parsed From: header) is preferred
    // when available since it is what a human reads as "who sent this".
    const fromEmail = parsed.fromEmail ?? message.from;

    const classification = await classifySender(fromEmail, accountId, env);

    if (claim) await heartbeatDemoIngest(claim, env);
    const attachments = await uploadAttachments(
      parsed.attachments,
      accountId,
      env,
    );
    uploadedPaths = attachments.map((attachment) => attachment.path);

    // FR24: recover the original sender from a forwarded body. Run on the
    // full parsed text — the body is stored verbatim, never stripped
    // (buildInboxItemRow.ts's own doc comment).
    let originalSender = extractOriginalSender(parsed.text ?? "");
    // A self-referential "From:" (the sender forwarded their own earlier
    // message) is not useful attribution and must not be shown as confident
    // recovery. Lowercased on both sides for this JS-side comparison only —
    // unlike every DB lookup above, this never touches a citext column, so
    // there is no database-side case-insensitivity to rely on here.
    if (
      originalSender.email &&
      originalSender.email === fromEmail.toLowerCase()
    ) {
      originalSender = { name: null, email: null, needsConfirmation: true };
    }

    const row = buildInboxItemRow({
      textBody: parsed.text ?? parsed.html ?? null,
      subject: parsed.subject,
      originalSender,
      // The envelope sender, NOT `originalSender` above — this is what
      // classifySender() just checked, and what the Needs-review tab's
      // Trust-sender action needs a real address to write to and compare
      // against (see `buildInboxItemRow.ts`'s own doc comment).
      senderEmail: fromEmail,
      attachments,
      classification,
    });

    // Spread into a fresh literal: `row`'s named `InboxItemRow` type has no
    // index signature, which `ScopedTable.insert()`'s `Record<string, unknown>`
    // parameter requires — TypeScript only recognises a fresh object literal
    // (not a typed variable) as satisfying that shape.
    if (claim) await heartbeatDemoIngest(claim, env);
    const { error } = await forAccount(String(accountId), env)
      .from("inbox_items")
      .insert({ ...row });
    if (error) {
      throw new Error(`Failed to file inbox item: ${error.message}`);
    }
    committed = true;
  } finally {
    if (!committed && uploadedPaths.length > 0) {
      try {
        await removeUploadedAttachments(uploadedPaths, env);
      } catch (error) {
        // The clear-side prefix sweep is the durable backstop if compensation
        // is unavailable; keep the original worker failure visible.
        console.error("ingest.attachmentCompensation.error", error);
      }
    }
    if (claim) {
      try {
        await releaseDemoIngest(claim, env);
      } catch (error) {
        // The bounded claim expiry is the recovery path if the release RPC
        // itself is unavailable; never turn a committed inbox row into a
        // duplicate by retrying the whole email here.
        console.error("ingest.demoClaimRelease.finally", error);
      }
    }
  }
}

export default {
  fetch: app.fetch,
  async email(
    message: ForwardableEmailMessage,
    env: IngestEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await handleInboundEmail(message, env);
    } catch (error) {
      // Cloudflare does not document uncaught-exception behaviour for
      // email() — community reports suggest retry-then-fail, so relying on
      // it risks silently losing a customer's email, the exact failure mode
      // this feature exists to move away from. Any failure here (storage,
      // DB, parse, or the account/attachment lookups above) rejects
      // explicitly instead.
      console.error("ingest.email.error", error);
      message.setReject("Could not process this email");
    }
  },
};
