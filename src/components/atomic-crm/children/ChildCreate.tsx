import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { ChildFormFrame } from "./ChildFormFrame";
import { ChildInputs } from "./ChildInputs";

export const ChildCreate = () => (
  <Create redirect="show" title={false}>
    <ChildFormFrame
      heading="Add a child"
      description="A shidduchim pipeline belongs to a child — the single you are redting for."
    >
      <SimpleForm>
        <ChildInputs />
      </SimpleForm>
    </ChildFormFrame>
  </Create>
);
