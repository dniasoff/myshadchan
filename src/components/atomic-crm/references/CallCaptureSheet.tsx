import { useState } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CallStatus, ReferenceLinkSummary } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { CALL_STATUS_DESCRIPTORS } from "./callStatus";
import { getQuestionsForRelationship } from "./relationshipQuestions";

/**
 * Mid-call capture (§5c, NFR-1). This is used with a phone against one ear, so
 * it is built for one thumb: status is four big chip buttons rather than a
 * select, there is exactly one text field, and one save action.
 *
 * Everything it writes goes through log_reference_call, the same RPC the guided
 * call script uses — there is no second data path.
 */
export const CallCaptureSheet = ({
  link,
  open,
  onOpenChange,
  source = "manual",
}: {
  link: ReferenceLinkSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: "manual" | "assistant";
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  const [status, setStatus] = useState<CallStatus>(
    (link.call_status as CallStatus) ?? "not_started",
  );
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [areQuestionsOpen, setAreQuestionsOpen] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        call_status: status,
        what_they_said: note.trim() === "" ? null : note.trim(),
        source,
      });
      setNote("");
      refresh();
      onOpenChange(false);
      notify("crm.references.call.saved", {
        type: "success",
        messageArgs: { _: "Saved to the call log." },
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to save the call",
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  const subject = link.shidduch_name_en || link.reference_name_en;

  // Story 5.11 (AC 1/AC 2): the same free, deterministic question sets the
  // paid research assistant uses (`relationshipQuestions.ts`'s own doc
  // comment: "the call script itself is never behind the paywall"). This
  // file must stay off the AI entitlement gate entirely — the repo's own
  // build-time scan (`references/entitlementGate.guard.test.ts`) fails if
  // it ever consults that hook. Falls back to the universal questions when
  // `effective_relationship` is blank or unrecognised, so the list is
  // never empty.
  const { questions } = getQuestionsForRelationship(
    link.effective_relationship,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto
          bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]
          border-[var(--glass-border)]"
      >
        <SheetHeader>
          <SheetTitle>{link.reference_name_en}</SheetTitle>
          <SheetDescription>
            {translate("crm.references.call.about", {
              name: subject ?? "",
              _: "About %{name}",
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          <div>
            <p className="mb-2 text-sm font-medium">
              {translate("crm.references.call.howDidItGo", {
                _: "How did the call go?",
              })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CALL_STATUS_DESCRIPTORS.filter(
                (descriptor) => descriptor.id !== "not_started",
              ).map((descriptor) => {
                const tokenVar = `var(${descriptor.token})`;
                const isSelected = status === descriptor.id;
                return (
                  <button
                    key={descriptor.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setStatus(descriptor.id)}
                    className={cn(
                      "min-h-[56px] rounded-xl border px-4 py-3 text-base font-medium",
                      "transition-[box-shadow,transform] duration-[160ms] ease-[var(--ease-spring)]",
                      "active:scale-[0.97]",
                      isSelected ? "" : "opacity-80 hover:opacity-100",
                    )}
                    style={{
                      color: `color-mix(in oklch, ${tokenVar} var(--chip-text-mix), black)`,
                      backgroundColor: `color-mix(in oklch, ${tokenVar} 16%, transparent)`,
                      borderColor: `color-mix(in oklch, ${tokenVar} 28%, transparent)`,
                      boxShadow: isSelected
                        ? `0 0 0 2px var(--background), 0 0 0 4px ${tokenVar}`
                        : undefined,
                    }}
                  >
                    {translate(descriptor.labelKey, { _: descriptor.label })}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">
              {translate("crm.references.call.questionsTitle", {
                _: "Questions to ask",
              })}
            </p>
            <details
              className="text-sm"
              open={areQuestionsOpen}
              onToggle={(event) =>
                setAreQuestionsOpen(event.currentTarget.open)
              }
            >
              <summary className="cursor-pointer text-muted-foreground">
                {areQuestionsOpen
                  ? translate("crm.references.call.questionsToggleHide", {
                      _: "Hide questions",
                    })
                  : translate("crm.references.call.questionsToggle", {
                      _: "Show questions",
                    })}
              </summary>
              <ol className="mt-2 list-inside list-decimal">
                {questions.map((question) => (
                  <li key={question} className="py-0.5">
                    {question}
                  </li>
                ))}
              </ol>
            </details>
          </div>

          <div>
            <label htmlFor="what-they-said" className="text-sm font-medium">
              {translate("crm.references.call.whatTheySaid", {
                _: "What they said",
              })}
            </label>
            <Textarea
              id="what-they-said"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              className="mt-2 text-base"
              placeholder={translate("crm.references.call.placeholder", {
                _: "What was said on the call",
              })}
            />
          </div>

          <Button
            type="button"
            size="lg"
            className="min-h-[48px] w-full text-base text-primary-foreground
              bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
              shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
              transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)]
              hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
              active:scale-[0.97]"
            disabled={isSaving}
            onClick={handleSave}
          >
            {translate("crm.references.call.save", {
              _: "Save and add to log",
            })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
