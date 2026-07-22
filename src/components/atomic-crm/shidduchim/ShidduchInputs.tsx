import { required } from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { DateInput } from "@/components/admin/date-input";
import { NumberInput } from "@/components/admin/number-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

import { INITIAL_PIPELINE_STATES, PIPELINE_STATES } from "./pipelineStates";

const initialStateChoices = PIPELINE_STATES.filter((state) =>
  INITIAL_PIPELINE_STATES.includes(state.value),
).map((state) => ({ id: state.value, name: state.label }));

export const ShidduchInputs = () => {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-1 flex-col gap-4">
        <ReferenceInput source="child_id" reference="children">
          <AutocompleteInput
            label="Child (whose pipeline)"
            validate={required()}
            helperText={false}
          />
        </ReferenceInput>
        <TextInput
          source="name_en"
          label="Name (EN)"
          validate={required()}
          helperText={false}
        />
        <TextInput source="name_he" label="Name (HE)" helperText={false} />
      </div>

      <div className={`flex gap-6 ${isMobile ? "flex-col" : "flex-row"}`}>
        <div className="flex flex-1 flex-col gap-4">
          <h3 className="text-base font-medium">Redt by</h3>
          <ReferenceInput source="shadchan_id" reference="shadchanim">
            <AutocompleteInput label="Shadchan" helperText={false} />
          </ReferenceInput>
          <DateInput source="redt_date" label="Redt date" helperText={false} />
          <SelectInput
            source="initial_state"
            label="Starting column"
            choices={initialStateChoices}
            defaultValue="new"
            helperText={false}
          />
        </div>

        <Separator orientation={isMobile ? "horizontal" : "vertical"} />

        <div className="flex flex-1 flex-col gap-4">
          <h3 className="text-base font-medium">Details</h3>
          <TextInput
            source="seminary_en"
            label="Yeshiva / seminary"
            helperText={false}
          />
          <TextInput source="location_en" label="Location" helperText={false} />
          <TextInput source="parents_en" label="Parents" helperText={false} />
          <TextInput source="shul_en" label="Shul" helperText={false} />
          {/* Age & height are informational only — never matching signals (FR11). */}
          <NumberInput source="age" helperText={false} />
          <TextInput source="height" helperText={false} />
        </div>
      </div>
    </div>
  );
};
