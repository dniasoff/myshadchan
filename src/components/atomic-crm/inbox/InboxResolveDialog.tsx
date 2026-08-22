import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useFormContext } from "react-hook-form";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import { useAiEntitlement } from "../references/useAiEntitlement";
import type {
  CreateShidduchInput,
  InboxItem,
  PipelineState,
  Shadchan,
} from "../types";
import { createShadchanInline } from "../shidduchim/createShadchanInline";
import { ShidduchInputs } from "../shidduchim/ShidduchInputs";
import { InboxCapturePreview } from "./InboxCapturePreview";
import { INBOX_PRIMARY_CTA_CLASS } from "./inboxMeta";
import { LinkToShidduchSearch } from "./LinkToShidduchSearch";
import { useResolveInboxItem } from "./useResolveInboxItem";
import {
  hasResumeShapedAttachment,
  useParseResume,
  type ParsedResumeResponse,
} from "./useParseResume";

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

function readNumberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Inner component that resets the form when a parsed draft arrives. Lives
 * inside the Form context so `useFormContext()` is valid.
 */
const DraftResetter = ({ draft }: { draft: ParsedResumeResponse | null }) => {
  const { reset } = useFormContext();

  useEffect(() => {
    if (!draft) return;
    reset((current) => ({
      ...current,
      ...draft.fields,
      single_id: current.single_id,
      shadchan_id: current.shadchan_id,
      initial_state: current.initial_state ?? "new",
      redt_date: current.redt_date,
    }));
  }, [draft, reset]);

  return null;
};

