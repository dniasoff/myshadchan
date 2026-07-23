import type { ReactNode } from "react";
import { Notification } from "@/components/admin/notification";
import { BrandLockup } from "./BrandLockup";

/**
 * Ambient-glow ground behind the auth card (auth-redesign.md §4). Reuses only
 * existing tokens: indigo `--auth-glow-top` (a light-only warm blend of
 * `--accent-grad-from` toward honey — pure indigo on dark, see index.css),
 * violet `--accent-grad-to`, honey `--landing-accent-hi`, so dark is the
 * luminous showpiece and light is a soft warm-tinted bloom automatically.
 * Opacities are deliberately low (0.08–0.16) — calm and alive, not a rainbow
 * mesh. `.auth-blob` drifts slowly (`index.css`) and freezes under
 * `prefers-reduced-motion`.
 */
const AuthBackdrop = () => (
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

export interface AuthLayoutProps {
  children: ReactNode;
  /** Small note under the card, e.g. "Private to your family · Back to home". */
  footer?: ReactNode;
}

/**
 * Shared shell for every auth screen (login, signup, forgot/set-password,
 * confirmation): an atmospheric ground (`AuthBackdrop`) behind a single
 * centered glass card. Retires the old `AuthHero` split-screen — see
 * design-artifacts/auth-redesign.md.
 */
export const AuthLayout = ({ children, footer }: AuthLayoutProps) => (
  <div
    className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6"
    style={{ backgroundImage: "var(--wash)" }}
  >
    <AuthBackdrop />
    <div className="ql-enter relative z-10 w-full max-w-md">
      <div
        className="rounded-[20px] border p-7 shadow-lg sm:p-8
          bg-[--glass-bg] border-[--glass-border] backdrop-blur-[var(--glass-blur)]"
      >
        <BrandLockup className="mb-6 justify-center" />
        {children}
      </div>
      {footer ? (
        <div className="mt-5 flex flex-col items-center gap-1.5 text-center text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
    <Notification />
  </div>
);
