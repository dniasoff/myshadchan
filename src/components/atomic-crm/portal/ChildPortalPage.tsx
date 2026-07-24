import { useEffect, useState } from "react";

import type { ChildPortalData } from "../types";
import { loadChildPortal } from "./portalClient";
import { PortalSuggestionCard } from "./PortalSuggestionCard";
import { readPortalToken, type PortalUrl } from "./portalToken";

type LoadState =
  | { phase: "loading" }
  | { phase: "active"; data: ChildPortalData }
  | { phase: "inactive" };

export interface ChildPortalPageProps {
  /** Injectable for tests; defaults to the real `window.location`. */
  url?: PortalUrl;
  /** Injectable loader; defaults to the anon Supabase RPC. */
  loadPortal?: (token: string) => Promise<ChildPortalData | null>;
}

/** A calm reading surface with a soft ambient glow — no app chrome, no sidebar. */
const PortalShell = ({ children }: { children: React.ReactNode }) => (
  <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(120% 80% at 50% -10%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%), radial-gradient(90% 60% at 100% 0%, color-mix(in oklch, var(--violet, var(--primary)) 12%, transparent), transparent 55%)",
      }}
    />
    <main className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-14 sm:py-20">
      {children}
    </main>
  </div>
);

/** The quiet notice shown for a missing, unknown or revoked link. */
const InactiveNotice = () => (
  <PortalShell>
    <div className="m-auto max-w-md text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        MyShadchan
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
        This link is no longer active
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        If you were expecting to see something here, please ask the person who
        shared this link to send you a new one.
      </p>
    </div>
  </PortalShell>
);

const LoadingNotice = () => (
  <PortalShell>
    <div className="m-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div
        className="h-10 w-10 rounded-full border-2 border-transparent"
        style={{
          borderTopColor: "var(--primary)",
          borderRightColor:
            "color-mix(in oklch, var(--primary) 40%, transparent)",
          animation: "spin 0.9s linear infinite",
        }}
      />
    </div>
  </PortalShell>
);

const PortalContent = ({ data }: { data: ChildPortalData }) => {
  const firstName =
    data.child.first_name_en?.trim() ||
    data.child.first_name_he?.trim() ||
    null;
  const heading = firstName ? `${firstName}'s space` : "Your space";
  const suggestions = data.suggestions ?? [];

  return (
    <PortalShell>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          MyShadchan
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          {heading}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          What&rsquo;s being looked into for you.
        </p>
      </header>

      {suggestions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing to show just yet. When something is being looked into, it
            will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((suggestion, index) => (
            <PortalSuggestionCard
              // A stable-enough key for a static, read-only list; the RPC
              // deliberately never exposes internal ids.
              key={`${suggestion.name_en ?? suggestion.name_he ?? "s"}-${index}`}
              suggestion={suggestion}
            />
          ))}
        </div>
      )}

      <footer className="mt-auto pt-12">
        <p className="text-xs text-muted-foreground">
          This is a private, read-only view shared with you. Only what your
          family has chosen to share appears here.
        </p>
      </footer>
    </PortalShell>
  );
};

/**
 * The unauthenticated, read-only "‹child›'s space" portal (E7). Rendered OUTSIDE
 * the CRM's authed routes (see App.tsx). It reads the token from the URL and asks
 * the anon Supabase RPC what to show; every access decision is made server-side.
 * An invalid/revoked/missing token — or any error — resolves to a calm inactive
 * notice, never a crash.
 */
export const ChildPortalPage = ({
  url = window.location,
  loadPortal = loadChildPortal,
}: ChildPortalPageProps) => {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    const token = readPortalToken(url);
    if (!token) {
      setState({ phase: "inactive" });
      return;
    }
    let isStale = false;
    loadPortal(token)
      .then((data) => {
        if (isStale) return;
        setState(data ? { phase: "active", data } : { phase: "inactive" });
      })
      .catch(() => {
        // Fail soft: a transport or config error reads as an inactive link, not
        // a broken page. No error detail is surfaced to an anonymous viewer.
        if (!isStale) {
          setState({ phase: "inactive" });
        }
      });
    return () => {
      isStale = true;
    };
  }, [loadPortal, url]);

  if (state.phase === "loading") {
    return <LoadingNotice />;
  }
  if (state.phase === "inactive") {
    return <InactiveNotice />;
  }
  return <PortalContent data={state.data} />;
};
