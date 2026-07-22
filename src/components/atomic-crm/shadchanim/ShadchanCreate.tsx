import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { ShadchanInputs } from "./ShadchanInputs";

export const ShadchanCreate = () => (
  <Create redirect="list">
    <SimpleForm>
      <ShadchanInputs />
    </SimpleForm>
  </Create>
);
