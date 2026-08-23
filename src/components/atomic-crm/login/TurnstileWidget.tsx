import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { loadTurnstile, type TurnstileApi } from "./turnstileLoader";

export interface TurnstileWidgetHandle {
  /** Forces a fresh challenge/token — call after every request that
   * consumed the current token (a send or a resend), since a Turnstile
   * token is single-use. The parent is synchronously told that the old token
   * is gone before the new challenge begins. */
  reset: () => void;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  /** Fires with the solved token, or `null` once it expires/errors and is
   * no longer safe to send. */
  onToken: (token: string | null) => void;
  className?: string;
}

/**
 * Cloudflare Turnstile, mounted once per auth screen and kept alive across
 * every step of that screen's flow (see LoginPage / RegisterFlow) — a
 * resend needs a fresh token exactly as much as the initial send does, and
 * re-mounting the widget per step would mean re-solving a challenge the
 * visitor already passed seconds earlier.
 */
export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(({ siteKey, onToken, className }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);

  // `onToken` is a fresh closure on most renders (the parent's inline state
  // setter usage or a re-created callback prop) but the widget must only be
  // rendered ONCE per `siteKey` — re-running the load/render effect on every
  // `onToken` identity change would tear down and re-solve a challenge the
  // visitor already passed. Routing every callback through a ref kept in
  // sync by its own small effect (below) lets the load effect depend on
  // `siteKey` alone: reading `.current` inside it is exempt from
  // `react-hooks/exhaustive-deps` (a `useRef` container's identity is
  // already stable), so this needs no disable comment.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let isStale = false;
    loadTurnstile()
      .then((api) => {
        if (isStale || !containerRef.current) {
          return;
        }
        apiRef.current = api;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // A blocked/failed script load must never crash the login screen —
        // it just means no token ever arrives, so the gated submit button
        // stays disabled and the visitor sees a calm notice instead.
        if (!isStale) {
          setFailedToLoad(true);
          onTokenRef.current(null);
        }
      });
    return () => {
      isStale = true;
      if (apiRef.current && widgetIdRef.current) {
        apiRef.current.remove(widgetIdRef.current);
      }
    };
  }, [siteKey]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      // `turnstile.reset()` does not guarantee that its expired callback runs
      // synchronously. Clear the parent's token first so a second request can
      // never reuse the just-consumed value while a fresh challenge starts.
      onTokenRef.current(null);
      if (apiRef.current && widgetIdRef.current) {
        apiRef.current.reset(widgetIdRef.current);
      }
    },
  }));

  if (failedToLoad) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="turnstile-widget"
    />
  );
});

TurnstileWidget.displayName = "TurnstileWidget";
