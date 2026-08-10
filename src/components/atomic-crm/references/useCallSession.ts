import { useSearchParams } from "react-router";
import { useCallback, useMemo } from "react";

/**
 * Manages the guided call session cursor via URL search params.
 * Reads/writes `?call=<link id>&step=<n>` using react-router's useSearchParams
 * (hash-aware — works correctly under HashRouter).
 * Out-of-range or non-numeric `step` clamps to 1 (lower bound only).
 * The caller is responsible for upper-bound clamping against the script length,
 * because the script is not knowable inside this hook.
 */
export function useCallSession() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeLinkId = searchParams.get("call");
  const stepParam = searchParams.get("step");
  const step = useMemo(() => {
    const parsed = stepParam ? parseInt(stepParam, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [stepParam]);

  const open = useCallback(
    (linkId: string) => {
      setSearchParams({ call: linkId, step: "1" }, { replace: true });
    },
    [setSearchParams],
  );

  const goTo = useCallback(
    (newStep: number) => {
      if (!activeLinkId) return;
      const clamped = Number.isFinite(newStep) && newStep > 0 ? newStep : 1;
      setSearchParams(
        { call: activeLinkId, step: String(clamped) },
        { replace: true },
      );
    },
    [activeLinkId, setSearchParams],
  );

  const close = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return {
    activeLinkId,
    step,
    open,
    goTo,
    close,
  };
}
