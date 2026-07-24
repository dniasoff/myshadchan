import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Users } from "lucide-react";
import { useDataProvider, useNotify, useStore } from "ra-core";

import { Notification } from "@/components/admin/notification";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import {
  ONBOARDING_JUST_SEEDED_KEY,
  TOUR_COMPLETED_KEY,
} from "../root/onboardingKeys";
import { AuthBackdrop } from "./AuthBackdrop";
import { BrandLockup } from "./BrandLockup";
import { FirstRunSetup } from "./FirstRunSetup";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

type Mode = "choice" | "own";

/**
 * The signed-in first-run welcome (demo-onboarding-plan.md §B3): shown by
 * `OnboardingGate` in place of the whole app shell for an empty, non-demo
 * account that hasn't chosen yet. Echoes `AuthLayout`'s atmosphere (same
 * `AuthBackdrop`, same glass card) but renders inside the authenticated app
 * — no auth routing involved. Owns the one `<Notification/>` for both of
 * its branches, since it fully replaces the shell (and the shell's own
 * Notification) while it's showing.
 */
export const OnboardingChoice = () => {
  const [mode, setMode] = useState<Mode>("choice");

  return (
    <>
      {mode === "own" ? (
        <FirstRunSetup />
      ) : (
        <OnboardingChoiceCard onChooseOwn={() => setMode("own")} />
      )}
      <Notification />
    </>
  );
};

const OnboardingChoiceCard = ({ onChooseOwn }: { onChooseOwn: () => void }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [, setJustSeeded] = useStore<boolean>(
    ONBOARDING_JUST_SEEDED_KEY,
    false,
  );
  const [, setTourCompleted] = useStore<boolean>(TOUR_COMPLETED_KEY, false);
  const [seeding, setSeeding] = useState(false);

  const handleExploreDemo = async () => {
    setSeeding(true);
    try {
      // A `{ seeded: false, reason: "account_not_empty" }` no-op still means
      // the account already has demo (or real) data — treat it the same as
      // a fresh seed and just move on.
      await dataProvider.seedDemo();
      setJustSeeded(true);
      setTourCompleted(false);
      await queryClient.invalidateQueries();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't load the demo data. Try again.",
        { type: "error" },
      );
      setSeeding(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      <AuthBackdrop />
      <div className="ql-enter relative z-10 w-full max-w-lg">
        <div
          className="rounded-[20px] border p-7 shadow-lg sm:p-8
            bg-[--glass-bg] border-[--glass-border] backdrop-blur-[var(--glass-blur)]"
        >
          <BrandLockup className="mb-6 justify-center" />
          <div className="mb-7 space-y-2 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Welcome to MyShadchan
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A calm, private place to track every shadchan, suggestion and
              reference call for your family. How would you like to begin?
            </p>
          </div>

          <div className="space-y-3">
            <ExploreDemoButton seeding={seeding} onClick={handleExploreDemo} />
            <OwnFamilyButton disabled={seeding} onClick={onChooseOwn} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ExploreDemoButton = ({
  seeding,
  onClick,
}: {
  seeding: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={seeding}
    className={cn(
      "w-full cursor-pointer rounded-2xl p-5 text-start outline-none",
      "transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]",
      "disabled:cursor-not-allowed disabled:opacity-80",
      !seeding && "hover:-translate-y-0.5 active:scale-[0.99]",
      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      PRIMARY_CTA_CLASSNAME,
    )}
  >
    <div className="flex items-center gap-2">
      <Sparkles className="size-5 shrink-0" aria-hidden="true" />
      <span className="font-display text-base font-bold">
        Explore with demo data
      </span>
      <span
        className="ms-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
        style={{ background: "oklch(1 0 0 / 0.22)" }}
      >
        Recommended
      </span>
    </div>
    <p className="mt-2 text-[13px] leading-relaxed opacity-90">
      We'll load a realistic sample family — two children, shadchanim,
      suggestions across the whole pipeline, reference calls and reminders — so
      you can see exactly how everything works. You can clear it and start fresh
      anytime.
    </p>
    {seeding ? (
      <span className="mt-3 flex items-center gap-2 text-[13px] font-medium">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading your sample family…
      </span>
    ) : null}
  </button>
);

const OwnFamilyButton = ({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full cursor-pointer rounded-2xl border border-border bg-card p-5
      text-start outline-none transition-colors duration-[160ms]
      hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60
      focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    <div className="flex items-center gap-2">
      <Users
        className="size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="font-display text-base font-semibold">
        Start with my own family
      </span>
    </div>
    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
      Name your family's record and add your first child. You can invite the
      demo later from Settings if you change your mind.
    </p>
  </button>
);
