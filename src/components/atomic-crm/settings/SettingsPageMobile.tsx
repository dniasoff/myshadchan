import { LogOut } from "lucide-react";
import { Translate, useAuthProvider, useLogout, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { ContextSwitcher } from "../layout/ContextSwitcher";
import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { useMyContexts } from "../root/useMyContexts";
import { ChangePasswordButton } from "./ChangePasswordButton";
import { FamilySection } from "./FamilySection";
import { PreferencesSection } from "./PreferencesSection";
import { PrivacySection } from "./PrivacySection";
import { ProfileSection } from "./ProfileSection";
import { SectionLabel } from "./SectionLabel";

/**
 * Mobile /settings — account, family, preferences, privacy (design-artifacts
 * ticket lane 7). The MCP-server and inbound-email cards that shipped with
 * the Atomic CRM template were developer plumbing, not parent-facing, and
 * have been removed from this surface.
 */
export const SettingsPageMobile = () => {
  const translate = useTranslate();
  const authProvider = useAuthProvider();
  const logout = useLogout();

  if (!authProvider) return null;

  return (
    <>
      <MobileHeader>
        <h1 className="text-xl font-semibold">
          {translate("crm.settings.title")}
        </h1>
      </MobileHeader>
      <MobileContent>
        <div className="flex min-h-[calc(100dvh-3.5rem-4.5rem)] flex-col">
          <div className="space-y-6">
            <ContextSwitcherSection />
            <ProfileSection />
            <FamilySection />
            <PreferencesSection />
            <PrivacySection />
          </div>

          <div className="mb-4 mt-auto space-y-3 pt-6">
            <ChangePasswordButton />
            <Button
              variant="destructive"
              className="h-auto w-full text-base"
              onClick={() => logout()}
            >
              <LogOut className="me-3 size-5" />
              <Translate i18nKey="ra.auth.logout">Log out</Translate>
            </Button>
          </div>
        </div>
      </MobileContent>
    </>
  );
};

SettingsPageMobile.path = "/settings";

// Interim mobile entry point for the context switcher (2.4 AC-7; 4.4 moves
// it into the mobile "More" menu and deletes it from here). Gated on the
// same "fewer than 2 contexts" rule as `ContextSwitcher` itself (AC-1) so
// the heading above it never appears on its own — a lone `SectionLabel`
// with nothing switchable below it would be exactly the "visual trace"
// AC-1 forbids.
const ContextSwitcherSection = () => {
  const { data: contexts } = useMyContexts();
  const translate = useTranslate();

  if (!contexts || contexts.length < 2) {
    return null;
  }

  return (
    <div>
      <SectionLabel>
        {translate("crm.context_switcher.section_title", { _: "Context" })}
      </SectionLabel>
      <ContextSwitcher />
    </div>
  );
};
