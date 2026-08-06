import { z } from "zod";
import { createWorkerApp } from "../shared/createApp";
import { fail, ok } from "../shared/envelope";
import { summarizeErrorForLog } from "../shared/safeLog";
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  findResumeAttachment,
  splitStoragePath,
} from "./inboxAttachment";
import {
  exceedsMaxImagePixels,
  readImageDimensions,
} from "./imageDimensionGuard";
import { confirmParseAttempt } from "./parseQuota";
import { releaseParseAttempt } from "./parseQuotaRecovery";
import { resolveParseClaim } from "./resolveParseClaim";
import { resolveConfirmOutcome } from "./resolveConfirmOutcome";
import { registerParseMiddleware } from "./registerParseMiddleware";
import type { ParseApp, ParseContext } from "./parseAppTypes";
import {
  CURRENT_PARSE_RESULT_SCHEMA_VERSION,
  type ParseResultPayload,
} from "./parseResultPayload";
import { toDraft } from "./parsedResumeDraft";
import {
  ExtractorTimeoutError,
  geminiExtractor,
  type ParseEnv,
  type ResumeExtractor,
} from "./resumeExtractor";

const ParseBodySchema = z.object({
  inbox_item_id: z.number(),
});

// The HTTP statuses a post-claim failure can return — narrowed (rather than
// a bare `number`) so `releaseAndFail` stays assignable to Hono's
// `ContentfulStatusCode`.
type ReleaseFailureStatus = 413 | 422 | 502;

/**
 * Release a held reservation and return its documented failure envelope.
 * Every post-claim failure branch (oversized attachment, download failure,
 * extractor throw) goes through this, so the account is never left charged
 * for a parse it never received (Findings 6/7).
 *
 * `generation` (review Finding C2) must be the value `claimParseAttempt()`
 * returned for this attempt — see `parseQuota.ts`'s `releaseParseAttempt()`
 * for why.
 *
 * Finding 10 closure: `releaseParseAttempt()` now returns a real outcome
 * instead of a fire-and-forget `void`. A `"failed"` outcome means the
 * charge was NOT given back — logged loudly here (never swallowed) so an
 * operator can see it, even though the caller still receives the original
 * failure regardless: `claim_ai_parse_attempt()`'s own opportunistic reaper
 * (`02_functions.sql`) self-heals a permanently stuck reservation the next
 * time this account calls `/parse` at all.
 */
async function releaseAndFail(
  c: ParseContext,
  accountId: number,
  attemptId: number,
  generation: number,
  message: string,
  status: ReleaseFailureStatus,
  traceOutcome: string,
) {
  c.set("traceOutcome", traceOutcome);
  const releaseOutcome = await releaseParseAttempt(
    c.env,
    accountId,
    attemptId,
    generation,
  );
  if (releaseOutcome.outcome === "failed") {
    console.error("parse.release.exhausted", {
      accountId,
      attemptId,
      generation,
    });
  }
  return c.json(fail(message), status);
}

/**
 * Build the parse worker app. The optional `extractor` parameter lets tests
 * inject a fake; production uses `geminiExtractor(env)`.
 *
 * Middleware registration order (CORS -> tracing -> IP rate limit ->
 * entitlement gate -> caller rate limit) is load-bearing (Findings 1/16) —
 * see `registerParseMiddleware.ts` for why each position matters and
 * `index.middlewareOrder.test.ts` for the regression coverage.
 */
