import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";
import type { ShareAccessLog, ShareLink, Single } from "../types";

type ShareLinkStatus = "active" | "revoked" | "expired";

/** AC-7: expiry is enforced identically to revocation — this is display
 * ONLY, for the sharer's own view (never the public `/share` path, which
 * never distinguishes the two at all, AC-7). */
const statusOf = (link: ShareLink): ShareLinkStatus => {
  if (link.revoked_at) return "revoked";
  if (new Date(link.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
};

const STATUS_LABELS: Record<
  ShareLinkStatus,
  { key: string; fallback: string }
> = {
  active: { key: "crm.sharing.link_list.status_active", fallback: "Active" },
  revoked: {
    key: "crm.sharing.link_list.status_revoked",
    fallback: "Revoked",
  },
  expired: {
    key: "crm.sharing.link_list.status_expired",
    fallback: "Expired",
  },
};

/**
 * AC-8: the sharer's own access-log view (in the app, never the public
 * link) — lists each access with its timestamp. Loaded lazily, only once
 * the dialog is first opened, via the `getShareAccessLog` custom method
 * (`dataProvider.ts`), which is narrowed by `share_access_log`'s own RLS
 * (a caller who cannot see the `share_links` row cannot see its log
 * either).
 */
const AccessLogDialog = ({ shareLinkId }: { shareLinkId: Identifier }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [log, setLog] = useState<ShareAccessLog[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    if (!open || log) return;
    setIsLoading(true);
    try {
      const rows = await dataProvider.getShareAccessLog(shareLinkId);
      setLog(rows);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => void handleOpenChange(open)}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {translate("crm.sharing.link_list.view_access_button", {
            _: "Access log",
          })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate("crm.sharing.link_list.access_log_title", {
              _: "Who accessed this link",
            })}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !log || log.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.sharing.link_list.access_log_empty", {
              _: "No access recorded yet.",
            })}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {log.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span>{entry.resource}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(entry.accessed_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

const GET_LIST_PARAMS = {
  pagination: { page: 1, perPage: 100 },
  sort: { field: "created_at" as const, order: "DESC" as const },
};

/**
 * Story 9.5 (Task 6): the per-single list of active/expired/revoked share
 * links, each with a revoke action (active links only) and the access-log
 * view (AC-8). Revocation calls the `revokeShareLink` custom method — never
 * a generic `dataProvider.update`, which would be refused by the
 * `revoked_at`-only column grant (see `dataProvider.ts`'s own comment on
 * `revokeShareLinkViaUpdate`).
 */
export const ShareLinkList = ({ single }: { single: Single }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [revokingId, setRevokingId] = useState<Identifier | null>(null);

  const {
    data: links,
    isPending,
    refetch,
  } = useGetList<ShareLink>("share_links", {
    ...GET_LIST_PARAMS,
    filter: { single_id: single.id },
  });

  const handleRevoke = async (link: ShareLink) => {
    setRevokingId(link.id);
    try {
      await dataProvider.revokeShareLink(link.id);
      notify("crm.sharing.link_list.revoke_success", {
        messageArgs: { _: "The link has been revoked." },
      });
      await refetch();
    } catch {
      notify("crm.sharing.link_list.revoke_error", {
        type: "error",
        messageArgs: { _: "Couldn't revoke that link. Try again." },
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!links || links.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        {translate("crm.sharing.link_list.empty", {
          _: "No share links yet.",
        })}
      </p>
    );
  }

  return (
    <ItemGroup className="overflow-hidden rounded-lg border">
      {links.map((link, index) => {
        const status = statusOf(link);
        return (
          <div key={link.id}>
            {index > 0 ? <ItemSeparator /> : null}
            <Item size="sm">
              <ItemContent>
                <ItemTitle className="font-normal">
                  {translate(STATUS_LABELS[status].key, {
                    _: STATUS_LABELS[status].fallback,
                  })}
                </ItemTitle>
                <ItemDescription>
                  {translate("crm.sharing.link_list.expires_at", {
                    date: new Date(link.expires_at).toLocaleDateString(),
                    _: "Expires %{date}",
                  })}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="gap-2">
                <AccessLogDialog shareLinkId={link.id} />
                {status === "active" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revokingId === link.id}
                    onClick={() => void handleRevoke(link)}
                  >
                    {translate("crm.sharing.link_list.revoke_button", {
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
  );
};
