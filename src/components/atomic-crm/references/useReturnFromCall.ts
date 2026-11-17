import { useCallback, useEffect, useMemo, useState } from "react";
import type { Identifier } from "ra-core";

export const RETURN_FROM_CALL_STORAGE_KEY = "myshadchan.pending-reference-call";

const MIN_HIDDEN_MS = 5_000;
const MAX_RETURN_MS = 30 * 60 * 1_000;
const RETURN_CALL_EVENT = "myshadchan:pending-reference-call";

type PendingReferenceCall = {
  referenceKey: string;
  tappedAt: number;
  hiddenAt?: number;
  promptedAt?: number;
};

const withoutHiddenAt = (
  pending: PendingReferenceCall,
): PendingReferenceCall => {
  const next = { ...pending };
  delete next.hiddenAt;
  return next;
};

const keyFor = (referenceKey: Identifier | null | undefined): string | null =>
  referenceKey == null ? null : String(referenceKey);

const readPending = (): PendingReferenceCall | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_FROM_CALL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingReferenceCall>;
    if (
      typeof parsed.referenceKey !== "string" ||
      typeof parsed.tappedAt !== "number" ||
      !Number.isFinite(parsed.tappedAt)
    ) {
      return null;
    }
    return parsed as PendingReferenceCall;
  } catch {
    return null;
  }
};

const writePending = (pending: PendingReferenceCall | null): void => {
  if (typeof window === "undefined") return;
  try {
    if (pending) {
      window.sessionStorage.setItem(
        RETURN_FROM_CALL_STORAGE_KEY,
        JSON.stringify(pending),
      );
    } else {
      window.sessionStorage.removeItem(RETURN_FROM_CALL_STORAGE_KEY);
    }
  } catch {
    // A disabled or full session store must not block the call link.
  }
};

const notifyPendingChange = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RETURN_CALL_EVENT));
  }
};

/**
 * Arms a reference call without persisting any contact details. A prompt is
 * eligible only after the same tab was hidden for at least five seconds and
 * returned within thirty minutes.
 */
export const useReturnFromCall = (
  referenceKey: Identifier | null | undefined,
): {
  arm: () => void;
  isPromptOpen: boolean;
  dismiss: () => void;
} => {
  const stableKey = useMemo(() => keyFor(referenceKey), [referenceKey]);
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  const dismiss = useCallback(() => {
    const pending = readPending();
    if (pending && pending.referenceKey === stableKey) {
      writePending(null);
      notifyPendingChange();
    }
    setIsPromptOpen(false);
  }, [stableKey]);

  const arm = useCallback(() => {
    if (!stableKey) return;
    writePending({ referenceKey: stableKey, tappedAt: Date.now() });
    setIsPromptOpen(false);
    notifyPendingChange();
  }, [stableKey]);

  useEffect(() => {
    if (!stableKey || typeof window === "undefined") return;

    const evaluateVisibleReturn = () => {
      if (document.visibilityState !== "visible") return;
      const pending = readPending();
      if (!pending || pending.referenceKey !== stableKey) {
        setIsPromptOpen(false);
        return;
      }

      if (pending.promptedAt) {
        if (pending.hiddenAt != null) {
          writePending(withoutHiddenAt(pending));
          notifyPendingChange();
        }
        return;
      }
      const now = Date.now();
      const hiddenFor = pending.hiddenAt == null ? 0 : now - pending.hiddenAt;
      const totalElapsed = now - pending.tappedAt;

      if (totalElapsed > MAX_RETURN_MS) {
        writePending(null);
        notifyPendingChange();
        return;
      }

      const visiblePending = withoutHiddenAt(pending);
      if (hiddenFor < MIN_HIDDEN_MS) {
        writePending(visiblePending);
        notifyPendingChange();
        return;
      }

      writePending({ ...visiblePending, promptedAt: now });
      notifyPendingChange();
      setIsPromptOpen(true);
    };

    const onVisibilityChange = () => {
      const pending = readPending();
      if (document.visibilityState === "hidden") {
        if (pending && pending.referenceKey === stableKey) {
          writePending({ ...pending, hiddenAt: Date.now() });
        }
        return;
      }
      evaluateVisibleReturn();
    };

    const onPendingChange = () => {
      const pending = readPending();
      setIsPromptOpen(
        pending?.referenceKey === stableKey && pending.promptedAt != null,
      );
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(RETURN_CALL_EVENT, onPendingChange);
    evaluateVisibleReturn();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(RETURN_CALL_EVENT, onPendingChange);
    };
  }, [stableKey]);

  return { arm, isPromptOpen, dismiss };
};
