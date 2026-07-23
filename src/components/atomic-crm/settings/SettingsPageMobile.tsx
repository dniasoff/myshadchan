import { LogOut } from "lucide-react";
import { Translate, useAuthProvider, useLogout, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { AboutSection } from "./AboutSection";
import { ChangePasswordButton } from "./ChangePasswordButton";
import { FamilySection } from "./FamilySection";
import { PreferencesSection } from "./PreferencesSection";
import { PrivacySection } from "./PrivacySection";
import { ProfileSection } from "./ProfileSection";

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
            <ProfileSection />
            <FamilySection />
            <PreferencesSection />
            <PrivacySection />
            <AboutSection />
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
