import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Context, Hono } from "hono";

import { createWorkerApp } from "../shared/createApp";
import {
  createCorsMiddleware,
  LOCAL_DEV_ORIGINS,
  PRODUCTION_ORIGINS,
} from "../shared/cors";
import { deriveIpKey } from "../shared/callerIdentity";
import { fail, ok } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import { createCallerClient } from "../shared/aiEntitlementGate";
import {
  checkRateLimit,
  createRateLimitMiddleware,
  EMAIL_ACCOUNT_RATE_LIMIT,
  EMAIL_IP_RATE_LIMIT,
  isRateLimitingEnforced,
  type RateLimitEnforcementEnv,
} from "../shared/rateLimit";
import { sendEmail } from "../shared/resend";
import {
  createTracingMiddleware,
  type TracingVariables,
} from "../shared/requestTracing";
import {
  EMAIL_MAX_RAW_BYTES,
  isAccountStoragePath,
  isAllowedAttachmentMime,
  isProviderRateLimitError,
  isProviderServerError,
  isSafeFilename,
  isUsableEmail,
  toBase64,
} from "./emailPayload";

export type EmailEnv = BaseEnv &
  RateLimitEnforcementEnv & {
    EMAIL_IP_RATE_LIMITER?: RateLimit;
    EMAIL_ACCOUNT_RATE_LIMITER?: RateLimit;
    OUTBOUND_EMAIL_ENABLED?: string;
    OUTBOUND_EMAIL_REPLY_TO?: string;
  };

type EmailContext = { Bindings: EmailEnv; Variables: TracingVariables };
type EmailApp = Hono<EmailContext>;
type EmailRequestContext = Context<EmailContext>;

const DOCUMENTS_BUCKET = "documents";
const ACCOUNT_WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_DAILY_LIMIT = 20;
const ACCOUNT_DAY_MS = 24 * 60 * 60 * 1000;
const activeAccounts = new Set<string>();

const SendBodySchema = z.object({
  single_id: z.number().int().positive(),
  shadchan_id: z.number().int().positive(),
  include_photo: z.boolean(),
  request_id: z.string().uuid(),
});

type SendBody = z.infer<typeof SendBodySchema>;
type EmailOutcome =
  | "email_provider_accepted"
  | "email_rate_limited"
  | "email_rejected"
  | "email_fetch_failed"
  | "email_delivery_unknown";

type ResumeFile = {
  path?: unknown;
  filename?: unknown;
  mime_type?: unknown;
  size?: unknown;
};
type ResumeRow = {
  id: number;
  single_id: number | null;
  files: ResumeFile[] | null;
};
type PhotoRow = {
  id: number;
  resume_id: number;
  path: string;
  uploaded_at: string;
  visibility: string;
  hidden_at: string | null;
};
type MemberRow = { id: number; disabled: boolean | null };
type AccountMemberRow = { id: number; status: string };
type ShadchanRow = { id: number; name: string; contacts: unknown };
type Attachment = { filename: string; content: string; content_type: string };

function isEnabled(value: string | undefined): boolean {
  return value === "true";
}

function contactEmail(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const email = (value as { email?: unknown }).email;
  return isUsableEmail(email) ? email.trim() : null;
}

function replyToFor(configuredReplyTo: string | undefined): string | null {
  if (configuredReplyTo?.trim()) {
    return isUsableEmail(configuredReplyTo) ? configuredReplyTo.trim() : null;
  }
  return null;
}

function safeProviderFailure(
  error: string,
): "rate_limited" | "unknown" | "rejected" {
  if (isProviderRateLimitError(error)) return "rate_limited";
  if (isProviderServerError(error)) return "unknown";
  return "rejected";
}

async function audit(
  supabase: SupabaseClient,
  accountId: number,
  body: SendBody,
  outcome: EmailOutcome,
  actorMemberId: number,
  hasPhoto: boolean,
): Promise<void> {
  const { error } = await supabase.from("outbound_share_history").insert({
    account_id: accountId,
    single_id: body.single_id,
    shadchan_id: body.shadchan_id,
    actor_member_id: actorMemberId,
    channel: "email",
    file_kinds: hasPhoto ? ["resume", "photo"] : ["resume"],
    outcome,
  });
  if (error)
    console.error("email.auditWriteFailed", { code: error.code ?? "unknown" });
}

