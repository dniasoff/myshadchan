import { LogOut } from "lucide-react";
import { Translate, useAuthProvider, useLogout, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { AboutSection } from "./AboutSection";
import { ChangePasswordButton } from "./ChangePasswordButton";
import { FamilySection } from "./FamilySection";
import { PreferencesSection } from "./PreferencesSection";
import { PrivacySection } from "./PrivacySection";
import { ProfileSection } from "./ProfileSection";

/**
 * Desktop /settings — the sidebar/TopBar "Settings" destination. Mirrors the
 * mobile Settings sections (account, family, preferences, privacy, about) in
 * the same Quiet-Luminance card system, instead of the Atomic CRM
 * Branding/Companies/Deals/Notes/Tasks configuration template this replaced
 * (those entities no longer exist in MyShadchan).
 */
export const SettingsPage = () => {
  const translate = useTranslate();
  const authProvider = useAuthProvider();
  const logout = useLogout();

  if (!authProvider) return null;

  return (
    <div className="mx-auto mt-10 w-full max-w-4xl px-6 pb-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.settings.preferences", { _: "Preferences" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold tracking-tight">
          {translate("crm.settings.title")}
        </h1>
      </div>

      {/*
        Desktop widens into two balanced columns (single column below `lg`,
        e.g. tablets between the mobile breakpoint and 1024px). `items-start`
        keeps each card at its natural height instead of stretching to match
        the taller column.
      */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <ProfileSection />
          <FamilySection />
          <PreferencesSection />
        </div>

        <div className="space-y-6">
          <PrivacySection />
          <AboutSection />

          <div className="space-y-3 border-t border-border pt-6">
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
      </div>
    </div>
  );
};

SettingsPage.path = "/settings";
