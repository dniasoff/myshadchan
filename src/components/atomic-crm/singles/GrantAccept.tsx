import { Loader2 } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";

import { buildRecordPath } from "../entity360/entityPaths";
import { EmptyState } from "../misc/EmptyState";
import type { CrmDataProvider } from "../providers/types";
import type { ChildGrantPreview } from "../types";
import {
  ACCESS_LEVEL_DESCRIPTIONS,
  ACCESS_LEVEL_ICONS,
  ACCESS_LEVEL_LABELS,
} from "./childGrantAccessLevel";

/**
 * Story 13.1's missing half: the accept screen at /accept-grant/:token,
 * reached by an ALREADY-authenticated household member — structurally
 * mirrors `connections/ConnectionAccept.tsx` (Story 8.2's own accept
 * screen for `connection_invites`). Like that flow, there is no anonymous
 * acceptance path: `preview_child_grant()`/`accept_child_grant()` are
 * SECURITY DEFINER RPCs that resolve the caller's own active household
 * account, so the caller must already be logged in with a household
 * context — this is never reachable by a brand-new user the way
 * `login/InviteAcceptance.tsx` is.
 *
 * `preview_child_grant()` returns null for anything other than an open,
 * unexpired grant — unknown, expired, revoked, severed or already-accepted
 * are indistinguishable on purpose (the same enumeration-safety intent
 * `ConnectionAccept`'s own doc comment explains), so this screen shows one
 * generic "not valid" message rather than several distinct ones.
 *
 * The access level is shown in its own, visually distinct block — never
 * folded into the description sentence — because accepting this grant is a
 * real consent moment: the acceptor is agreeing to a specific tier (view /
 * comment / edit) and must not discover what they signed up for later.
 *
 * On success, routes straight to the now-shared single's own record
 * (`buildRecordPath("singles", …)`) using the `target_single_id` the
 * `accept_child_grant()` RPC hands back — there is no separate "grants"
 * list to land on the way `ConnectionAccept` has `/connections`.
 */
export const GrantAccept = () => {
  const { token } = useParams<{ token: string }>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const navigate = useNavigate();
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const [isAccepting, setIsAccepting] = useState(false);

  const {
    data: preview,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["child_grant_preview", token],
    queryFn: (): Promise<ChildGrantPreview | null> =>
      dataProvider.previewChildGrant(token ?? ""),
    enabled: !!token,
  });

  const handleAccept = () => {
    if (!token) return;
    setIsAccepting(true);
    dataProvider
      .acceptChildGrant(token)
      .then(async (grant) => {
        // The proposer's own grant list, and whatever this household's
        // singles roster/summary queries already have cached, are queries
        // this screen never itself ran — invalidate broadly so the
        // destination screen re-fetches rather than showing stale,
        // pre-grant data (mirrors ConnectionAccept's own reasoning).
        await queryClient.invalidateQueries();
        navigate(buildRecordPath("singles", grant.target_single_id));
      })
      .catch(() => {
        // The raw Postgres error must never reach the user directly — it
        // is not localized copy (ConnectionAccept's own review finding F9
        // applies just as much here). Always show one generic, translated
        // message instead.
        notify("crm.child_grant_accept.error", {
          type: "error",
          messageArgs: {
            _: "Couldn't accept that grant. It may already be used or something changed — try the link again.",
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

  if (isError || !preview) {
    return (
      <div className="mx-auto max-w-lg pt-16">
        <EmptyState
          title={translate("crm.child_grant_accept.invalid_title", {
            _: "This link isn't valid",
          })}
          description={translate("crm.child_grant_accept.invalid_description", {
            _: "It may have expired, already been used, or been revoked. Ask the person who sent it for a new one.",
          })}
        />
      </div>
    );
  }

  const singleName =
    preview.target_single_name_en ??
    preview.target_single_name_he ??
    translate("crm.child_grant_accept.fallback_name", {
      _: "this single",
    });
  const AccessLevelIcon = ACCESS_LEVEL_ICONS[preview.access_level];

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pt-16 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {translate("crm.child_grant_accept.title", {
            _: "Share access to %{name}",
            name: singleName,
          })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate("crm.child_grant_accept.description", {
            _: "%{proposer} would like to share %{name}'s record with your household.",
            proposer: preview.proposer_name,
            name: singleName,
          })}
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-left">
        <AccessLevelIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">
            {translate("crm.child_grant_accept.access_level_label", {
              _: "You're being offered: %{level}",
              level: ACCESS_LEVEL_LABELS[preview.access_level],
            })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ACCESS_LEVEL_DESCRIPTIONS[preview.access_level]}
          </p>
        </div>
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
        {translate("crm.child_grant_accept.accept_button", {
          _: "Accept",
        })}
      </Button>
    </div>
  );
};

GrantAccept.path = "/accept-grant/:token";
