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
import MobileHeader from "../layout/MobileHeader";
import { CommunicationSection } from "./CommunicationSection";
import { ConnectionSection } from "./ConnectionSection";
import { FamilySection } from "./FamilySection";
import { InvitesSection } from "./InvitesSection";
import { PersonasSection } from "./PersonasSection";
import { PreferencesSection } from "./PreferencesSection";
import { PrivacySection } from "./PrivacySection";
import { ProfileSection } from "./ProfileSection";
import { SectionLabel } from "./SectionLabel";

/**
 * Mobile /settings — account, family, preferences, privacy (design-artifacts
 * ticket lane 7). The MCP-server and inbound-email cards that shipped with
 * the Atomic CRM template were developer plumbing, not parent-facing, and
 * have been removed from this surface.
 *
 * `<MobileContent>` chrome comes from `MobileLayout` itself
 * (ui-audit-plan.md S3) — wrapping again here would nest a second
 * `<main id="main-content">` and double the page padding.
 *
 * The context switcher's interim mount here (Story 2.4 AC-7) is removed as
 * of Story 4.4 (NFR-14): it now lives in `layout/MobileNavigation.tsx`'s
 * "More" menu — the persistent mobile chrome slot that did not exist at
 * 2.4-time.
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
      <div className="flex min-h-[calc(100dvh-3.5rem-4.5rem)] flex-col">
        <div className="space-y-6">
          <ProfileSection />
          <FamilySection />
          <PersonasSection />
          <InvitesSection />
          <PreferencesSection />
          <CommunicationSection />
          <ConnectionSection />
          <PrivacySection />
          <BillingSection />
        </div>

        {/* Logging out is reversible and routine, not destructive — matches
            the desktop SettingsPage.tsx treatment exactly (loose-ends round
            item I: the two surfaces had drifted, desktop having already
            moved off `variant="destructive"`, reserved for the delete
            path). */}
        <div className="mb-4 mt-auto space-y-3 pt-6">
          <Button
            variant="outline"
            className="h-auto w-auto text-base"
            onClick={() => logout()}
          >
            <LogOut className="me-3 size-5" />
            <Translate i18nKey="ra.auth.logout">Log out</Translate>
          </Button>
        </div>
      </div>
    </>
  );
};

SettingsPageMobile.path = "/settings";

/**
 * Mobile entry point for the billing / AI-entitlement page (loose-ends round
 * item H): unreachable from any mobile surface before this story — neither
 * this page nor `MobileNavigation` linked to it, so a phone-only user had no
 * way to find the product's only paid surface. Mirrors the desktop
 * `settings/SettingsPage.tsx` placement and copy exactly.
 */
const BillingSection = () => {
  const translate = useTranslate();

  return (
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
  );
};
