import { OverviewFactGrid } from "../entity360/tabs/OverviewFactGrid";
import type { ShidduchSummary } from "../types";

/** The shidduch facts section (Screen 18 body) — parents, seminary, shul,
 * location, age, height, rendered through the shared `OverviewFactGrid`
 * (Story 3-10). Age/height are info-only (FR11) — they render exactly like
 * any other fact and are never framed as a matching signal. */
export const ShidduchFactsCard = ({
  shidduch,
}: {
  shidduch: ShidduchSummary;
}) => {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 font-display text-lg font-semibold">
        Shidduch facts
      </h3>
      <OverviewFactGrid
        facts={[
          {
            label: "Parents",
            en: shidduch.parents_en,
            he: shidduch.parents_he,
          },
          {
            label: "Seminary",
            en: shidduch.seminary_en,
            he: shidduch.seminary_he,
          },
          { label: "Shul", en: shidduch.shul_en, he: shidduch.shul_he },
          {
            label: "Location",
            en: shidduch.location_en,
            he: shidduch.location_he,
          },
          {
            label: "Age",
            plain: shidduch.age != null ? String(shidduch.age) : null,
          },
          { label: "Height", plain: shidduch.height ?? null },
        ]}
        emptyLabel="No details on file yet."
      />
    </section>
  );
};