export function createParseApp(extractor?: ResumeExtractor): ParseApp {
  // E5/E11 (resume auto-parse) land here — AD-6, AD-8, AD-12.
  const app = createWorkerApp("parse") as unknown as ParseApp;
  registerParseMiddleware(app);

  /**
   * POST /parse — read the resume attached to an inbox item, run it through
   * the extractor, and return a validated, nullable draft. The original
   * capture is never modified.
   *
   * Findings 6/7/8/9/10/12 (Epic 11 adversarial review, second pass):
   * `claim_ai_parse_attempt()` (`resolveParseClaim.ts` / `parseQuota.ts`) is
   * the SOLE authority on the monthly `ai_usage` cap and on idempotency —
   * there is deliberately no cap pre-check anywhere in this route. One used
   * to run ahead of the atomic claim, but the RPC's own "replay" and
   * stale-in_progress-reclaim branches both return before its cap check is
   * ever consulted — they already succeed at ANY usage level, cap included
   * — so a pre-check's only observable effect was to unconditionally refuse
   * BOTH of those free-cost paths before they ever reached the RPC designed
   * to serve them for free (see `resolveParseClaim.ts`'s own header for the
   * full argument, and `index.idempotency.test.ts` for the regression
   * proof). `resolveParseClaim()` and `resolveConfirmOutcome()` carry the
   * rest of Findings 6/7/8/9/10/12's detail in their own header comments —
   * this route only maps their decisions to an HTTP response.
   *
   * If the claim machinery itself errors for any reason (database down,
   * permission denied, network) the route returns 503 and performs no
   * download, no inference, and writes nothing further — fail-closed, never
   * a silent fallback to unmetered access (Finding 16).
   *
   * Review fix (Finding 9): the attachment's MIME type is checked against an
   * explicit allowlist (`inboxAttachment.ts`) and its size is checked BEFORE
   * download via storage `list()` metadata, with a post-download backstop in
   * case that metadata is ever unavailable.
   *
   * Review fix (Finding 19): once downloaded, a PNG/JPEG/WebP attachment's
   * pixel dimensions are also checked (`imageDimensionGuard.ts`) so a small,
   * highly compressed decompression-bomb-shaped image can't reach the
   * extractor just because it slipped under the byte cap above.
   */
  app.post("/parse", async (c) => {
    const supabase = c.get("supabaseCaller");

    // 1. Body validation.
    //
    // Review fix (Finding 5): `c.req.json()` throws on syntactically invalid
    // JSON, which is NOT the same failure as a well-formed body that fails
    // the schema — that throw previously happened INSIDE the `safeParse(...)`
    // argument, so it rejected before Zod ever ran and produced an unhandled
    // error instead of the documented 400 envelope. Decode first, in its own
    // try/catch, and return the identical documented shape either way (a
    // static string, never the caught error itself — this route must never
    // echo a parser's internal message or stack trace back to the caller).
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      c.set("traceOutcome", "invalid_body");
      return c.json(fail("invalid request body"), 400);
    }
    const bodyResult = ParseBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      c.set("traceOutcome", "invalid_body");
      return c.json(fail("invalid request body"), 400);
    }
    const { inbox_item_id } = bodyResult.data;

    // 2. Fetch the inbox item through the caller-scoped client (RLS-enforced).
    const { data: item, error: itemError } = await supabase
      .from("inbox_items")
      .select("id, account_id, attachments")
      .eq("id", inbox_item_id)
      .single();
    if (itemError || !item) {
      c.set("traceOutcome", "item_not_found");
      return c.json(fail("inbox item not found"), 404);
    }

    // 3. Find a resume-shaped attachment (MIME-allowlisted — Finding 9,
    // inboxAttachment.ts).
    const attachment = findResumeAttachment(item.attachments);
    if (!attachment) {
      c.set("traceOutcome", "no_attachment");
      return c.json(fail("no resume attachment found"), 422);
    }

    const accountId: number = item.account_id;

    // 4. Atomic claim (Findings 6/7/8/12): reserve this month's usage,
    // check idempotency, and validate any replayed result — all before any
    // download or inference. See the header comment above and
    // `resolveParseClaim.ts` for what each outcome means.
    const resolution = await resolveParseClaim(
      c.env,
      accountId,
      inbox_item_id,
      attachment.path,
    );
    if (resolution.kind === "claim_error") {
      // Fail-closed (Finding 16): the reservation machinery itself
      // errored. No download, no inference, nothing further written —
      // proceeding here would be exactly Finding 6's failure restated:
      // spending inference during a database/permission outage with no
      // durable record of it.
      c.set("traceOutcome", "claim_error");
      return c.json(fail("AI service temporarily unavailable"), 503);
    }
    if (resolution.kind === "cap_reached") {
      c.set("traceOutcome", "cap_reached");
      return c.json(fail("monthly resume limit reached"), 402);
    }
    if (resolution.kind === "conflict") {
      c.set("traceOutcome", "conflict");
      return c.json(
        fail("a parse is already in progress for this attachment"),
        409,
        { "Retry-After": "5" },
      );
    }
    if (resolution.kind === "replay") {
      // Story 11.4 (Finding 16 follow-up, review Finding C4): a replay is a
      // free re-serve of an already-metered, already-validated
      // (Finding 12) result — no new inference spend — and must read as
      // such in Cloudflare Logs, never conflated with a fresh, billable
      // parse under the generic "ok" fallback.
      c.set("traceOutcome", "replay");
      return c.json(ok(resolution.payload));
    }
    const attemptId = resolution.attemptId;
    // Fencing token (review Finding C2): carried forward to whichever of
    // confirm/release this request ultimately calls below. Required by both
    // — see their own comments in `parseQuota.ts`.
    const generation = resolution.generation;

    // 5. Size guard BEFORE downloading (Finding 9): `list()` returns each
    // object's stored metadata (including `size`) without transferring the
    // file body, so an oversized attachment is rejected without ever paying
    // for the download.
    const { dirPath, fileName } = splitStoragePath(attachment.path);
    const { data: listing } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .list(dirPath, { search: fileName, limit: 1 });
    const knownSize = listing?.[0]?.metadata?.size;
    if (typeof knownSize === "number" && knownSize > MAX_ATTACHMENT_BYTES) {
      return releaseAndFail(
        c,
        accountId,
        attemptId,
        generation,
        "attachment too large",
        413,
        "attachment_too_large",
      );
    }

    // 6. Download the file bytes from the attachments bucket.
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(attachment.path);
    if (downloadError || !fileData) {
      return releaseAndFail(
        c,
        accountId,
        attemptId,
        generation,
        "could not download attachment",
        422,
        "download_failed",
      );
    }
    const fileBytes = await fileData.arrayBuffer();

    // Backstop (Finding 9): the metadata check above is the PRIMARY guard —
    // it is what actually avoids downloading an oversized object. This
    // second check exists only for the case the storage backend didn't
    // return a usable `metadata.size` (never trust external data, even when
    // the primary guard should already have caught it).
    if (fileBytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return releaseAndFail(
        c,
        accountId,
        attemptId,
        generation,
        "attachment too large",
        413,
        "attachment_too_large",
      );
    }

    // 7. Image pixel-dimension guard (Finding 19): the byte-size guards above
    // bound encoded size only — a small, highly compressed PNG/JPEG/WebP can
    // still decode to an enormous pixel canvas (a decompression-bomb shape).
    // `readImageDimensions()` reads each format's dimensions directly out of
    // its header (no decode), so this costs a handful of byte reads even for
    // a legitimate attachment. See `imageDimensionGuard.ts`'s header for the
    // full design.
    //
    // Scope, matching that module exactly: `application/pdf` and
    // `image/heic`/`image/heif` (all allowed by `inboxAttachment.ts`'s
    // allowlist) are OUT of scope for THIS guard by design, and
    // `readImageDimensions()` returns `null` for them — same as it does for
    // a malformed/truncated file of a covered type. A `null` result means
    // "not checkable", never "checked and fine": this guard exists to REJECT
    // a genuine over-budget dimension, never to hard-fail an otherwise
    // legitimate parse it simply has no way to read. So `null` here falls
    // straight through to extraction, exactly like a PDF or HEIC/HEIF file
    // does.
    const imageDimensions = readImageDimensions(fileBytes, attachment.type);
    if (imageDimensions && exceedsMaxImagePixels(imageDimensions)) {
      // Same public message and status as the byte-size guards above —
      // deliberately not distinguished for the caller (no reason to hand an
      // attacker a signal for calibrating "under the byte cap but over the
      // pixel cap" probes), but a distinct `traceOutcome` so an operator can
      // tell the two apart in Cloudflare Logs.
      return releaseAndFail(
        c,
        accountId,
        attemptId,
        generation,
        "attachment too large",
        413,
        "image_dimensions_exceeded",
      );
    }

    // 8. Extract. The extractor is injected for tests; production uses
    // Gemini. Wrapped in try/catch: a model/network/timeout failure
    // releases the reservation instead of leaving the account charged for a
    // parse it never received. Finding 14: `extract()` returns `unknown` —
    // it is no longer a validation gate, `toDraft()` below validates per
    // field instead.
    const activeExtractor = extractor ?? geminiExtractor(c.env);
    let raw: unknown;
    try {
      raw = await activeExtractor.extract(fileBytes, attachment.type);
    } catch (error) {
      console.error("parse.extract.error", summarizeErrorForLog(error));
      // Finding 7: distinguish a timeout from any other extractor failure
      // in the trace log — both release the reservation identically, but
      // an operator sizing `GEMINI_EXTRACT_TIMEOUT_MS` needs to see timeout
      // events separately from genuine provider/network errors.
      const traceOutcome =
        error instanceof ExtractorTimeoutError
          ? "extract_timeout"
          : "extract_failed";
      return releaseAndFail(
        c,
        accountId,
        attemptId,
        generation,
        "resume extraction failed",
        502,
        traceOutcome,
      );
    }

    // 9. Convert to a validated draft.
    const draft = toDraft(raw);

    const payload: ParseResultPayload = {
      fields: draft.fields,
      lowConfidenceFields: draft.lowConfidenceFields,
      sections: draft.sections,
      rawDraft: raw,
    };

    // 10. Confirm: cache the result for future replay. Does NOT touch
    // ai_usage — the spend already happened durably at step 4's claim.
    // Findings 8/9/12 closure: the outcome is now inspected instead of
    // ignored — `resolveConfirmOutcome()` turns it into a decision this
    // route responds to; see that module's own header comment for what
    // each branch means, and the header comment above for the full
    // picture.
    const confirmOutcome = await confirmParseAttempt(
      c.env,
      accountId,
      attemptId,
      generation,
      payload,
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );
    const confirmResolution = resolveConfirmOutcome(confirmOutcome);

    if (confirmResolution.kind === "applied") {
      // Story 11.4 (Finding 16 follow-up, review Finding C4): the
      // counterpart to "replay" above — this IS a fresh, billable parse
      // (real inference just ran and the monthly meter was durably spent
      // at step 4). Named to mirror `workers/ai/index.ts`'s
      // "fresh_dossier" exactly.
      c.set("traceOutcome", "fresh_parse");
      return c.json(ok(payload));
    }

    if (confirmResolution.kind === "superseded_replay") {
      // Finding 8 closure: the WINNING generation already finished — serve
      // ITS (re-validated, Finding 12) result so both concurrent callers
      // converge on the same durable answer, never this caller's own
      // now-orphaned draft.
      c.set("traceOutcome", "fresh_parse_superseded_replay");
      return c.json(ok(confirmResolution.payload));
    }

    if (confirmResolution.kind === "superseded_conflict") {
      // The winner has nothing trustworthy to offer yet (still in
      // progress, failed, or — the rare case — its own result failed
      // re-validation). This caller's own draft is now orphaned: a newer
      // generation owns this row, so serving our draft would risk
      // diverging from whatever is actually durable. A retry naturally
      // lands on `resolveParseClaim.ts`'s own replay/force-reclaim
      // machinery once the winner settles.
      c.set("traceOutcome", "fresh_parse_superseded_conflict");
      return c.json(
        fail("a newer parse attempt has already claimed this attachment"),
        409,
        { "Retry-After": "5" },
      );
    }

    // "unconfirmed": every retry exhausted, never durably confirmed.
    // Findings 6/7's invariant is untouched — the spend happened durably
    // at step 4's claim, entirely independent of this confirm call — so
    // the user still receives their correct, already-metered draft rather
    // than a request failure that would throw it away for nothing. Marked
    // non-durable and logged loudly (never silently swallowed) so an
    // operator can see and alert on it; the row stays 'in_progress', so a
    // retry within 5 minutes correctly gets a 409 conflict, and after 5
    // minutes self-heals for free via the stale-reclaim branch in
    // `claim_ai_parse_attempt()`.
    console.error("parse.confirm.exhausted", {
      accountId,
      attemptId,
      generation,
    });
    c.set("traceOutcome", "fresh_parse_unconfirmed");
    return c.json(ok(payload, { durable: false }));
  });

  return app;
}

const app = createParseApp();
export default app;
export type { ParseEnv };
