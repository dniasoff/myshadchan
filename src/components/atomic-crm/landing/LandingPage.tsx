import { StoreContextProvider } from "ra-core";
import { ThemeProvider } from "@/components/admin/theme-provider";
import { createCrmStore } from "../root/crmStore";
import { LandingBackdrop } from "./LandingBackdrop";
import { LandingFooter, LandingHeader } from "./LandingChrome";
import { LandingClosing } from "./LandingClosing";
import { LandingHero } from "./LandingHero";
import { LandingHowItWorks } from "./LandingHowItWorks";
import { LandingOpenness } from "./LandingOpenness";
import { LandingPrivacy } from "./LandingPrivacy";
import { LandingWhatItDoes } from "./LandingWhatItDoes";

/**
 * The landing page is rendered before `<Admin>` exists, so it brings its own
 * store — the same localStorage namespace the app uses — purely so a visitor
 * who has already chosen light or dark keeps that choice here.
 */
const landingStore = createCrmStore();

export const LandingPageContent = () => (
  <div className="relative flex min-h-screen flex-col bg-background text-foreground">
    <LandingBackdrop />
    <LandingHeader />
    <main className="relative flex-1">
      <LandingHero />
      <LandingWhatItDoes />
      <LandingHowItWorks />
      <LandingPrivacy />
      <LandingOpenness />
      <LandingClosing />
    </main>
    <LandingFooter />
  </div>
);

/**
 * Public, unauthenticated page shown at `/` to a visitor who is not signed in.
 * It reads no data and renders nothing about anybody — it only says what the
 * product is and offers one way in.
 */
export const LandingPage = () => (
  <StoreContextProvider value={landingStore}>
    <ThemeProvider>
      <LandingPageContent />
    </ThemeProvider>
  </StoreContextProvider>
);
