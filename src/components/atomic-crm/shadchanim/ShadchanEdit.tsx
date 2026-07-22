import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { ShadchanInputs } from "./ShadchanInputs";

export const ShadchanEdit = () => (
  <Edit>
    <SimpleForm>
      <ShadchanInputs />
    </SimpleForm>
  </Edit>
);
