/**
 * Decoration behind the hero: one honey wash on the side the states card sits,
 * one indigo wash under the headline. Both start above the viewport so neither
 * shows a cut edge, and both fade out downwards. Purely ornamental — hidden
 * from assistive technology.
 */
export const LandingBackdrop = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-x-0 top-0 h-[46rem] overflow-hidden"
  >
    <div
      className="absolute -top-64 left-0 h-[42rem] w-[52rem] -translate-x-1/3 rounded-full opacity-[0.1] blur-3xl"
      style={{ background: "var(--primary)" }}
    />
    <div
      className="absolute -top-56 right-0 h-[40rem] w-[46rem] translate-x-1/4 rounded-full opacity-[0.14] blur-3xl"
      style={{ background: "var(--landing-accent-hi)" }}
    />
  </div>
);
