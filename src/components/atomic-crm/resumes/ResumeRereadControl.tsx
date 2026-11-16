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
import { RESUME_AUTO_READ_COPY } from "./resumeAutoReadHelpers";
import {
  createResumeReadRequestId,
  resumeReadAttemptKey,
  unresolvedResumeReadAttempts,
} from "./resumeReadRequest";

type RereadFeedback =
  | "reading"
  | "completed"
  | "empty"
  | "failed"
  | "timeout"
  | "provider_busy"
  | "no_allowance"
  | "not_entitled";

export const REREAD_COPY = {
  trigger: "Make it easy to read",
  readTrigger: "Make it easy to read",
  title: "Make this resume easy to read?",
  readTitle: "Make this resume easy to read?",
  description:
    "This uses 1 of your monthly resume reads. Your edits, notes and call history will not change.",
  reading: "Making it easy to read. Please wait.",
  completed: "Done. The easy-to-read details are ready below.",
  readCompleted: "Done. The easy-to-read details are ready below.",
  readEmpty: RESUME_AUTO_READ_COPY.empty,
  failed: "Could not make this resume easy to read. Nothing was changed.",
  timeout: RESUME_AUTO_READ_COPY.timeout,
  providerBusy: RESUME_AUTO_READ_COPY.provider_busy,
  noAllowance: "No resume reads left this month.",
  notEntitled: "AI reading is not switched on for your account yet.",
  cancel: "Cancel",
  confirm: "Make it easy to read",
  readConfirm: "Make it easy to read",
} as const;

export type ResumeRereadControlProps = {
  resumeId: Identifier;
  /** Stable identity of the current file version, kept in memory only. */
  fileIdentity: string;
  /** Unread resumes use the full fill-empty reader; read resumes keep reread. */
  isUnread?: boolean;
};

function feedbackText(feedback: RereadFeedback, isUnread: boolean): string {
  switch (feedback) {
    case "reading":
      return REREAD_COPY.reading;
    case "completed":
      return isUnread ? REREAD_COPY.readCompleted : REREAD_COPY.completed;
    case "empty":
      return REREAD_COPY.readEmpty;
    case "no_allowance":
      return REREAD_COPY.noAllowance;
    case "not_entitled":
      return REREAD_COPY.notEntitled;
    case "failed":
      return REREAD_COPY.failed;
    case "timeout":
      return REREAD_COPY.timeout;
    case "provider_busy":
      return REREAD_COPY.providerBusy;
  }
}

export function ResumeRereadControl({
  resumeId,
  fileIdentity,
  isUnread = false,
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
  const rereadAttemptKey = resumeReadAttemptKey(resumeId, fileIdentity);

  useEffect(
    () => () => {
      activeController.current?.abort();
      activeController.current = null;
    },
    [],
  );

  const triggerLabel = translate(
    isUnread
      ? "crm.entity360.resume.read.trigger"
      : "crm.entity360.resume.reread.trigger",
    {
      _: isUnread ? REREAD_COPY.readTrigger : REREAD_COPY.trigger,
    },
  );
  const title = translate(
    isUnread
      ? "crm.entity360.resume.read.title"
      : "crm.entity360.resume.reread.title",
    {
      _: isUnread ? REREAD_COPY.readTitle : REREAD_COPY.title,
    },
  );
  const description = translate("crm.entity360.resume.reread.description", {
    _: REREAD_COPY.description,
  });
  const cancelLabel = translate("crm.entity360.resume.reread.cancel", {
    _: REREAD_COPY.cancel,
  });
  const confirmLabel = translate(
    isUnread
      ? "crm.entity360.resume.read.confirm"
      : "crm.entity360.resume.reread.confirm",
    {
      _: isUnread ? REREAD_COPY.readConfirm : REREAD_COPY.confirm,
    },
  );

  const openConfirmation = () => {
    if (isReading) return;
    setFeedback(null);
    // Allocate only after the user explicitly confirms. A cancelled dialog
    // must not consume an idempotency key that could be mistaken for a read.
    setRequestId(unresolvedResumeReadAttempts.get(rereadAttemptKey) ?? null);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isReading) return;
    setOpen(nextOpen);
    if (!nextOpen) setRequestId(null);
  };

  const handleConfirm = async () => {
    if (isReading) return;
    const stableRequestId = requestId ?? createResumeReadRequestId();
    unresolvedResumeReadAttempts.set(rereadAttemptKey, stableRequestId);
    setRequestId(stableRequestId);
    setFeedback("reading");
    setIsReading(true);
    const controller = new AbortController();
    activeController.current = controller;
    try {
      const outcome = isUnread
        ? await dataProvider.readResume({
            resumeId,
            requestId: stableRequestId,
            fileIdentity,
            mode: "fill_empty",
            signal: controller.signal,
          })
        : await dataProvider.reReadResume({
            resumeId,
            requestId: stableRequestId,
            fileIdentity,
            signal: controller.signal,
          });
      if (outcome === "completed") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("completed");
        setOpen(false);
        setRequestId(null);
        refresh();
      } else if (isUnread && outcome === "empty") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("empty");
        setOpen(false);
        setRequestId(null);
        refresh();
      } else if (outcome === "no_allowance") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("no_allowance");
      } else if (outcome === "not_entitled") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("not_entitled");
      } else if (outcome === "timeout") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("timeout");
      } else if (outcome === "provider_busy") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("provider_busy");
      } else if (isUnread && outcome === "stale_file") {
        unresolvedResumeReadAttempts.delete(rereadAttemptKey);
        setFeedback("failed");
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

  const feedbackMessage = feedback ? feedbackText(feedback, isUnread) : null;
  const feedbackLabel = feedback
    ? translate(
        isUnread && feedback === "completed"
          ? "crm.entity360.resume.read.completed"
          : isUnread && feedback === "empty"
            ? "crm.entity360.resume.read.empty"
            : `crm.entity360.resume.reread.${feedback}`,
        {
          _: feedbackMessage ?? "",
        },
      )
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
        {isReading ? "Making it easy to read…" : triggerLabel}
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
