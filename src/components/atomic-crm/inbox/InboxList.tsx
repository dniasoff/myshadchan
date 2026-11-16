import { useEffect, useRef, useState } from "react";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useListContext,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useSearchParams } from "react-router";
import { List } from "@/components/admin/list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmptyState } from "../misc/EmptyState";
import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import { canPickResumeFromInbox } from "../resumes/resumeInbox";
import type { InboxItem } from "../types";
import { formatRedtDate } from "../shidduchim/boardUtils";
import { AddToInboxDialog } from "./AddToInboxDialog";
import { INBOX_DELETE_UNDO_MS, canDeleteInboxItem } from "./inboxDelete";
import { InboxDeleteDialog } from "./InboxDeleteDialog";
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
  onDelete,
}: {
  item: InboxItem;
  ctaLabel: string;
  onOpen: (item: InboxItem) => void;
  onDelete: (item: InboxItem, trigger: HTMLButtonElement) => void;
}) => {
  const meta = INBOX_SOURCE_META[item.source];
  const SourceIcon = meta.icon;
  const translate = useTranslate();
  return (
    <article className="ql-enter w-full rounded-2xl border border-border bg-card shadow-sm transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)] hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="w-full rounded-2xl p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
      </button>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="text-start text-sm font-medium text-primary outline-none focus-visible:underline"
        >
          {ctaLabel}
        </button>
        {canDeleteInboxItem(item) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Delete ${
              item.subject ||
              item.raw_text?.slice(0, 48) ||
              item.attachments?.[0]?.title ||
              meta.label
            }`}
            onClick={(event) => onDelete(item, event.currentTarget)}
            className="min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        ) : null}
      </div>
    </article>
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

  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = readActiveTab(searchParams);

  const [addOpen, setAddOpen] = useState(false);
  const [resolving, setResolving] = useState<InboxItem | null>(null);
  const [reviewing, setReviewing] = useState<InboxItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<InboxItem | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, InboxItem>>(
    new Map(),
  );
  const [deleteDeadlines, setDeleteDeadlines] = useState<Map<string, number>>(
    new Map(),
  );
  const deleteTimers = useRef(new Map<string, number>());
  const finalizingDeletes = useRef(new Set<string>());
  const confirmingDelete = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [deleteClock, setDeleteClock] = useState(() => Date.now());

  useEffect(() => {
    try {
      const drain = (
        dataProvider as unknown as {
          drainInboxAttachmentPurge?: () => Promise<unknown>;
        }
      ).drainInboxAttachmentPurge;
      if (typeof drain === "function") {
        void Promise.resolve(drain()).catch(() => undefined);
      }
    } catch {
      // Fake/test providers without the optional durable purge method simply
      // have no queue to drain.
    }
  }, [dataProvider]);

  useEffect(
    () => () => {
      // A pending deletion is intentionally cancelled when this screen
      // unmounts (including a tab close). The row was never deleted, so the
      // safe outcome is that it remains in the Inbox for the next visit.
      for (const timer of deleteTimers.current.values()) {
        window.clearTimeout(timer);
      }
      deleteTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (pendingDeletes.size === 0) return;
    const interval = window.setInterval(() => {
      setDeleteClock(Date.now());
    }, 100);
    return () => window.clearInterval(interval);
  }, [pendingDeletes.size]);

  const removePendingDelete = (key: string) => {
    setPendingDeletes((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setDeleteDeadlines((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const finalizeDelete = async (item: InboxItem, key: string) => {
    try {
      const result = await dataProvider.deleteInboxItem(item.id);
      removePendingDelete(key);
      setNotice(
        result?.purgePending
          ? "Deleted. Some files will be removed shortly."
          : "Item deleted.",
      );
      refresh();
    } catch (error) {
      // The server RPC commits the row delete and purge queue atomically. A
      // refusal leaves the row intact; Storage failures are reported as a
      // pending purge result, never as a false "nothing changed" message.
      removePendingDelete(key);
      const message =
        error instanceof Error &&
        error.message === "This item cannot be deleted automatically."
          ? error.message
          : "Could not delete automatically. The item is still here.";
      setNotice(message);
      notify(message, { type: "error" });
    } finally {
      deleteTimers.current.delete(key);
      finalizingDeletes.current.delete(key);
    }
  };

  const handleDeleteConfirm = () => {
    if (
      confirmingDelete.current ||
      !deleteCandidate ||
      !canDeleteInboxItem(deleteCandidate)
    )
      return;
    confirmingDelete.current = true;
    const item = deleteCandidate;
    const key = String(item.id);
    closeDeleteDialog();
    setNotice(null);
    setDeleteDeadlines((current) => {
      const next = new Map(current);
      next.set(key, Date.now() + INBOX_DELETE_UNDO_MS);
      return next;
    });
    setPendingDeletes((current) => {
      const next = new Map(current);
      next.set(key, item);
      return next;
    });
    const timer = window.setTimeout(() => {
      finalizingDeletes.current.add(key);
      void finalizeDelete(item, key);
    }, INBOX_DELETE_UNDO_MS);
    deleteTimers.current.set(key, timer);
  };

  const handleUndo = (key: string) => {
    if (finalizingDeletes.current.has(key)) return;
    const timer = deleteTimers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    deleteTimers.current.delete(key);
    removePendingDelete(key);
    confirmingDelete.current = false;
    setNotice("Item restored.");
  };

  const handleDeleteRequested = (
    item: InboxItem,
    trigger: HTMLButtonElement,
  ) => {
    if (!canDeleteInboxItem(item)) return;
    confirmingDelete.current = false;
    deleteTrigger.current = trigger;
    setDeleteCandidate(item);
  };

  const closeDeleteDialog = () => {
    confirmingDelete.current = false;
    setDeleteCandidate(null);
    window.requestAnimationFrame(() => deleteTrigger.current?.focus());
  };

  const isPendingDelete = (item: InboxItem) =>
    pendingDeletes.has(String(item.id));
  const visibleWorkingItems = workingItems.filter(
    (item) => !isPendingDelete(item),
  );
  const visibleHeldItems = heldItems.filter((item) => !isPendingDelete(item));

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

      {pendingDeletes.size > 0 ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          {[...pendingDeletes.keys()].map((key) => {
            const timeRemaining = Math.max(
              0,
              (deleteDeadlines.get(key) ?? deleteClock) - deleteClock,
            );
            return (
              <div
                key={key}
                role="status"
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold">Item deleted.</p>
                  <p className="text-xs text-muted-foreground">
                    Undo is available for 10 seconds.
                  </p>
                  <div
                    className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Undo time remaining"
                    aria-valuemin={0}
                    aria-valuemax={INBOX_DELETE_UNDO_MS}
                    aria-valuenow={timeRemaining}
                  >
                    <div
                      className="h-full bg-primary transition-[width] duration-100"
                      style={{
                        width: `${(timeRemaining / INBOX_DELETE_UNDO_MS) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleUndo(key)}
                >
                  Undo
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="text-sm text-muted-foreground">
          {notice}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="working">
            {translate("crm.inbox.tabs.working", { _: "Inbox" })}
          </TabsTrigger>
          <TabsTrigger value="needs-review" className="gap-1.5">
            {translate("crm.inbox.tabs.needsReview", { _: "Needs review" })}
            {/* A calm count, never an alarming dot — matching this file's own
                header comment. Nothing renders at zero. */}
            {visibleHeldItems.length > 0 ? (
              <Badge variant="secondary">{visibleHeldItems.length}</Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="working" className="mt-4">
          {isPending ? (
            <CardGridSkeleton />
          ) : visibleWorkingItems.length === 0 ? (
            <EmptyState
              title="No files or notes are waiting yet"
              description="Paste a note, choose Add files or photos, or send an email to your household address. Files wait here until you decide what to do with them."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {visibleWorkingItems.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  ctaLabel="Confirm the details →"
                  onOpen={setResolving}
                  onDelete={handleDeleteRequested}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="needs-review" className="mt-4">
          {isPendingHeld ? (
            <CardGridSkeleton />
          ) : visibleHeldItems.length === 0 ? (
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
              {visibleHeldItems.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  ctaLabel={translate("crm.inbox.needsReview.cta", {
                    _: "Review this sender →",
                  })}
                  onOpen={setReviewing}
                  onDelete={handleDeleteRequested}
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
      <InboxDeleteDialog
        open={deleteCandidate !== null}
        onClose={closeDeleteDialog}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
};

export const InboxList = () => {
  const { role, isPending: isRolePending } = useViewerRole();

  // Do not mount List (or its held-item query) until the role is known. This
  // keeps single, pending, and no-membership viewers from fetching Inbox data
  // even briefly; RLS remains the enforcement boundary.
  if (!canPickResumeFromInbox(role, isRolePending)) return null;

  return (
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
};
