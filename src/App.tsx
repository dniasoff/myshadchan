import { isPublicSearchUrl } from "@/components/atomic-crm/listings/publicSearchUrl";
import { isShareUrl } from "@/components/atomic-crm/sharing/shareToken";
import { isPurgeRequestUrl } from "@/components/atomic-crm/listings/purgeRequestUrl";
import { isPurgeRequestVerifyUrl } from "@/components/atomic-crm/listings/purgeRequestVerifyUrl";
import { PublicSearchPage } from "@/components/atomic-crm/listings/PublicSearchPage";
import { SharedProfilePage } from "@/components/atomic-crm/sharing/SharedProfilePage";
import { PurgeRequestPage } from "@/components/atomic-crm/listings/PurgeRequestPage";
import { PurgeRequestVerifyPage } from "@/components/atomic-crm/listings/PurgeRequestVerifyPage";

const App = ({ url = window.location }: AppProps = {}) => {
  if (isPublicSearchUrl(url)) {
    return <PublicSearchPage />;
  }

  if (isShareUrl(url)) {
    return <SharedProfilePage />;
  }

  if (isPurgeRequestUrl(url)) {
    return <PurgeRequestPage />;
  }

  if (isPurgeRequestVerifyUrl(url)) {
    return <PurgeRequestVerifyPage />;
  }

  return (
    <LandingGate>
      <CRM disableTelemetry />
    </LandingGate>
  );
};

export default App;
