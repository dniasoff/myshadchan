// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  extractOriginalSender,
  getForwardedMailContent,
  stripSubjectForwardingPrefix,
} from "./forwardedParser.ts";
import { getExpectedAuthorization } from "./getExpectedAuthorization.ts";
import { timingSafeEqual } from "./timingSafeEqual.ts";
import { extractAndUploadAttachments } from "./extractAndUploadAttachments.ts";
import { buildInboxItemPayload } from "./buildInboxItemPayload.ts";
import {
  createInboxItemFromEmail,
  resolveHouseholdAccountIdForMemberEmail,
} from "./createInboxItemFromEmail.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

/**
 * The three Basic-Auth / IP-allowlist secrets this webhook cannot run
 * without. Read HERE — inside the request handler, not at module scope —
 * so a missing/rotated secret produces a per-request, log-visible 500
 * instead of an import-time crash that takes the whole function down before
 * it can even report why (Story 10.3, AC 7: before this, the deployed
 * function never booted in production at all; every invocation returned an
 * opaque `500 WORKER_ERROR`). `console.error`s a specific, greppable message
 * naming whichever one is missing; returns null (never throws) so the
 * caller can turn that into a normal Response.
 */
function readWebhookSecrets(): {
  webhookUser: string;
  webhookPassword: string;
  rawAuthorizedIPs: string;
} | null {
  const webhookUser = Deno.env.get("POSTMARK_WEBHOOK_USER");
  if (!webhookUser) {
    console.error("postmark: missing POSTMARK_WEBHOOK_USER env variable");
    return null;
  }

  const webhookPassword = Deno.env.get("POSTMARK_WEBHOOK_PASSWORD");
  if (!webhookPassword) {
    console.error("postmark: missing POSTMARK_WEBHOOK_PASSWORD env variable");
    return null;
  }

  const rawAuthorizedIPs = Deno.env.get("POSTMARK_WEBHOOK_AUTHORIZED_IPS");
  if (!rawAuthorizedIPs) {
    console.error(
      "postmark: missing POSTMARK_WEBHOOK_AUTHORIZED_IPS env variable",
    );
    return null;
  }

  return { webhookUser, webhookPassword, rawAuthorizedIPs };
}

/**
 * The origin the caller actually reached this function on — used to rewrite
 * Storage's internal `http://kong:8000` signed-URL host into something the
 * recipient can open (see extractAndUploadAttachments.ts's `fixPublicUrl`).
 *
 * Deliberately NOT `new URL(req.url).origin`. Review finding F8 replaced a
 * hardcoded `SB_JWT_ISSUER` (wrong for every STACK_ID != 0) with exactly
 * that, and it is wrong in a worse way: inside the Edge Runtime `req.url` is
 * the container's own internal listener, so every stored `src` pointed at an
 * address no client can reach. Measured against the real local stack —
 * `req.url = http://127.0.0.1:8081/postmark`, `host =
 * supabase_edge_runtime_…:8081` — and caught by e2e/email-ingress.spec.ts,
 * whose byte comparison failed with ECONNREFUSED on port 8081.
 *
 * Kong passes the real client-facing origin in the standard forwarded
 * headers (measured on the same request: `x-forwarded-proto: http`,
 * `x-forwarded-host: 127.0.0.1`, `x-forwarded-port: 54351`), which is
 * correct per-stack locally with no new config. `req.url` remains the
 * last-resort fallback for a caller that sets no forwarded headers at all —
 * no worse than the behaviour this replaces, and unreachable in production,
 * where a hosted project's signed URL never contains `http://kong:8000` for
 * `fixPublicUrl` to rewrite in the first place.
 */
export const resolvePublicOrigin = (req: Request): string => {
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host");
  if (!proto || !host) return new URL(req.url).origin;

  // `x-forwarded-host` carries the hostname only; the port is its own header.
  // Omit it when it is the scheme's default (production is https/443) so the
  // origin reads as a normal URL rather than `https://host:443`.
  const port = req.headers.get("x-forwarded-port");
  const isDefaultPort =
    (proto === "https" && port === "443") ||
    (proto === "http" && port === "80");
  return port && !isDefaultPort && !host.includes(":")
    ? `${proto}://${host}:${port}`
    : `${proto}://${host}`;
};

/**
 * The inbound-email webhook handler, extracted and exported (Story 10.3,
 * AC 3 / AC 7) so an integration test can exercise it directly, in-process
 * — `Deno.serve` below is the only production entry point. Otherwise the
 * same logic this function always ran, unchanged.
 */
