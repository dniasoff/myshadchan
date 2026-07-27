import { Edit } from "@/components/admin/edit";
import { ShowButton } from "@/components/admin/show-button";
import { SimpleForm } from "@/components/admin/simple-form";

import { SingleFormFrame } from "./SingleFormFrame";
import { SingleInputs } from "./SingleInputs";
import { FormToolbar } from "../layout/FormToolbar";
import { TopToolbar } from "../layout/TopToolbar";

/**
 * Overrides the admin default actions to omit Delete: `singles.id` cascades
 * to `shidduchim` and `date_records` (ON DELETE CASCADE), so deleting a
 * single here would silently wipe its pipeline history with no confirmation
 * of that impact. Mirrors `SingleShow`'s custom actions until a safe,
 * impact-aware delete flow exists.
 */
const SingleEditActions = () => (
  <TopToolbar>
    <ShowButton />
  </TopToolbar>
);

export const SingleEdit = () => (
  <Edit redirect="show" title={false} actions={<SingleEditActions />}>
    <SingleFormFrame
      heading="Edit single"
      description="Update this single's details."
    >
      <SimpleForm toolbar={<FormToolbar />}>
        <SingleInputs />
      </SimpleForm>
    </SingleFormFrame>
  </Edit>
);
