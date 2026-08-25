import { Check, Copy } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useGetMany,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";

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

import { pickActiveContext } from "../providers/commons/roleAuthority";
import type { CrmDataProvider } from "../providers/types";
import { useMyContexts } from "../root/useMyContexts";
import type { Account, Connection, ConnectionInvite } from "../types";
import { ConfirmDestructiveAction } from "./ConfirmDestructiveAction";
import { SectionLabel } from "./SectionLabel";

const GET_LIST_PARAMS = {
  pagination: { page: 1, perPage: 200 },
  sort: { field: "id", order: "ASC" as const },
};

/**
 * Story 8.2 (AC-1, AC-2, AC-3): the consent-based connection workflow's
 * minimal UI — "Connect with a shadchan"/"Connect with a family" (generate
 * a token, share the link out-of-band, AC-2's no-directory-driven-linkage),
 * and "End connection" (AC-3) wherever the connection is visible. The
 * polished Connections list/360 is Story 8.5's; this is only enough to
 * exercise the flow, mirroring InvitesSection.tsx's copy-the-link shape.
 *
 * Branches on the active context's kind — the same account can only ever
 * be one kind (AD-2) — rather than being two separate components each
 * consumer has to remember to pick between.
 */
export const ConnectionSection = () => {
  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);

  if (!activeContext) return null;

  return activeContext.kind === "household" ? (
    <HouseholdConnectionPanel accountId={activeContext.account_id} />
  ) : (
    <ShadchanusConnectionPanel accountId={activeContext.account_id} />
  );
};

/** Shared "generate + copy a connection invite link" control — the token
 * lives only in local state (never re-fetched), exactly like
 * InvitesSection's own `createdLink` shape. */
const GenerateInviteLink = ({
  buttonLabel,
  onCreated,
}: {
  buttonLabel: string;
  onCreated?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [isCreating, setIsCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const token = await dataProvider.createConnectionInvite();
      setCreatedLink(`${window.location.origin}/#/connect/${token}`);
      setIsCopied(false);
      onCreated?.();
    } catch {
      notify("crm.settings.connection_generate_error", {
        type: "error",
        messageArgs: { _: "Couldn't create that invite link. Try again." },
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink).then(() => setIsCopied(true));
  };

  return (
    <div className="space-y-3">
      <Button
        type="button"
        onClick={handleCreate}
        disabled={isCreating}
        className="w-full sm:w-auto"
      >
        {buttonLabel}
      </Button>
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
      ) : null}
    </div>
  );
};

/**
 * Outstanding (pending) connection invites the active context has issued —
 * shared by both panels below. `useGetList` is scoped implicitly to the
 * caller by `connection_invites`' own SELECT policy (`inviter_account_id =
 * current_context_id()`), so no explicit account-id filter is needed here.
 *
 * Review finding F8 (fix): `revoke_connection_invite()` and both
 * dataProvider mirrors existed from Task 3/5 but nothing in `src/` called
 * them — a leaked invite link had no shipped way to be killed before its
 * 7-day expiry. This is that surface.
 */
