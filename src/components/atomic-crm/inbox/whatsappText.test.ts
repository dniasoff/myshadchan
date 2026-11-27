import { describe, expect, it } from "vitest";
import { parseWhatsAppText } from "./whatsappText";

describe("parseWhatsAppText", () => {
  it("preserves the source while exposing paired bold runs", () => {
    const source = "*Sarah Cohen*\nAge: 24\n<not html>";

    expect(parseWhatsAppText(source)).toEqual({
      parts: [
        { text: "Sarah Cohen", bold: true },
        { text: "\nAge: 24\n<not html>", bold: false },
      ],
      firstBoldText: "Sarah Cohen",
    });
  });

  it("leaves unpaired markers as literal text", () => {
    const source = "Name *not finished\nsecond line";

    expect(parseWhatsAppText(source)).toEqual({
      parts: [{ text: source, bold: false }],
      firstBoldText: null,
    });
  });
});