function fileNameFromPath(path: string): string | null {
  const filename = path.split("/").pop();
  return filename && isSafeFilename(filename) ? filename : null;
}

type StorageMetadata = { filename: string; mimeType: string; size: number };

async function storageMetadata(
  admin: SupabaseClient,
  path: string,
): Promise<StorageMetadata | null> {
  const filename = fileNameFromPath(path);
  if (!filename) return null;
  const folder = path.slice(0, -(filename.length + 1));
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .list(folder, {
      limit: 100,
      search: filename,
    });
  if (error) return null;
  const object = data?.find((item) => item.name === filename);
  const metadata = object?.metadata as
    { mimetype?: unknown; size?: unknown } | null | undefined;
  const mimeType = metadata?.mimetype;
  const size = metadata?.size;
  if (
    (!isAllowedAttachmentMime("photo", mimeType) &&
      !isAllowedAttachmentMime("resume", mimeType)) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1
  ) {
    return null;
  }
  return { filename, mimeType, size };
}

async function readAttachment(
  admin: SupabaseClient,
  path: unknown,
  filename: unknown,
  mimeType: unknown,
  expectedSize: unknown,
  kind: "resume" | "photo",
  accountId: number,
  singleId: number,
): Promise<{ attachment: Attachment; size: number } | null> {
  if (
    !isAccountStoragePath(path, accountId, kind, singleId) ||
    !isSafeFilename(filename) ||
    !isAllowedAttachmentMime(kind, mimeType) ||
    typeof expectedSize !== "number" ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1 ||
    expectedSize > EMAIL_MAX_RAW_BYTES
  ) {
    return null;
  }
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .download(path);
  if (error || !data) return null;
  const bytes = await data.arrayBuffer();
  if (bytes.byteLength !== expectedSize) return null;
  return {
    attachment: {
      filename,
      content: toBase64(bytes),
      content_type: mimeType,
    },
    size: bytes.byteLength,
  };
}

async function recentEmailCount(
  supabase: SupabaseClient,
  windowMs: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const result = await supabase
    .from("outbound_share_history")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .gte("created_at", cutoff);
  return result.error ? null : (result.count ?? 0);
}

function configured(env: EmailEnv): boolean {
  return (
    isEnabled(env.OUTBOUND_EMAIL_ENABLED) &&
    env.RESEND_API_KEY.length > 0 &&
    env.RESEND_FROM.length > 0
  );
}

function authHeader(c: EmailRequestContext): string | null {
  const value = c.req.header("Authorization");
  return value && /^Bearer\s+\S+$/i.test(value) ? value : null;
}

