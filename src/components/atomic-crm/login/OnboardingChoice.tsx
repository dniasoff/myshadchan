import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, Users } from "lucide-react";
import {
  useDataProvider,
  useNotify,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useNavigate } from "react-router";

import { Notification } from "@/components/admin/notification";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import {
  ONBOARDING_JUST_SEEDED_KEY,
  TOUR_COMPLETED_KEY,
} from "../root/onboardingKeys";
import { MY_PERSONAS_QUERY_KEY } from "../root/useMyPersonas";
import type { Persona } from "../types";
import { AuthBackdrop } from "./AuthBackdrop";
import { BrandLockup } from "./BrandLockup";
import { FirstRunSetup } from "./FirstRunSetup";
import { PersonaChecklist } from "./PersonaChecklist";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

type Mode = "choice" | "own-select" | "own-household" | "own-done";

/**
 * The signed-in first-run welcome (demo-onboarding-plan.md §B3): shown by
 * `OnboardingGate` in place of the whole app shell for a personaless,
 * non-demo login that hasn't chosen yet. Echoes `AuthLayout`'s atmosphere
 * (same `AuthBackdrop`, same glass card) but renders inside the
 * authenticated app — no auth routing involved. Owns the one
 * `<Notification/>` for every branch, since it fully replaces the shell
 * (and the shell's own Notification) while it's showing.
 *
 * "Own family" is a three-step hand-off (2.3 AC-3/4/5/6): tick personas
 * (`own-select`) -> provision them -> either `FirstRunSetup` (parent was
 * ticked) or a compact done screen (it wasn't). `MY_PERSONAS_QUERY_KEY` is
 * deliberately NOT invalidated until `handleOnboardingFinished` — see its
 * comment for why invalidating any earlier would cut the flow short.
 */
export const OnboardingChoice = () => {
  const [mode, setMode] = useState<Mode>("choice");
  const [accountId, setAccountId] = useState<Identifier | null>(null);
  const [donePersonas, setDonePersonas] = useState<Persona[]>([]);
  const queryClient = useQueryClient();

  // `OnboardingGate` shares this exact query key (root/useMyPersonas.ts) and
  // is mounted throughout this whole flow. Invalidating it right after
  // add_persona('parent') resolves — the moment `my_personas()` stops
  // being empty — would flip `OnboardingGate` to the real app shell
  // immediately, unmounting `FirstRunSetup` (or this screen's own done
  // step) before the user ever sees it. Deferred to here: the one point
  // every branch of "own family" eventually reaches.
  const handleOnboardingFinished = () => {
    void queryClient.invalidateQueries({ queryKey: MY_PERSONAS_QUERY_KEY });
  };

  return (
    <>
      {mode === "choice" ? (
        <OnboardingChoiceCard onChooseOwn={() => setMode("own-select")} />
      ) : null}
      {mode === "own-select" ? (
        <PersonaSelectCard
          onHousehold={(id) => {
            setAccountId(id);
            setMode("own-household");
          }}
          onDone={(personas) => {
            setDonePersonas(personas);
            setMode("own-done");
          }}
        />
      ) : null}
      {mode === "own-household" && accountId != null ? (
        <FirstRunSetup
          accountId={accountId}
          onFinished={handleOnboardingFinished}
        />
      ) : null}
      {mode === "own-done" ? (
        <PersonaOnboardingDone
          personas={donePersonas}
          onFinished={handleOnboardingFinished}
        />
      ) : null}
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
      // AC-7: post-2.7 a brand-new login has no household at all (no
      // bootstrap membership), and seed_demo's writes rely on RLS against
      // the caller's ACTIVE context, so provision one before seeding into
      // it. Idempotent — no-ops if the caller already holds a parent_admin
      // membership (2.2 AC-6).
      await dataProvider.addPersona("parent");
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
            bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-[var(--glass-blur)]"
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
      "transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)]",
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
      We'll load a realistic sample family — two singles, shadchanim,
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
      Name your family's record and add your first single. You can invite the
      demo later from Settings if you change your mind.
    </p>
  </button>
);

// add_persona('parent') must run before add_persona('single') (2.3 AC-3):
// determinism, and the exact sequence 2.2 AC-7's own test pins. shadchan is
// provisioning-independent (a separate shadchanus account) so it runs last.
const PERSONA_SUBMIT_ORDER: Persona[] = ["parent", "single", "shadchan"];

const PersonaSelectCard = ({
  onHousehold,
  onDone,
}: {
  onHousehold: (accountId: Identifier) => void;
  onDone: (personas: Persona[]) => void;
}) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [selected, setSelected] = useState<Persona[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showValidationError, setShowValidationError] = useState(false);

  const handleChange = (next: Persona[]) => {
    setSelected(next);
    if (next.length > 0) {
      setShowValidationError(false);
    }
  };

  const handleContinue = async () => {
    if (selected.length === 0) {
      setShowValidationError(true);
      return;
    }
    setSubmitting(true);
    try {
      const toProvision = PERSONA_SUBMIT_ORDER.filter((persona) =>
        selected.includes(persona),
      );
      // Sequential, never Promise.all (2.3 AC-3): each add_persona() branch
      // is read-then-write ("do I already hold an owning membership?"), so
      // two concurrent calls would both read "no membership" and each
      // create a household — exactly what 2.2 AC-7 forbids.
      for (const persona of toProvision) {
        await dataProvider.addPersona(persona);
      }

      if (selected.includes("parent")) {
        // add_persona() returns void (2.2 AC-6) — the household id has to
        // come from a fresh my_personas() read, not the call itself.
        // `.find()` over an unordered my_personas() (no ORDER BY,
        // 02_functions.sql) would be ambiguous for a caller with two
        // `parent_admin` memberships — not possible here: `OnboardingGate`
        // only ever renders this screen for a login `my_personas()` reported
        // as EMPTY (review finding #1), so this `addPersona('parent')` call
        // is the only one that can have created a `parent` row.
        const personas = await dataProvider.getMyPersonas();
        const parentPersona = personas.find((p) => p.persona === "parent");
        if (!parentPersona) {
          throw new Error("Couldn't find your new family record");
        }
        onHousehold(parentPersona.account_id);
      } else {
        onDone(selected);
      }
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't set that up. Try again.",
        { type: "error" },
      );
      setSubmitting(false);
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
            bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-[var(--glass-blur)]"
        >
          <BrandLockup className="mb-6 justify-center" />
          <div className="mb-6 space-y-2 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {translate("crm.auth.onboarding.persona_title", {
                _: "Which applies to you?",
              })}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {translate("crm.auth.onboarding.persona_subtitle", {
                _: "Pick everything that applies — you can add more later from Settings.",
              })}
            </p>
          </div>

          <PersonaChecklist value={selected} onChange={handleChange} />

          {showValidationError ? (
            <p
              className="mt-3 text-sm font-medium text-destructive"
              role="alert"
            >
              {translate("crm.auth.onboarding.persona_validation", {
                _: "Pick at least one to continue.",
              })}
            </p>
          ) : null}

          <Button
            type="button"
            className={cn("mt-5 w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={submitting}
            onClick={handleContinue}
          >
            {submitting ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : null}
            {translate("crm.auth.onboarding.continue", { _: "Continue" })}
          </Button>
        </div>
      </div>
    </div>
  );
};

