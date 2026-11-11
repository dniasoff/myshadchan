import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { ShadchanInputs } from "./ShadchanInputs";
import { normalizeShadchanName } from "./shadchanUtils";

export const ShadchanCreate = () => (
  <Create redirect="list" transform={normalizeShadchanName}>
    <SimpleForm>
      <ShadchanInputs />
    </SimpleForm>
  </Create>
);
