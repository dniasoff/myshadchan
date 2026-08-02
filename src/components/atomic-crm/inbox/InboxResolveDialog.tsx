import { Loader2 } from "lucide-react";
import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  InboxItem,
  PipelineState,
  Shadchan,
} from "../types";
import { ShidduchInputs } from "../shidduchim/ShidduchInputs";
import { INBOX_PRIMARY_CTA_CLASS, INBOX_SOURCE_META } from "./inboxMeta";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

/**
 * Resolve a captured inbox item into a shidduch (Epic 2). The raw capture is
 * shown verbatim for context; the same `ShidduchInputs` used by the manual
 * "Add a suggestion" flow collects which single / which shadchan / the name, and
 * submit goes through `createShidduch` (AD-4 sole INSERT) with `origin:'channel'`
 * so the E3 catch fires exactly as it would for a manual add. On success the
 * item is marked resolved and linked to the new suggestion. Nothing is ever
 * lost: dismiss only sets `dismissed`, and closing keeps the item unresolved.
 */
export const InboxResolveDialog = ({
  item,
  open,
  onClose,
}: {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  const SourceIcon = INBOX_SOURCE_META[item.source].icon;
  const sourceLabel = translate(`crm.inbox.source_${item.source}`, {
    _: INBOX_SOURCE_META[item.source].label,
  });

  // Story 8.3 (AC-3): a shadchan-sourced item's shadchan_id is resolved from
  // the CONNECTION, never left to the household to pick — the linked
  // shadchanim row is the one Story 8.2's accept_connection_invite() seeded
  // for this exact connection (shadchanim.connection_id is unique, so at
  // most one row ever matches). Only queried for a shadchan-sourced item;
  // every other source's dialog never runs this fetch at all.
  const isShadchanSourced = item.source === "shadchan";
  const { data: linkedShadchanim, isPending: isLoadingLinkedShadchan } =
    useGetList<Shadchan>(
      "shadchanim",
      {
        filter: { connection_id: item.connection_id },
        pagination: PAGE_ONE,
        sort: SORT_BY_ID,
      },
      { enabled: isShadchanSourced && item.connection_id != null },
    );
  const lockedShadchanId: Identifier | null = isShadchanSourced
    ? (linkedShadchanim?.[0]?.id ?? null)
    : null;

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      const input: CreateShidduchInput = {
        single_id: values.single_id as Identifier,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        name_en: (values.name_en as string) ?? null,
        name_he: (values.name_he as string) ?? null,
        father_en: (values.father_en as string) ?? null,
        father_he: (values.father_he as string) ?? null,
        mother_en: (values.mother_en as string) ?? null,
        mother_he: (values.mother_he as string) ?? null,
        seminary_en: (values.seminary_en as string) ?? null,
        shul_en: (values.shul_en as string) ?? null,
        location_en: (values.location_en as string) ?? null,
        age: (values.age as number) ?? null,
        height: (values.height as string) ?? null,
        dob: (values.dob as string) ?? null,
        background: (values.background as string) ?? null,
        marital_status: (values.marital_status as string) ?? null,
        existing_children_note:
          (values.existing_children_note as string) ?? null,
        // Story 8.3 (AC-4): a shadchan-sourced item enters via
        // create_shidduch() with origin: 'shadchan', never 'channel' or
        // 'manual' — the pipeline still starts at 'new' (initial_state
        // below), same as every other origin; there is no fast path.
        origin: isShadchanSourced ? "shadchan" : "channel",
        initial_state: (values.initial_state as PipelineState) ?? "new",
        visibility: "shared",
        redt_date: (values.redt_date as string) ?? null,
      };
      const created = await dataProvider.createShidduch(input);
      await dataProvider.update("inbox_items", {
        id: item.id,
        data: {
          status: "resolved",
          resolved_shidduchim_id: created.id,
          single_id: input.single_id,
          shadchan_id: input.shadchan_id ?? null,
        },
        previousData: item,
      });
      notify("Filed as a suggestion", { type: "info" });
      refresh();
      onClose();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Couldn't file this item",
        {
          type: "error",
        },
      );
    }
  };

  const onDismiss = async () => {
    try {
      await dataProvider.update("inbox_items", {
        id: item.id,
        data: { status: "dismissed" },
        previousData: item,
      });
      notify("Dismissed — nothing was filed", { type: "info" });
      refresh();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't dismiss", {
        type: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={
          "top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-4xl " +
          "bg-popover border-border shadow-lg " +
          "dark:bg-[var(--glass-bg)] dark:backdrop-blur-[var(--glass-blur)] dark:border-[var(--glass-border)]"
        }
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            Confirm the details
          </DialogTitle>
          <DialogDescription>
            The capture stays exactly as received — just tell us who it's for.
          </DialogDescription>
        </DialogHeader>

        {/* The raw capture, verbatim, for reference while filing. */}
        <div className="rounded-2xl border border-border bg-secondary/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <SourceIcon className="size-3.5" aria-hidden="true" />
            {sourceLabel}
            {item.sender ? (
              <span className="normal-case">· {item.sender}</span>
            ) : null}
          </div>
          {item.subject ? (
            <p className="text-sm font-semibold">{item.subject}</p>
          ) : null}
          {item.raw_text ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {item.raw_text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No text — see the attached file.
            </p>
          )}
        </div>

        {isShadchanSourced && isLoadingLinkedShadchan ? (
          // Story 8.3 (AC-3): never mount the form with the wrong default —
          // wait for the connection's shadchan to resolve rather than
          // rendering it unlocked-then-relocking (React Hook Form's
          // defaultValues are captured once, at mount).
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : (
          <Form
            onSubmit={onSubmit}
            mode="onBlur"
            defaultValues={{
              single_id: item.single_id ?? undefined,
              shadchan_id: lockedShadchanId ?? item.shadchan_id ?? undefined,
              initial_state: "new",
              redt_date: item.created_at?.split("T")[0],
            }}
          >
            <ShidduchInputs lockedShadchanId={lockedShadchanId} />
            <FormToolbar>
              <div className="flex flex-row justify-between gap-2">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Dismiss — not a redt
                </button>
                <div className="flex flex-row justify-end gap-2">
                  <CancelButton className="h-11" onClick={onClose} />
                  <SaveButton
                    label="File as a suggestion"
                    className={INBOX_PRIMARY_CTA_CLASS}
                  />
                </div>
              </div>
            </FormToolbar>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};
