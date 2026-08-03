import type { ReactNode } from "react";
import type { Identifier, SupportCreateSuggestionOptions } from "ra-core";
import { required } from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { DateInput } from "@/components/admin/date-input";
import { NumberInput } from "@/components/admin/number-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import { INITIAL_PIPELINE_STATES, PIPELINE_STATES } from "./pipelineStates";

interface InitialStateChoice {
  id: string;
  name: string;
  token: string;
}

const initialStateChoices: InitialStateChoice[] = PIPELINE_STATES.filter(
  (state) => INITIAL_PIPELINE_STATES.includes(state.value),
).map((state) => ({ id: state.value, name: state.label, token: state.token }));

/**
 * Renders each starting-column option with its pipeline-state dot (design-
 * language §5.5 token pattern) so the chosen column previews the same colour
 * signature used on the board — cheap since the choice already carries its
 * token.
 */
const renderStateOption = (choice: InitialStateChoice) => (
  <span className="inline-flex items-center gap-2">
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: `var(${choice.token})` }}
      aria-hidden="true"
    />
    {choice.name}
  </span>
);

/**
 * A labelled, chunked group of fields (design-language §2 eyebrow header +
 * a quiet panel) — keeps a long form forgiving by breaking it into named,
 * scannable steps instead of one undifferentiated stack of inputs.
 */
