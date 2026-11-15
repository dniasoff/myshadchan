import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  useDataProvider,
  useRefresh,
  useTranslate,
  type Identifier,
} from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import type { CrmDataProvider } from "../providers/types";

type RereadFeedback = "reading" | "completed" | "failed" | "no_allowance";

const unresolvedRereadAttempts = new Map<string, string>();

function attemptKey(resumeId: Identifier, fileIdentity: string): string {
  return `${String(resumeId)}\u0000${fileIdentity}`;
}

export const REREAD_COPY = {
  trigger: "Re-read this resume",
  title: "Read this resume again?",
  description:
    "This uses 1 of your monthly resume reads. Your edits, notes and call history will not change.",
  reading: "Reading this resume. Please wait.",
  completed: "Resume read again. New sections are ready below.",
  failed: "Could not read this resume. Nothing was changed.",
  noAllowance: "No resume reads left this month.",
  cancel: "Cancel",
  confirm: "Re-read",
} as const;

export type ResumeRereadControlProps = {
  resumeId: Identifier;
  /** Stable identity of the current file version, kept in memory only. */
  fileIdentity: string;
};

function createRequestId(): string {
  return crypto.randomUUID();
}

function feedbackText(feedback: RereadFeedback): string {
  switch (feedback) {
    case "reading":
      return REREAD_COPY.reading;
    case "completed":
      return REREAD_COPY.completed;
    case "no_allowance":
      return REREAD_COPY.noAllowance;
    case "failed":
      return REREAD_COPY.failed;
  }
}

export function ResumeRereadControl({
  resumeId,
  fileIdentity,
}: ResumeRereadControlProps): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefresh();
  const translate = useTranslate();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<RereadFeedback | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const rereadAttemptKey = attemptKey(resumeId, fileIdentity);

  useEffect(
    () => () => {
      activeController.current?.abort();
      activeController.current = null;
    },
    [],
  );

  const triggerLabel = translate("crm.entity360.resume.reread.trigger", {
    _: REREAD_COPY.trigger,
  });
  const title = translate("crm.entity360.resume.reread.title", {
    _: REREAD_COPY.title,
  });
  const description = translate("crm.entity360.resume.reread.description", {
    _: REREAD_COPY.description,
  });
  const cancelLabel = translate("crm.entity360.resume.reread.cancel", {
    _: REREAD_COPY.cancel,
  });
  const confirmLabel = translate("crm.entity360.resume.reread.confirm", {
    _: REREAD_COPY.confirm,
  });

  const openConfirmation = () => {
    if (isReading) return;
    setFeedback(null);
    // Allocate only after the user explicitly confirms. A cancelled dialog
    // must not consume an idempotency key that could be mistaken for a read.
    setRequestId(unresolvedRereadAttempts.get(rereadAttemptKey) ?? null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isReading) return;
    setOpen(nextOpen);
    if (!nextOpen) setRequestId(null);
  };

  const handleConfirm = async () => {
    if (isReading) return;
    const stableRequestId = requestId ?? createRequestId();
    unresolvedRereadAttempts.set(rereadAttemptKey, stableRequestId);
    setRequestId(stableRequestId);
    setFeedback("reading");
    setIsReading(true);
    const controller = new AbortController();
    activeController.current = controller;
    try {
      const outcome = await dataProvider.reReadResume({
        resumeId,
        requestId: stableRequestId,
        signal: controller.signal,
      });
      if (outcome === "completed") {
        unresolvedRereadAttempts.delete(rereadAttemptKey);
        setFeedback("completed");
        setOpen(false);
        setRequestId(null);
        refresh();
      } else if (outcome === "no_allowance") {
        unresolvedRereadAttempts.delete(rereadAttemptKey);
        setFeedback("no_allowance");
      } else {
        // "already_reading" and every transport/server failure intentionally
        // share the calm, non-sensitive retryable copy.
        setFeedback("failed");
      }
    } catch {
      setFeedback("failed");
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
      }
      setIsReading(false);
    }
  };

  const feedbackMessage = feedback ? feedbackText(feedback) : null;
  const feedbackLabel = feedback
    ? translate(`crm.entity360.resume.reread.${feedback}`, {
        _: feedbackMessage ?? "",
      })
    : null;

  const actions = (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={isReading}
        onClick={() => handleOpenChange(false)}
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        disabled={isReading}
        onClick={() => void handleConfirm()}
      >
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isReading}
        onClick={openConfirmation}
      >
        {triggerLabel}
      </Button>

      {feedback && !open && feedback !== "reading" ? (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {feedbackLabel}
        </p>
      ) : null}

      {isMobile ? (
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetContent
            side="bottom"
            hideClose
            className="max-h-[85dvh] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            {feedbackMessage ? (
              <p
                role="status"
                aria-live="polite"
                className="px-4 text-sm text-muted-foreground"
              >
                {feedbackLabel}
              </p>
            ) : null}
            <SheetFooter>{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent hideClose className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {feedbackMessage ? (
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                {feedbackLabel}
              </p>
            ) : null}
            <DialogFooter>{actions}</DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