/**
 * Resolve a captured inbox item into a shidduch (Epic 2). The raw capture is
 * shown verbatim for context; the same `ShidduchInputs` used by the manual
 * "Add a suggestion" flow collects which single / which shadchan / the name, and
 * submit goes through `createShidduch` (AD-4 sole INSERT) with `origin:'channel'`
 * so the E3 catch fires exactly as it would for a manual add. On success the
 * item is marked resolved and linked to the new suggestion. Nothing is ever
 * lost: dismiss only sets `dismissed`, and closing keeps the item unresolved.
 *
 * Story 11.2 adds an optional "Auto-fill from resume" step: the attachment is
 * read by the parse Worker and the draft populates the form. The raw capture
 * remains unchanged; the user confirms rather than retypes.
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
  const { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem } =
    useResolveInboxItem();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const { isEntitled } = useAiEntitlement();
  const { parse, isParsing } = useParseResume();

  const [parsedDraft, setParsedDraft] = useState<ParsedResumeResponse | null>(
    null,
  );

  // Review fix (F6, MEDIUM, Story 10.1 — same family as ShareTarget.tsx's
  // fix): "File as a suggestion", every "Link" press, "Dismiss", and now
  // "Auto-fill" each act on this SAME already-captured `item`. Nothing here
  // duplicates the item itself the way ShareTarget.tsx's fresh capture could,
  // but without a shared busy flag two of these could still race — e.g. a
  // "Link" press resolving while "File as a suggestion" is mid-submit — and
  // send two competing resolutions for the one item. One flag, gating all four.
  const [isBusy, setIsBusy] = useState(false);

  // AC 3's inline "+ Add a shadchan" (FR78): the shared helper (review fix
  // F4) — was wired nowhere in this dialog before, leaving the affordance
  // unreachable from the one screen `ShidduchInputs.tsx`'s own comment
  // claims it's reused "wherever" it appears.
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
        filter: { connection_id: item.connection_id },
        pagination: PAGE_ONE,
        sort: SORT_BY_ID,
      },
      { enabled: isShadchanSourced && item.connection_id != null },
    );
  const lockedShadchanId: Identifier | null = isShadchanSourced
    ? (linkedShadchanim?.[0]?.id ?? null)
    : null;

  const canAutoFill = isEntitled && hasResumeShapedAttachment(item);

  const handleAutoFill = async () => {
    setIsBusy(true);
    try {
      const draft = await parse(item);
      setParsedDraft(draft);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Couldn't read the resume",
        { type: "warning" },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const onSubmit = async (values: Record<string, unknown>) => {
    setIsBusy(true);
    try {
      const input: CreateShidduchInput = {
        // `single_id` / `shadchan_id`: written only by `ReferenceInput` +
        // `AutocompleteInput` (`ShidduchInputs.tsx`), which produce an
        // `Identifier` (string | number) or leave the field unset — never a
        // value a resume extraction could have supplied. A resume draft
        // never touches either field (`ParsedResumeFields` has no
        // `single_id` / `shadchan_id`), so this assertion is sound;
        // Finding 13 concerns only the resume-fillable fields
        // below, all read through `readTextField` / `readNumberField`.
        single_id: values.single_id as Identifier,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        name_en: readTextField(values.name_en),
        name_he: readTextField(values.name_he),
        father_en: readTextField(values.father_en),
        father_he: readTextField(values.father_he),
        mother_en: readTextField(values.mother_en),
        mother_he: readTextField(values.mother_he),
        seminary_en: readTextField(values.seminary_en),
        seminary_he: readTextField(values.seminary_he),
        shul_en: readTextField(values.shul_en),
        shul_he: readTextField(values.shul_he),
        location_en: readTextField(values.location_en),
        location_he: readTextField(values.location_he),
        age: readNumberField(values.age),
        height: readTextField(values.height),
        dob: readTextField(values.dob),
        background: readTextField(values.background),
        marital_status: readTextField(values.marital_status),
        person_gender: readTextField(values.person_gender),
        kohen_status: readTextField(values.kohen_status) ?? "unknown",
        existing_children_note: readTextField(values.existing_children_note),
        // Story 8.3 (AC-4): a shadchan-sourced item enters via
        // create_shidduch() with origin: 'shadchan', never 'channel' or
        // 'manual' — the pipeline still starts at 'new' (initial_state
        // below), same as every other origin; there is no fast path.
        origin: isShadchanSourced ? "shadchan" : "channel",
        // `initial_state`: constrained to `SelectInput`'s fixed
        // `initialStateChoices` (`ShidduchInputs.tsx`), every choice a real
        // `PipelineState` literal — sound for the same reason as
        // `single_id` above.
        initial_state: (values.initial_state as PipelineState) ?? "new",
        visibility: "shared",
        redt_date: readTextField(values.redt_date),
      };

      const resumeAttachment = item.attachments?.find((a) =>
        hasResumeShapedAttachment({ ...item, attachments: [a] }),
      );

      await resolveAsNewShidduch(
        item,
        input,
        parsedDraft && resumeAttachment
          ? {
              attachment: resumeAttachment,
              rawDraft: parsedDraft.rawDraft,
              sections: parsedDraft.sections,
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
        <InboxCapturePreview item={item} />

        {canAutoFill && (
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleAutoFill}
              disabled={isBusy || isParsing}
              className="gap-2"
            >
              {isParsing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              {translate("crm.inbox.parse.autoFill", {
                _: "Auto-fill from resume",
              })}
            </Button>
          </div>
        )}

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
              ...(parsedDraft?.fields ?? {}),
            }}
          >
            <DraftResetter draft={parsedDraft} />
            <ShidduchInputs
              lockedShadchanId={lockedShadchanId}
              isShadchanLocked={isShadchanSourced}
              onCreateShadchan={handleCreateShadchan}
              lowConfidenceFields={parsedDraft?.lowConfidenceFields ?? []}
            />

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

            <FormToolbar>
              <div className="flex flex-row justify-between gap-2">
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={isBusy}
                  className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Dismiss — not a redt
                </button>
                <div className="flex flex-row justify-end gap-2">
                  <CancelButton
                    className="h-11"
                    onClick={onClose}
                    disabled={isBusy}
                  />
                  <SaveButton
                    label="File as a suggestion"
                    className={INBOX_PRIMARY_CTA_CLASS}
                    disabled={isBusy}
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
