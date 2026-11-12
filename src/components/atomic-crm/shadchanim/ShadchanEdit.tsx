import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { ShadchanInputs } from "./ShadchanInputs";
import { normalizeShadchanName } from "./shadchanUtils";

export const ShadchanEdit = () => (
  <Edit transform={normalizeShadchanName}>
    <SimpleForm>
      <ShadchanInputs />
    </SimpleForm>
  </Edit>
);
