import { useState } from "react";
import { Paperclip, Plus } from "lucide-react";
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
        transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)]
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
      {/* Story 10.3 (Task 5, AC 1/AC 4): a small chip, not the raw file list
          InboxResolveDialog.tsx renders — this card is a preview, resolving
          is where the attachment is actually reachable. */}
      {item.attachments && item.attachments.length > 0 ? (
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Paperclip className="size-3.5" aria-hidden="true" />
          {item.attachments.length > 1
            ? `${item.attachments[0].title} +${item.attachments.length - 1}`
            : item.attachments[0].title}
        </span>
      ) : null}
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
    // `InboxContent` renders the page's own `<h1>Inbox</h1>`; without this,
    // `<List>` renders a second "Inbox" heading above it, so the word was
    // announced twice on every visit. (`title={false}` still leaves the
    // empty `<h2>` `admin/list.tsx` emits — that renderer bug is shared with
    // 4 other screens and is fixed centrally, not here. See ui-audit-plan
    // §7.11: do not "fix" this by dropping the prop.)
    title={false}
  >
    <InboxContent />
  </List>
);
