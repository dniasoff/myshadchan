# Security Policy

**Privacy and security are the product, not a setting.** MyShadchan holds deeply
sensitive information — resumes, photos, references' candid words, health notes, and
dating outcomes — so we take reports seriously and are grateful to anyone who helps us
keep people's data safe. Thank you for looking. 🙏

## 📣 Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** Public disclosure
before a fix puts real families' data at risk.

Instead, report it privately:

1. **Preferred:** use GitHub's private vulnerability reporting —
   go to the [**Security** tab](https://github.com/dniasoff/myshadchan/security) →
   **Report a vulnerability**. This opens a private advisory only maintainers can see.
2. If you can't use GitHub advisories, open a minimal public issue that says *only*
   "I'd like to report a security issue privately" (no details) and we'll open a private
   channel.

<!-- Maintainers: add a dedicated security contact email here once one is set up. -->

Please include, as best you can:

- What the issue is and its potential impact.
- Step-by-step reproduction (proof-of-concept if you have one).
- Affected component, URL, or code path.
- Any suggested remediation.

## 🔒 What we especially care about

Given the risk model (communal and reputational harm, not just regulation), we prioritise:

- **Cross-account data leaks** — anything that lets one account see another's data. Our
  isolation is enforced in the database (row-level security); a bypass is critical.
- **Authentication / authorization** flaws — magic-link/passkey abuse, privilege
  escalation, invite-token misuse, role bypass.
- **Channel mis-routing** — an inbound item (email/SMS) attributed to the wrong account.
- **Share-link exposure** — access to a resume or photo past revoke/expiry, or without
  being logged.
- **Sensitive-media exposure** — raw/pre-signed access to stored files that should only
  be served through the access-controlled proxy.
- **Injection / XSS / CSRF**, SSRF in the parsing pipeline, and secret leakage.

## 🤝 Our commitment (coordinated disclosure)

- We'll **acknowledge** your report as quickly as we reasonably can and keep you updated.
- We'll work with you on a fix and a **coordinated disclosure** timeline, and we're happy
  to **credit** you (or keep you anonymous — your choice).
- We ask that you give us reasonable time to fix an issue before any public disclosure.

## 🛡️ Safe harbor

We will not pursue or support legal action against anyone who, in good faith:

- makes a genuine effort to avoid privacy violations, data destruction, and service
  disruption while researching;
- only accesses or exposes the **minimum** data necessary to demonstrate the issue; and
- reports promptly and does not exploit the issue beyond what's needed for a proof of
  concept.

Please **do not** access, modify, or retain other people's data; run automated scans
that degrade the service; or use social engineering against our users or team.

---

Thank you for helping protect the families who trust MyShadchan with something precious.
