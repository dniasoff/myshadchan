import { useState, useCallback, useMemo } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ReferenceLinkSummary } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { buildCallScript } from "./callScript";
import { useCallSession } from "./useCallSession";
import { countOtherConversations } from "./repeatRecognition";
import { useReferenceLinks } from "./useReferenceLinks";

/**
 * Guided Call mode session — one question at a time, saved per answer.
 * Mounted by ReferenceCallLog when `?call=<linkId>&step=<n>` is present.
 */
export const GuidedCallSession = ({
  links,
}: {
  links: ReferenceLinkSummary[];
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  const { activeLinkId, step, goTo, close } = useCallSession();
  const link = links.find((l) => String(l.id) === activeLinkId);
  const effectiveRelationship = link?.effective_relationship;

  const script = useMemo(
    () => buildCallScript(effectiveRelationship),
    [effectiveRelationship],
  );

  const clampedStep = Math.min(Math.max(step, 1), Math.max(script.length, 1));
  const currentStep = script[clampedStep - 1];
  const isLastStep = clampedStep >= script.length;
  const [answeredSteps, setAnsweredSteps] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const [answer, setAnswer] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isFirstSave, setIsFirstSave] = useState(true);
  const [showWrapUp, setShowWrapUp] = useState(false);

  const { links: allLinks, isPending: linksPending } = useReferenceLinks(
    link?.reference_id,
  );
  const otherCount = countOtherConversations(
    allLinks,
    link?.shidduchim_id ?? null,
  );

  const handleAdvance = useCallback(async () => {
    if (!link || !currentStep || isSaving) return;

    const text = answer.trim();

    if (text) {
      setIsSaving(true);
      try {
        await dataProvider.logReferenceCall({
          reference_link_id: link.id,
          what_they_said: text,
          source: "assistant",
          call_status: isFirstSave ? "answered" : undefined,
        });
        setAnswer("");
        setAnsweredSteps((prev) => new Set(prev).add(clampedStep));
        setIsFirstSave(false);
        if (!isLastStep) {
          goTo(clampedStep + 1);
        } else {
          setShowWrapUp(true);
        }
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Failed to save answer",
          { type: "error" },
        );
      } finally {
        setIsSaving(false);
      }
    } else {
      if (!isLastStep) {
        goTo(clampedStep + 1);
      } else {
        setShowWrapUp(true);
      }
    }
  }, [
    link,
    currentStep,
    answer,
    isSaving,
    isFirstSave,
    isLastStep,
    clampedStep,
    goTo,
    dataProvider,
    notify,
  ]);

  const handleCallBack = useCallback(async () => {
    if (!link || isSaving) return;
    setIsSaving(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        what_they_said: null,
        source: "assistant",
        call_status: "call_back",
      });
      close();
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to log call back",
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  }, [link, isSaving, dataProvider, notify, close, refresh]);

  const handleClose = useCallback(() => {
    close();
    refresh();
  }, [close, refresh]);

  const handleEndCall = useCallback(() => {
    handleClose();
  }, [handleClose]);

  if (!link || !currentStep) {
    return null;
  }

  const progressPercent = ((clampedStep - 1) / script.length) * 100;
  const answeredCount = answeredSteps.size;
  const nextThree = script.slice(clampedStep, clampedStep + 3);

  return (
    <Sheet open={true} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto
          bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]
          border-[var(--glass-border)]"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">
            {translate("crm.references.call.onACall", { _: "On a call" })}
          </SheetTitle>
          <SheetDescription>
            {translate("crm.references.call.about", {
              name: link.shidduch_name_en || link.reference_name_en,
              _: "About %{name}",
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 flex flex-col gap-6">
          {otherCount > 0 && !linksPending && (
            <div className="rounded-xl bg-[color-mix(in_oklch,var(--attention)_10%,var(--card))] border border-[color-mix(in_oklch,var(--attention)_35%,var(--border))] p-4">
              <p className="font-semibold">
                {translate("crm.references.repeat.title", {
                  name: link.reference_name_en,
                  smart_count: otherCount,
                  _: "You have spoken to %{name} about %{smart_count} other singles",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {translate("crm.references.repeat.progress", {
                  contacted: otherCount,
                  total: otherCount,
                  _: "%{contacted} of %{total} of those conversations happened",
                })}
              </p>
            </div>
          )}

          {linksPending && (
            <div
              className="rounded-xl bg-[color-mix(in_oklch,var(--attention)_10%,var(--card))] border border-[color-mix(in_oklch,var(--attention)_35%,var(--border))] p-4"
              aria-busy="true"
            >
              <div className="animate-pulse space-y-2">
                <div className="h-5 w-3/4 bg-muted rounded" />
                <div className="h-4 w-1/2 bg-muted rounded" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {translate("crm.references.callMode.coverage", {
                  done: answeredCount,
                  total: script.length,
                  _: "%{done} of %{total} covered",
                })}
              </span>
              <span className="text-muted-foreground">
                {translate("crm.references.callMode.stepOf", {
                  current: clampedStep,
                  total: script.length,
                  _: "Step %{current} of %{total}",
                })}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            {/* One-handed, mid-call: 20px rows 4px apart are not a target,
                and a 160px scroll box nested inside an already-scrolling
                sheet is a second thing to steer. Padded 44px rows, two
                readable lines each, in a taller box. */}
            <ol className="text-sm text-muted-foreground space-y-0.5 max-h-56 overflow-y-auto">
              {script.map((s, idx) => {
                const stepNum = idx + 1;
                const isAnswered = answeredSteps.has(stepNum);
                const isCurrent = stepNum === clampedStep;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex min-h-11 w-full items-start gap-2 rounded-md py-2 text-left",
                        isAnswered && "text-primary font-medium",
                        isCurrent && "font-semibold",
                      )}
                      onClick={() => goTo(stepNum)}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={translate(
                        "crm.references.callMode.stepLabel",
                        {
                          step: stepNum,
                          question: s.question,
                          answered: isAnswered ? "answered" : "unanswered",
                          _: "Step %{step}: %{question} (%{answered})",
                        },
                      )}
                    >
                      <span
                        className="flex-shrink-0 w-5 text-center"
                        aria-hidden="true"
                      >
                        {isAnswered ? "✓" : stepNum}
                      </span>
                      <span className="line-clamp-2">{s.question}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {translate("crm.references.callMode.askThem", { _: "Ask them" })}
            </p>
            <div
              data-testid="current-question"
              className="text-xl leading-relaxed min-h-[80px]"
            >
              {currentStep.question}
            </div>
          </div>

          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            className="text-base"
            placeholder={translate(
              "crm.references.callMode.answerPlaceholder",
              {
                _: "Type their answer here…",
              },
            )}
            disabled={isSaving}
          />

          {nextThree.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {translate("crm.references.callMode.comingUp", {
                  _: "Coming up",
                })}
              </p>
              <ol className="text-sm text-muted-foreground space-y-1">
                {nextThree.map((s) => (
                  <li key={s.id} className="truncate">
                    {s.question}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <Button
            type="button"
            size="lg"
            className={cn(
              "min-h-[48px] w-full text-base text-primary-foreground",
              "bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]",
              "shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]",
              "transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)]",
              "hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]",
              "active:scale-[0.97]",
            )}
            disabled={isSaving}
            onClick={handleAdvance}
          >
            {isSaving
              ? translate("crm.common.saving", { _: "Saving…" })
              : isLastStep
                ? translate("crm.references.callMode.wrapTitle", {
                    _: "Finish call",
                  })
                : translate("crm.references.callMode.saveNext", {
                    _: "Save and next",
                  })}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {translate("crm.references.callMode.guardrail", {
              _: "Call mode helps you not miss a question; it never judges whether this is a good match.",
            })}
          </p>

          {showWrapUp && (
            <div className="border-t pt-4 space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleCallBack}
                disabled={isSaving}
              >
                {translate("crm.references.callMode.callBack", {
                  _: "Not finished — call back",
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleEndCall}
                disabled={isSaving}
              >
                {translate("crm.references.callMode.end", { _: "End call" })}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
