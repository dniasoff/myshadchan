import { z } from "zod";
import type { Hono } from "hono";
import { createWorkerApp } from "../shared/createApp";
import type { BaseEnv } from "../shared/env";
import { fail, ok } from "../shared/envelope";
import { forAccount } from "../shared/forAccount";
import {
  requireAiEntitlement,
  type AiEntitlementVariables,
} from "../shared/aiEntitlementGate";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
} from "../shared/cors";
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  findResumeAttachment,
  splitStoragePath,
} from "./inboxAttachment";
import {
  buildIdempotencyCacheKey,
  readCachedParseResult,
  writeCachedParseResult,
} from "./parseIdempotency";
import { toDraft, type ParsedResumeDraft } from "./parsedResumeDraft";
import {
  geminiExtractor,
  type ParseEnv,
  type RawExtraction,
  type ResumeExtractor,
} from "./resumeExtractor";

/**
 * The exact shape POST /parse returns on success — cached verbatim by
 * `parseIdempotency.ts` (Finding 8) so a cache hit can be replayed byte for
 * byte without re-deriving it.
 */
type ParseResultPayload = {
  fields: ParsedResumeDraft["fields"];
  lowConfidenceFields: string[];
  sections: ParsedResumeDraft["sections"];
  rawDraft: RawExtraction;
};

type ParseBindings = BaseEnv & ParseEnv;
type ParseApp = Hono<{
  Bindings: ParseBindings;
  Variables: AiEntitlementVariables;
}>;

const ParseBodySchema = z.object({
  inbox_item_id: z.number(),
});

/**
 * Current AI period for the `ai_usage` monthly cap. Uses UTC month boundary to
 * match `ai_entitlement()`'s own accounting.
 */
function currentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Build the parse worker app. The optional `extractor` parameter lets tests
 * inject a fake; production uses `geminiExtractor(env)`.
 */
