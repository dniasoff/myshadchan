export type WhatsAppTextPart = {
  text: string;
  bold: boolean;
};

/**
 * Render only WhatsApp's paired `*bold*` marker. The returned text is still
 * plain data; callers must render it as text (React does that by default), so
 * pasted HTML and script-looking strings are never interpreted as markup.
 */
export function parseWhatsAppText(source: string): {
  parts: WhatsAppTextPart[];
  firstBoldText: string | null;
} {
  const parts: WhatsAppTextPart[] = [];
  let plain = "";
  let firstBoldText: string | null = null;
  let index = 0;

  const flushPlain = () => {
    if (plain) {
      parts.push({ text: plain, bold: false });
      plain = "";
    }
  };

  while (index < source.length) {
    if (source[index] === "*" && source[index + 1] !== "*") {
      const close = source.indexOf("*", index + 1);
      if (close > index + 1 && source[close + 1] !== "*") {
        flushPlain();
        const text = source.slice(index + 1, close);
        parts.push({ text, bold: true });
        if (firstBoldText === null) firstBoldText = text;
        index = close + 1;
        continue;
      }
    }
    plain += source[index];
    index += 1;
  }
  flushPlain();

  return { parts, firstBoldText };
}
