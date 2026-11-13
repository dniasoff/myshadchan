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
  safeSubjectName,
  isUsableEmail,
  toBase64,
} from "./emailPayload";

export type EmailEnv = BaseEnv &
  RateLimitEnforcementEnv & {
    EMAIL_IP_RATE_LIMITER?: RateLimit;
    EMAIL_ACCOUNT_RATE_LIMITER?: RateLimit;
    OUTBOUND_EMAIL_ENABLED?: string;
    OUTBOUND_EMAIL_REPLY_TO?: string;
    OUTBOUND_EMAIL_ACCOUNT_IDS?: string;
    OUTBOUND_EMAIL_GLOBAL_DAILY_CAP?: string;
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
type SingleRow = {
  id: number;
  account_id: number;
  member_id: number | null;
  first_name_en?: string | null;
  last_name_en?: string | null;
  first_name_he?: string | null;
  last_name_he?: string | null;
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
type EmailDependencies = {
  createCallerClient: (authorization: string, env: EmailEnv) => SupabaseClient;
  createAdminClient: (env: EmailEnv) => SupabaseClient;
  sendEmail: typeof sendEmail;
};

const defaultEmailDependencies: EmailDependencies = {
  createCallerClient,
  createAdminClient: (env) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
  sendEmail,
};

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
  retryable: boolean,
): "rate_limited" | "unknown" | "rejected" {
  if (isProviderRateLimitError(error)) return "rate_limited";
  if (retryable || isProviderServerError(error)) return "unknown";
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
  path: unknown,
  kind: "resume" | "photo",
  accountId: number,
  singleId: number,
): Promise<StorageMetadata | null> {
  if (!isAccountStoragePath(path, accountId, kind, singleId)) return null;
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
    !isAllowedAttachmentMime(kind, mimeType) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1
  ) {
    return null;
  }
  return { filename, mimeType, size };
}

/** Fetch through the private Storage object API with a byte guard before the
 * body is materialised. The list metadata is an early rejection signal; the
 * stream guard also protects against stale or dishonest metadata. */
async function boundedDownload(
  storageUrl: string,
  serviceRoleKey: string,
  path: string,
): Promise<ArrayBuffer | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await fetch(
      `${storageUrl.replace(/\/$/, "")}/storage/v1/object/${DOCUMENTS_BUCKET}/${encodedPath}`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentLength = response.headers.get("content-length");
  if (
    contentLength != null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > EMAIL_MAX_RAW_BYTES)
  ) {
    return null;
  }
  // A fetch response normally exposes a stream. If it does not, fail closed
  // instead of materialising an object whose length could not be bounded.
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > EMAIL_MAX_RAW_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function readAttachment(
  path: unknown,
  filename: unknown,
  mimeType: unknown,
  expectedSize: unknown,
  metadata: StorageMetadata,
  kind: "resume" | "photo",
  accountId: number,
  singleId: number,
  storageUrl: string,
  serviceRoleKey: string,
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
  if (
    metadata.filename !== filename ||
    metadata.mimeType !== String(mimeType).toLowerCase() ||
    metadata.size !== expectedSize
  ) {
    return null;
  }
  const bytes = await boundedDownload(storageUrl, serviceRoleKey, path);
  if (!bytes || bytes.byteLength > EMAIL_MAX_RAW_BYTES) return null;
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
  accountId?: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  let query = supabase
    .from("outbound_share_history")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .in("outcome", ["email_provider_accepted", "email_delivery_unknown"])
    .gte("created_at", cutoff);
  if (accountId != null) query = query.eq("account_id", accountId);
  const result = await query;
  return result.error ? null : (result.count ?? 0);
}

function allowedAccountIds(value: string | undefined): Set<number> | null {
  if (value == null || value === "") return new Set();
  const ids = new Set<number>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) return null;
    const id = Number(trimmed);
    if (!Number.isSafeInteger(id) || ids.has(id)) return null;
    ids.add(id);
  }
  return ids;
}

function globalDailyCap(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return 40;
  if (!/^\d+$/.test(value.trim())) return null;
  const cap = Number(value.trim());
  return Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}

