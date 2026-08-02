import { Loader2 } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";

import { useActiveContextKind } from "../layout/navItems";
import { EmptyState } from "../misc/EmptyState";
import type { CrmDataProvider } from "../providers/types";
import type { ConnectionInvitePreview } from "../types";

/**
 * Story 8.2 (Task 6): the accept half of the consent workflow, reached at
 * /connect/:token by an ALREADY-authenticated user — unlike
 * `login/InviteAcceptance.tsx` (Story 2.7's brand-new-user signup flow),
 * there is no anonymous acceptance path here (Task 3's own grant note):
 * accepting requires already being logged in with the opposite-kind
 * context active. `previewConnectionInvite()` returns null for anything
 * other than an open invite — unknown, expired, revoked or already
 * accepted are indistinguishable on purpose (AC-6's enumeration-safety
 * intent), so this screen shows one generic "not valid" message rather
 * than InviteAcceptance's four distinct ones.
 *
 * On success, routes the shadchan side to /connections (8.1's placeholder
 * until 8.5) and the household side to /shadchanim (where the auto-created
 * book row now is) — the story's own Task 6 text, verbatim.
 */
export const ConnectionAccept = () => {
  const { token } = useParams<{ token: string }>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const navigate = useNavigate();
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const activeKind = useActiveContextKind();
  const [isAccepting, setIsAccepting] = useState(false);

  const {
    data: invite,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["connection-invite-preview", token],
    queryFn: (): Promise<ConnectionInvitePreview | null> =>
      dataProvider.previewConnectionInvite(token ?? ""),
    enabled: !!token,
  });

  const handleAccept = () => {
    if (!token) return;
    setIsAccepting(true);
    dataProvider
      .acceptConnectionInvite(token)
      .then(async () => {
        // The household side's new shadchanim row, and either side's
        // connections list, are queries this screen never itself ran —
        // invalidate broadly so the destination screen re-fetches rather
        // than showing stale, pre-connection data.
        await queryClient.invalidateQueries();
        navigate(activeKind === "shadchanus" ? "/connections" : "/shadchanim");
      })
      .catch(() => {
        // Review finding F9: the raw Postgres error (e.g. the unique-
        // constraint message re-inviting an already-connected pair
        // produces) must never reach the user directly — it is not
        // localized copy, and a stray `%` in it would break this same
        // call's use of the message as an i18n key. Always show one
        // generic, translated message instead, mirroring
        // ConnectionSection.tsx's own catch blocks.
        notify("crm.connection_accept.error", {
          type: "error",
          messageArgs: {
            _: "Couldn't accept that invite. It may already be used or something changed — try the link again.",
          },
        });
        setIsAccepting(false);
      });
  };

  if (!token || isPending) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 pt-16">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="mx-auto max-w-lg pt-16">
        <EmptyState
          title={translate("crm.connection_accept.invalid_title", {
            _: "This invite link isn't valid",
          })}
          description={translate("crm.connection_accept.invalid_description", {
            _: "It may have expired, already been used, or been revoked. Ask the person who sent it for a new one.",
          })}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pt-16 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {translate("crm.connection_accept.title", {
            _: "Connect with %{name}",
            name: invite.inviter_name,
          })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate("crm.connection_accept.description", {
            _: "%{name} would like to connect with you on MyShadchan.",
            name: invite.inviter_name,
          })}
        </p>
      </div>
      <Button
        type="button"
        onClick={handleAccept}
        disabled={isAccepting}
        className="mx-auto"
      >
        {isAccepting ? (
          <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {translate("crm.connection_accept.accept_button", { _: "Accept" })}
      </Button>
    </div>
  );
};

ConnectionAccept.path = "/connect/:token";
