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
