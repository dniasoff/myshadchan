import type { ReactNode } from "react";
import { Notification } from "@/components/admin/notification";
import { AuthBackdrop } from "./AuthBackdrop";
import { BrandLockup } from "./BrandLockup";

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
