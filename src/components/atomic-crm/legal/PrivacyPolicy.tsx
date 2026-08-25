import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { AuthLayout } from "../login/AuthLayout";

/**
 * Privacy Policy page — bare route (outside the app shell), reachable
 * without authentication.
 *
 * The reading width comes from `AuthLayout`'s `maxWidthClassName`, not from
 * a `max-w-*` on the div below: the card column is the narrower of the two,
 * so a width declared only in here is dead and the document renders in a
 * ~200px ribbon on a phone.
 */
export const PrivacyPolicy = () => {
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
            {translate("crm.legal.privacy.title", {
              _: "Privacy Policy",
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate("crm.legal.privacy.last_updated", {
              _: "Last updated: 2026-08-09 (v1)",
            })}
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.controller.title", {
              _: "1. Data Controller",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.controller.body", {
              _: "MyShadchan (operated by the MyShadchan project) is the data controller for the personal data you provide when using the service. Contact: dniasoff@gmail.com.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.data_collected.title", {
              _: "2. Data We Collect",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.data_collected.body", {
              _: "We collect what you enter: account email, family member names, shidduch records, reference people, notes, tasks, and uploaded files. We also record first-party usage counts (which suggestions were filed, reference calls logged, inbox captures) that are linked to your account and can be turned off in Settings → Privacy. There are no tracking pixels, third-party cookies, or third-party analytics.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.purpose.title", {
              _: "3. Purpose & Legal Basis",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.purpose.body", {
              _: "Your data is processed solely to provide the shidduch management service (contract performance) and to meet legal obligations (e.g., the 18+ confirmation accepted at signup, which is a declaration and is not verified). No profiling, automated decision-making, or marketing use occurs.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.sharing.title", {
              _: "4. Sharing & Sub-processors",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.sharing.body", {
              _: "Your data is never sold. It is shared only with the sub-processors listed on our Sub-processors page (infrastructure, email delivery, payments, AI inference) and only as needed to operate the service. Each is used under its own published data-processing terms.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.rights.title", {
              _: "5. Your Rights",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.rights.body", {
              _: "You may access, rectify, export, or delete your data at any time from Settings → Privacy. You may also object to processing or request restriction. We respond within 30 days.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.retention.title", {
              _: "6. Retention",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.retention.body", {
              _: "Data is retained while your account is active. On deletion, it is removed from primary storage within 30 days. No backup copies are kept, so there is no separate backup deletion step.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.security.title", {
              _: "7. Security",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.security.body", {
              _: "Data is encrypted in transit (TLS 1.2+) and at rest (AES-256), as provided by our hosting sub-processors. Access is limited to the operator of the service.",
            })}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.privacy.contact.title", {
              _: "8. Contact",
            })}
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {translate("crm.legal.privacy.contact.body", {
              _: "Privacy questions or requests: dniasoff@gmail.com. You also have the right to lodge a complaint with your supervisory authority.",
            })}
          </p>
        </section>

        <footer className="pt-6 border-t text-center text-sm text-muted-foreground">
          <p>
            {translate("crm.legal.privacy.footer_note", {
              _: "The code is public. The record is free; the optional AI features are paid. Run at cost.",
            })}
          </p>
        </footer>
      </div>
    </AuthLayout>
  );
};

PrivacyPolicy.path = "/privacy";
