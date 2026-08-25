import type { ReactNode } from "react";
import { Notification } from "@/components/admin/notification";
import { cn } from "@/lib/utils";
import { AuthBackdrop } from "./AuthBackdrop";
import { BrandLockup } from "./BrandLockup";

export interface AuthLayoutProps {
  children: ReactNode;
  /** Small note under the card, e.g. "Private to your family · Back to home". */
  footer?: ReactNode;
  /**
   * Width of the card column. The default suits a short auth form; a long
   * document has to pass a wider one, because the card's own padding is
   * subtracted from whatever this allows. `max-w-md` on a 360px phone leaves
   * roughly a 200px reading measure once the page's `p-6` and the card's
   * `p-7` are taken off — fine for one email field, unreadable for a legal
   * policy. A `max-w-3xl` declared by the child itself does nothing: this
   * element is the one that constrains it.
   */
  maxWidthClassName?: string;
}

/**
 * Shared shell for every auth screen (login, signup, confirmation,
 * onboarding): an atmospheric ground (`AuthBackdrop`) behind a single
 * centered glass card. Retires the old `AuthHero` split-screen — see
 * design-artifacts/auth-redesign.md.
 */
export const AuthLayout = ({
  children,
  footer,
  maxWidthClassName = "max-w-md",
}: AuthLayoutProps) => (
  <div
    className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6"
    style={{ backgroundImage: "var(--wash)" }}
  >
    <AuthBackdrop />
    <div className={cn("ql-enter relative z-10 w-full", maxWidthClassName)}>
      <div
        className="rounded-[20px] border p-7 shadow-lg sm:p-8
          bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-[var(--glass-blur)]"
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
