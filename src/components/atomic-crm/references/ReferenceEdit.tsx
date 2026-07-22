import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { ReferenceInputs } from "./ReferenceInputs";

export const ReferenceEdit = () => (
  <Edit redirect="show">
    <SimpleForm>
      <ReferenceInputs />
    </SimpleForm>
  </Edit>
);
