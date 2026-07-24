import { Edit } from "@/components/admin/edit";
import { ShowButton } from "@/components/admin/show-button";
import { SimpleForm } from "@/components/admin/simple-form";

import { ChildFormFrame } from "./ChildFormFrame";
import { ChildInputs } from "./ChildInputs";
import { FormToolbar } from "../layout/FormToolbar";
import { TopToolbar } from "../layout/TopToolbar";

/**
 * Overrides the admin default actions to omit Delete: `children.id` cascades
 * to `shidduchim` and `date_records` (ON DELETE CASCADE), so deleting a
 * child here would silently wipe its pipeline history with no confirmation
 * of that impact. Mirrors `ChildShow`'s custom actions until a safe,
 * impact-aware delete flow exists.
 */
const ChildEditActions = () => (
  <TopToolbar>
    <ShowButton />
  </TopToolbar>
);

export const ChildEdit = () => (
  <Edit redirect="show" title={false} actions={<ChildEditActions />}>
    <ChildFormFrame
      heading="Edit child"
      description="Update this child's details."
    >
      <SimpleForm toolbar={<FormToolbar />}>
        <ChildInputs />
      </SimpleForm>
    </ChildFormFrame>
  </Edit>
);
