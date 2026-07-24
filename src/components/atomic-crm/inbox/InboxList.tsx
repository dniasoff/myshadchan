import { useState } from "react";
import { Plus } from "lucide-react";
import { useListContext } from "ra-core";
import { List } from "@/components/admin/list";

import { EmptyState } from "../misc/EmptyState";
import type { InboxItem } from "../types";
import { formatRedtDate } from "../shidduchim/boardUtils";
import { AddToInboxDialog } from "./AddToInboxDialog";
import { InboxResolveDialog } from "./InboxResolveDialog";
import { INBOX_PRIMARY_CTA_CLASS, INBOX_SOURCE_META } from "./inboxMeta";

/**
 * The capture inbox (Epic 2 "front door"): un-triaged items that arrived by
 * share / email / upload, each awaiting one calm confirm step. Resolving files
 * a suggestion (via createShidduch, so the catch fires); dismissing keeps it
 * out of the way without losing it. Never an alarming badge — a calm count.
 */
const InboxCard = ({
  item,
  onResolve,
}: {
  item: InboxItem;
  onResolve: (item: InboxItem) => void;
}) => {
  const meta = INBOX_SOURCE_META[item.source];
  const SourceIcon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onResolve(item)}
      className="ql-enter w-full rounded-2xl border border-border bg-card p-4 text-start shadow-sm
        transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
        hover:shadow-md active:scale-[0.99]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background outline-none"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          <SourceIcon className="size-3.5" aria-hidden="true" />
          {meta.label}
          {item.sender ? (
            <span className="normal-case font-normal">· {item.sender}</span>
          ) : null}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatRedtDate(item.created_at?.split("T")[0])}
        </span>
      </div>
      {item.subject ? (
        <p className="mt-2 text-sm font-semibold">{item.subject}</p>
      ) : null}
      {item.raw_text ? (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-foreground">
          {item.raw_text}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          An attachment, ready to file.
        </p>
      )}
      <span className="mt-3 inline-block text-sm font-medium text-primary">
        Confirm the details →
      </span>
    </button>
  );
};

const InboxContent = () => {
  const { data, isPending } = useListContext<InboxItem>();
  const [addOpen, setAddOpen] = useState(false);
  const [resolving, setResolving] = useState<InboxItem | null>(null);

  const items = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Capture
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Inbox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Redts you've captured, waiting for one confirm step. We won't guess
            who they're for.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className={INBOX_PRIMARY_CTA_CLASS}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add to inbox
        </button>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="h-[120px] animate-pulse rounded-2xl bg-muted"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing to confirm"
          description="When a resume or redt arrives — shared, emailed, or pasted in — it lands here so nothing slips by. Use “Add to inbox” to drop one in."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <InboxCard key={item.id} item={item} onResolve={setResolving} />
          ))}
        </div>
      )}

      <AddToInboxDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {resolving ? (
        <InboxResolveDialog
          item={resolving}
          open={!!resolving}
          onClose={() => setResolving(null)}
        />
      ) : null}
    </div>
  );
};

export const InboxList = () => (
  <List
    resource="inbox_items"
    filter={{ status: "unresolved" }}
    sort={{ field: "created_at", order: "DESC" }}
    perPage={100}
    pagination={false}
    actions={false}
    empty={false}
  >
    <InboxContent />
  </List>
);
