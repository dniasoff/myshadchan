import { formatDistanceToNow } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  invitableRoles,
  pickActiveContext,
} from "../providers/commons/roleAuthority";
import type { CrmDataProvider } from "../providers/types";
import { useMyContexts } from "../root/useMyContexts";
import type { Invite, InvitableRole } from "../types";
import { SectionLabel } from "./SectionLabel";

const ROLE_LABELS: Record<InvitableRole, { key: string; fallback: string }> = {
  parent_admin: {
    key: "crm.settings.invites_role_parent_admin",
    fallback: "Parent / admin",
  },
  helper: { key: "crm.settings.invites_role_helper", fallback: "Helper" },
  single: { key: "crm.settings.invites_role_single", fallback: "Single" },
  shadchan: {
    key: "crm.settings.invites_role_shadchan",
    fallback: "Shadchan",
  },
};

const STATUS_LABELS: Record<
  Invite["status"],
  { key: string; fallback: string }
> = {
  pending: {
    key: "crm.settings.invites_status_pending",
    fallback: "Pending",
  },
  accepted: {
    key: "crm.settings.invites_status_accepted",
    fallback: "Accepted",
  },
  revoked: {
    key: "crm.settings.invites_status_revoked",
    fallback: "Revoked",
  },
  expired: {
    key: "crm.settings.invites_status_expired",
    fallback: "Expired",
  },
};

/**
 * AC-4: `invites.status` only flips to `'expired'` lazily (there is no cron
 * sweep — see the story's Dev Notes "Expiry is read-time, not a background
 * job"), so a `'pending'` row past its own `expires_at` is folded to
 * `'expired'` here for DISPLAY, mirroring `get_invite_preview()`'s
 * identical server-side computation. The row's stored status is left
 * untouched — this never writes anything.
 */
const effectiveStatus = (invite: Invite): Invite["status"] =>
  invite.status === "pending" && new Date(invite.expires_at) < new Date()
    ? "expired"
    : invite.status;

const GET_LIST_PARAMS = {
  pagination: { page: 1, perPage: 100 },
  sort: { field: "created_at", order: "DESC" as const },
};

/**
 * Story 2.8: the ONE screen that sends every kind of household invite
 * (AC-1) — parent/admin, helper, single, or (from a shadchanus context)
 * shadchan — with a shareable, copyable link (AC-2 — no outbound email is
 * sent by this story, a deliberate Phase-1 scope call, see the story's
 * AC-2 note) and a revoke action on anything still pending (AC-3). Also
 * lists every invite's email/role/status, computing `expired` for display
 * (AC-4).
 *
 * The role selector's option set mirrors `create_invite()`'s own
 * authority/kind checks client-side (`invitableRoles`,
 * `providers/commons/roleAuthority.ts`) so a non-owning caller (e.g. a
 * `helper`) sees no invitable options — and no send form at all — rather
 * than an error after submitting. `create_invite()`'s own server-side
 * check remains the real enforcement; this is UX only.
 */
