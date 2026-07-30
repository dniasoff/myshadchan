import { useState } from "react";
import type { FormEvent } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import type { Single } from "../types";

/** Mirrors `SingleProfileHeader.tsx`'s own display-name fallback. */
const singleDisplayName = (single: Single): string =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `Single #${single.id}`;

/**
 * Story 6.1 (AC-1): the ONE entry point that gives a single their own
 * login — "give {name} their own login", mounted on the single's own
 * record (`entityDescriptorRegions.tsx`'s `SingleActions`), never a second,
 * generic entry in Settings (Dev Notes "One path, from the record" — the
 * action is about THIS row: `record.id` is the invite's `target_single_id`,
 * the gate is this row's own `member_id`, and the post-acceptance indicator
 * belongs on the same surface).
 *
 * Renders only for `parent_admin`/`self_manager` (`useViewerRole()`) on an
 * UNLINKED single (`member_id == null`); renders nothing while the role is
 * still resolving — the same fail-closed `isPending` idiom
 * `shidduchim/SingleInputForm.tsx` uses (RolePending posture, never a
 * flash of the wrong affordance). Once linked, the action is replaced by a
 * read-only indicator — never a substitute for the Task 2/3 database
 * guards, which are the real boundary (AD-1).
 *
 * A `<Popover>`, not a `<Dialog>`: this is a one-tap action with a small
 * form, not a record's own screen, and `misc/recordSurfaceDialogs.guard
 * .test.ts` scans `singles/` for dialog imports (UX-DR3) —
 * `references/ReferenceAttachToShidduch.tsx` is the exact same call for the
 * exact same reason, see its own header comment.
 *
 * Kept out of `entityDescriptorRegions.tsx` on purpose (that module stays a
 * thin adapter list — its own header comment) since this component owns
 * real state (the popover, the email field, the created link).
 */
export function SingleLoginInvite({ single }: { single: Single }) {
  const { role, isPending: isRolePending } = useViewerRole();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  if (isRolePending) return null;
  if (role !== "parent_admin" && role !== "self_manager") return null;

  if (single.member_id != null) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <KeyRound className="size-3.5" />
        {translate("crm.singles.loginInvite.linkedIndicator", {
          _: "Has their own login",
        })}
      </Badge>
    );
  }

  const name = singleDisplayName(single);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEmail("");
      setCreatedLink(null);
      setIsCopied(false);
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!email) return;
    setIsSending(true);
    try {
      const invite = await dataProvider.createInvite(
        email,
        "single",
        single.id,
      );
      setCreatedLink(
        `${window.location.origin}/#/accept-invite/${invite.token}`,
      );
    } catch {
      // Review-fix convention this story mirrors (InvitesSection.tsx): the
      // raw Postgres/dataProvider message never becomes the notify KEY
      // (i18nProvider's allowMissing:true would silently fall back to the
      // inline `_` string for an unknown key, making a translated
      // catalogue entry unreachable dead copy).
      notify("crm.singles.loginInvite.sendError", {
        type: "error",
        messageArgs: { _: "Couldn't send that invite. Try again." },
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink).then(() => setIsCopied(true));
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
          <UserPlus className="size-4" />
          {translate("crm.singles.loginInvite.action", {
            name,
            _: "Give %{name} their own login",
          })}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="flex w-80 flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {translate("crm.singles.loginInvite.description", {
            name,
            _: "%{name} will be able to sign in and see what you share with them.",
          })}
        </p>

        {createdLink ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <Input readOnly value={createdLink} className="text-xs" />
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
                  ? "crm.settings.invites_copied"
                  : "crm.settings.invites_copy",
                { _: isCopied ? "Copied" : "Copy" },
              )}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-3">
            <div className="space-y-1">
              <Label htmlFor="single-invite-email">
                {translate("crm.singles.loginInvite.emailLabel", {
                  _: "Email",
                })}
              </Label>
              <Input
                id="single-invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <Button type="submit" disabled={isSending || !email}>
              {translate("crm.singles.loginInvite.sendButton", {
                _: "Send invite",
              })}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
