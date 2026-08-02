import {
  Handshake,
  Mail,
  MessageCircle,
  Image as ImageIcon,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxSource } from "../types";

/**
 * Presentation metadata for a captured item's source (Epic 2). Icon + short
 * label, so the Inbox reads calmly regardless of where a redt arrived from.
 *
 * `label` is a plain display string, not an i18n key — `InboxList.tsx` (not
 * this story's file) renders it verbatim, so every entry must stay a
 * ready-to-display string. `InboxResolveDialog.tsx` (Story 8.3, Task 4)
 * additionally routes it through the i18nProvider itself
 * (`translate("crm.inbox.source_" + item.source, { _: label })`), which adds
 * a real catalogue entry only for the new `shadchan` value — the other five
 * fall back to this same literal text in every locale, unchanged.
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
  // Story 8.3 (Task 4): a redt sent in-platform by a connected shadchan.
  // Handshake is already imported for the same "connection" concept
  // elsewhere (layout/navItems.ts, settings/PrivacySection.tsx) — reused
  // here rather than adding a new icon dependency for one entry.
  shadchan: { label: "Shadchan", icon: Handshake },
};

/** The gradient primary CTA recipe (design-language §5.3), shared across the
 * inbox surfaces so its one primary action matches the rest of the app. */
export const INBOX_PRIMARY_CTA_CLASS =
  "inline-flex items-center gap-2 rounded-xl px-4 h-11 font-semibold " +
  "text-primary-foreground bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))] " +
  "shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)] " +
  "transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)] " +
  "hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)] active:scale-[0.97] " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background outline-none";