export function createParseApp(extractor?: ResumeExtractor): ParseApp {
  // E5/E11 (resume auto-parse) land here — AD-6, AD-8, AD-12. Every non-health
  // route is gated by `requireAiEntitlement` (Story 11.1).
  //
  // Review fix (Finding 1, P1): CORS MUST be registered before the
  // entitlement gate. `callAiWorker()` sends `Authorization` +
  // `Content-Type: application/json`, so every real call preflights with an
  // `OPTIONS` request first — one that never carries `Authorization`. With
  // the gate registered first it 401'd every preflight, with no
  // Access-Control-Allow-Origin header, so the browser blocked the response
  // and never sent the real POST: this endpoint was unreachable from any
  // browser. `hono/cors` answers `OPTIONS` itself (204, short-circuits
  // before `next()`), so registering it first means the gate never even
  // sees a preflight — only real requests reach it.
  const app = createWorkerApp("parse") as unknown as ParseApp;
  app.use(
    "*",
    createCorsMiddleware({
      origins: AI_WORKER_ALLOWED_ORIGINS,
      methods: ["POST"],
      allowHeaders: [...AI_WORKER_ALLOWED_HEADERS],
    }),
  );
  app.use("*", requireAiEntitlement);

  /**
   * POST /parse — read the resume attached to an inbox item, run it through the
   * extractor, and return a validated, nullable draft. The original capture is
   * never modified. The monthly `ai_usage.resumes_parsed` cap is enforced here,
   * after the gate but before any inference is spent.
   *
   * Review fix (Finding 8): a repeat request for the exact same (account,
   * inbox item, attachment) is served from `parseIdempotency.ts`'s cache
   * instead of re-invoking the model and re-metering usage — see that
   * module's header comment for what this does and does not guarantee. The
   * cache probe runs after the monthly-cap gate (step 2) rather than before
   * it: this means a household already at its cap this month who retries an
   * ALREADY-completed item sees 402 instead of the cached result, since the
   * cache key depends on the fetched inbox item/attachment, which the cap
   * check (deliberately) still gates first. That is an accepted, narrow
   * trade-off — it costs no new spend, only an over-strict error message on
   * a rare edge — in exchange for keeping the well-tested "402 without
   * touching the database" fast-fail path intact.
   *
   * Review fix (Finding 9): the attachment's MIME type is checked against an
   * explicit allowlist (`inboxAttachment.ts`) and its size is checked BEFORE
   * download via storage `list()` metadata, with a post-download backstop in
   * case that metadata is ever unavailable.
   */
  app.post("/parse", async (c) => {
    const supabase = c.get("supabaseCaller");
    const entitlement = c.get("aiEntitlement");

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
      return c.json(fail("invalid request body"), 400);
    }
    const bodyResult = ParseBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json(fail("invalid request body"), 400);
    }
    const { inbox_item_id } = bodyResult.data;

    // 2. Monthly cap check.
    if (entitlement.resumes_used >= entitlement.resumes_limit) {
      return c.json(fail("monthly resume limit reached"), 402);
    }

    // 3. Fetch the inbox item through the caller-scoped client (RLS-enforced).
    const { data: item, error: itemError } = await supabase
      .from("inbox_items")
      .select("id, account_id, attachments")
      .eq("id", inbox_item_id)
      .single();
    if (itemError || !item) {
      return c.json(fail("inbox item not found"), 404);
    }

    // 4. Find a resume-shaped attachment (MIME-allowlisted — Finding 9,
    // inboxAttachment.ts).
    const attachment = findResumeAttachment(item.attachments);
    if (!attachment) {
      return c.json(fail("no resume attachment found"), 422);
    }

    const accountId = String(item.account_id);

    // 4.5. Idempotency probe (Finding 8): a completed result for this exact
    // (account, inbox item, attachment) is replayed verbatim — no download,
    // no model call, no usage metering.
    const idempotencyKey = buildIdempotencyCacheKey(
      accountId,
      inbox_item_id,
      attachment.path,
    );
    const cachedResult =
      await readCachedParseResult<ParseResultPayload>(idempotencyKey);
    if (cachedResult) {
      return c.json(ok(cachedResult));
    }

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
      return c.json(fail("attachment too large"), 413);
    }

    // 6. Download the file bytes from the attachments bucket.
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(attachment.path);
    if (downloadError || !fileData) {
      return c.json(fail("could not download attachment"), 422);
    }
    const fileBytes = await fileData.arrayBuffer();

    // Backstop (Finding 9): the metadata check above is the PRIMARY guard —
    // it is what actually avoids downloading an oversized object. This
    // second check exists only for the case the storage backend didn't
    // return a usable `metadata.size` (never trust external data, even when
    // the primary guard should already have caught it).
    if (fileBytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return c.json(fail("attachment too large"), 413);
    }

    // 7. Extract. The extractor is injected for tests; production uses Gemini.
    const activeExtractor = extractor ?? geminiExtractor(c.env);
    const raw = await activeExtractor.extract(fileBytes, attachment.type);

    // 8. Convert to a validated draft.
    const draft = toDraft(raw);

    // 9. Meter usage: increment ai_usage.resumes_parsed for this account/period.
    const period = currentPeriod();
    const scoped = forAccount(accountId, c.env).from("ai_usage");
    const { data: usageRows } = await scoped
      .select("resumes_parsed")
      .eq("period", period);
    if (usageRows && usageRows.length > 0) {
      const current =
        (usageRows[0] as { resumes_parsed: number }).resumes_parsed ?? 0;
      await scoped.update({ resumes_parsed: current + 1 }).eq("period", period);
    } else {
      const { error: insertError } = await scoped.insert({
        period,
        resumes_parsed: 1,
      });
      if (insertError) {
        // Concurrent first parse: retry the update path once.
        const { data: retryRows } = await scoped
          .select("resumes_parsed")
          .eq("period", period);
        if (retryRows && retryRows.length > 0) {
          const current =
            (retryRows[0] as { resumes_parsed: number }).resumes_parsed ?? 0;
          await scoped
            .update({ resumes_parsed: current + 1 })
            .eq("period", period);
        }
      }
    }

    const payload: ParseResultPayload = {
      fields: draft.fields,
      lowConfidenceFields: draft.lowConfidenceFields,
      sections: draft.sections,
      rawDraft: raw,
    };

    // 10. Cache the completed result (Finding 8) so a retry for this exact
    // attachment is replayed instead of re-invoking the model.
    await writeCachedParseResult(idempotencyKey, payload);

    return c.json(ok(payload));
  });

  return app;
}

const app = createParseApp();
export default app;
export type { ParseEnv };
