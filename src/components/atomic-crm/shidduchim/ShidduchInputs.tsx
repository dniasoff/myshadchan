import type { ReactNode } from "react";
import { required } from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { DateInput } from "@/components/admin/date-input";
import { NumberInput } from "@/components/admin/number-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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

export const ShidduchInputs = () => {
  const isMobile = useIsMobile();

  return (
    <div className="flex flex-col gap-4">
      <FormSection eyebrow="Who">
        <ReferenceInput source="child_id" reference="children">
          <AutocompleteInput
            label="Child (whose pipeline)"
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
        <div
          className={cn(
            "grid gap-4",
            isMobile ? "grid-cols-1" : "grid-cols-3",
          )}
        >
          <ReferenceInput source="shadchan_id" reference="shadchanim">
            <AutocompleteInput
              label="Shadchan"
              helperText="Optional — who suggested this match"
            />
          </ReferenceInput>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            source="seminary_en"
            label="Yeshiva / seminary"
            helperText={false}
          />
          <TextInput source="location_en" label="Location" helperText={false} />
          <TextInput source="parents_en" label="Parents" helperText={false} />
          <TextInput source="shul_en" label="Shul" helperText={false} />
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
          <TextInput source="height" helperText={false} />
        </div>
      </FormSection>
    </div>
  );
};
