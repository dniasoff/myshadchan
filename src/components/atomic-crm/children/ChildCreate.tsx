import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { ChildInputs } from "./ChildInputs";

export const ChildCreate = () => (
  <Create redirect="list">
    <SimpleForm>
      <ChildInputs />
    </SimpleForm>
  </Create>
);
