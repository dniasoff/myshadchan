import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Form,
  required,
  type Identifier,
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useFormState } from "react-hook-form";
import { CancelButton } from "@/components/admin/cancel-button";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { SaveButton } from "@/components/admin/form";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, InboxItem, Shadchan } from "../types";
import { createShadchanInline } from "../shidduchim/createShadchanInline";
import { InboxCapturePreview } from "./InboxCapturePreview";
import { INBOX_PRIMARY_CTA_CLASS } from "./inboxMeta";
import { InboxResumeActionsDialog } from "./InboxResumeActions";
import { LinkToShidduchSearch } from "./LinkToShidduchSearch";
import { SuggestedByFields } from "./SuggestedByFields";
import {
  resolveSuggestedByValues,
  suggestedByPhoneForName,
} from "./suggestedBy";
import {
  hasResumeDocumentAttachment,
  suggestedByNameFromInboxItem,
  suggestedByPhoneFromInboxItem,
  useResolveInboxItem,
} from "./useResolveInboxItem";
import { hasResumeShapedAttachment } from "./useParseResume";

const PAGE_ONE = { page: 1, perPage: 1 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

/**
 * Review fix (Finding 13, frontend half — Epic 11 adversarial review):
 * `onSubmit` used to read every text-shaped field off `values` with a bare
 * `as string` assertion — compile-time only, so a value that was ACTUALLY a
 * number (e.g. a resume-parsed `height` a malformed model response left as
 * `5` instead of `"5'6\""`) still reached `CreateShidduchInput` — and from
 * there `createShidduch()`'s RPC parameters and `ShidduchInputs.tsx`'s text
 * controls — as a raw JS number. `parsedResumeDraft.ts`'s `toDraft()` now
 * coerces at the Worker's own validation boundary (Finding 13 closure), so
 * an auto-filled value is already the right JS type by the time it lands in
 * `values` — but `values` itself is `Record<string, unknown>` (React Hook
 * Form's generic shape), so nothing enforces that at the type level, and a
 * value that reaches the form some other way is still worth converting
 * rather than silently dropping. These do the actual runtime conversion the
 * assertions never did.
 */
function readTextField(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function NameInput() {
  const { errors, submitCount } = useFormState({ name: "name_en" });
  const message =
    typeof errors.name_en?.message === "string"
      ? errors.name_en.message
      : undefined;

  useEffect(() => {
    if (!message || submitCount === 0) return;
    document.querySelector<HTMLInputElement>('input[name="name_en"]')?.focus();
  }, [message, submitCount]);

  return (
    <>
      <TextInput
        source="name_en"
        label="Name of the person"
        dir="auto"
        aria-describedby={message ? "name-of-person-error" : undefined}
        validate={(value) =>
          typeof value === "string" && value.trim() !== ""
            ? undefined
            : "Name of the person is required"
        }
        helperText={false}
      />
      {message ? (
        <p
          id="name-of-person-error"
          role="alert"
          aria-live="assertive"
          className="sr-only"
        >
          {message}
        </p>
      ) : null}
    </>
  );
}

/**
 * Resolve a captured inbox item into a shidduch (Epic 2). The raw capture is
 * shown verbatim for context; this short confirmation form collects which
 * single / which shadchan / the name, and submit goes through
 * `createShidduch` (AD-4 sole INSERT) with `origin:'channel'` so the E3 catch
 * fires exactly as it would for a manual add. On success the item is marked
 * resolved and linked to the new suggestion. Nothing is ever lost: dismiss
 * only sets `dismissed`, and closing keeps the item unresolved.
 *
 * Resume attachments are copied automatically by the resolve hook. Resume
 * reading happens later on the Resume tab, so this confirmation form never
 * writes hidden extraction fields.
 */
const LegacyInboxResolveDialog = ({
  item,
  open,
  onClose,
}: {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
}) => {
  const { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem } =
    useResolveInboxItem();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  // Review fix (F6, MEDIUM, Story 10.1 — same family as ShareTarget.tsx's
  // fix): "File as a suggestion", every "Link" press, and "Dismiss" each act
  // on this SAME already-captured `item`. Nothing here duplicates the item
  // itself the way ShareTarget.tsx's fresh capture could, but without a shared
  // busy flag two of these could still race — e.g. a "Link" press resolving
  // while "File as a suggestion" is mid-submit — and send two competing
  // resolutions for the one item. One flag gates all three.
  const [isBusy, setIsBusy] = useState(false);

  // AC 3's inline "+ Add a shadchan" (FR78): the shared helper (review fix
  // F4) keeps the affordance available in this short confirmation form.
  const handleCreateShadchan = createShadchanInline(dataProvider);

  // Story 8.3 (AC-3): a shadchan-sourced item's shadchan_id is resolved from
  // the CONNECTION, never left to the household to pick — the linked
  // shadchanim row is the one Story 8.2's accept_connection_invite() seeded
  // for this exact connection (shadchanim.connection_id is unique, so at most
  // one row ever matches). Only queried for a shadchan-sourced item; every
  // other source's dialog never runs this fetch at all.
  const isShadchanSourced = item.source === "shadchan";
  const { data: linkedShadchanim, isPending: isLoadingLinkedShadchan } =
    useGetList<Shadchan>(
      "shadchanim",
      {
        filter: {
          connection_id: item.connection_id,
          "archived_at@is": null,
        },
        pagination: PAGE_ONE,
        sort: SORT_BY_ID,
      },
      { enabled: isShadchanSourced && item.connection_id != null },
    );
  const lockedShadchanId: Identifier | null = isShadchanSourced
    ? (linkedShadchanim?.[0]?.id ?? null)
    : null;

  const resumeAttachment = item.attachments?.find((attachment) =>
    hasResumeShapedAttachment({ ...item, attachments: [attachment] }),
  );

  const onSubmit = async (values: Record<string, unknown>) => {
    setIsBusy(true);
    try {
      const suggestedBy = await resolveSuggestedByValues(values);
      const suggestedByName =
        suggestedBy.suggestedByName ?? suggestedByNameFromInboxItem(item);
      const input: CreateShidduchInput = {
        single_id: values.single_id as Identifier,
        shadchan_id: suggestedBy.shadchanId,
        suggested_by_name: suggestedByName,
        suggested_by_phone:
          suggestedBy.suggestedByName != null
            ? suggestedByPhoneForName(
                suggestedByName,
                suggestedBy.suggestedByPhone,
              )
            : suggestedByPhoneFromInboxItem(item),
        name_en: readTextField(values.name_en)?.trim() || null,
        // Story 8.3 (AC-4): a shadchan-sourced item enters via
        // create_shidduch() with origin: 'shadchan', never 'channel' or
        // 'manual' — the pipeline still starts at 'new' (initial_state
        // below), same as every other origin; there is no fast path.
        origin: isShadchanSourced ? "shadchan" : "channel",
        initial_state: "new",
        visibility: "shared",
        redt_date: item.created_at?.split("T")[0] ?? null,
      };

      if (!input.name_en) {
        notify("Name of the person is required", { type: "warning" });
        return;
      }
      if (input.single_id == null) {
        notify("Choose which child this is for", { type: "warning" });
        return;
      }

      await resolveAsNewShidduch(
        item,
        input,
        resumeAttachment
          ? {
              attachment: resumeAttachment,
              rawDraft: null,
              sections: null,
            }
          : undefined,
      );
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
    } finally {
      setIsBusy(false);
    }
  };

  // AC 5 (Story 10.1, Task 3): "link to an existing suggestion" — the same
  // shared search/resolve pair `ShareTarget.tsx` uses, so this dialog and the
  // share screen agree on exactly one way to attach a capture to an existing
  // suggestion instead of creating a second one (AD-4).
  const handleLinkToExisting = async (shidduchimId: Identifier) => {
    setIsBusy(true);
    try {
      await resolveAsLinkToExisting(item, shidduchimId);
      notify("Linked to the existing suggestion", { type: "info" });
      refresh();
      onClose();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Couldn't link that item",
        { type: "error" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const onDismiss = async () => {
    setIsBusy(true);
    try {
      await dismissInboxItem(item);
      notify("Dismissed — nothing was filed", { type: "info" });
      refresh();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't dismiss", {
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-busy={isBusy}
        className={
          "top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-4xl " +
          "flex flex-col " +
          "bg-popover border-border shadow-lg " +
          "dark:bg-[var(--glass-bg)] dark:backdrop-blur-[var(--glass-blur)] dark:border-[var(--glass-border)]"
        }
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            Confirm the details
          </DialogTitle>
        </DialogHeader>

        {/* The raw capture, verbatim, for reference while filing. */}
        <InboxCapturePreview item={item} />

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
              suggested_by_name: suggestedByNameFromInboxItem(item) ?? "",
              suggested_by_phone: suggestedByPhoneFromInboxItem(item) ?? "",
              initial_state: "new",
              redt_date: item.created_at?.split("T")[0],
            }}
          >
            <div className="flex flex-col gap-4">
              <ReferenceInput
                source="shadchan_id"
                reference="shadchanim"
                filter={{ "archived_at@is": null }}
              >
                <fieldset
                  disabled={isShadchanSourced}
                  className="m-0 min-w-0 border-0 p-0"
                >
                  <AutocompleteInput
                    label="Who is the shadchan?"
                    onCreate={handleCreateShadchan}
                    helperText={false}
                  />
                </fieldset>
              </ReferenceInput>
              <ReferenceInput
                source="single_id"
                reference="singles"
                filter={{ "status@neq": "archived" }}
              >
                <AutocompleteInput
                  label="Which child is this for?"
                  validate={required()}
                  helperText={false}
                />
              </ReferenceInput>
              <NameInput />
              <SuggestedByFields />
            </div>

            {/* AC 5 (Story 10.1, Task 3): link to an existing suggestion
                instead of submitting the form above — the same shared
                search component ShareTarget.tsx uses. */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {translate("crm.inbox.share.linkLabel", {
                  _: "Or link to an existing suggestion",
                })}
              </span>
              <LinkToShidduchSearch
                onLink={handleLinkToExisting}
                disabled={isBusy}
              />
            </div>

            <div role="toolbar" className="pt-2 pb-2">
              {/* Stacked below sm. All three of these come from
                  buttonVariants' `whitespace-nowrap shrink-0` base, so on one
                  row they cannot shrink or wrap: at 360px they need ~420px
                  against a ~280px content box, and DialogContent's
                  `overflow-y-auto` computes overflow-x to auto — so the
                  primary CTA does not clip visibly, it slides off sideways
                  behind a scrollbar nobody looks for. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={isBusy}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  Dismiss — not a redt
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <CancelButton
                    className="h-11 w-full justify-center sm:w-auto"
                    onClick={onClose}
                    disabled={isBusy}
                  />
                  <SaveButton
                    label="File as a suggestion"
                    className={`${INBOX_PRIMARY_CTA_CLASS} w-full justify-center sm:w-auto`}
                    disabled={isBusy}
                  />
                </div>
              </div>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const InboxResolveDialog = ({
  item,
  open,
  initialAction = "attach",
  fileActionsEnabled = false,
  onClose,
}: {
  item: InboxItem;
  open: boolean;
  initialAction?: "attach" | "new";
  fileActionsEnabled?: boolean;
  onClose: () => void;
}) => {
  if (fileActionsEnabled && hasResumeDocumentAttachment(item)) {
    return (
      <InboxResumeActionsDialog
        item={item}
        open={open}
        action={initialAction}
        onClose={onClose}
      />
    );
  }
  return <LegacyInboxResolveDialog item={item} open={open} onClose={onClose} />;
};
