import { parseContactInfo } from "./shadchanUtils";

export type OutboundShareChannel = "whatsapp" | "sms" | "email";

export interface OutboundShareChannelOption {
  channel: OutboundShareChannel;
  contact?: string;
  label: string;
  missingReason: string;
}

/** The only contact values used by the manual handoff links. */
export function getOutboundShareChannels(
  contactData: unknown,
): OutboundShareChannelOption[] {
  const parsed = parseContactInfo(contactData);
  return [
    {
      channel: "whatsapp",
      contact: parsed.whatsapp,
      label: "WhatsApp",
      missingReason: "No WhatsApp number saved for this shadchan.",
    },
    {
      channel: "sms",
      contact: parsed.phone,
      label: "Text message",
      missingReason: "No phone number saved for this shadchan.",
    },
    {
      channel: "email",
      contact: parsed.email,
      label: "Email",
      missingReason: "No email saved for this shadchan.",
    },
  ];
}

export function buildOutboundShareMessage(
  singleName: string,
  shadchanName: string,
  includesPhoto: boolean,
): string {
  const files = includesPhoto ? "resume and photo" : "resume";
  const photoNote = includesPhoto ? "" : " A photo was not included.";
  return `Hi ${shadchanName}, here is ${singleName}'s ${files}.${photoNote}`;
}

export function buildManualHandoffMessage(
  singleName: string,
  shadchanName: string,
  includesPhoto: boolean,
): string {
  const files = includesPhoto ? "resume and photo" : "resume";
  const attachment = includesPhoto ? "downloaded files" : "downloaded resume";
  const photoNote = includesPhoto ? "" : " A photo was not included.";
  return `Hi ${shadchanName}, I’m sending ${singleName}'s ${files}.${photoNote} Please attach the ${attachment} before sending.`;
}

export function buildManualHandoffUrl(
  channel: OutboundShareChannel,
  contact: string,
  message: string,
): string {
  const encodedMessage = encodeURIComponent(message);
  if (channel === "email") {
    return `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(
      "Resume",
    )}&body=${encodedMessage}`;
  }
  if (channel === "sms") {
    return `sms:${contact.replace(/[^0-9+]/g, "")}?body=${encodedMessage}`;
  }
  const phoneDigits = contact.replace(/[^0-9]/g, "");
  if (!phoneDigits) return "";
  return `https://wa.me/${phoneDigits}?text=${encodedMessage}`;
}

export function fileKindsForShare(
  includesPhoto: boolean,
): ("resume" | "photo")[] {
  return includesPhoto ? ["resume", "photo"] : ["resume"];
}
