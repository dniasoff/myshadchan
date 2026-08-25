import { Check, Copy } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { CrmDataProvider } from "../providers/types";
import type { ShareLink, ShareLinkExpiryDays, Single } from "../types";
import { buildShareUrl } from "./shareToken";

/** AC-1: a fixed set of durations, deliberately not a free datetime picker
 * — kept simple. */
const EXPIRY_OPTIONS: ShareLinkExpiryDays[] = [7, 30, 90];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Story 9.5 (AC-1): the create form — expiry choice (7/30/90 days) and an
 * `include_photo` toggle, generated only after the sharer explicitly
 * clicks "Create share link" (never on dialog open or on a toggle change).
 * `account_id`/`created_by_member_id`/`token` are deliberately never sent —
 * the account is trigger-derived from `current_context_id()`, the member
 * from `auth.uid()`, and `token` is ALWAYS server-overwritten by
 * `set_share_link_token_defaults()` regardless of what a client supplies
 * (AC-2) — this component never even has a token to send.
 *
 * After a successful create, shows the fragment-form share URL
 * (`shareToken.ts#buildShareUrl` — the bearer token rides ONLY in the
 * fragment, never a query string) with a copy button, mirroring
 * `settings/InvitesSection.tsx`'s own "created link" affordance.
 */
export const CreateShareLinkDialog = ({
  single,
  onCreated,
}: {
  single: Single;
  /** Called after a successful create, so a caller listing existing links
   * (`ShareLinkList.tsx`) can refetch without this component knowing how. */
  onCreated?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const [expiryDays, setExpiryDays] = useState<ShareLinkExpiryDays>(7);
  const [includePhoto, setIncludePhoto] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!recipientName.trim()) {
      notify("Please enter a recipient name", { type: "error" });
      return;
    }

    setIsSaving(true);
    try {
      const expiresAt = new Date(
        Date.now() + expiryDays * MS_PER_DAY,
      ).toISOString();
      const { data: link } = await dataProvider.create<ShareLink>(
        "share_links",
        {
          data: {
            single_id: single.id,
            expires_at: expiresAt,
            include_photo: includePhoto,
            recipient_name: recipientName.trim(),
            watermark: watermark,
          },
        },
      );
      setCreatedUrl(buildShareUrl(window.location.origin, link.token));
      setIsCopied(false);
      onCreated?.();
    } catch {
      notify("crm.sharing.create_dialog.create_error", {
        type: "error",
        messageArgs: { _: "Couldn't create the share link. Try again." },
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    if (!createdUrl) return;
    navigator.clipboard.writeText(createdUrl).then(() => setIsCopied(true));
  };

  if (createdUrl) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {translate("crm.sharing.create_dialog.link_ready", {
            _: "Share this link — anyone who has it can view the shared profile until it expires or you revoke it.",
          })}
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={createdUrl}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopy}
            aria-label={translate("crm.sharing.create_dialog.copy_button", {
              _: "Copy",
            })}
          >
            {isCopied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setCreatedUrl(null);
            setIsCopied(false);
          }}
        >
          {translate("crm.sharing.create_dialog.create_another_button", {
            _: "Create another link",
          })}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleCreate} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="share-recipient-name"
          className="block text-sm font-medium text-foreground"
        >
          {translate("crm.sharing.create_dialog.recipient_name", {
            _: "Recipient Name",
          })}
        </label>
        {/* The design-system `Input` rather than a raw `<input>`: it carries
         * the `min-h-11 md:min-h-9` mobile touch floor and the
         * `focus-visible` ring that the hand-rolled `focus:outline-none`
         * here used to remove. The `htmlFor`/`id` pair is what gives this
         * required field an accessible name at all. */}
        <Input
          id="share-recipient-name"
          type="text"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder={translate(
            "crm.sharing.create_dialog.recipient_name_placeholder",
            {
              _: "Enter recipient's name (e.g., shadchan name)",
            },
          )}
          required
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">
          {translate("crm.sharing.create_dialog.expiry", {
            _: "Link expires in",
          })}
        </label>
        <Select
          value={String(expiryDays)}
          onValueChange={(v) => setExpiryDays(Number(v) as ShareLinkExpiryDays)}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={translate(
                "crm.sharing.create_dialog.select_expiry",
                {
                  _: "Select expiry period",
                },
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {translate(`crm.sharing.create_dialog.expiry_${days}`, {
                  _: `${days} days`,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* A Switch is 32px wide by design and its thumb travels ~14px. These
       * rows used to stretch it with `w-full`, which left that same 14px of
       * travel inside a full-width bar — so on/off read only as a track
       * colour, for a real privacy decision. Keep the pill its natural size
       * and pair it with the label instead. */}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label
          htmlFor="share-include-photo"
          className="text-sm font-medium text-foreground"
        >
          {translate("crm.sharing.create_dialog.include_photo", {
            _: "Include photo",
          })}
        </label>
        <Switch
          id="share-include-photo"
          checked={includePhoto}
          onCheckedChange={setIncludePhoto}
          aria-label={translate("crm.sharing.create_dialog.include_photo", {
            _: "Include photo",
          })}
        />
      </div>
      {/*
       * Story 14.6 / PRV-8 — this control is deliberately disabled and
       * relabelled. `applyWatermark()` (workers/share/index.ts:42) is a
       * pass-through stub that returns the blob unchanged, so a switch reading
       * "Add watermark" promised a protection the code never applied, which is
       * a worse failure mode for a privacy control than one that is visibly
       * absent. Re-enable it in the same change that makes applyWatermark()
       * actually composite a watermark — never before.
       */}
      <div className="space-y-2">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label
            htmlFor="share-watermark"
            className="text-sm font-medium text-muted-foreground"
          >
            {translate("crm.sharing.create_dialog.watermark", {
              _: "Add watermark — not available yet",
            })}
          </label>
          <Switch
            id="share-watermark"
            checked={watermark}
            onCheckedChange={setWatermark}
            disabled
            aria-label={translate("crm.sharing.create_dialog.watermark", {
              _: "Add watermark — not available yet",
            })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("crm.sharing.create_dialog.watermarkUnavailable", {
            _: "Shared files are not watermarked yet. This option turns on when watermarking ships.",
          })}
        </p>
      </div>
      <div className="flex justify-end space-x-3">
        {/* `type="button"` is load-bearing: `ui/button.tsx` sets no default
         * type, so inside a <form> this defaults to `submit` — tapping Reset
         * used to clear the fields AND create a real, live share link to a
         * single's profile that nobody asked for. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setExpiryDays(7);
            setIncludePhoto(false);
            setWatermark(false);
            setRecipientName("");
          }}
          disabled={isSaving}
        >
          {translate("ra.action.reset")}
        </Button>
        <Button
          variant="outline"
          type="submit"
          disabled={isSaving || recipientName.trim() === ""}
        >
          {isSaving
            ? translate("crm.sharing.create_dialog.creating", {
                _: "Creating link...",
              })
            : translate("crm.sharing.create_dialog.create_link", {
                _: "Create link",
              })}
        </Button>
      </div>
    </form>
  );
};
