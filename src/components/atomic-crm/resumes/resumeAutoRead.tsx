import { useCallback, useEffect, useRef, useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider, useRefresh } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ResumeFileVersion } from "../types";
import {
  createResumeReadRequestId,
  resumeReadAttemptKey,
  unresolvedResumeReadAttempts,
} from "./resumeReadRequest";

export const RESUME_AUTO_READ_COPY = {
  reading: "Reading this resume. Please wait.",
  completed: "Resume read. The details are ready below.",
  empty: "We could not find details in this resume.",
  failed:
    'Could not read this resume. The file was saved; you can try "Read this resume" again.',
  noAllowance: "No resume reads left this month. The file was saved.",
  notEntitled:
    "AI reading is not switched on for your account yet. The file was saved.",
  staleFile: "This resume changed while it was being read. Please try again.",
  unsupported: "This file type cannot be read automatically.",
} as const;

export type ResumeAutoReadFeedback =
  | "reading"
  | "completed"
  | "empty"
  | "failed"
  | "no_allowance"
  | "not_entitled"
  | "stale_file"
  | "unsupported";

const READABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isAutomaticallyReadableResume(
  file: Pick<ResumeFileVersion, "mime_type">,
): boolean {
  return READABLE_MIME_TYPES.has(file.mime_type.trim().toLowerCase());
}

export function resumeAutoReadFeedbackText(
  feedback: ResumeAutoReadFeedback,
): string {
  switch (feedback) {
    case "reading":
      return RESUME_AUTO_READ_COPY.reading;
    case "completed":
      return RESUME_AUTO_READ_COPY.completed;
    case "empty":
      return RESUME_AUTO_READ_COPY.empty;
    case "failed":
      return RESUME_AUTO_READ_COPY.failed;
    case "no_allowance":
      return RESUME_AUTO_READ_COPY.noAllowance;
    case "not_entitled":
      return RESUME_AUTO_READ_COPY.notEntitled;
    case "stale_file":
      return RESUME_AUTO_READ_COPY.staleFile;
    case "unsupported":
      return RESUME_AUTO_READ_COPY.unsupported;
  }
}

export function useResumeAutoRead(): {
  feedback: ResumeAutoReadFeedback | null;
  isReading: boolean;
  readResume: (
    resumeId: Identifier,
    file: Pick<ResumeFileVersion, "path" | "mime_type">,
  ) => Promise<void>;
} {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefresh();
  const [feedback, setFeedback] = useState<ResumeAutoReadFeedback | null>(null);
  const [isReading, setIsReading] = useState(false);
  const activeController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeController.current?.abort();
      activeController.current = null;
    },
    [],
  );

  const readResume = useCallback(
    async (
      resumeId: Identifier,
      file: Pick<ResumeFileVersion, "path" | "mime_type">,
    ): Promise<void> => {
      if (!isAutomaticallyReadableResume(file)) {
        setFeedback("unsupported");
        return;
      }

      const attemptKey = resumeReadAttemptKey(resumeId, file.path);
      const requestId =
        unresolvedResumeReadAttempts.get(attemptKey) ??
        createResumeReadRequestId();
      unresolvedResumeReadAttempts.set(attemptKey, requestId);
      setFeedback("reading");
      setIsReading(true);
      const controller = new AbortController();
      activeController.current?.abort();
      activeController.current = controller;

      try {
        const outcome = await dataProvider.readResume({
          resumeId,
          requestId,
          fileIdentity: file.path,
          mode: "fill_empty",
          signal: controller.signal,
        });
        if (outcome === "completed") {
          unresolvedResumeReadAttempts.delete(attemptKey);
          setFeedback("completed");
          refresh();
        } else if (outcome === "empty") {
          unresolvedResumeReadAttempts.delete(attemptKey);
          setFeedback("empty");
          refresh();
        } else if (outcome === "no_allowance") {
          unresolvedResumeReadAttempts.delete(attemptKey);
          setFeedback("no_allowance");
        } else if (outcome === "not_entitled") {
          unresolvedResumeReadAttempts.delete(attemptKey);
          setFeedback("not_entitled");
        } else if (outcome === "stale_file") {
          unresolvedResumeReadAttempts.delete(attemptKey);
          setFeedback("stale_file");
        } else if (outcome === "already_reading") {
          setFeedback("failed");
        } else {
          // Keep the request id for a retry after a transport or server
          // failure. The server's claim remains releasable on failure.
          setFeedback("failed");
        }
      } catch {
        if (!controller.signal.aborted) setFeedback("failed");
      } finally {
        if (activeController.current === controller) {
          activeController.current = null;
        }
        setIsReading(false);
      }
    },
    [dataProvider, refresh],
  );

  return { feedback, isReading, readResume };
}
