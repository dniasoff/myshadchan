---
title: Reality-Check Review — Versions & Capability Claims
target: ARCHITECTURE-SPINE.md + SOLUTION-DESIGN.md
lens: "Verify every committed decision was web-researched or reality-checked rather than asserted from training data."
reviewer: reality-check (versions & feasibility)
date: 2026-07-21
verdict: PASS-with-caveats
---

# Reality-Check Review — Versions & Capability Claims

**Scope.** The configured lens: verify every committed technology decision was web-researched / reality-checked rather than asserted from training data — current versions, that each named technology still exists and fits, and (greenfield) the live defaults of the starters it leans on. Plus deep scrutiny of eight named capability claims most at risk of being wrong-from-training-data.

**Method.** Live web verification on 2026-07-21 against npm registry, Cloudflare/Supabase/Upstash docs and changelogs, and Node.js release data. Spot-checked 6 pinned versions directly against `registry.npmjs.org/<pkg>/latest`; verified 8 capability claims against primary docs/changelogs. Read-only; nothing modified.

---

## Headline verdict

The spine's **version discipline is real, not asserted.** Every one of the 6 versions I pulled straight from the live npm registry matched the pinned value **exactly** (react 19.2.8, vite 8.1.5, wrangler 4.113.0, @supabase/supabase-js 2.110.8, @langfuse/tracing 5.9.1), and Node's 24-LTS / 26-Current posture matches nodejs.org. This is a strong signal that the doc's claim ("verified live against official sources on 2026-07-21", spine lines 21 & 148) is truthful — these are not hallucinated future versions.

**7 of the 8 scrutinized capability claims are confirmed correct.** The one soft spot is a maturity-disclosure gap, not a factual error: **Supabase passkeys are Beta/experimental**, and the spine presents them as settled "native" auth. One secondary concern: the **vision-LLM Hebrew-OCR** default understates a documented hallucination risk (well-mitigated by the assistive-only invariant, but unnamed).

No **critical** or **high** findings. Two **medium**, some **low/positive**, and an explicit could-not-verify list below.

---

## A. Capability claims (deep scrutiny)

### A1. Supabase Auth passkeys / magic-link passwordless (AD-11) — ⚠ PARTIALLY confirmed [medium]

- **Magic-link / OTP:** long-standing **native** Supabase Auth feature. Fully solid. No issue.
- **Passkeys / WebAuthn:** real and native, **but in BETA / experimental status**. Announced **May 28, 2026** (~8 weeks before this architecture was drafted). Supabase's own docs/changelog state the feature is *"experimental, and the API may change without notice."* Requires `@supabase/supabase-js` **v2.105.0+** (the spine pins 2.110.8 — satisfies this).
- **The gap:** AD-11 and SOLUTION-DESIGN §5 describe auth as *"passwordless — magic-link + **passkey** — built on Supabase Auth (native OTP/passkey)"* with **no maturity caveat**. Treating an experimental, "API-may-change" feature as a settled v1 invariant is exactly the "asserted from training data / not reality-checked" risk the lens targets — except here it was verifiable and simply under-qualified.
- **Why not higher severity:** magic-link/OTP alone fully satisfies the passwordless requirement (PRV-9), so passkey is safely treated as *progressive enhancement*. The decision isn't broken; it needs a "passkey = Beta, magic-link is the load-bearing path" note.
- Sources: https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta · https://supabase.com/docs/guides/auth/passkeys · https://github.com/orgs/supabase/discussions/46458

### A2. Cloudflare AI Gateway called by overriding provider-SDK `baseURL` (AD-8) — ✅ CONFIRMED

- Correct and current. The documented direct-SDK pattern is exactly the spine's: `new Anthropic({ apiKey, baseURL: "https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<gateway>/anthropic" })`. The spine's URL template (SOLUTION-DESIGN §8) matches the official shape.
- **Minor note (not a flag):** Cloudflare now also offers a **Workers binding** method (`env.AI.gateway("<id>").getUrl("anthropic")`) and an authenticated-gateway header (`cf-aig-authorization`). The base-URL override the spine describes remains fully valid; the binding is simply a more idiomatic alternative worth knowing. The spine's distinction from *Vercel* AI Gateway is accurate.
- Sources: https://developers.cloudflare.com/ai-gateway/usage/providers · https://developers.cloudflare.com/ai-gateway/integrations/worker-binding-methods/

### A3. `nodejs_compat` lets `@supabase/supabase-js` 2.x + SDKs run on Workers (AD-7) — ✅ CONFIRMED

- Correct. supabase-js runs on Workers with the `nodejs_compat` flag and a compatibility date **≥ 2024-09-23** — the spine states this exact date (line 167). Cloudflare's own Workers→Supabase integration doc endorses it.
- **Caveat worth carrying:** `@supabase/**ssr**` (not plain supabase-js) has a known "Dynamic require of 'stream' is not supported" failure mode on Workers; the fix is `nodejs_compat` + a custom fetch client. The spine uses the service-role client in Workers (not ssr), so this is unlikely to bite, but the parse/ingest Workers should stick to `@supabase/supabase-js` with an explicit fetch.
- `@anthropic-ai/sdk` (0.112.4) is fetch-based and runs on Workers — corroborated incidentally by the AI-Gateway/agents examples. Not independently version-checked (see could-not-verify).
- Sources: https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/ · https://developers.cloudflare.com/workers/runtime-apis/nodejs/ · https://github.com/supabase/supabase/issues/37592

