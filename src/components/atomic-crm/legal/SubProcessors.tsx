import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { AuthLayout } from "../login/AuthLayout";

/**
 * Sub-processors page — bare route (outside the app shell), reachable
 * without authentication. Lists the six known processors derived from
 * deployment infrastructure — amend when infra changes.
 */
export const SubProcessors = () => {
  const translate = useTranslate();

  // Derived from deployment — amend when infra changes
  const processors = [
    {
      name: "Supabase",
      purpose: "PostgreSQL database, authentication, storage, Edge Functions",
      location: "AWS regions (configurable per project)",
      dpa: true,
    },
    {
      name: "Cloudflare",
      purpose:
        "CDN, DNS, WAF, Turnstile (signup/sign-in challenge), and Workers running resume parsing, billing and sharing",
      location: "Global edge network",
      dpa: true,
    },
    {
      name: "Vercel",
      purpose: "Frontend hosting, serverless functions, preview deployments",
      location: "AWS regions (global edge)",
      dpa: true,
    },
    {
      name: "Resend",
      purpose: "Transactional email delivery (OTP, invites, notifications)",
      location: "AWS us-east-1",
      dpa: true,
    },
    {
      name: "Stripe",
      purpose: "Billing & subscriptions (AI entitlements)",
      location: "Global (PCI DSS Level 1)",
      dpa: true,
    },
    {
      name: "Google (Gemini API, reached through Cloudflare AI Gateway)",
      purpose:
        "Resume auto-parse only — an uploaded resume's image or text is sent for extraction. No other feature sends data to an inference provider.",
      location: "Google Cloud (global)",
      dpa: true,
    },
  ] as const;

  return (
    <AuthLayout
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
      <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <header className="text-center space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {translate("crm.legal.subprocessors.title", {
              _: "Sub-processors",
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate("crm.legal.subprocessors.version", {
              _: "v1 · 2026-08-09",
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate("crm.legal.subprocessors.note", {
              _: "This list reflects the services the deployed system actually uses.",
            })}
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.subprocessors.intro", {
              _: "The following sub-processors process personal data on our behalf to deliver the MyShadchan service. Each is used under its own published data-processing terms.",
            })}
          </h2>
        </section>

        <div className="space-y-4">
          {processors.map((p, i) => (
            <article key={p.name} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {i + 1}.
                </span>
                <h3 className="font-semibold">{p.name}</h3>
                {p.dpa && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    {translate("crm.legal.subprocessors.dpa_badge", {
                      _: "Standard terms",
                    })}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  {translate("crm.legal.subprocessors.purpose_label", {
                    _: "Purpose",
                  })}
                </dt>
                <dd>{p.purpose}</dd>
                <dt className="text-muted-foreground">
                  {translate("crm.legal.subprocessors.location_label", {
                    _: "Data location",
                  })}
                </dt>
                <dd>{p.location}</dd>
              </dl>
            </article>
          ))}
        </div>

        <section className="space-y-4 pt-4 border-t">
          <h2 className="text-lg font-semibold">
            {translate("crm.legal.subprocessors.changes.title", {
              _: "Changes to this list",
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {translate("crm.legal.subprocessors.changes.body", {
              _: "This page is updated when a sub-processor is added or changed. You may object by contacting dniasoff@gmail.com; if the objection cannot be accommodated, you may export your data and delete your account from Settings → Privacy.",
            })}
          </p>
        </section>

        <footer className="pt-6 border-t text-center text-sm text-muted-foreground">
          <p>
            {translate("crm.legal.subprocessors.footer_note", {
              _: "The code is public. The record is free; the optional AI features are paid. Run at cost.",
            })}
          </p>
        </footer>
      </div>
    </AuthLayout>
  );
};

SubProcessors.path = "/sub-processors";
