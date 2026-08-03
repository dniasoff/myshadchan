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
import { ATTACHMENTS_BUCKET, findResumeAttachment } from "./inboxAttachment";
import { toDraft } from "./parsedResumeDraft";
import {
  geminiExtractor,
  type ParseEnv,
  type ResumeExtractor,
} from "./resumeExtractor";

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
  const app = createWorkerApp("parse") as unknown as ParseApp;
  app.use("*", requireAiEntitlement);

  /**
   * POST /parse — read the resume attached to an inbox item, run it through the
   * extractor, and return a validated, nullable draft. The original capture is
   * never modified. The monthly `ai_usage.resumes_parsed` cap is enforced here,
   * after the gate but before any inference is spent.
   */
  app.post("/parse", async (c) => {
    const supabase = c.get("supabaseCaller");
    const entitlement = c.get("aiEntitlement");

    // 1. Body validation.
    const bodyResult = ParseBodySchema.safeParse(await c.req.json());
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

    // 4. Find a resume-shaped attachment.
    const attachment = findResumeAttachment(item.attachments);
    if (!attachment) {
      return c.json(fail("no resume attachment found"), 422);
    }

    // 5. Download the file bytes from the attachments bucket.
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(attachment.path);
    if (downloadError || !fileData) {
      return c.json(fail("could not download attachment"), 422);
    }
    const fileBytes = await fileData.arrayBuffer();

    // 6. Extract. The extractor is injected for tests; production uses Gemini.
    const activeExtractor = extractor ?? geminiExtractor(c.env);
    const raw = await activeExtractor.extract(fileBytes, attachment.type);

    // 7. Convert to a validated draft.
    const draft = toDraft(raw);

    // 8. Meter usage: increment ai_usage.resumes_parsed for this account/period.
    const accountId = String(item.account_id);
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

    return c.json(
      ok({
        fields: draft.fields,
        lowConfidenceFields: draft.lowConfidenceFields,
        sections: draft.sections,
        rawDraft: raw,
      }),
    );
  });

  return app;
}

const app = createParseApp();
export default app;
export type { ParseEnv };