export async function handleInboundEmail(req: Request): Promise<Response> {
  const secrets = readWebhookSecrets();
  if (!secrets) {
    // The specific missing variable is in the server log
    // (readWebhookSecrets above), never in the response body — Postmark,
    // not an operator with log access, is what reads this.
    return new Response("Server misconfigured", { status: 500 });
  }
  const { webhookUser, webhookPassword, rawAuthorizedIPs } = secrets;

  // Deliberately NOT one of the three required secrets above: this only
  // gates the "strip forwarding chrome for the shared address" convenience
  // branch below, exactly as before this story. A member's own forward
  // still files correctly with it unset — a missing/rotated value here must
  // never 500 the whole capture path the way a missing Basic-Auth secret
  // does.
  const INBOUND_EMAIL = (
    Deno.env.get("VITE_INBOUND_EMAIL") || ""
  ).toLowerCase();

  let response: Response | undefined;

  response = checkRequestTypeAndHeaders(
    req,
    webhookUser,
    webhookPassword,
    rawAuthorizedIPs,
  );
  if (response) return response;

  const json = await req.json();
  response = checkBody(json);
  if (response) return response;

  const { FromFull, Attachments, ToFull } = json;
  const rawTextBody = json.TextBody;
  let { TextBody, Subject } = json;

  const memberEmail = (FromFull.Email || "").toLowerCase();
  if (!memberEmail) {
    // Return a 403 to let Postmark know that it's no use to retry this request
    // https://postmarkapp.com/developer/webhooks/inbound-webhook#errors-and-retries
    return new Response(
      `Could not extract member email from FromFull: ${FromFull}`,
      { status: 403 },
    );
  }

  const allMembers = await supabaseAdmin.from("members").select("email");
  const memberEmails =
    allMembers.data?.map((m: { email: string }) => m.email) ?? [];

  const firstToEmail = (ToFull[0]?.Email || "").toLowerCase();

  // When a known user forwards/CCs a redt to the private inbox address, strip
  // the forwarding chrome so the captured text reads cleanly in the inbox.
  if (
    INBOUND_EMAIL &&
    ToFull.length === 1 &&
    firstToEmail === INBOUND_EMAIL &&
    memberEmails.includes(memberEmail)
  ) {
    TextBody = getForwardedMailContent(TextBody);
    Subject = stripSubjectForwardingPrefix(Subject);
  }

  // Shidduch capture (Epic 2): file the whole email verbatim into the sender's
  // inbox for one calm confirm step. The sender is the family member who sent
  // or forwarded the redt; their account is resolved via members -> account_members.
  if (!memberEmails.includes(memberEmail)) {
    // Only known MyShadchan users may file captures; never attribute an inbound
    // email to an arbitrary account. 403 tells Postmark not to retry.
    return new Response(
      `Sender ${memberEmail} is not a known MyShadchan user`,
      {
        status: 403,
      },
    );
  }

  const accountId = await resolveHouseholdAccountIdForMemberEmail(memberEmail);
  if (!accountId) {
    return new Response(`No MyShadchan account for sender ${memberEmail}`, {
      status: 403,
    });
  }

  // Story 10.2: recover the original sender from forwarded headers (FR24).
  // Run on the UNSTRIPPED body — stripping discards the very headers we need.
  let originalSender = extractOriginalSender(rawTextBody);
  // A self-referential "From:" (the member forwarded their own earlier message)
  // is not useful attribution and must not be shown as confident recovery.
  if (
    originalSender.email &&
    originalSender.email.toLowerCase() === memberEmail
  ) {
    originalSender = { name: null, email: null, needsConfirmation: true };
  }

  // Review finding F8: the origin THIS request actually arrived on — never
  // a hardcoded env var — so the signed-URL host fix-up in
  // extractAndUploadAttachments works correctly under any Supabase stack
  // (each e2e STACK_ID serves on its own port; see that file's own comment).
  const publicOrigin = resolvePublicOrigin(req);
  const attachments = await extractAndUploadAttachments(
    Attachments,
    accountId,
    publicOrigin,
  );

  await createInboxItemFromEmail(
    buildInboxItemPayload({
      accountId,
      textBody: TextBody,
      subject: Subject,
      originalSender,
      attachments,
    }),
  );

  return new Response("OK");
}

// The real Deno Edge Runtime is the only production caller of Deno.serve —
// guarded so importing this module (the "functions" Vitest project,
// index.test.ts) never tries to actually start a server. `typeof Deno` is
// the standard safe way to feature-detect a global that may not exist at
// all: unlike `Deno.serve`, it never throws even when `Deno` itself is
// undeclared.
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handleInboundEmail);
} else {
  // Never true in the real Edge Runtime (both `Deno` and `Deno.serve` are
  // always present there) — only reachable if a future runtime change ever
  // removed `Deno.serve`. Logged loudly rather than silently booting with no
  // request handler registered at all: a step (or, here, a module) that
  // silently skips its own setup is worse than one that fails (Story 10.3's
  // brief — the same shape that let `deploy-workers` skip seven workers for
  // weeks reporting green).
  console.error(
    "postmark: Deno.serve is unavailable — no request handler registered; this function will not receive any traffic",
  );
}

