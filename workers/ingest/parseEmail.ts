import PostalMime from "postal-mime";

/**
 * One parsed attachment. `content` is always a real `ArrayBuffer` here —
 * `postal-mime` can in principle also hand back a `Uint8Array` or a `string`
 * (see its own `Attachment` type), but only when explicitly configured with
 * a different `attachmentEncoding`; this Worker never passes that option, so
 * the default ("arraybuffer") always applies. `toArrayBuffer()` below
 * normalises defensively anyway, rather than trusting that invariant to hold
 * forever across a dependency upgrade.
 */
export interface ParsedEmailAttachment {
  filename: string | null;
  mimeType: string;
  content: ArrayBuffer;
}

export interface ParsedEmail {
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: ParsedEmailAttachment[];
}

/**
 * Parse the raw RFC-822 MIME stream Cloudflare hands the `email()` handler
 * (`message.raw`) into the fields this Worker needs.
 *
 * This wrapper is the single biggest difference from the retired Postmark
 * webhook path (`supabase/functions/postmark/`): that transport received
 * attachments pre-parsed as base64 JSON in the request body; an Email Worker
 * gets only a raw byte stream and must parse subject/from/to/text/
 * attachments itself. `postal-mime` does that parsing; this function just
 * shapes its output into the fields the rest of this Worker needs.
 */
export async function parseEmail(
  raw: ReadableStream<Uint8Array>,
): Promise<ParsedEmail> {
  const email = await PostalMime.parse(raw);

  return {
    fromEmail: email.from?.address ?? null,
    fromName: email.from?.name ?? null,
    toEmails: (email.to ?? [])
      .map((address) => ("address" in address ? address.address : undefined))
      .filter((address): address is string => Boolean(address)),
    subject: email.subject ?? null,
    text: email.text ?? null,
    html: email.html ?? null,
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      content: toArrayBuffer(attachment.content),
    })),
  };
}

function toArrayBuffer(
  content: ArrayBuffer | Uint8Array | string,
): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;
  if (content instanceof Uint8Array) {
    return content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
  }
  // Only reachable if a future change ever configures `postal-mime` with a
  // non-default `attachmentEncoding` — see this file's `ParsedEmailAttachment`
  // doc comment.
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}