export const InvitesSection = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: contexts } = useMyContexts();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<Invite["id"] | null>(null);

  const {
    data: invites,
    isPending,
    refetch,
  } = useGetList<Invite>("invites", GET_LIST_PARAMS);

  const activeContext = pickActiveContext(contexts);
  const roleOptions = activeContext
    ? invitableRoles(activeContext.role, activeContext.kind)
    : [];
  // Derived, not stored (web-patterns.md: "derive values instead of storing
  // redundant computed state") — falls back to the first available option
  // so the Select is never handed an empty value once options exist.
  const selectedRole =
    role && roleOptions.includes(role) ? role : (roleOptions[0] ?? null);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !selectedRole) return;
    setIsSending(true);
    try {
      const invite = await dataProvider.createInvite(email, selectedRole);
      setCreatedLink(
        `${window.location.origin}/#/accept-invite/${invite.token}`,
      );
      setEmail("");
      setRole(null);
      setIsCopied(false);
      await refetch();
    } catch {
      // Review finding #2: `error.message` (raw Postgres text, e.g. "role %
      // may not send invites") must never be passed as the notify KEY — the
      // i18n provider's `allowMissing: true` (i18nProvider.ts) makes a
      // missing key silently fall back to the inline `_` string, which made
      // the French `invites_send_error` catalogue entry unreachable dead
      // copy. Always notify with the real, translated key.
      notify("crm.settings.invites_send_error", {
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

  const handleRevoke = async (invite: Invite) => {
    setRevokingId(invite.id);
    try {
      await dataProvider.revokeInvite(invite.id);
      await refetch();
    } catch {
      // Review finding #2 — see the matching comment in handleSend above.
      notify("crm.settings.invites_revoke_error", {
        type: "error",
        messageArgs: { _: "Couldn't revoke that invite. Try again." },
      });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.invites_title", { _: "Invites" })}
      </SectionLabel>
      <div className="space-y-4 rounded-lg border p-4">
        {roleOptions.length > 0 ? (
          <form
            onSubmit={handleSend}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1">
              <label
                htmlFor="invite-email"
                className="text-xs font-medium text-muted-foreground"
              >
                {translate("crm.settings.invites_email_label", {
                  _: "Email",
                })}
              </label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="invite-role"
                className="text-xs font-medium text-muted-foreground"
              >
                {translate("crm.settings.invites_role_label", {
                  _: "Role",
                })}
              </label>
              <Select
                value={selectedRole ?? undefined}
                onValueChange={(value) => setRole(value as InvitableRole)}
              >
                <SelectTrigger id="invite-role" className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {translate(ROLE_LABELS[option].key, {
                        _: ROLE_LABELS[option].fallback,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={isSending || !email}>
              {translate("crm.settings.invites_send_button", {
                _: "Send invite",
              })}
            </Button>
          </form>
        ) : null}

        {createdLink ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            {/* The label is not decoration: this input had no accessible name,
             * so it was reachable only as `input[readonly]` — and Settings now
             * renders a second unlabelled readonly input (the inbound capture
             * address, CaptureSection.tsx:98), which made that selector
             * ambiguous and failed invite-sending.spec.ts with a Playwright
             * strict-mode violation. Naming it fixes the a11y gap and gives the
             * test a role-based handle, which is this repo's e2e convention
             * (e2e/ uses no getByTestId at all). */}
            <Input
              readOnly
              value={createdLink}
              className="text-xs"
              aria-label={translate("crm.settings.invites_link_label", {
                _: "Invite link",
              })}
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
                  ? "crm.settings.invites_copied"
                  : "crm.settings.invites_copy",
                { _: isCopied ? "Copied" : "Copy" },
              )}
            </Button>
          </div>
        ) : null}

        {isPending || !invites || invites.length === 0 ? (
          !isPending ? (
            <p className="px-1 text-sm text-muted-foreground">
              {translate("crm.settings.invites_empty", {
                _: "No invites sent yet",
              })}
            </p>
          ) : null
        ) : (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {invites.map((invite, index) => {
              const status = effectiveStatus(invite);
              const roleCopy = ROLE_LABELS[invite.role]
                ? translate(ROLE_LABELS[invite.role].key, {
                    _: ROLE_LABELS[invite.role].fallback,
                  })
                : invite.role;
              return (
                <div key={invite.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle className="font-normal">
                        {invite.email}
                      </ItemTitle>
                      <ItemDescription>
                        {status === "pending"
                          ? translate("crm.settings.invites_expires_in", {
                              _: "%{role} · expires %{when}",
                              role: roleCopy,
                              when: formatDistanceToNow(
                                new Date(invite.expires_at),
                                { addSuffix: true },
                              ),
                            })
                          : roleCopy}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="gap-2">
                      <Badge
                        variant={status === "pending" ? "secondary" : "outline"}
                      >
                        {translate(STATUS_LABELS[status].key, {
                          _: STATUS_LABELS[status].fallback,
                        })}
                      </Badge>
                      {/* Review finding #1: gate on the caller's own
                          invite-capable authority (roleOptions is [] for a
                          non-invite-capable role, e.g. helper/single), not
                          merely the invite's own status — otherwise a
                          non-owning viewer sees a Revoke button that always
                          fails server-side, the exact "error after
                          submitting" UX AC-1 designs the send form against. */}
                      {status === "pending" && roleOptions.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={revokingId === invite.id}
                          onClick={() => handleRevoke(invite)}
                        >
                          {translate("crm.settings.invites_revoke", {
                            _: "Revoke",
                          })}
                        </Button>
                      ) : null}
                    </ItemActions>
                  </Item>
                </div>
              );
            })}
          </ItemGroup>
        )}
      </div>
    </div>
  );
};