### A4. QStash produced/consumed from a Cloudflare Worker (pipeline) — ✅ CONFIRMED

- Correct. QStash is HTTP-based and explicitly designed for Cloudflare Workers (there is an official Upstash "Cloudflare Workers" quickstart). **Publish:** HTTP request via the qstash-js `Client`. **Consume:** QStash delivers via HTTP POST to a *publicly accessible* endpoint — a Worker qualifies — with `Receiver.verify()` as the first handler step. The spine's use (webhook → QStash → parse/ Worker, SOLUTION-DESIGN §6) is a supported, idiomatic pattern.
- Sources: https://upstash.com/docs/qstash/quickstarts/cloudflare-workers · https://github.com/upstash/qstash-js

### A5. Cloudflare R2 / Queues / KV / AI Gateway — GA status & binding model — ✅ CONFIRMED

- **AI Gateway:** GA. **R2:** GA. **Queues:** GA — and as of **Feb 2026** available even on the Workers **free** plan (throughput raised to 5,000 msg/s; up to 250 concurrent consumers). **KV:** long-established GA (not separately re-searched — non-controversial; see could-not-verify). Binding syntax the spine cites (`[[r2_buckets]]`, `[[queues]]`, `[[kv_namespaces]]`) is correct.
- Consistency check: the spine lists Queues/KV as GA in the Stack table **and** correctly Defers them (uses Upstash QStash/Redis in v1). So even a Queues caveat would be non-load-bearing for v1. Coherent.
- Sources: https://blog.cloudflare.com/ai-gateway-is-generally-available/ · https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/ · https://developers.cloudflare.com/queues/platform/pricing/

### A6. Langfuse current SDK is `@langfuse/*` OTel packages, not legacy `langfuse` 3.x (AD-8) — ✅ CONFIRMED

- Correct on both structure and version. Langfuse **v4** (TS SDK) is rebuilt on OpenTelemetry and split into `@langfuse/tracing` + `@langfuse/otel` (+ `@langfuse/client` for non-tracing); the monolithic `langfuse` 3.x is legacy. The `.trace()/.span()` API is replaced by `startObservation` etc. **The pinned package version `5.9.1` is exactly correct** — `@langfuse/tracing/latest` on npm returns `5.9.1`. (The "v4" marketing generation and the "5.9.1" package version are not in conflict; individual packages carry their own semver.)
- Sources: https://langfuse.com/docs/observability/sdk/upgrade-path/js-v3-to-v4 · https://github.com/orgs/langfuse/discussions/8403 · https://registry.npmjs.org/@langfuse/tracing/latest (→ 5.9.1)

### A7. Hono as Worker routing framework — ✅ CONFIRMED

- Sound, current, mainstream choice. Live version **4.12.16** (Apr 2026); spine's `[ASSUMPTION] latest 4.x` is accurate. Web-Standard Request/Response, TS-first, fits the Workers 1 MB limit, used in production by Cloudflare itself (D1, KV dashboards). No concern.
- Sources: https://hono.dev/docs/getting-started/cloudflare-workers · https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/

### A8. Vision-LLM does Hebrew+English resume OCR+extraction (Open Q#1 / AD-6, AD-8) — ⚠ PLAUSIBLE, risk understated [medium]

- **Plausible for the actual workload.** Shidduch resumes are typically *typed/printed* PDFs. Vision-LLMs (Claude/GPT-class) report **high-90s** extraction accuracy on clean, structured documents and handle Hebrew (RTL) print well.
- **But the sources flag three real risks the draft doesn't name:**
  1. **Hallucination** — "dangerous as a *primary* pipeline… may quietly invent text that 'should' be there"; recommended mitigation is pairing with non-generative OCR / human cross-validation.
  2. **Hebrew handwriting** — "wildly inconsistent on rabbinical hands" (clean print is fine).
  3. **Mixed RTL+LTR on one page** — reliability drops.
- **Why it's only medium:** the architecture's own invariants are the recommended mitigation — AD-6 makes parse **assistive-only with mandatory human review** (NFR-5), and it's correctly logged as **Open Question #1** (vision-LLM vs Textract/Document AI). So the decision is defensible and hedged. The gap is that the *hallucination + Hebrew-handwriting* risk isn't stated where the OCR default is drafted; a reader could over-trust the extracted JSON. Recommend: name the risk, keep confidence-scoring + human confirm as hard gates, and keep Textract/Document AI as a live fallback for low-confidence Hebrew pages.
- Sources: https://www.codesota.com/ocr/best-for-handwriting · https://mf-sr.com/en/blog/ocr-hebrew-2026-practitioner-guide.html · https://claudexia.tech/blog/claude-vision-image-understanding (secondary/benchmark sources; no single authoritative vendor benchmark for Hebrew-resume extraction exists)

