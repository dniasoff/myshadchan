import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { ChildInputs } from "./ChildInputs";

export const ChildEdit = () => (
  <Edit>
    <SimpleForm>
      <ChildInputs />
    </SimpleForm>
  </Edit>
);