const FormSection = ({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:p-5">
    <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {eyebrow}
    </h3>
    {children}
  </section>
);

export const ShidduchInputs = ({
  lockedShadchanId,
  isShadchanLocked = lockedShadchanId != null,
  onCreateShadchan,
}: {
  /**
   * Story 8.3 (AC-3): the value to lock the `shadchan_id` field to, when
   * known.
   */
  lockedShadchanId?: Identifier | null;
  /**
   * Story 8.3 review fix (Finding 2): whether the `shadchan_id` field must
   * be LOCKED at all — a separate question from whether we know a value to
   * lock it TO. The two used to be conflated (disabled iff
   * `lockedShadchanId != null`): when `InboxResolveDialog.tsx`'s linked-
   * shadchanim lookup came back empty (the connection's book row deleted,
   * or not yet created), the field fell open — unlocked and freely
   * editable — for exactly the shadchan-sourced item AC-3 says must never
   * be re-attributable. Proven over real JWTs: household A can
   * `DELETE /shadchanim?connection_id=eq.N` (the table's own
   * `FOR ALL`-scoped policy places no restriction on it) while the
   * shadchan-sourced inbox item keeps its `connection_id` — nothing
   * recreates the row, and the lock silently disappeared.
   *
   * Callers now pass this explicitly instead of relying on the ID's
   * nullability: `InboxResolveDialog.tsx` locks on `item.source ===
   * "shadchan"` alone, so a missing linked row still leaves the field
   * disabled (empty and un-attributable, never open to picking a
   * different book entry) — fails CLOSED, not open. A native
   * `<fieldset disabled>` around the field, rather than an
   * `AutocompleteInput` prop: `@/components/admin/autocomplete-input` (a
   * mutable dependency this story does not own) plumbs no
   * `disabled`/`readOnly` prop of its own today, and the browser's
   * fieldset-disable cascade reaches the popover trigger button without
   * needing one. The `m-0 min-w-0 border-0 p-0` classes neutralise
   * `<fieldset>`'s default box/border so it reads exactly like the plain
   * wrapper it replaces.
   */
  isShadchanLocked?: boolean;
  /**
   * Story 10.1 (Task 4): the share-target screen's "+ Add a shadchan"
   * inline-create affordance (FR78) — optional and additive, so every
   * existing caller (the manual "Add a suggestion" flow,
   * `InboxResolveDialog.tsx`) keeps rendering a plain, non-creatable
   * autocomplete when this is omitted. Passed straight through to the
   * `shadchan_id` `AutocompleteInput`'s own `onCreate` prop
   * (`@/components/admin/autocomplete-input.tsx` already wires it into
   * `useSupportCreateSuggestion` — this makes the affordance reachable from
   * every screen that reuses `ShidduchInputs`, not just the new one).
   */
  onCreateShadchan?: SupportCreateSuggestionOptions["onCreate"];
} = {}) => {
  return (
    <div className="flex flex-col gap-4">
      <FormSection eyebrow="Who">
        {/* 2.5 AC-8: an archived single is not offered as the pipeline owner
            for a brand-new shidduch. */}
        <ReferenceInput
          source="single_id"
          reference="singles"
          filter={{ "status@neq": "archived" }}
        >
          <AutocompleteInput
            label="Single (whose pipeline)"
            helperText="Whose suggestion board this will appear on"
            validate={required()}
          />
        </ReferenceInput>

        {/* Bilingual identity pair — English in foreground, Hebrew alongside
            in Heebo/RTL with a real gap (never ms-* on the dir="rtl" span). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            source="name_en"
            label="Name (English)"
            helperText="As it will appear on the board"
            validate={required()}
          />
          <TextInput
            source="name_he"
            label="Name (Hebrew)"
            helperText="Optional — shown alongside the English name"
            dir="rtl"
            inputClassName="font-hebrew"
          />
        </div>
      </FormSection>

      <FormSection eyebrow="Redt by">
        {/* 4.3 AC-2: no second `useIsMobile()` under `shidduchim/` — the one
            call lives in `ShidduchimViewSwitch` and only picks a default.
            This was a JS rendering fork; `md:` is the same 768px breakpoint
            `useIsMobile()` itself uses, so the columns are unchanged, minus
            the mount-then-reflow flash (the hook returns `false` until its
            effect runs, so a phone painted three columns for one frame). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <fieldset
            disabled={isShadchanLocked}
            className="m-0 min-w-0 border-0 p-0"
          >
            <ReferenceInput source="shadchan_id" reference="shadchanim">
              <AutocompleteInput
                label="Shadchan"
                onCreate={onCreateShadchan}
                helperText={
                  isShadchanLocked
                    ? lockedShadchanId != null
                      ? "Sent by your connected shadchan — cannot be changed here"
                      : "Sent by your connected shadchan, but their book entry could not be found — this can be resolved without a shadchan credited"
                    : "Optional — who suggested this match"
                }
              />
            </ReferenceInput>
          </fieldset>
          <DateInput
            source="redt_date"
            label="Redt date"
            helperText="When this was first suggested"
          />
          <SelectInput
            source="initial_state"
            label="Starting column"
            choices={initialStateChoices}
            optionText={renderStateOption}
            defaultValue="new"
            helperText="Most suggestions start at New"
          />
        </div>
      </FormSection>

      <FormSection eyebrow="Details">
        {/* Each context fact is a bilingual pair — English on the inline-start,
            Hebrew (Heebo/RTL) beside it — so a fact can be recorded and read in
            both scripts. Grid fills row by row, keeping each EN next to its HE. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            source="seminary_en"
            label="Yeshiva / seminary (English)"
            helperText={false}
          />
          <TextInput
            source="seminary_he"
            label="Yeshiva / seminary (Hebrew)"
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
          <TextInput
            source="location_en"
            label="Location (English)"
            helperText={false}
          />
          <TextInput
            source="location_he"
            label="Location (Hebrew)"
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
          <TextInput
            source="father_en"
            label="Father (English)"
            helperText={false}
          />
          <TextInput
            source="father_he"
            label="Father (Hebrew)"
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
          <TextInput
            source="mother_en"
            label="Mother (English)"
            helperText={false}
          />
          <TextInput
            source="mother_he"
            label="Mother (Hebrew)"
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
          <TextInput
            source="shul_en"
            label="Shul (English)"
            helperText={false}
          />
          <TextInput
            source="shul_he"
            label="Shul (Hebrew)"
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
        </div>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
          {/* Age & height are informational only — never matching signals
              (FR11) — the helper text says so plainly rather than burying it.
              Stacked on mobile and `items-start` on larger screens so the
              multi-line age caveat doesn't ragged-align against the
              helper-less height field. */}
          <NumberInput
            source="age"
            helperText="Informational only — never used for matching"
          />
          {/* Story 5.2: DOB is the more precise source when both are known —
              the Overview tab prefers a live age computed from it. */}
          <DateInput
            source="dob"
            label="Date of birth"
            helperText="Optional — shown alongside age"
          />
          <TextInput source="height" helperText={false} />
          <TextInput
            source="marital_status"
            label="Marital status"
            helperText={false}
          />
        </div>
        <div className="grid grid-cols-1 gap-4">
          <TextInput
            source="background"
            label="Background"
            multiline
            rows={2}
            helperText={false}
          />
          <TextInput
            source="existing_children_note"
            label="Existing children"
            multiline
            rows={2}
            helperText="The suggested person's own prior children, if any"
          />
        </div>
      </FormSection>
    </div>
  );
};
