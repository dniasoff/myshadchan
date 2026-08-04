/**
 * Shared, side-effect-free test fixtures for `workers/ingest`'s suite.
 * Deliberately holds NO `vi.mock(...)` calls — those are per-file (Vitest
 * hoists them within the file that declares them), so each `*.test.ts` file
 * still owns its own `@supabase/supabase-js` mock; only plain data and pure
 * helpers live here.
 */

export const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

/** Turn a plain string into the `ReadableStream<Uint8Array>` shape
 * `message.raw` provides in production — postal-mime accepts either. */
export function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

export interface RawEmailOptions {
  from?: string;
  to?: string;
  subject?: string;
  textBody?: string;
  /** Set to `null` to build a message with NO attachment part at all. */
  attachmentFilename?: string | null;
  attachmentContent?: string;
  attachmentContentType?: string;
}

/**
 * A REAL multipart/mixed RFC-822 message — parsed by the actual `postal-mime`
 * dependency in tests, never a hand-built `{from, to, ...}` object. This is
 * deliberate: `postal-mime` is the whole point of the ported pipeline (an
 * Email Worker gets raw MIME bytes, not pre-parsed JSON), so a fake parsed
 * shape would never exercise it.
 */
export function buildRawEmail(options: RawEmailOptions = {}): string {
  const {
    from = '"Mrs. Feldman" <mrs.feldman@example.com>',
    to = "abc123def456@myshadchan.space",
    subject = "A resume for Rivky",
    textBody = "Hi, please see the attached resume for Rivky.",
    attachmentFilename = "resume.pdf",
    attachmentContent = "PDF-DATA-BYTES",
    attachmentContentType = "application/pdf",
  } = options;

  const boundary = "BOUNDARY-myshadchan-test";
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    textBody,
    "",
  ];

  if (attachmentFilename !== null) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachmentContentType}; name="${attachmentFilename}"`,
      `Content-Disposition: attachment; filename="${attachmentFilename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      btoa(attachmentContent),
      "",
    );
  }

  lines.push(`--${boundary}--`, "");

  return lines.join("\r\n");
}
