import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { AuthLayout } from "../login/AuthLayout";

/**
 * Terms of Service page — bare route (outside the app shell), reachable
 * without authentication. Mirrors the placement of RegisterFlow and
 * InviteAcceptance in routeManifest.ts.
 *
 * Reading width comes from `AuthLayout`'s `maxWidthClassName` — see the same
 * note on `PrivacyPolicy`.
 */
export const TermsOfService = () => {
  const translate = useTranslate();

  return (
    <AuthLayout
      maxWidthClassName="max-w-3xl"
      footer={
        <>
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {translate("crm.auth.back_to_home", { _: "Back to home" })}
          </Link>
        </>
      }
    >
      <div className="space-y-8">
        <header className="text-center space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {translate("crm.legal.terms.title", {
              _: "Terms of Service",
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate("crm.legal.terms.last_updated", {
              _: "Last updated: 2026-08-09 (v1)",
            })}
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.acceptance.title", {
              _: "1. Acceptance of Terms",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.acceptance.body", {
              _: "By accessing or using MyShadchan, you agree to be bound by these Terms. If you do not agree, do not use the service.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.accounts.title", {
              _: "2. Accounts",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.accounts.body", {
              _: "You must be 18 or older to create an account. You are responsible for keeping your credentials secure and for all activity under your account. Accounts are per family/household; you may invite additional members.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.data.title", {
              _: "3. Your Data",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.data.body", {
              _: "You own the records you create. MyShadchan does not pool your data with other families, does not train models on it, and does not sell it. One feature sends data to an AI provider: resume auto-parse sends the resume you upload to Google's Gemini API (see Sub-processors). No other feature sends your records to an AI provider. You can export or delete your data at any time from Settings → Privacy.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.usage.title", {
              _: "4. Acceptable Use",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.usage.body", {
              _: "You may not use the service for unlawful purposes, to harass anyone, or to interfere with the service's operation. We may suspend or terminate access for violations.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.availability.title", {
              _: "5. Availability & Changes",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.availability.body", {
              _: 'The service is provided "as is" without warranties. We may modify or discontinue features with reasonable notice. These Terms may be updated; continued use constitutes acceptance.',
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.limitation.title", {
              _: "6. Limitation of Liability",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.limitation.body", {
              _: "To the fullest extent permitted by law, MyShadchan and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the service.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.terms.contact.title", {
              _: "7. Contact",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.terms.contact.body", {
              _: "Questions about these Terms? Contact dniasoff@gmail.com.",
            })}
          </p>
        </section>

        <footer className="pt-6 border-t text-center text-sm text-muted-foreground">
          <p>
            {translate("crm.legal.terms.footer_note", {
              _: "The code is public. The record is free; the optional AI features are paid. Run at cost.",
            })}
          </p>
        </footer>
      </div>
    </AuthLayout>
  );
};

TermsOfService.path = "/terms";
