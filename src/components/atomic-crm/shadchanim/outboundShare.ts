import { parseContactInfo } from "./shadchanUtils";

export type OutboundShareChannel = "whatsapp" | "sms" | "email";

export interface OutboundShareChannelOption {
  channel: OutboundShareChannel;
  contact: string;
  label: string;
}

/** The only contact values used by the manual handoff links. */
export function getOutboundShareChannels(
  contactData: unknown,
): OutboundShareChannelOption[] {
  const parsed = parseContactInfo(contactData);
  const options: OutboundShareChannelOption[] = [];
  const whatsapp = parsed.whatsapp ?? parsed.phone;
  if (whatsapp) {
    options.push({ channel: "whatsapp", contact: whatsapp, label: "WhatsApp" });
  }
  if (parsed.phone) {
    options.push({ channel: "sms", contact: parsed.phone, label: "SMS" });
  }
  if (parsed.email) {
    options.push({ channel: "email", contact: parsed.email, label: "Email" });
  }
  return options;
}

export function buildOutboundShareMessage(
  singleName: string,
  shadchanName: string,
  includesPhoto: boolean,
): string {
  const files = includesPhoto ? "resume and photo" : "resume";
  return `Hi ${shadchanName}, attaching ${singleName}'s ${files}.`;
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
    return `sms:${encodeURIComponent(contact)}?body=${encodedMessage}`;
  }
  const phoneDigits = contact.replace(/[^0-9]/g, "");
  return `https://wa.me/${phoneDigits}?text=${encodedMessage}`;
}

export function fileKindsForShare(
  includesPhoto: boolean,
): ("resume" | "photo")[] {
  return includesPhoto ? ["resume", "photo"] : ["resume"];
}