const checkRequestTypeAndHeaders = (
  req: Request,
  webhookUser: string,
  webhookPassword: string,
  rawAuthorizedIPs: string,
) => {
  // Only allow known IP addresses
  // We can use the x-forwarded-for header as it is populated by Supabase
  // https://supabase.com/docs/guides/api/securing-your-api#accessing-request-information
  //
  // Story 10.3 review fix (F-D, non-blocking/medium): this used to accept
  // the request if ANY comma-separated entry matched (`ips.some(...)`) —
  // but `x-forwarded-for` is caller-supplied, and the local Kong gateway
  // was measured to pass it through completely unmodified (unlike
  // `x-forwarded-host`, which it overwrites). A caller who controls the
  // WHOLE header can put a real Postmark IP anywhere in a comma-separated
  // list they invented and `.some()` would accept it. Only the RIGHT-MOST
  // entry is trusted now — the position a well-behaved proxy chain APPENDS
  // to (never prepends), so a client-supplied prefix cannot influence it.
  // This is still a secondary, defense-in-depth control: the
  // Authorization check below (a real, timing-safe-compared secret) is
  // what this endpoint actually depends on, and this check does not by
  // itself distinguish an attacker who reaches Kong directly, bypassing
  // whatever trusted edge proxy fronts the hosted project, from a
  // legitimate caller — that guarantee lives in the network topology, not
  // in this function.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return new Response("Unauthorized", { status: 401 });
  }
  const ips = forwardedFor.split(",").map((ip) => ip.trim());
  const authorizedIPs = rawAuthorizedIPs
    .split(",")
    .map((ip: string) => ip.trim());
  const observedIp = ips[ips.length - 1];
  if (!authorizedIPs.includes(observedIp)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  // Check the Authorization header. Story 10.3 review fix (F-D): a
  // timing-safe compare, not `!==` — this endpoint's Basic-Auth password
  // is the one control here that is not derived from network topology,
  // and a byte-at-a-time short-circuit compare is the wrong risk to
  // accept for free.
  const expectedAuthorization = getExpectedAuthorization(
    webhookUser,
    webhookPassword,
  );
  const authorization = req.headers.get("Authorization");
  if (
    !authorization ||
    !timingSafeEqual(authorization, expectedAuthorization)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
};

// deno-lint-ignore no-explicit-any
const checkBody = (json: any) => {
  const { ToFull, FromFull, Subject, TextBody } = json;

  // In case of incorrect request data, we
  // return a 403 to let Postmark know that it's no use to retry this request
  // https://postmarkapp.com/developer/webhooks/inbound-webhook#errors-and-retries
  if (!ToFull || !ToFull.length)
    return new Response("Missing parameter: ToFull", { status: 403 });
  if (!FromFull)
    return new Response("Missing parameter: FromFull", { status: 403 });
  if (!Subject)
    return new Response("Missing parameter: Subject", { status: 403 });
  if (!TextBody)
    return new Response("Missing parameter: TextBody", {
      status: 403,
    });
};

/* To invoke locally:
  1. Run `make start`
  2. Make sure to have a Member with email "support@postmarkapp.com" (create it if needed)
  3. OPTIONAL: Create a Contact with email "firstname.lastname@marmelab.com"
  4. In another terminal, run `make start-supabase-functions`
  5. In another terminal, make an HTTP request:
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/postmark' \
    --header 'Content-Type: application/json' \
    --header 'Authorization: Basic dGVzdHVzZXI6dGVzdHB3ZA==' \
    --data '{
        "FromName": "Postmarkapp Support",
        "From": "support@postmarkapp.com",
        "FromFull": {
            "Email": "support@postmarkapp.com",
            "Name": "Postmarkapp Support",
            "MailboxHash": ""
        },
        "To": "\"Firstname Lastname\" <firstname.lastname@marmelab.com>",
        "ToFull": [
            {
            "Email": "firstname.lastname@marmelab.com",
            "Name": "Firstname Lastname",
            "MailboxHash": "SampleHash"
            }
        ],
        "Cc": "\"First Cc\" <firstcc@postmarkapp.com>, secondCc@postmarkapp.com",
        "CcFull": [
            {
            "Email": "firstcc@postmarkapp.com",
            "Name": "First Cc",
            "MailboxHash": ""
            },
            {
            "Email": "secondCc@postmarkapp.com",
            "Name": "",
            "MailboxHash": ""
            }
        ],
        "Bcc": "\"First Bcc\" <firstbcc@postmarkapp.com>, secondbcc@postmarkapp.com",
        "BccFull": [
            {
            "Email": "firstbcc@postmarkapp.com",
            "Name": "First Bcc",
            "MailboxHash": ""
            },
            {
            "Email": "secondbcc@postmarkapp.com",
            "Name": "",
            "MailboxHash": ""
            }
        ],
        "OriginalRecipient": "firstname.lastname@marmelab.com",
        "Subject": "Test subject",
        "MessageID": "73e6d360-66eb-11e1-8e72-a8904824019b",
        "ReplyTo": "replyto@postmarkapp.com",
        "MailboxHash": "SampleHash",
        "Date": "Fri, 1 Aug 2014 16:45:32 -04:00",
        "TextBody": "This is a test text body.",
        "HtmlBody": "<html><body><p>This is a test html body.</p></body></html>",
        "StrippedTextReply": "This is the reply text",
        "Tag": "TestTag",
        "Headers": [
            {
            "Name": "X-Header-Test",
            "Value": ""
            },
            {
            "Name": "X-Spam-Status",
            "Value": "No"
            },
            {
            "Name": "X-Spam-Score",
            "Value": "-0.1"
            },
            {
            "Name": "X-Spam-Tests",
            "Value": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS"
            }
        ],
        "Attachments": [
            {
            "Name": "test.txt",
            "Content": "VGhpcyBpcyBhdHRhY2htZW50IGNvbnRlbnRzLCBiYXNlLTY0IGVuY29kZWQu",
            "ContentType": "text/plain",
            "ContentLength": 45
            }
        ]
      }'

      
  To trigger the email forwarding feature, you can change the "To" and "ToFull" fields to have the INBOUND_EMAIL, and add an email address that is neither a member nor the INBOUND_EMAIL, for example:
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/postmark' \
    --header 'Content-Type: application/json' \
    --header 'Authorization: Basic dGVzdHVzZXI6dGVzdHB3ZA==' \
    --data '{
      "FromName": "Postmarkapp Support",
      "MessageStream": "inbound",
      "From": "support@postmarkapp.com",
      "FromFull": {
        "Email": "support@postmarkapp.com",
        "Name": "Postmarkapp Support",
        "MailboxHash": ""
      },
      "To": "2aff30e603e54dc3eb556bd9e03ee099@inbound.postmarkapp.com",
      "ToFull": [
        {
          "Email": "2aff30e603e54dc3eb556bd9e03ee099@inbound.postmarkapp.com",
          "Name": "",
          "MailboxHash": ""
        }
      ],
      "Cc": "",
      "CcFull": [],
      "Bcc": "",
      "BccFull": [],
      "OriginalRecipient": "2aff30e603e54dc3eb556bd9e03ee099@inbound.postmarkapp.com",
      "Subject": "Fwd: Test for forwarding mail",
      "MessageID": "32dcbecb-57d0-476e-9591-c747808cb599",
      "ReplyTo": "",
      "MailboxHash": "",
      "Date": "Thu, 5 Mar 2026 10:41:26 +0100",
      "TextBody": "---------- Forwarded message ---------\nFrom : Original Recipient <original.recipient@company.com>\nDate: Fri, 1 Aug 2014 16:45:32 -04:00\nSubject: Test for forwarding mail\nTo: Postmarkapp Support <support@postmarkapp.com>\n\n\nThe transferred message body\n",
      "HtmlBody": "<div dir=\"ltr\"><br><br><div class=\"gmail_quote gmail_quote_container\"><div dir=\"ltr\" class=\"gmail_attr\">---------- Forwarded message ---------<br>From: <strong class=\"gmail_sendername\" dir=\"auto\">Original Recipient</strong> <span dir=\"auto\">&lt;<a href=\"mailto:original.recipient@company.com\">original.recipient@company.com</a>&gt;</span><br>Date: Fri, 1 Aug 2014 16:45:32 -04:00<br>Subject: Test for forwarding mail<br>To: Postmarkapp Support &lt;<a href=\"mailto:support@postmarkapp.com\">support@postmarkapp.com</a>&gt;<br></div><br><br><div dir=\"ltr\">The transferred message body</div>\n</div></div>\n",
      "StrippedTextReply": "",
      "Tag": "",
      "Headers": [
            {
                "Name": "X-Header-Test",
                "Value": ""
            },
            {
                "Name": "X-Spam-Status",
                "Value": "No"
            },
            {
                "Name": "X-Spam-Score",
                "Value": "-0.1"
            },
            {
                "Name": "X-Spam-Tests",
                "Value": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS"
            }
      ],
      "Attachments": []
    }'

*/
