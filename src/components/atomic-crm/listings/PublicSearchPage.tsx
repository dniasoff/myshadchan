import { useEffect, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import type { Listing } from "../types";
import { loadPublicListings } from "./publicListingsClient";
import { ShadchanListingCard } from "./ShadchanListingCard";
import { SingleListingCard } from "./SingleListingCard";
import { translatePublicSearch } from "./publicSearchTranslate";
import type { PublicSearchUrl } from "./publicSearchUrl";

/** 300ms — the same typing debounce `misc/GlobalSearch.tsx` (Story 4.5,
 * AC-5) established for the in-app search. */
const DEBOUNCE_MS = 300;

type SearchPhase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "results"; listings: Listing[] };

export interface PublicSearchPageProps {
  /** Injectable for tests; defaults to the real `window.location`. */
  url?: PublicSearchUrl;
  /** Injectable loader; defaults to the anon Supabase client (Task 2). */
  loadListings?: (query: {
    text?: string;
    type?: Listing["listing_type"];
  }) => Promise<Listing[]>;
}

/** Reads the shareable `?q=` param (Task 1's rationale for a plain query
 * string over a fragment) so a shared search link reconstructs its result
 * on a fresh load, not just an empty search box. */
const initialQueryFrom = (url: PublicSearchUrl): string =>
  new URLSearchParams(url.search).get("q")?.trim() ?? "";

/** A calm, un-chromed surface — same visual language as the retired
 * pre-Epic-1 token-based public page (deleted before this story; its
 * component is gone, only the look is being followed here). */
const SearchShell = ({ children }: { children: ReactNode }) => (
  <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(120% 80% at 50% -10%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%), radial-gradient(90% 60% at 100% 0%, color-mix(in oklch, var(--violet, var(--primary)) 12%, transparent), transparent 55%)",
      }}
    />
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-14 sm:py-20">
      {children}
    </main>
  </div>
);

/**
 * Story 9.4's unauthenticated, read-only public search (`/find`). Rendered
 * OUTSIDE the CRM's authed routes (see `App.tsx`) — no ra-core write layer,
 * no authenticated list framework, no `<Admin>` context of any kind (Dev
 * Notes, "Why the authenticated list framework is the wrong tool here"). It
 * reads the free-text query the visitor types (or arrives with, via `?q=`)
 * and asks the anon Supabase client what published listings match; every
 * access decision — which rows, which columns — is already made by 9.1's
 * RLS policy and grant, not by this page.
 */
export const PublicSearchPage = ({
  url = window.location,
  loadListings = loadPublicListings,
}: PublicSearchPageProps) => {
  const [rawQuery, setRawQuery] = useState(() => initialQueryFrom(url));
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    initialQueryFrom(url),
  );
  const [phase, setPhase] = useState<SearchPhase>({ status: "idle" });

  // The raw keystroke is held locally so the input feels instant; the fetch
  // effect below only ever sees the value DEBOUNCE_MS after the last
  // keystroke. Cleanup clears the pending timeout on every keystroke, so
  // only the trailing one ever fires (mirrors `misc/GlobalSearch.tsx`'s own
  // Task 2, AC-5).
  useEffect(() => {
    const timeoutId = setTimeout(
      () => setDebouncedQuery(rawQuery),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [rawQuery]);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      // AC-6: no query yet — a distinct calm state, and no fetch at all.
      setPhase({ status: "idle" });
      return;
    }
    let isStale = false;
    setPhase({ status: "loading" });
    loadListings({ text: trimmed })
      .then((listings) => {
        if (!isStale) {
          setPhase({ status: "results", listings });
        }
      })
      .catch(() => {
        // AC-6: a network/config failure reads as a calm error state, never
        // an unhandled exception boundary or a raw error message (nothing
        // here is sensitive enough to withhold, but nothing useful enough
        // to a visitor to show either).
        if (!isStale) {
          setPhase({ status: "error" });
        }
      });
    return () => {
      isStale = true;
    };
  }, [debouncedQuery, loadListings]);

  const shadchanListings =
    phase.status === "results"
      ? phase.listings.filter((listing) => listing.listing_type === "shadchan")
      : [];
  const singleListings =
    phase.status === "results"
      ? phase.listings.filter((listing) => listing.listing_type === "single")
      : [];

  // AC-5: branch on `listing_type` once, here, to pick which card renders a
  // given row — neither card component tries to handle both shapes itself.
  const renderListingCard = (listing: Listing) =>
    listing.listing_type === "shadchan" ? (
      <ShadchanListingCard key={listing.id} listing={listing} />
    ) : (
      <SingleListingCard key={listing.id} listing={listing} />
    );

  return (
    <SearchShell>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          MyShadchan
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          {translatePublicSearch(
            "crm.public_search.title",
            "Find a shadchan or a single",
          )}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {translatePublicSearch(
            "crm.public_search.subtitle",
            "Search only shows what each family has chosen to publish.",
          )}
        </p>
      </header>

      <Input
        type="search"
        value={rawQuery}
        onChange={(event) => setRawQuery(event.target.value)}
        placeholder={translatePublicSearch(
          "crm.public_search.search_placeholder",
          "Search by name, area, or community",
        )}
        aria-label={translatePublicSearch(
          "crm.public_search.search_placeholder",
          "Search by name, area, or community",
        )}
      />

      <div className="mt-8 flex flex-col gap-8">
        {phase.status === "idle" && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="public-search-idle"
          >
            {translatePublicSearch(
              "crm.public_search.idle_hint",
              "Start typing to search published listings.",
            )}
          </p>
        )}

        {phase.status === "loading" && (
          <div
            aria-busy="true"
            aria-live="polite"
            data-testid="public-search-loading"
          >
            <span className="sr-only">
              {translatePublicSearch("crm.public_search.loading", "Searching…")}
            </span>
            <Spinner size="small" />
          </div>
        )}

        {phase.status === "error" && (
          <p role="alert" data-testid="public-search-error">
            {translatePublicSearch(
              "crm.public_search.error",
              "Couldn't load listings. Please try again.",
            )}
          </p>
        )}

        {phase.status === "results" && phase.listings.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="public-search-empty"
          >
            {translatePublicSearch(
              "crm.public_search.empty",
              "No published listings match this search.",
            )}
          </p>
        )}

        {phase.status === "results" && shadchanListings.length > 0 && (
          <section aria-labelledby="public-search-shadchanim-heading">
            <h2
              id="public-search-shadchanim-heading"
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {translatePublicSearch(
                "crm.public_search.shadchanim_heading",
                "Shadchanim",
              )}
            </h2>
            <div className="flex flex-col gap-3">
              {shadchanListings.map(renderListingCard)}
            </div>
          </section>
        )}

        {phase.status === "results" && singleListings.length > 0 && (
          <section aria-labelledby="public-search-singles-heading">
            <h2
              id="public-search-singles-heading"
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {translatePublicSearch(
                "crm.public_search.singles_heading",
                "Singles",
              )}
            </h2>
            <div className="flex flex-col gap-3">
              {singleListings.map(renderListingCard)}
            </div>
          </section>
        )}
      </div>
    </SearchShell>
  );
};
