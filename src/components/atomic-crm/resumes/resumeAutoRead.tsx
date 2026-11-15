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
import {
  isAutomaticallyReadableResume,
  type ResumeAutoReadFeedback,
} from "./resumeAutoReadHelpers";

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
      if (activeController.current) return;

      const attemptKey = resumeReadAttemptKey(resumeId, file.path);
      const requestId =
        unresolvedResumeReadAttempts.get(attemptKey) ??
        createResumeReadRequestId();
      unresolvedResumeReadAttempts.set(attemptKey, requestId);
      setFeedback("reading");
      setIsReading(true);
      const controller = new AbortController();
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