const PendingInvites = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [revokingId, setRevokingId] = useState<ConnectionInvite["id"] | null>(
    null,
  );

  const {
    data: invites,
    isPending,
    refetch,
  } = useGetList<ConnectionInvite>("connection_invites", {
    ...GET_LIST_PARAMS,
    filter: { status: "pending" },
  });

  const handleRevoke = async (invite: ConnectionInvite) => {
    setRevokingId(invite.id);
    try {
      await dataProvider.revokeConnectionInvite(invite.id);
      await refetch();
    } catch {
      notify("crm.settings.connection_invite_revoke_error", {
        type: "error",
        messageArgs: { _: "Couldn't cancel that invite. Try again." },
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (isPending || !invites || invites.length === 0) return null;

  return (
    <ItemGroup className="overflow-hidden rounded-lg border">
      {invites.map((invite, index) => (
        <div key={invite.id}>
          {index > 0 ? <ItemSeparator /> : null}
          <Item size="sm">
            <ItemContent>
              <ItemTitle className="font-normal">
                {translate("crm.settings.connection_invite_pending_label", {
                  _: "Invite link pending",
                })}
              </ItemTitle>
              <ItemDescription>
                {translate("crm.settings.connection_invite_expires", {
                  _: "Expires %{when}",
                  when: new Date(invite.expires_at).toLocaleDateString(),
                })}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ConfirmDestructiveAction
                triggerLabel={translate(
                  "crm.settings.connection_invite_cancel",
                  { _: "Cancel invite" },
                )}
                title={translate(
                  "crm.settings.connection_invite_cancel_confirm_title",
                  { _: "Cancel this invite link?" },
                )}
                description={translate(
                  "crm.settings.connection_invite_cancel_confirm_body",
                  {
                    _: "The link stops working immediately. Anyone you already sent it to will not be able to connect with it, and you can always generate a new one.",
                  },
                )}
                confirmLabel={translate(
                  "crm.settings.connection_invite_cancel_confirm_button",
                  { _: "Yes, cancel the invite" },
                )}
                disabled={revokingId === invite.id}
                onConfirm={() => handleRevoke(invite)}
              />
            </ItemActions>
          </Item>
        </div>
      ))}
    </ItemGroup>
  );
};

/** Household side: connect to a shadchan, and see/end the household's own
 * accepted connections. Reads `connections` directly, filtered to this
 * account (mirroring `ShadchanusConnectionPanel` below) — NOT derived from
 * the `shadchanim` book row `accept_connection_invite()` seeds.
 *
 * Review finding F3 (fix): deriving the connected list, and its only "End
 * connection" button, from `shadchanim.connection_id` meant a household
 * lost every path to end an accepted connection the moment it deleted that
 * book row (`authenticated` still holds table-level DELETE on `shadchanim`,
 * and `<Edit>` renders a DeleteButton by default) — the connection stayed
 * `accepted` and fully visible to the shadchan side while this panel
 * rendered nothing, which made AC-3 ("either side may end it") false for
 * the household through every shipped surface. `connections` is the ground
 * truth this story's own consent workflow writes to and RLS scopes to
 * either party — reading it directly here can never be lost that way. */
const HouseholdConnectionPanel = ({ accountId }: { accountId: Identifier }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [endingId, setEndingId] = useState<Connection["id"] | null>(null);

  const {
    data: connections,
    isPending,
    refetch: refetchConnections,
  } = useGetList<Connection>("connections", {
    ...GET_LIST_PARAMS,
    filter: { household_account_id: accountId },
  });

  const shadchanusIds = (connections ?? []).map((c) => c.shadchanus_account_id);
  const { data: shadchanusAccounts } = useGetMany<Account>(
    "accounts",
    { ids: shadchanusIds },
    { enabled: shadchanusIds.length > 0 },
  );
  const shadchanusById = new Map(
    (shadchanusAccounts ?? []).map((a) => [String(a.id), a]),
  );

  const handleEnd = async (connection: Connection) => {
    setEndingId(connection.id);
    try {
      await dataProvider.endConnection(connection.id);
      await refetchConnections();
    } catch {
      notify("crm.settings.connection_end_error", {
        type: "error",
        messageArgs: { _: "Couldn't end that connection. Try again." },
      });
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.connection_title", { _: "Connection" })}
      </SectionLabel>
      <div className="space-y-4 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          {translate("crm.settings.connection_household_description", {
            _: "Connect with your family's shadchan so they can see your singles' shidduchim and redt directly.",
          })}
        </p>
        <GenerateInviteLink
          buttonLabel={translate("crm.settings.connection_connect_shadchan", {
            _: "Connect with a shadchan",
          })}
        />
        <PendingInvites />

        {!isPending && connections && connections.length > 0 ? (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {connections.map((connection, index) => {
              const shadchan = shadchanusById.get(
                String(connection.shadchanus_account_id),
              );
              const isEnded = connection.status === "ended";
              return (
                <div key={connection.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle className="font-normal">
                        {shadchan?.name ?? connection.shadchanus_account_id}
                      </ItemTitle>
                      <ItemDescription>
                        {translate(
                          isEnded
                            ? "crm.settings.connection_ended_status"
                            : "crm.settings.connection_active_status",
                          { _: isEnded ? "Connection ended" : "Connected" },
                        )}
                      </ItemDescription>
                    </ItemContent>
                    {!isEnded ? (
                      <ItemActions>
                        <ConfirmDestructiveAction
                          triggerLabel={translate(
                            "crm.settings.connection_end_button",
                            { _: "End connection" },
                          )}
                          title={translate(
                            "crm.settings.connection_end_confirm_title",
                            {
                              _: "End your connection with %{name}?",
                              name:
                                shadchan?.name ??
                                connection.shadchanus_account_id,
                            },
                          )}
                          description={translate(
                            "crm.settings.connection_end_confirm_body_household",
                            {
                              _: "This is immediate and cannot be undone. They will lose access to your singles' shidduchim and can no longer redt through this connection.",
                            },
                          )}
                          confirmLabel={translate(
                            "crm.settings.connection_end_confirm_button",
                            { _: "Yes, end the connection" },
                          )}
                          disabled={endingId === connection.id}
                          onConfirm={() => handleEnd(connection)}
                        />
                      </ItemActions>
                    ) : null}
                  </Item>
                </div>
              );
            })}
          </ItemGroup>
        ) : null}
      </div>
    </div>
  );
};

/** Shadchan side: connect to a family, and see/end the resulting
 * connections. `accounts` is fetched for display names — `connections`
 * itself carries only ids. */
const ShadchanusConnectionPanel = ({
  accountId,
}: {
  accountId: Identifier;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [endingId, setEndingId] = useState<Connection["id"] | null>(null);

  const {
    data: connections,
    isPending,
    refetch: refetchConnections,
  } = useGetList<Connection>("connections", {
    ...GET_LIST_PARAMS,
    filter: { shadchanus_account_id: accountId },
  });

  const householdIds = (connections ?? []).map((c) => c.household_account_id);
  const { data: households } = useGetMany<Account>(
    "accounts",
    { ids: householdIds },
    { enabled: householdIds.length > 0 },
  );
  const householdById = new Map(
    (households ?? []).map((a) => [String(a.id), a]),
  );

  const handleEnd = async (connection: Connection) => {
    setEndingId(connection.id);
    try {
      await dataProvider.endConnection(connection.id);
      await refetchConnections();
    } catch {
      notify("crm.settings.connection_end_error", {
        type: "error",
        messageArgs: { _: "Couldn't end that connection. Try again." },
      });
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.connection_title", { _: "Connection" })}
      </SectionLabel>
      <div className="space-y-4 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          {translate("crm.settings.connection_shadchan_description", {
            _: "Connect with a family so you can see their shidduchim and redt directly.",
          })}
        </p>
        <GenerateInviteLink
          buttonLabel={translate("crm.settings.connection_connect_family", {
            _: "Connect with a family",
          })}
        />
        <PendingInvites />

        {!isPending && connections && connections.length > 0 ? (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {connections.map((connection, index) => {
              const household = householdById.get(
                String(connection.household_account_id),
              );
              const isEnded = connection.status === "ended";
              return (
                <div key={connection.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle className="font-normal">
                        {household?.name ?? connection.household_account_id}
                      </ItemTitle>
                      <ItemDescription>
                        {translate(
                          isEnded
                            ? "crm.settings.connection_ended_status"
                            : "crm.settings.connection_active_status",
                          { _: isEnded ? "Connection ended" : "Connected" },
                        )}
                      </ItemDescription>
                    </ItemContent>
                    {!isEnded ? (
                      <ItemActions>
                        <ConfirmDestructiveAction
                          triggerLabel={translate(
                            "crm.settings.connection_end_button",
                            { _: "End connection" },
                          )}
                          title={translate(
                            "crm.settings.connection_end_confirm_title",
                            {
                              _: "End your connection with %{name}?",
                              name:
                                household?.name ??
                                connection.household_account_id,
                            },
                          )}
                          description={translate(
                            "crm.settings.connection_end_confirm_body_shadchan",
                            {
                              _: "This is immediate and cannot be undone. You will lose access to their singles' shidduchim and can no longer redt through this connection.",
                            },
                          )}
                          confirmLabel={translate(
                            "crm.settings.connection_end_confirm_button",
                            { _: "Yes, end the connection" },
                          )}
                          disabled={endingId === connection.id}
                          onConfirm={() => handleEnd(connection)}
                        />
                      </ItemActions>
                    ) : null}
                  </Item>
                </div>
              );
            })}
          </ItemGroup>
        ) : null}
      </div>
    </div>
  );
};
