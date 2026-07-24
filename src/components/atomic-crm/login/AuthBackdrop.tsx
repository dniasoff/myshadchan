/**
 * Ambient-glow ground behind a centered glass card (auth-redesign.md §4).
 * Reuses only existing tokens: indigo `--auth-glow-top` (a light-only warm
 * blend of `--accent-grad-from` toward honey — pure indigo on dark, see
 * index.css), violet `--accent-grad-to`, honey `--landing-accent-hi`, so dark
 * is the luminous showpiece and light is a soft warm-tinted bloom
 * automatically. Opacities are deliberately low (0.08-0.16) — calm and
 * alive, not a rainbow mesh. `.auth-blob` drifts slowly (`index.css`) and
 * freezes under `prefers-reduced-motion`.
 *
 * Shared by `AuthLayout` (signed-out auth screens) and `OnboardingChoice`
 * (the signed-in first-run welcome) so both echo the same atmosphere.
 */
export const AuthBackdrop = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 overflow-hidden"
  >
    {/* indigo (warm-blended on light) — top-start */}
    <div
      className="auth-blob absolute -top-40 -start-32 h-[38rem] w-[38rem] rounded-full opacity-[0.16] blur-3xl"
      style={{ background: "var(--auth-glow-top)" }}
    />
    {/* violet — bottom-end */}
    <div
      className="auth-blob absolute -bottom-48 -end-32 h-[34rem] w-[34rem] rounded-full opacity-[0.14] blur-3xl"
      style={{ background: "var(--accent-grad-to)", animationDelay: "-6s" }}
    />
    {/* honey hint — low, behind the card */}
    <div
      className="auth-blob absolute bottom-[-8rem] start-1/3 h-[22rem] w-[22rem] rounded-full opacity-[0.08] blur-3xl"
      style={{
        background: "var(--landing-accent-hi)",
        animationDelay: "-12s",
      }}
    />
    {/* vignette — darkens the edges, focuses the card */}
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(120% 120% at 50% 42%, transparent 55%, oklch(0 0 0 / 0.16) 100%)",
      }}
    />
  </div>
);
