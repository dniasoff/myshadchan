import { ChevronRight, LogOut, Sparkles } from "lucide-react";
import { Translate, useAuthProvider, useLogout, useTranslate } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

import { BillingPage } from "../billing/BillingPage";
import { ChangePasswordButton } from "./ChangePasswordButton";
import { FamilySection } from "./FamilySection";
import { PersonasSection } from "./PersonasSection";
import { PreferencesSection } from "./PreferencesSection";
import { PrivacySection } from "./PrivacySection";
import { ProfileSection } from "./ProfileSection";
import { SectionLabel } from "./SectionLabel";

/**
 * Desktop /settings — the sidebar/TopBar "Settings" destination. Mirrors the
 * mobile Settings sections (account, family, preferences, privacy) in the
 * same Quiet-Luminance card system, instead of the generic CRM branding
 * configuration template this replaced (those fork resources no longer exist
 * in MyShadchan).
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
          <PersonasSection />
          <PreferencesSection />
        </div>

        <div className="space-y-6">
          <PrivacySection />

          <div>
            <SectionLabel>
              {translate("crm.billing.eyebrow", { _: "AI features" })}
            </SectionLabel>
            <ItemGroup className="overflow-hidden rounded-lg border">
              <Item asChild size="sm" className="cursor-pointer">
                <Link to={BillingPage.path}>
                  <ItemMedia>
                    <Sparkles className="size-4 text-muted-foreground" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-normal">
                      {translate("crm.billing.title", { _: "Billing" })}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Link>
              </Item>
            </ItemGroup>
          </div>

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
