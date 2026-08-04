import { Check, Copy, Mail } from "lucide-react";
import { useGetOne, useTranslate } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item";

import { looksLikeEmail } from "../inbox/looksLikeEmail";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import type { Account } from "../types";
import { SectionLabel } from "./SectionLabel";

/** The live domain every household capture address is minted under
 * (`accounts.inbound_email_token` + this, `01_tables.sql`) — mirrors the
 * same literal `workers/ingest/resolveAccount.ts` and `DeleteDataDialog.tsx`
 * already hardcode. */
const CAPTURE_EMAIL_DOMAIN = "myshadchan.space";

/**
 * Epic 11 (Story 10.3's successor): surfaces THIS household's own inbound
 * capture address — `${accounts.inbound_email_token}@myshadchan.space` — so
 * a signed-in member knows where to forward or CC a redt. Replaces the
 * earlier `VITE_INBOUND_EMAIL`-based single shared address (removed from
 * every environment): the address is now per-household, read from the
 * database, not an env var.
 *
 * Grouped near `CommunicationSection` (both sections are about how things
 * reach this account, not about privacy or family membership) — same slot
 * in `SettingsPage.tsx` / `SettingsPageMobile.tsx` as before.
 *
 * Only a household account has an inbox to capture into
 * (`accounts_inbound_email_token_kind_check`): a shadchanus context, or a
 * still-loading/absent token, both render nothing — informational, never a
 * broken or empty address shown as real.
 */
export const CaptureSection = () => {
  const translate = useTranslate();
  const [isCopied, setIsCopied] = useState(false);

  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const isHousehold = activeContext?.kind === "household";

  const { data: account } = useGetOne<Account>(
    "accounts",
    { id: activeContext?.account_id },
    { enabled: isHousehold && activeContext?.account_id != null },
  );

  if (!isHousehold) return null;

  const inboundEmail = account?.inbound_email_token
    ? `${account.inbound_email_token}@${CAPTURE_EMAIL_DOMAIN}`
    : null;

  // Fail closed: still loading, a malformed/blank token, or (defensively)
  // this branch somehow reached for a non-household account — render
  // nothing rather than a broken or empty address. Mirrors the pre-existing
  // guard this section already had for a misconfigured VITE_INBOUND_EMAIL.
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
            <ItemDescription>
              {translate("crm.settings.capture.explanation", {
                _: "Anyone who knows this address can send to it. Mail from a sender we don't recognize waits in Needs review until you confirm them.",
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