export function createEmailApp(): EmailApp {
  const app = createWorkerApp<EmailEnv>("email") as unknown as EmailApp;
  app.use(
    "*",
    createCorsMiddleware({
      origins: [...PRODUCTION_ORIGINS, ...LOCAL_DEV_ORIGINS],
      methods: ["POST"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use("*", createTracingMiddleware<EmailContext>("email"));
  app.use(
    "*",
    createRateLimitMiddleware<EmailContext>({
      limiterName: "email-ip",
      config: EMAIL_IP_RATE_LIMIT,
      getBinding: (env) => env.EMAIL_IP_RATE_LIMITER,
      deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
      workerName: "email",
      surface: "email",
    }),
  );

  app.post("/send", async (c) => {
    if (!configured(c.env))
      return c.json(fail("email sending is temporarily unavailable"), 503);
    const authorization = authHeader(c);
    if (!authorization)
      return c.json(fail("missing Authorization header"), 401);

    let body: SendBody;
    try {
      const parsed = SendBodySchema.safeParse(await c.req.json<unknown>());
      if (!parsed.success) return c.json(fail("invalid request body"), 400);
      body = parsed.data;
    } catch {
      return c.json(fail("invalid request body"), 400);
    }

    const supabase = createCallerClient(authorization, c.env);
    const [
      { data: accountId, error: accountError },
      { data: role, error: roleError },
    ] = await Promise.all([
      supabase.rpc("current_context_id"),
      supabase.rpc("current_member_role"),
    ]);
    if (accountError || roleError || typeof accountId !== "number") {
      return c.json(fail("email sending is temporarily unavailable"), 503);
    }
    if (role !== "parent_admin" && role !== "self_manager") {
      return c.json(
        fail("this action is available only to the household manager"),
        403,
      );
    }

    const { data: userResult, error: userError } =
      await supabase.auth.getUser();
    if (userError || !userResult.user)
      return c.json(fail("not authenticated"), 401);
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id,disabled")
      .eq("user_id", userResult.user.id)
      .maybeSingle<MemberRow>();
    const { data: accountMember, error: accountMemberError } = await supabase
      .from("account_members")
      .select("id,status")
      .eq("account_id", accountId)
      .eq("user_id", userResult.user.id)
      .eq("status", "active")
      .maybeSingle<AccountMemberRow>();
    const replyTo = replyToFor(c.env.OUTBOUND_EMAIL_REPLY_TO);
    if (
      memberError ||
      accountMemberError ||
      !member ||
      !accountMember ||
      member.disabled === true
    ) {
      return c.json(
        fail("email sending is temporarily unavailable, nothing was sent"),
        503,
      );
    }
    if (!replyTo) {
      return c.json(
        fail("email sending is temporarily unavailable, nothing was sent"),
        503,
      );
    }

    const rate = await checkRateLimit({
      binding: c.env.EMAIL_ACCOUNT_RATE_LIMITER,
      key: `account:${accountId}`,
      enforced: isRateLimitingEnforced(c.env.RATE_LIMITING_ENFORCED),
      limiterName: "email-account",
    });
    if (!rate.allowed) {
      c.header("Retry-After", String(EMAIL_ACCOUNT_RATE_LIMIT.periodSeconds));
      await audit(
        supabase,
        accountId,
        body,
        "email_rate_limited",
        accountMember.id,
        body.include_photo,
      );
      return c.json(fail("you've reached the email sending limit"), 429);
    }
    const recent = await recentEmailCount(supabase, ACCOUNT_WINDOW_MS);
    const daily = await recentEmailCount(supabase, ACCOUNT_DAY_MS);
    if (recent == null || daily == null) {
      return c.json(fail("email sending is temporarily unavailable"), 503);
    }
    if (
      daily >= ACCOUNT_DAILY_LIMIT ||
      recent >= EMAIL_ACCOUNT_RATE_LIMIT.limit
    ) {
      c.header("Retry-After", "600");
      await audit(
        supabase,
        accountId,
        body,
        "email_rate_limited",
        accountMember.id,
        body.include_photo,
      );
      return c.json(fail("you've reached the email sending limit"), 429);
    }

    const activeKey = `${accountId}:${member.id}`;
    if (activeAccounts.has(activeKey)) {
      await audit(
        supabase,
        accountId,
        body,
        "email_rate_limited",
        accountMember.id,
        body.include_photo,
      );
      return c.json(fail("you've reached the email sending limit"), 429);
    }
    activeAccounts.add(activeKey);

    try {
      const { data: single, error: singleError } = await supabase
        .from("singles")
        .select("id,account_id,member_id")
        .eq("id", body.single_id)
        .maybeSingle<{
          id: number;
          account_id: number;
          member_id: number | null;
        }>();
      if (
        singleError ||
        !single ||
        single.account_id !== accountId ||
        (role === "self_manager" && single.member_id !== accountMember.id)
      ) {
        return c.json(
          fail("this action is not available for the selected kid"),
          403,
        );
      }

      const { data: shadchan, error: shadchanError } = await supabase
        .from("shadchanim")
        .select("id,name,contacts")
        .eq("id", body.shadchan_id)
        .maybeSingle<ShadchanRow>();
      const recipient = contactEmail(shadchan?.contacts);
      if (shadchanError || !shadchan || !recipient) {
        await audit(
          supabase,
          accountId,
          body,
          "email_rejected",
          accountMember.id,
          body.include_photo,
        );
        return c.json(fail("no email saved for this shadchan"), 422);
      }

      const { data: resume, error: resumeError } = await supabase
        .from("resumes")
        .select("id,single_id,files")
        .eq("single_id", body.single_id)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle<ResumeRow>();
      const resumeFile = resume?.files?.[resume.files.length - 1];
      if (
        !resume ||
        resumeError ||
        resume.single_id !== body.single_id ||
        !resumeFile
      ) {
        await audit(
          supabase,
          accountId,
          body,
          "email_fetch_failed",
          accountMember.id,
          body.include_photo,
        );
        return c.json(fail("we couldn't prepare these attachments"), 422);
      }

      let photo: PhotoRow | null = null;
      if (body.include_photo) {
        const result = await supabase
          .from("resume_photos")
          .select("id,resume_id,path,uploaded_at,visibility,hidden_at")
          .eq("resume_id", resume.id)
          .eq("visibility", "shared")
          .is("hidden_at", null)
          .order("uploaded_at", { ascending: false })
          .limit(1)
          .maybeSingle<PhotoRow>();
        if (result.error || !result.data) {
          await audit(
            supabase,
            accountId,
            body,
            "email_fetch_failed",
            accountMember.id,
            true,
          );
          return c.json(fail("we couldn't prepare these attachments"), 422);
        }
        photo = result.data;
      }

      const admin = createClient(
        c.env.SUPABASE_URL,
        c.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false },
        },
      );
      const photoInfo = photo ? await storageMetadata(admin, photo.path) : null;
      const totalSize =
        typeof resumeFile.size === "number" && photoInfo
          ? resumeFile.size + photoInfo.size
          : resumeFile.size;
      if (
        typeof totalSize !== "number" ||
        !Number.isSafeInteger(totalSize) ||
        totalSize < 1 ||
        totalSize > EMAIL_MAX_RAW_BYTES ||
        (photo && photoInfo == null)
      ) {
        await audit(
          supabase,
          accountId,
          body,
          "email_fetch_failed",
          accountMember.id,
          Boolean(photo),
        );
        return c.json(
          fail("these files are too large or unavailable to email"),
          413,
        );
      }

      const resumeAttachment = await readAttachment(
        admin,
        resumeFile.path,
        resumeFile.filename,
        resumeFile.mime_type,
        resumeFile.size,
        "resume",
        accountId,
        body.single_id,
      );
      const photoAttachment =
        photo && photoInfo
          ? await readAttachment(
              admin,
              photo.path,
              photoInfo.filename,
              photoInfo.mimeType,
              photoInfo.size,
              "photo",
              accountId,
              body.single_id,
            )
          : null;
      if (!resumeAttachment || (photo && !photoAttachment)) {
        await audit(
          supabase,
          accountId,
          body,
          "email_fetch_failed",
          accountMember.id,
          Boolean(photo),
        );
        return c.json(fail("we couldn't prepare these attachments"), 422);
      }

      const result = await sendEmail({
        apiKey: c.env.RESEND_API_KEY,
        from: c.env.RESEND_FROM,
        to: recipient,
        replyTo,
        subject: `Resume for ${shadchan.name}`,
        text: `Please find the attached resume${photo ? " and photo" : ""}.`,
        idempotencyKey: `outbound-email:${accountId}:${body.request_id}`,
        attachments: [
          resumeAttachment.attachment,
          ...(photoAttachment ? [photoAttachment.attachment] : []),
        ],
      });
      if (result.ok) {
        await audit(
          supabase,
          accountId,
          body,
          "email_provider_accepted",
          accountMember.id,
          Boolean(photo),
        );
        return c.json(ok({ status: "accepted" }));
      }
      const failure = safeProviderFailure(result.error);
      const outcome: EmailOutcome =
        failure === "rate_limited"
          ? "email_rate_limited"
          : failure === "unknown"
            ? "email_delivery_unknown"
            : "email_rejected";
      await audit(
        supabase,
        accountId,
        body,
        outcome,
        accountMember.id,
        Boolean(photo),
      );
      if (failure === "rate_limited") {
        c.header("Retry-After", "60");
        return c.json(fail("you've reached the email sending limit"), 429);
      }
      if (failure === "unknown") {
        return c.json(
          fail("we couldn't confirm what happened with the email"),
          503,
        );
      }
      return c.json(fail("the email service rejected this email"), 422);
    } finally {
      activeAccounts.delete(activeKey);
    }
  });
  return app;
}

export default createEmailApp();
