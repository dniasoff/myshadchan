import { OverviewFactGrid } from "../entity360/tabs/OverviewFactGrid";
import type { ShidduchSummary } from "../types";
import { computeAgeFromDob } from "./shidduchAge";

/** The shidduch facts section (Screen 18 body) — father/mother, seminary,
 * shul, location, age/DOB, height, background, marital status and the
 * existing-children note, rendered through the shared `OverviewFactGrid`
 * (Story 3-10, extended by Story 5.2). Age/height/DOB are info-only (FR11)
 * — they render exactly like any other fact and are never framed as a
 * matching signal. */
export const ShidduchFactsCard = ({
  shidduch,
}: {
  shidduch: ShidduchSummary;
}) => {
  // Story 5.2: when a DOB is on file, it is the more precise source, so the
  // Age fact prefers a live age computed from it over the (possibly stale)
  // stored `age` number; the DOB fact itself always renders the raw date
  // alongside it, so both are visible when both are known.
  const ageValue = shidduch.dob
    ? String(computeAgeFromDob(shidduch.dob))
    : shidduch.age != null
      ? String(shidduch.age)
      : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 font-display text-lg font-semibold">
        Shidduch facts
      </h3>
      <OverviewFactGrid
        facts={[
          {
            label: "Father",
            en: shidduch.father_en,
            he: shidduch.father_he,
          },
          {
            label: "Mother",
            en: shidduch.mother_en,
            he: shidduch.mother_he,
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
            plain: ageValue,
          },
          {
            label: "Date of birth",
            plain: shidduch.dob ?? null,
          },
          { label: "Height", plain: shidduch.height ?? null },
          { label: "Background", plain: shidduch.background ?? null },
          {
            label: "Marital status",
            plain: shidduch.marital_status ?? null,
          },
          {
            label: "Existing children",
            plain: shidduch.existing_children_note ?? null,
          },
        ]}
        emptyLabel="No details on file yet."
      />
    </section>
  );
};