function singleDisplayName(single: SingleRow): string {
  return safeSubjectName(
    [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
      [single.first_name_he, single.last_name_he].filter(Boolean).join(" "),
  );
}

function configured(env: EmailEnv): boolean {
  return (
    isEnabled(env.OUTBOUND_EMAIL_ENABLED) &&
    Boolean(env.RESEND_API_KEY?.length) &&
    Boolean(env.RESEND_FROM?.length)
  );
}

function unavailable(
  message = "email sending is temporarily unavailable, nothing was sent",
) {
  return fail(message, { code: "unavailable" });
}

function authHeader(c: EmailRequestContext): string | null {
  const value = c.req.header("Authorization");
  return value && /^Bearer\s+\S+$/i.test(value) ? value : null;
}

export function createEmailApp(
  dependencies: Partial<EmailDependencies> = {},
): EmailApp {
  const deps = { ...defaultEmailDependencies, ...dependencies };
  const app = createWorkerApp<EmailEnv>("email") as unknown as EmailApp;
  app.use(
    "*",
    createCorsMiddleware({
      origins: [...PRODUCTION_ORIGINS, ...LOCAL_DEV_ORIGINS],
      methods: ["GET", "POST"],
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
  app.use("/config", async (c, next) => {
    c.header("Cache-Control", "no-store, private");
    await next();
  });

  app.get("/config", async (c) => {
    if (!configured(c.env)) return c.json(unavailable(), 503);
    const authorization = authHeader(c);
    if (!authorization)
      return c.json(fail("missing Authorization header"), 401);
    const supabase = deps.createCallerClient(authorization, c.env);
    const { data: userResult, error: userError } =
      await supabase.auth.getUser();
    if (userError || !userResult.user)
      return c.json(fail("not authenticated"), 401);
    const [
      { data: accountId, error: accountError },
      { data: role, error: roleError },
    ] = await Promise.all([
      supabase.rpc("current_context_id"),
      supabase.rpc("current_member_role"),
    ]);
    const allowlistedAccounts = allowedAccountIds(
      c.env.OUTBOUND_EMAIL_ACCOUNT_IDS,
    );
    if (!allowlistedAccounts) {
      console.warn("email.accountAllowlistMalformed");
      return c.json(unavailable(), 503);
    }
    const replyTo = replyToFor(c.env.OUTBOUND_EMAIL_REPLY_TO);
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
    if (
      accountError ||
      roleError ||
      typeof accountId !== "number" ||
      (role !== "parent_admin" && role !== "self_manager") ||
      !replyTo ||
      !allowlistedAccounts.has(accountId) ||
      memberError ||
      accountMemberError ||
      !member ||
      !accountMember ||
      member.disabled === true
    ) {
      return c.json(unavailable(), 503);
    }
    return c.json(ok({ reply_to: replyTo }));
  });

  app.post("/send", async (c) => {
    if (!configured(c.env)) return c.json(unavailable(), 503);
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

    const supabase = deps.createCallerClient(authorization, c.env);
    const [
      { data: accountId, error: accountError },
      { data: role, error: roleError },
    ] = await Promise.all([
      supabase.rpc("current_context_id"),
      supabase.rpc("current_member_role"),
    ]);
    if (accountError || roleError || typeof accountId !== "number") {
      return c.json(unavailable(), 503);
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
      return c.json(unavailable(), 503);
    }
    if (!replyTo) {
      return c.json(unavailable(), 503);
    }

    // This is an explicit server-side switchboard, separate from AI billing.
    // An empty or malformed list authorises nobody, including when the public
    // feature flag is accidentally enabled during a rollout.
    const allowlistedAccounts = allowedAccountIds(
      c.env.OUTBOUND_EMAIL_ACCOUNT_IDS,
    );
    if (!allowlistedAccounts) {
      console.warn("email.accountAllowlistMalformed");
      return c.json(unavailable(), 503);
    }
    if (!allowlistedAccounts.has(accountId)) {
      return c.json(unavailable(), 503);
    }

    const admin = deps.createAdminClient(c.env);
    const cap = globalDailyCap(c.env.OUTBOUND_EMAIL_GLOBAL_DAILY_CAP);
    if (cap == null) return c.json(unavailable(), 503);
    const globalDaily = await recentEmailCount(admin, ACCOUNT_DAY_MS);
    if (globalDaily == null) return c.json(unavailable(), 503);
    if (globalDaily >= cap) {
      console.warn("email.globalDailyCapReached");
      return c.json(unavailable(), 503);
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
      return c.json(
        fail("you've reached the email sending limit", {
          code: "rate_limited",
        }),
        429,
      );
    }
    const recent = await recentEmailCount(admin, ACCOUNT_WINDOW_MS, accountId);
    const daily = await recentEmailCount(admin, ACCOUNT_DAY_MS, accountId);
    if (recent == null || daily == null) {
      return c.json(unavailable(), 503);
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
      return c.json(
        fail("you've reached the email sending limit", {
          code: "rate_limited",
        }),
        429,
      );
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
      return c.json(
        fail("you've reached the email sending limit", {
          code: "rate_limited",
        }),
        429,
      );
    }
    activeAccounts.add(activeKey);

    try {
      const { data: single, error: singleError } = await supabase
        .from("singles")
        .select(
          "id,account_id,member_id,first_name_en,last_name_en,first_name_he,last_name_he",
        )
        .eq("id", body.single_id)
        .maybeSingle<SingleRow>();
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
        return c.json(
          fail("no email saved for this shadchan", { code: "no_email" }),
          422,
        );
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
        return c.json(
          fail("we couldn't prepare these attachments", {
            code: "prepare_failed",
          }),
          422,
        );
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
        if (
          result.error ||
          !result.data ||
          result.data.visibility !== "shared" ||
          result.data.hidden_at != null
        ) {
          await audit(
            supabase,
            accountId,
            body,
            "email_fetch_failed",
            accountMember.id,
            true,
          );
          return c.json(
            fail("we couldn't prepare these attachments", {
              code: "prepare_failed",
            }),
            422,
          );
        }
        photo = result.data;
      }

      if (
        !isAccountStoragePath(
          resumeFile.path,
          accountId,
          "resume",
          body.single_id,
        ) ||
        (photo != null &&
          !isAccountStoragePath(photo.path, accountId, "photo", body.single_id))
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
          fail("we couldn't prepare these attachments", {
            code: "prepare_failed",
          }),
          422,
        );
      }

      const resumeInfo = await storageMetadata(
        admin,
        resumeFile.path,
        "resume",
        accountId,
        body.single_id,
      );
      const photoInfo = photo
        ? await storageMetadata(
            admin,
            photo.path,
            "photo",
            accountId,
            body.single_id,
          )
        : null;
      const resumeSize = resumeInfo?.size;
      const totalSize =
        resumeSize != null && photoInfo
          ? resumeSize + photoInfo.size
          : resumeSize;
      if (
        !resumeInfo ||
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
          fail("these files are too large or unavailable to email", {
            code: "too_large",
          }),
          413,
        );
      }

      const resumeAttachment = await readAttachment(
        resumeFile.path,
        resumeFile.filename,
        resumeFile.mime_type,
        resumeSize,
        resumeInfo,
        "resume",
        accountId,
        body.single_id,
        c.env.SUPABASE_URL,
        c.env.SUPABASE_SERVICE_ROLE_KEY,
      );
      const photoAttachment =
        photo && photoInfo
          ? await readAttachment(
              photo.path,
              photoInfo.filename,
              photoInfo.mimeType,
              photoInfo.size,
              photoInfo,
              "photo",
              accountId,
              body.single_id,
              c.env.SUPABASE_URL,
              c.env.SUPABASE_SERVICE_ROLE_KEY,
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
        return c.json(
          fail("we couldn't prepare these attachments", {
            code: "prepare_failed",
          }),
          422,
        );
      }

      const result = await deps.sendEmail({
        apiKey: c.env.RESEND_API_KEY,
        from: c.env.RESEND_FROM,
        to: recipient,
        replyTo,
        subject: `Resume for ${singleDisplayName(single)} from MyShadchan`,
        text: `Please find ${singleDisplayName(single)}'s attached resume${photo ? " and photo" : ""} from MyShadchan.`,
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
      const failure = safeProviderFailure(result.error, result.retryable);
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
        return c.json(
          fail("you've reached the email sending limit", {
            code: "rate_limited",
          }),
          429,
        );
      }
      if (failure === "unknown") {
        return c.json(
          fail("we couldn't confirm what happened with the email", {
            code: "ambiguous",
          }),
          503,
        );
      }
      return c.json(
        fail("the email service rejected this email", { code: "rejected" }),
        422,
      );
    } finally {
      activeAccounts.delete(activeKey);
    }
  });
  return app;
}

export default createEmailApp();
