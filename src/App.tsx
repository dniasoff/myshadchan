import { LandingGate } from "@/components/atomic-crm/landing";
import { PublicSearchPage } from "@/components/atomic-crm/listings/PublicSearchPage";
import {
  isPublicSearchUrl,
  type PublicSearchUrl,
} from "@/components/atomic-crm/listings/publicSearchUrl";
import { CRM } from "@/components/atomic-crm/root/CRM";

export interface AppProps {
  /** Injectable for tests; defaults to the real `window.location`. Story
   * 9.4 review finding F5: without this, nothing in the suite actually
   * proves the `/find` branch below is wired into the real entry point —
   * `publicSearchUrl.test.ts` only proves `isPublicSearchUrl`'s own
   * predicate is correct in isolation, and deleting the branch entirely
   * left every other test green. */
  url?: PublicSearchUrl;
}

/**
 * Application entry point
 *
 * The public search page (`/find`, Story 9.4) is checked FIRST, before
 * `<LandingGate>`/`<CRM>` ever mount — the same pre-CRM position the
 * retired pre-Epic-1 token-based public page occupied (deleted by Epic 1
 * Story 1.4). No authenticated route mounts for this request.
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

  return (
    <LandingGate>
      <CRM disableTelemetry />
    </LandingGate>
  );
};

export default App;
