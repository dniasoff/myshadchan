import { Button } from "@/components/ui/button";
import { LandingBrand } from "./LandingBrand";
import { SIGN_IN_PATH } from "./landingLinks";
import { translateLanding } from "./landingTranslate";

export const LandingHeader = () => (
  <header className="relative px-6 py-5 sm:px-8 sm:py-6">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
      <LandingBrand />
      <Button asChild size="sm" className="h-10 px-5 shadow-xs">
        <a href={SIGN_IN_PATH}>
          {translateLanding("crm.landing.nav.sign_in", "Sign in")}
        </a>
      </Button>
    </div>
  </header>
);

export const LandingFooter = () => (
  <footer className="border-t px-6 py-10 sm:px-8">
    <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <LandingBrand size="sm" />
      <p className="text-sm text-muted-foreground">
        {translateLanding(
          "crm.landing.footer.note",
          "The code is public. The service is free, run at cost.",
        )}
      </p>
    </div>
  </footer>
);