// The done screen for every "own family" combination that did NOT tick
// `parent` (AC-4 / AC-6) — `FirstRunSetup` owns the parent path's own done
// step. Reuses `done_title`/`done_body`/`go_to_dashboard` verbatim (no third
// copy variant for AC-4's single-only case) and adds exactly one new key
// for the shadchan acknowledgement AC-6 asks for.
const PersonaOnboardingDone = ({
  personas,
  onFinished,
}: {
  personas: Persona[];
  onFinished: () => void;
}) => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const includesShadchan = personas.includes("shadchan");

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      <div className="ql-enter mx-auto w-full max-w-sm space-y-6 text-center">
        <div
          className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
          style={{
            background:
              "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))",
          }}
        >
          <Check
            className="size-6 text-primary-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.onboarding.done_title", {
              _: "You're all set",
            })}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {includesShadchan
              ? translate("crm.auth.onboarding.persona_done_shadchan_body", {
                  // AC-6 asks only that the screen acknowledge the
                  // shadchanus context — no actionable next step. A fresh
                  // shadchanus account holds no connection yet, so every
                  // household-scoped table (references included) rejects
                  // writes while it is active (review finding #2); do not
                  // reintroduce a call to action here without one that is
                  // actually possible from this screen.
                  _: "Your shadchanus book is ready.",
                })
              : translate("crm.auth.onboarding.done_body", {
                  _: "Your record is ready. Start by logging a suggestion.",
                })}
          </p>
        </div>
        <Button
          type="button"
          className={cn("w-full cursor-pointer gap-2", PRIMARY_CTA_CLASSNAME)}
          onClick={() => {
            onFinished();
            navigate("/");
          }}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {translate("crm.auth.onboarding.go_to_dashboard", {
            _: "Go to my dashboard",
          })}
        </Button>
      </div>
    </div>
  );
};
