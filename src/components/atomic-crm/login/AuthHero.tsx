import { PIPELINE_STATES } from "../shidduchim/pipelineStates";

export const LedgerMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? "h-5 w-5"}
    aria-hidden="true"
  >
    <path d="M4 4h11a2 2 0 0 1 2 2v14l-4-2.5L9 20V6a2 2 0 0 0-2-2z" />
    <path d="M17 6h3v11" />
  </svg>
);

const LockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
    aria-hidden="true"
  >
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

/**
 * Vibrant, branded hero panel shared by the login and signup pages. Uses the
 * Calm Ledger theme tokens and showcases the real 7-state shidduchim pipeline
 * (bilingual EN + Hebrew). Hidden on small screens (a compact brand shows there).
 */
export const AuthHero = () => (
  <div
    className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between"
    style={{
      background:
        "linear-gradient(155deg, var(--primary) 0%, oklch(0.5 0.2 300) 52%, var(--st-unsure) 100%)",
    }}
  >
    <div
      className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full opacity-40 blur-3xl"
      style={{ background: "var(--st-yes)" }}
    />
    <div
      className="pointer-events-none absolute -bottom-24 -left-16 h-80 w-80 rounded-full opacity-30 blur-3xl"
      style={{ background: "var(--st-notsure)" }}
    />

    <div className="relative z-10 flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 backdrop-blur">
        <LedgerMark className="h-5 w-5" />
      </div>
      <span className="text-xl font-bold tracking-tight">
        My<span className="text-white/75">Shadchan</span>
      </span>
    </div>

    <div className="relative z-10 max-w-md">
      <h1 className="text-[2.7rem] font-bold leading-[1.08] tracking-tight">
        A calm memory of every <span className="italic">shidduch</span>.
      </h1>
      <p
        className="font-hebrew mt-3 text-xl font-medium text-white/70"
        dir="rtl"
      >
        זיכרון רגוע של כל שידוך
      </p>
      <p className="mt-6 text-base leading-relaxed text-white/85">
        Every redt, from every shadchan — held on one quiet board. Bilingual,
        private, and run at cost.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        {PIPELINE_STATES.map((state) => (
          <span
            key={state.value}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `var(${state.token})` }}
            />
            {state.label}
            <span className="font-hebrew text-white/55" dir="rtl">
              {state.labelHe}
            </span>
          </span>
        ))}
      </div>
    </div>

    <div className="relative z-10 flex items-center gap-2 text-sm text-white/70">
      <LockIcon />
      Private to you. Run at cost, never pooled or shared.
    </div>
  </div>
);
