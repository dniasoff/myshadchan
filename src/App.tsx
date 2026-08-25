import { lazy, Suspense } from "react";
import { LandingGate } from "@/components/atomic-crm/landing";
import {
  isPublicSearchUrl,
  isDemoPreviewUrl,
  type PublicSearchUrl,
} from "@/components/atomic-crm/listings/publicSearchUrl";
import {
  isShareUrl,
  type ShareUrl,
} from "@/components/atomic-crm/sharing/shareToken";
import {
  isPurgeRequestUrl,
  type PurgeRequestUrl,
} from "@/components/atomic-crm/listings/purgeRequestUrl";
import {
  isPurgeRequestVerifyUrl,
  type PurgeRequestVerifyUrl,
} from "@/components/atomic-crm/listings/purgeRequestVerifyUrl";

// Keep the pre-auth entry chunk small. The CRM imports every authenticated
// resource and dashboard, but a visitor at `/login` only needs the auth shell.
// Loading it lazily also gives the user a visible state while the browser
// downloads and evaluates that larger chunk instead of showing a blank page.
const LazyCRM = lazy(async () => {
  const { CRM } = await import("@/components/atomic-crm/root/CRM");
  return { default: CRM };
});

/**
 * The four pre-CRM pages, lazily. Each is already behind a URL predicate, so
 * at most one of them can ever render — but statically imported they landed in
 * the entry chunk that EVERY visitor downloads, dragging zod, react-hook-form
 * and the data provider onto the landing page's critical path. Measured: the
 * entry chunk drops 261.5 KB -> 183.7 KB gzipped (-30%) by moving them here.
 *
 * The predicates themselves (`isPublicSearchUrl` and friends) stay static —
 * they are pure string checks, and they have to run before we know which
 * chunk to fetch.
 */
const LazyPublicSearchPage = lazy(async () => {
  const { PublicSearchPage } =
    await import("@/components/atomic-crm/listings/PublicSearchPage");
  return { default: PublicSearchPage };
});

/** The demo-preview variant needs the listings loader as well, so both are
 * fetched together rather than in series. */
const LazyDemoPreviewPage = lazy(async () => {
  const [{ PublicSearchPage }, { loadDemoPreviewListings }] = await Promise.all(
    [
      import("@/components/atomic-crm/listings/PublicSearchPage"),
      import("@/components/atomic-crm/listings/demoListingsClient"),
    ],
  );
  const DemoPreviewPage = ({ url }: { url: PublicSearchUrl }) => (
    <PublicSearchPage
      url={url}
      demoPreview
      loadListings={loadDemoPreviewListings}
    />
  );
  return { default: DemoPreviewPage };
});

const LazySharedProfilePage = lazy(async () => {
  const { SharedProfilePage } =
    await import("@/components/atomic-crm/sharing/SharedProfilePage");
  return { default: SharedProfilePage };
});

/**
 * The two purge pages are wrapped in `PublicRaShell` HERE, inside the lazy
 * chunk, rather than in the tree below — see that file for the blank-page bug
 * this fixes. Wrapping in `App.tsx` directly would pull ra-core and the data
 * provider back into the entry chunk and undo the split above.
 */
const LazyPurgeRequestPage = lazy(async () => {
  const [{ PurgeRequestPage }, { PublicRaShell }] = await Promise.all([
    import("@/components/atomic-crm/listings/PurgeRequestPage"),
    import("@/components/atomic-crm/listings/PublicRaShell"),
  ]);
  const WrappedPurgeRequestPage = () => (
    <PublicRaShell>
      <PurgeRequestPage />
    </PublicRaShell>
  );
  return { default: WrappedPurgeRequestPage };
});

const LazyPurgeRequestVerifyPage = lazy(async () => {
  const [{ PurgeRequestVerifyPage }, { PublicRaShell }] = await Promise.all([
    import("@/components/atomic-crm/listings/PurgeRequestVerifyPage"),
    import("@/components/atomic-crm/listings/PublicRaShell"),
  ]);
  const WrappedPurgeRequestVerifyPage = () => (
    <PublicRaShell>
      <PurgeRequestVerifyPage />
    </PublicRaShell>
  );
  return { default: WrappedPurgeRequestVerifyPage };
});

const AppLoading = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
    <div className="flex flex-col items-center gap-4" role="status">
      <div
        className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary"
        aria-hidden="true"
      />
      <span className="text-sm text-muted-foreground">Loading MyShadchan…</span>
    </div>
  </div>
);

/** Union of the URL shapes all pre-CRM predicates accept. `window.location`
 * has `pathname`, `search`, `hash` (and more), so it is assignable. */
type PreCrmUrl = PublicSearchUrl &
  ShareUrl &
  PurgeRequestUrl &
  PurgeRequestVerifyUrl;

export interface AppProps {
  /** Injectable for tests; defaults to the real `window.location`. Story
   * 9.4 review finding F5: without this, nothing in the suite actually
   * proves the `/find` branch below is wired into the real entry point —
   * `publicSearchUrl.test.ts` only proves `isPublicSearchUrl`'s own
   * predicate is correct in isolation, and deleting the branch entirely
   * left every other test green. */
  url?: PreCrmUrl;
}

/**
 * Application entry point
 *
 * The public search page (`/find`, Story 9.4), including its explicit
 * authenticated demo-preview mode (`/find?demo=1`), is checked FIRST, before
 * `<LandingGate>`/`<CRM>` ever mount — the same pre-CRM position the
 * retired pre-Epic-1 token-based public page occupied (deleted by Epic 1
 * Story 1.4). No authenticated route mounts for this request.
 *
 * The share page (`/share#<token>`, Story 10.x) and purge request pages
 * (`/purge-request`, `/purge-request-verify`) are also pre-CRM — they must
 * render without authentication or the CRM shell.
 *
 * `<LandingGate>` sits in front of the CRM: a visitor arriving at `/` without a
 * session gets the public landing page, everyone else falls through to the app.
 *
 * Customize MyShadchan by passing props to the CRM component:
 *  - darkTheme
 *  - lightTheme
 *  - logo
 *  - taskTypes
 *  - title
 * ... as well as all the props accepted by shadcn-admin-kit's <Admin> component.
 *
 * @example
 * const App = () => (
 *    <CRM
 *       logo="./img/logo.png"
 *       title="Acme CRM"
 *    />
 * );
 */
const App = ({ url = window.location }: AppProps = {}) => {
  if (isDemoPreviewUrl(url)) {
    return (
      <Suspense fallback={<AppLoading />}>
        <LazyDemoPreviewPage url={url} />
      </Suspense>
    );
  }

  if (isPublicSearchUrl(url)) {
    return (
      <Suspense fallback={<AppLoading />}>
        <LazyPublicSearchPage />
      </Suspense>
    );
  }

  if (isShareUrl(url)) {
    return (
      <Suspense fallback={<AppLoading />}>
        <LazySharedProfilePage />
      </Suspense>
    );
  }

  if (isPurgeRequestUrl(url)) {
    return (
      <Suspense fallback={<AppLoading />}>
        <LazyPurgeRequestPage />
      </Suspense>
    );
  }

  if (isPurgeRequestVerifyUrl(url)) {
    return (
      <Suspense fallback={<AppLoading />}>
        <LazyPurgeRequestVerifyPage />
      </Suspense>
    );
  }

  return (
    <LandingGate>
      <Suspense fallback={<AppLoading />}>
        <LazyCRM disableTelemetry />
      </Suspense>
    </LandingGate>
  );
};

export default App;