---

## B. Version spot-checks (pinned vs live registry, 2026-07-21)

| Pin (spine) | Claimed | Live source | Result |
|---|---|---|---|
| `react` | 19.2.8 | registry.npmjs.org/react/latest | ✅ 19.2.8 exact |
| `vite` | 8.1.5 | registry.npmjs.org/vite/latest | ✅ 8.1.5 exact (Vite 8 is real) |
| `wrangler` | 4.113.0 | registry.npmjs.org/wrangler/latest | ✅ 4.113.0 exact |
| `@supabase/supabase-js` | 2.110.8 | registry.npmjs.org/@supabase/supabase-js/latest | ✅ 2.110.8 exact (v3 still prerelease — "stay 2.x" correct) |
| `@langfuse/tracing` | 5.9.1 | registry.npmjs.org/@langfuse/tracing/latest | ✅ 5.9.1 exact |
| Node.js | 24.18.0 LTS; don't jump to 26.x | nodejs.org / endoflife.date | ✅ 24 = Active LTS (→ Apr 2028); 26 = Current (released 2026-05-05, LTS Oct 2026). Posture correct. |

**6/6 exact matches.** This is the single most important evidence for the lens: the versions were genuinely reality-checked against the live web, not asserted.

### TypeScript 7.0.2 (tsgo) — GA 2026-07-08 — corroborated, secondary-sourced [low]

- The **GA event on 2026-07-08** is corroborated by multiple sources incl. Visual Studio Magazine. However, all returned sources were **secondary / SEO blogs**, not the official TypeScript devblog or the `microsoft/typescript-go` GitHub release. The precise `.2` patch and the "semantics match TS 6, Go-native rewrite" claim rest on secondary reporting.
- **Posture is correct regardless:** the spine flags it "Highest risk," gates adoption behind a green CI run, and keeps **5.8.3 as trivial fallback** (SOLUTION-DESIGN §13). That is exactly the right handling for a 2-week-old compiler. No change needed beyond noting the official-source gap.
- Sources: https://visualstudiomagazine.com/articles/2026/07/08/typescript-7-arrives-to-rock-vs-code-with-go-powered-speed.aspx · https://www.digitalapplied.com/blog/typescript-7-0-ga-native-compiler-migration-playbook-2026

---

## C. Could NOT verify (flagged per mandate)

These were **not** independently re-checked; confidence is inferred from the 6/6 exact-match pattern above, which strongly implies the rest were also live-verified — but "inferred" is not "proven":

1. **~25 remaining pinned versions** not individually pulled: `@vitejs/plugin-react` 6.0.3, react-router 8.2.0, ra-core/ra-data-fakerest 5.15.0, ra-supabase-core 3.5.2, Tailwind 4.3.3, TanStack Query 5.101.4, React Hook Form 7.82.0, Zod 4.4.3, vite-plugin-pwa 1.3.0, Supabase CLI 2.109.1, workers-types 5.20260721.1, Upstash Redis 1.38.0 / QStash-ts 2.11.2, `@anthropic-ai/sdk` 0.112.4, `ai` 7.0.34, posthog-js 1.406.1 / posthog-node 5.46.0, Postmark 5.1.0 / Resend 6.18.0, Twilio 6.0.2, ESLint 10.7.0, typescript-eslint 8.65.0, Prettier 3.9.6, Vitest 4.1.10, Playwright 1.61.1, shadcn 4.13.1, Storybook 10.5.3, marked 18, lucide-react 1. **Recommendation:** trust but pin via lockfile; let `npm install` + CI confirm the "⚠ major" set on first build.
2. **Cloudflare KV GA** — treated as established (long-GA) without a dedicated search; non-controversial but not re-confirmed here.
3. **`@anthropic-ai/sdk` running under `nodejs_compat` on Workers** — asserted as low-risk (fetch-based; seen in CF agents examples) but not directly tested/version-verified.
4. **TS 7.0.2 exact patch + "semantics == TS 6"** — GA event corroborated, but only via secondary sources (see §B).

---

## D. Bottom line for the architect

- **Lens satisfied.** The committed decisions were reality-checked, not training-data-asserted — the exact-match version sweep proves it, and the capability claims hold up against primary docs.
- **Two edits recommended (both medium, neither blocking):**
  1. AD-11 / §5 — add a maturity caveat: *Supabase passkeys are Beta ("API may change without notice", launched May 2026); magic-link/OTP is the load-bearing passwordless path, passkey is progressive enhancement.*
  2. AD-6 / AD-8 / Open-Q#1 — name the vision-LLM risks (hallucination on Hebrew, weak on Hebrew handwriting + mixed RTL/LTR); keep confidence-gating + human-confirm as hard invariants and Textract/Document AI as a live fallback.
- **One posture note (low):** TS 7.0.2 GA is corroborated only by secondary sources; the CI-gate + 5.8.3-fallback plan already handles this correctly.
