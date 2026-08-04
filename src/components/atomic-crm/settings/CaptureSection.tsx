import { Check, Copy, Mail } from "lucide-react";
import { useTranslate } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item";

import { SectionLabel } from "./SectionLabel";

// Basic shape check, not an RFC-5322 regex — the point is to catch garbage
// (a missing value, or a misconfigured non-email string) before it reaches
// the UI, not to validate deliverability.
const EMAIL_SHAPE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const looksLikeEmail = (value: string): boolean =>
  EMAIL_SHAPE_REGEX.test(value);

/**
 * Story 10.3 (Task 6, AC 5): surfaces the one global inbound-email address
 * (`VITE_INBOUND_EMAIL` — FR22's per-account private address is explicitly
 * out of scope for this story, see the story's Dev Notes) so the phone-less
 * capture path is actually discoverable — before this, nothing in the app
 * ever showed a signed-in member where to forward or CC a redt.
 *
 * Grouped near `CommunicationSection` (both sections are about how things
 * reach this account, not about privacy or family membership) rather than
 * by a fixed position in either settings page — see SettingsPage.tsx /
 * SettingsPageMobile.tsx for the exact slot in each layout.
 *
 * No shared copy-to-clipboard primitive exists yet (the story's Dev Notes:
 * the only two prior `navigator.clipboard` call sites are both deleted by
 * Epic 1) — this mirrors InvitesSection.tsx's own inline `isCopied` pattern
 * rather than inventing a generic component for one more caller.
 */
export const CaptureSection = () => {
  const translate = useTranslate();
  const [isCopied, setIsCopied] = useState(false);

  // Fail closed: local dev without the env var set, and a misconfigured
  // value that isn't shaped like an email (e.g. a mis-set Vercel var),
  // both render nothing rather than showing something broken as a real
  // address — this section is informational, not a blocking requirement.
  const inboundEmail = import.meta.env.VITE_INBOUND_EMAIL as string | undefined;
  if (!inboundEmail || !looksLikeEmail(inboundEmail)) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(inboundEmail).then(() => setIsCopied(true));
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.capture.title", { _: "Capture by email" })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Item size="sm" className="flex-col items-stretch gap-3">
          <ItemContent className="flex-none">
            <ItemDescription>
              {translate("crm.settings.capture.description", {
                _: "Forward or CC any redt to this address — it lands in your own Inbox.",
              })}
            </ItemDescription>
          </ItemContent>
          <div className="flex items-center gap-2">
            <Mail
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              readOnly
              value={inboundEmail}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
            >
              {isCopied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {translate(
                isCopied
                  ? "crm.settings.capture.copied"
                  : "crm.settings.capture.copy",
                { _: isCopied ? "Copied" : "Copy" },
              )}
            </Button>
          </div>
        </Item>
      </ItemGroup>
    </div>
  );
};
