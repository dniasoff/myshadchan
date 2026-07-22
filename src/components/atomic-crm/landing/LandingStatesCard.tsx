import { PIPELINE_STATES } from "../shidduchim/pipelineStates";
import { translateLanding } from "./landingTranslate";

/**
 * The seven states a suggestion moves through, in the app's own words and its
 * own colours — bilingual, and with no counts or invented records in sight.
 * It is the product's spine, so it stands beside the headline as the hero's
 * product visual: a tilted accent slab, then the real list on a raised card.
 */
export const LandingStatesCard = () => (
  <div className="relative">
    <div
      aria-hidden="true"
      className="absolute -inset-2 rotate-[-1.5deg] rounded-[1.75rem] bg-landing-accent-hi/25 sm:-inset-3"
    />
    <aside className="relative overflow-hidden rounded-3xl border bg-card shadow-xl">
      <div className="flex items-center justify-between gap-4 border-b bg-secondary/60 px-6 py-4">
        <p className="font-display text-sm font-bold uppercase tracking-[0.16em]">
          {translateLanding("crm.landing.what.states_caption", "Seven states")}
        </p>
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-landing-accent-hi font-display text-sm font-bold text-landing-accent-ink">
          {PIPELINE_STATES.length}
        </span>
      </div>

      <ol className="divide-y">
        {PIPELINE_STATES.map((state, index) => (
          <li
            key={state.value}
            className="flex items-center gap-4 px-6 py-3.5 sm:py-4"
          >
            <span className="w-5 shrink-0 font-display text-xs font-bold tabular-nums text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="inline-flex flex-1 items-center gap-3 font-medium">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: `var(${state.token})`,
                  // The same soft halo the board gives its column dots.
                  boxShadow: `0 0 0 3px color-mix(in oklch, var(${state.token}) 22%, transparent)`,
                }}
                aria-hidden="true"
              />
              {state.label}
            </span>
            <span className="font-hebrew text-muted-foreground" dir="rtl">
              {state.labelHe}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  </div>
);
