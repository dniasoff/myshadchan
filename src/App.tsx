import { LandingGate } from "@/components/atomic-crm/landing";
import { ChildPortalPage, isPortalUrl } from "@/components/atomic-crm/portal";
import { CRM } from "@/components/atomic-crm/root/CRM";

/**
 * Application entry point
 *
 * `/portal` is the UNAUTHENTICATED, read-only child portal (E7). It is checked
 * FIRST and rendered entirely OUTSIDE `<CRM>`/`<Admin>`, so no authenticated route
 * ever mounts for it — a child arriving with a link never touches the CRM shell.
 *
 * `<LandingGate>` sits in front of the CRM: a visitor arriving at `/` without a
 * session gets the public landing page, everyone else falls through to the app.
 *
 * Customize MyShadchan by passing props to the CRM component:
 *  - companySectors
 *  - darkTheme
 *  - dealCategories
 *  - dealPipelineStatuses
 *  - dealStages
 *  - lightTheme
 *  - logo
 *  - noteStatuses
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
const App = () => {
  if (isPortalUrl(window.location)) {
    return <ChildPortalPage />;
  }

  return (
    <LandingGate>
      <CRM disableTelemetry />
    </LandingGate>
  );
};

export default App;
