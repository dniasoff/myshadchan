import { LandingGate } from "@/components/atomic-crm/landing";
import { PublicSearchPage } from "@/components/atomic-crm/listings/PublicSearchPage";
import {
  isPublicSearchUrl,
  type PublicSearchUrl,
} from "@/components/atomic-crm/listings/publicSearchUrl";
import { CRM } from "@/components/atomic-crm/root/CRM";
import { SharedProfilePage } from "@/components/atomic-crm/sharing/SharedProfilePage";
import {
  isShareUrl,
  type ShareUrl,
} from "@/components/atomic-crm/sharing/shareToken";

/** Both pre-CRM route predicates only ever read `pathname`/`search`
 * (`isPublicSearchUrl`) or `pathname`/`hash` (`isShareUrl`) — a single
 * superset shape covers both without either page needing the other's
 * fields. */
type PreCrmUrl = PublicSearchUrl & ShareUrl;

export interface AppProps {
  /** Injectable for tests; defaults to the real `window.location`. Story
   * 9.4 review finding F5: without this, nothing in the suite actually
   * proves the `/find` branch below is wired into the real entry point —
   * `publicSearchUrl.test.ts` only proves `isPublicSearchUrl`'s own
   * predicate is correct in isolation, and deleting the branch entirely
   * left every other test green. Story 9.5 reuses the same injectable for
   * its own `/share` branch, for the identical reason. */
  url?: PreCrmUrl;
}

/**
 * Application entry point
 *
 * The public search page (`/find`, Story 9.4) and the share-link recipient
 * page (`/share`, Story 9.5) are checked FIRST, before `<LandingGate>`/
 * `<CRM>` ever mount — the same pre-CRM position the retired pre-Epic-1
 * token-based public page occupied (deleted by Epic 1 Story 1.4). No
 * authenticated route mounts for either request. Kept as two separate,
 * clearly named early-returns rather than merged into one generic "public
 * route" branch: their token handling (query vs. fragment) and data source
 * (direct anon Supabase read vs. a Worker fetch) are genuinely different —
 * see `sharing/shareToken.ts`'s own Dev Notes "Why this token is
 * fragment-only and 9.4's query isn't".
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
  if (isPublicSearchUrl(url)) {
    return <PublicSearchPage />;
  }

  if (isShareUrl(url)) {
    return <SharedProfilePage />;
  }

  return (
    <LandingGate>
      <CRM disableTelemetry />
    </LandingGate>
  );
};

export default App;
