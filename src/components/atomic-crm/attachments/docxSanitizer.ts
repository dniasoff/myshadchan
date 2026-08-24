/**
 * Converting a Word document into HTML this app will inject into its own DOM,
 * safely. Its own module, not part of `DocxPreview.tsx`, for the same two
 * reasons `attachmentPreview.ts` is separate from the components that consume
 * it: a security boundary is easier to review and to test when it is not
 * interleaved with rendering, and a file that exports both a component and a
 * helper breaks React Fast Refresh (`react-refresh/only-export-components`,
 * the same rule `shidduchim/entityDescriptor.tsx` documents).
 */
/**
 * `mammoth` produces HTML derived from a file any member of the account can
 * upload, and it goes into the DOM — so it is sanitised first, with a vetted
 * library, per `.claude/rules/web-security.md` ("Avoid innerHTML and
 * dangerouslySetInnerHTML unless sanitized first").
 *
 * The allow-list is deliberately narrower than DOMPurify's default: a resume
 * is prose, a few headings, some emphasis, lists and tables. It has no reason
 * to carry a `<form>`, an `<iframe>`, or any attribute at all beyond a table
 * span, so none is permitted. `mammoth` emits images as `data:` URIs, which
 * are dropped with the rest — a Word resume's inline photo is not worth an
 * attribute channel, and the Photo tab is where a photo belongs.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "sup",
  "sub",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "hr",
  "span",
  "div",
];

const ALLOWED_ATTR = ["colspan", "rowspan"];

/**
 * Fetch → convert → sanitise, all inside this tab. Exported so the conversion
 * rules can be tested without a browser fetch: the sanitiser configuration is
 * the security boundary here, exactly as `attachmentPreview.ts`'s allow-list
 * is for the frame.
 */
export async function convertDocxToSafeHtml(
  buffer: ArrayBuffer,
  deps?: {
    convert?: (buffer: ArrayBuffer) => Promise<string>;
    sanitize?: (html: string) => string;
  },
): Promise<string> {
  const convert =
    deps?.convert ??
    (async (input: ArrayBuffer) => {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer: input });
      return result.value;
    });

  const sanitize =
    deps?.sanitize ??
    (await (async () => {
      const { default: DOMPurify } = await import("dompurify");
      return (html: string) =>
        DOMPurify.sanitize(html, {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          // Belt and braces alongside the tag allow-list: neither can appear,
          // and naming them makes the intent legible to the next reader.
          FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
          FORBID_ATTR: ["style", "srcset", "formaction"],
        });
    })());

  return sanitize(await convert(buffer));
}
