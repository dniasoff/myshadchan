import { describe, expect, it } from "vitest";

import {
  buildManualHandoffUrl,
  buildOutboundShareMessage,
  fileKindsForShare,
  getOutboundShareChannels,
} from "./outboundShare";

describe("outbound share helpers", () => {
  it("offers only channels backed by a contact value", () => {
    expect(
      getOutboundShareChannels({
        phone: "+1 555 0100",
        email: "ronit@example.test",
      }),
    ).toEqual([
      { channel: "whatsapp", contact: "+1 555 0100", label: "WhatsApp" },
      { channel: "sms", contact: "+1 555 0100", label: "SMS" },
      { channel: "email", contact: "ronit@example.test", label: "Email" },
    ]);
    expect(getOutboundShareChannels({ phone: 42, secret: "ignored" })).toEqual(
      [],
    );
  });

  it("builds a neutral prepared message and exact audit file kinds", () => {
    expect(buildOutboundShareMessage("Miriam", "Aunty Ronit", false)).toBe(
      "Hi Aunty Ronit, attaching Miriam's resume.",
    );
    expect(fileKindsForShare(false)).toEqual(["resume"]);
    expect(fileKindsForShare(true)).toEqual(["resume", "photo"]);
  });

  it("builds manual handoff links without silently sending", () => {
    const message = "Hi Aunty Ronit, attaching Miriam's resume.";
    expect(buildManualHandoffUrl("whatsapp", "+1 (555) 0100", message)).toBe(
      "https://wa.me/15550100?text=Hi%20Aunty%20Ronit%2C%20attaching%20Miriam's%20resume.",
    );
    expect(buildManualHandoffUrl("sms", "+15550100", message)).toContain(
      "sms:%2B15550100?body=",
    );
    expect(
      buildManualHandoffUrl("email", "ronit@example.test", message),
    ).toContain("mailto:ronit%40example.test?subject=Resume&body=");
  });
});
