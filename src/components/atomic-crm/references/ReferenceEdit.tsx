import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { FormToolbar } from "../layout/FormToolbar";
import { ReferenceInputs } from "./ReferenceInputs";

export const ReferenceEdit = () => (
  <Edit redirect="show">
    <SimpleForm toolbar={<FormToolbar />}>
      <ReferenceInputs />
    </SimpleForm>
  </Edit>
);
