import { Mail, MessageCircle, Image as ImageIcon, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxSource } from "../types";

/**
 * Presentation metadata for a captured item's source (Epic 2). Icon + short
 * label, so the Inbox reads calmly regardless of where a redt arrived from.
 */
export const INBOX_SOURCE_META: Record<
  InboxSource,
  { label: string; icon: LucideIcon }
> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  sms: { label: "SMS", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
  photo: { label: "Photo", icon: ImageIcon },
  upload: { label: "Upload", icon: Upload },
};

/** The gradient primary CTA recipe (design-language §5.3), shared across the
 * inbox surfaces so its one primary action matches the rest of the app. */
export const INBOX_PRIMARY_CTA_CLASS =
  "inline-flex items-center gap-2 rounded-xl px-4 h-11 font-semibold " +
  "text-primary-foreground bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))] " +
  "shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)] " +
  "transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring] " +
  "hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)] active:scale-[0.97] " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background outline-none";
