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
import type { Account, Connection, Shadchan } from "../types";
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
    <HouseholdConnectionPanel />
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

/** Household side: connect to a shadchan, and see/end the shadchanim book
 * entries this story's consent workflow created (`shadchanim.connection_id`
 * — set only by `accept_connection_invite()`). Scoped implicitly to the
 * caller's own account by RLS — no explicit account id needed here. */
const HouseholdConnectionPanel = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [endingId, setEndingId] = useState<Connection["id"] | null>(null);

  const {
    data: shadchanim,
    isPending,
    refetch: refetchShadchanim,
  } = useGetList<Shadchan>("shadchanim", GET_LIST_PARAMS);

  const connected = (shadchanim ?? []).filter((s) => s.connection_id != null);
  const connectionIds = connected.map((s) => s.connection_id!);

  const { data: connections, refetch: refetchConnections } =
    useGetMany<Connection>(
      "connections",
      { ids: connectionIds },
      { enabled: connectionIds.length > 0 },
    );
  const connectionById = new Map(
    (connections ?? []).map((c) => [String(c.id), c]),
  );

  const handleEnd = async (shadchan: Shadchan) => {
    if (shadchan.connection_id == null) return;
    setEndingId(shadchan.connection_id);
    try {
      await dataProvider.endConnection(shadchan.connection_id);
      await Promise.all([refetchShadchanim(), refetchConnections()]);
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
            _: "Connect with your family's shadchan so they can see your children's suggestions and redt directly.",
          })}
        </p>
        <GenerateInviteLink
          buttonLabel={translate("crm.settings.connection_connect_shadchan", {
            _: "Connect with a shadchan",
          })}
        />

        {!isPending && connected.length > 0 ? (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {connected.map((shadchan, index) => {
              const connection = connectionById.get(
                String(shadchan.connection_id),
              );
              const isEnded = connection?.status === "ended";
              return (
                <div key={shadchan.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle className="font-normal">
                        {shadchan.name}
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={endingId === shadchan.connection_id}
                          onClick={() => handleEnd(shadchan)}
                        >
                          {translate("crm.settings.connection_end_button", {
                            _: "End connection",
                          })}
                        </Button>
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={endingId === connection.id}
                          onClick={() => handleEnd(connection)}
                        >
                          {translate("crm.settings.connection_end_button", {
                            _: "End connection",
                          })}
                        </Button>
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
