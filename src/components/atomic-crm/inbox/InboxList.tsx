import { useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { useGetList, useListContext, useTranslate } from "ra-core";
import { useSearchParams } from "react-router";
import { List } from "@/components/admin/list";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmptyState } from "../misc/EmptyState";
import type { InboxItem } from "../types";
import { formatRedtDate } from "../shidduchim/boardUtils";
import { AddToInboxDialog } from "./AddToInboxDialog";
import { InboxResolveDialog } from "./InboxResolveDialog";
import { NeedsReviewDialog } from "./NeedsReviewDialog";
import { INBOX_PRIMARY_CTA_CLASS, INBOX_SOURCE_META } from "./inboxMeta";

/**
 * The capture inbox (Epic 2 "front door"): un-triaged items that arrived by
 * share / email / upload, each awaiting one calm confirm step. Resolving files
 * a suggestion (via createShidduch, so the catch fires); dismissing keeps it
 * out of the way without losing it. Never an alarming badge — a calm count.
 *
 * Epic 11 adds a second tab: mail from a sender the household hasn't
 * confirmed yet (`status: 'held'`) waits in "Needs review" instead of
 * mixing into the working inbox above — see `NeedsReviewDialog.tsx`.
 */
const InboxCard = ({
  item,
  ctaLabel,
  onOpen,
}: {
  item: InboxItem;
  ctaLabel: string;
  onOpen: (item: InboxItem) => void;
}) => {
  const meta = INBOX_SOURCE_META[item.source];
  const SourceIcon = meta.icon;
  const translate = useTranslate();
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
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
          {item.sender_needs_confirmation ? (
            <span
              className="normal-case font-medium"
              style={{
                color:
                  "color-mix(in oklch, var(--attention) 75%, var(--foreground))",
              }}
            >
              {translate("crm.inbox.senderNeedsConfirmation", {
                _: "Who sent this?",
              })}
            </span>
          ) : item.sender ? (
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
        {ctaLabel}
      </span>
    </button>
  );
};

const CardGridSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {Array.from({ length: 2 }).map((_, index) => (
      <div
        key={index}
        className="h-[120px] animate-pulse rounded-2xl bg-muted"
      />
    ))}
  </div>
);

const SORT_BY_CREATED_DESC = { field: "created_at", order: "DESC" } as const;
const HELD_PAGINATION = { page: 1, perPage: 100 } as const;

/** The one query param the two tabs sync to (web-patterns.md, "URL as
 * state") — a linkable, refresh-proof view of which tab is active. Any
 * value other than "needs-review" (missing, unrecognized, or explicitly
 * "working") resolves to the working inbox, so an old/bad link never lands
 * on a blank tab. */
type InboxTabKey = "working" | "needs-review";
const TAB_QUERY_PARAM = "tab";

const readActiveTab = (searchParams: URLSearchParams): InboxTabKey =>
  searchParams.get(TAB_QUERY_PARAM) === "needs-review"
    ? "needs-review"
    : "working";

const InboxContent = () => {
  // The working inbox's own data (status: 'unresolved') — UNCHANGED from
  // before this tab split: still the resource's own <List> filter below,
  // still this same `useListContext()` read. A held item leaking in here
  // would defeat the entire "Needs review" design, so this filter is not
  // touched by anything added in this file.
  const { data, isPending } = useListContext<InboxItem>();
  const workingItems = data ?? [];

  // The "Needs review" tab's data (status: 'held') — a second, independent
  // read, never merged with the working inbox's ListContext above.
  const { data: heldData, isPending: isPendingHeld } = useGetList<InboxItem>(
    "inbox_items",
    {
      filter: { status: "held" },
      sort: SORT_BY_CREATED_DESC,
      pagination: HELD_PAGINATION,
    },
  );
  const heldItems = heldData ?? [];

  const translate = useTranslate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = readActiveTab(searchParams);

  const [addOpen, setAddOpen] = useState(false);
  const [resolving, setResolving] = useState<InboxItem | null>(null);
  const [reviewing, setReviewing] = useState<InboxItem | null>(null);

  const handleTabChange = (value: string) => {
    const next = value === "needs-review" ? "needs-review" : "working";
    const nextParams = new URLSearchParams(searchParams);
    if (next === "working") {
      // Keep the default tab's URL clean (no `?tab=working` clutter) —
      // absence already reads as "working" via readActiveTab() above.
      nextParams.delete(TAB_QUERY_PARAM);
    } else {
      nextParams.set(TAB_QUERY_PARAM, next);
    }
    setSearchParams(nextParams, { replace: true });
  };

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
            Captured redts, waiting for one confirm step. Who each redt is for
            is not inferred.
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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="working">
            {translate("crm.inbox.tabs.working", { _: "Inbox" })}
          </TabsTrigger>
          <TabsTrigger value="needs-review" className="gap-1.5">
            {translate("crm.inbox.tabs.needsReview", { _: "Needs review" })}
            {/* A calm count, never an alarming dot — matching this file's own
                header comment. Nothing renders at zero. */}
            {heldItems.length > 0 ? (
              <Badge variant="secondary">{heldItems.length}</Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="working" className="mt-4">
          {isPending ? (
            <CardGridSkeleton />
          ) : workingItems.length === 0 ? (
            <EmptyState
              title="Nothing to confirm"
              description="When a resume or redt arrives — shared, emailed, or pasted in — it lands here so nothing slips by. Use “Add to inbox” to drop one in."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {workingItems.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  ctaLabel="Confirm the details →"
                  onOpen={setResolving}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="needs-review" className="mt-4">
          {isPendingHeld ? (
            <CardGridSkeleton />
          ) : heldItems.length === 0 ? (
            <EmptyState
              title={translate("crm.inbox.needsReview.emptyTitle", {
                _: "Nothing waiting on review",
              })}
              description={translate("crm.inbox.needsReview.emptyDescription", {
                _: "Mail from a sender we don't yet recognize for this household waits here until you confirm them.",
              })}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {heldItems.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  ctaLabel={translate("crm.inbox.needsReview.cta", {
                    _: "Review this sender →",
                  })}
                  onOpen={setReviewing}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddToInboxDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {resolving ? (
        <InboxResolveDialog
          item={resolving}
          open={!!resolving}
          onClose={() => setResolving(null)}
        />
      ) : null}
      {reviewing ? (
        <NeedsReviewDialog
          item={reviewing}
          open={!!reviewing}
          onClose={() => setReviewing(null)}
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
