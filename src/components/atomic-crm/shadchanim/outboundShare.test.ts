import { describe, expect, it } from "vitest";

import {
  buildManualHandoffMessage,
  buildManualHandoffUrl,
  buildOutboundShareMessage,
  fileKindsForShare,
  getOutboundShareChannels,
} from "./outboundShare";

describe("outbound share helpers", () => {
  it("uses only the explicitly saved contact for each channel", () => {
    expect(
      getOutboundShareChannels({
        phone: "+1 555 0100",
        email: "ronit@example.test",
      }),
    ).toEqual([
      {
        channel: "whatsapp",
        label: "WhatsApp",
        missingReason: "No WhatsApp number saved for this shadchan.",
      },
      {
        channel: "sms",
        contact: "+1 555 0100",
        label: "Text message",
        missingReason: "No phone number saved for this shadchan.",
      },
      {
        channel: "email",
        contact: "ronit@example.test",
        label: "Email",
        missingReason: "No email saved for this shadchan.",
      },
    ]);
    expect(getOutboundShareChannels({ phone: "+15550100" })[0].contact).toBe(
      undefined,
    );
  });

  it("builds native/manual messages and exact audit file kinds", () => {
    expect(buildOutboundShareMessage("Miriam", "Aunty Ronit", false)).toBe(
      "Hi Aunty Ronit, here is Miriam's resume. A photo was not included.",
    );
    expect(buildManualHandoffMessage("Miriam", "Aunty Ronit", true)).toContain(
      "Please attach the downloaded files before sending.",
    );
    expect(fileKindsForShare(false)).toEqual(["resume"]);
    expect(fileKindsForShare(true)).toEqual(["resume", "photo"]);
  });

  it("builds manual handoff links without silently sending", () => {
    const message = "Please attach the downloaded resume before sending.";
    expect(buildManualHandoffUrl("whatsapp", "+1 (555) 0100", message)).toBe(
      "https://wa.me/15550100?text=Please%20attach%20the%20downloaded%20resume%20before%20sending.",
    );
    expect(buildManualHandoffUrl("sms", "+15550100", message)).toContain(
      "sms:+15550100?body=",
    );
    expect(
      buildManualHandoffUrl("email", "ronit@example.test", message),
    ).toContain("mailto:ronit%40example.test?subject=Resume&body=");
  });
});
