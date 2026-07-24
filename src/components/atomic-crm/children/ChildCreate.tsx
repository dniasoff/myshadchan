import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { ChildFormFrame } from "./ChildFormFrame";
import { ChildInputs } from "./ChildInputs";
import { FormToolbar } from "../layout/FormToolbar";

export const ChildCreate = () => (
  <Create redirect="show" title={false}>
    <ChildFormFrame
      heading="Add a child"
      description="A shidduchim pipeline belongs to a child — the single you are redting for."
    >
      <SimpleForm toolbar={<FormToolbar />}>
        <ChildInputs />
      </SimpleForm>
    </ChildFormFrame>
  </Create>
);
