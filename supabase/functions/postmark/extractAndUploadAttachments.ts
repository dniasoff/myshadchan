import { decode } from "base64-arraybuffer";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

export type Attachment = {
  title: string;
  type: string;
  path: string;
  src: string;
};

/**
 * Extracts the attachments from the email and upload them to Supabase Storage.
 *
 * Example:
 *   "Attachments": [
 *      {
 *          "Name": "test.txt",
 *          "Content": "VGhpcyBpcyBhdHRhY2htZW50IGNvbnRlbnRzLCBiYXNlLTY0IGVuY29kZWQu",
 *          "ContentType": "text/plain",
 *          "ContentLength": 45
 *      }
 *   ]
 *
 * Return Value:
 * [{
 *    title: "test.txt",
 *    type: "text/plain",
 *    "path": "0.8262106278726917.txt",
 *    "src": "http://127.0.0.1:54321/storage/v1/object/public/attachments/0.8262106278726917.txt",
 * }]
 *
 */
/** How long a generated attachment URL stays valid. The durable reference is the
 * object `path`; callers re-sign on read. AD-9's Worker proxy-stream is the eventual
 * answer (see epics.md "Unowned work" S1). */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const extractAndUploadAttachments = async (
  Attachments: {
    Name: string;
    Content: string;
    ContentType: string;
    ContentLength: number;
  }[],
  accountId: number,
  publicOrigin: string,
): Promise<Attachment[]> => {
  return (
    await Promise.all(
      (Attachments || []).map(async (attachment) => {
        const { Name, Content, ContentType } = attachment;
        if (!Name || !Content || !ContentType) {
          console.warn("Attachment is missing required fields, skipping", {
            attachment,
          });
          return null;
        }

        const decodedContent = decode(Content);
        if (!decodedContent) {
          console.error("Failed to decode attachment content, skipping", {
            attachment,
          });
          return null;
        }

        const fileParts = Name.split(".");
        const fileExt = fileParts.length > 1 ? `.${Name.split(".").pop()}` : "";
        // Account-prefixed, CSPRNG key. The bucket is private and its RLS policies
        // scope on this first path segment, so the prefix is load-bearing, not
        // cosmetic. `Math.random()` was never a secret.
        const fileName = `${accountId}/${crypto.randomUUID()}${fileExt}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("attachments")
          .upload(fileName, decodedContent);

        if (uploadError) {
          console.error("uploadError", uploadError);
          throw new Error("Failed to upload attachment");
        }

        // Signed, expiring URL — never a public one (AD-9, PRV-5, PRV-8). The
        // durable reference is `path`; `src` is a convenience that expires.
        const { data, error: signError } = await supabaseAdmin.storage
          .from("attachments")
          .createSignedUrl(fileName, SIGNED_URL_TTL_SECONDS);

        if (signError || !data) {
          console.error("signError", signError);
          throw new Error("Failed to sign attachment URL");
        }

        return {
          title: Name,
          type: ContentType,
          path: fileName,
          src: fixPublicUrl(data.signedUrl, publicOrigin),
        };
      }),
    )
  ).filter(Boolean) as Attachment[];
};

/*
 * Workaround fix for public URL not working on local environment
 * See https://github.com/orgs/supabase/discussions/37271
 *
 * Replaces http://kong:8000/storage/v1/object/public/attachments/0.08968261048718773.txt with
 * e.g. http://127.0.0.1:54321/storage/v1/object/public/attachments/0.08968261048718773.txt.
 *
 * Story 10.3 review finding F8: this used to read the replacement host from
 * `Deno.env.get("SB_JWT_ISSUER")`, which `supabase/functions/.env` hardcodes
 * to stack 0's port (54321) — correct for `make start`, but wrong for any
 * `STACK_ID != 0` (a stack's Edge Runtime shares that one file with every
 * other stack, since it is not itself stack-scoped). `publicOrigin` is
 * derived by the caller from the INBOUND REQUEST's own URL instead — the
 * origin Postmark (or, in the e2e test, Playwright) actually reached this
 * function on, which is correct per-stack locally with zero new config, and
 * a safe no-op in production: `.replace()` only fires when the string
 * actually contains "http://kong:8000" (Supabase's own internal Docker
 * hostname), which a real hosted project's signed URL never does.
 */
const fixPublicUrl = (url: string, publicOrigin: string) => {
  return url.replace("http://kong:8000", publicOrigin);
};
