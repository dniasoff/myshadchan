import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { redirectToRecord } from "../entity360/routeConvention";
import { FormPageFrame } from "../misc/FormPageFrame";
import { SingleInputs } from "./SingleInputs";
import { FormToolbar } from "../layout/FormToolbar";

const singleCreateDefaultValues = {
  kohen_status: "unknown",
  status: "active",
};

export const SingleCreate = () => (
  <Create redirect={redirectToRecord} title={false}>
    <FormPageFrame
      eyebrow="Family roster"
      heading="Add a single"
      description="A shidduchim pipeline belongs to a single — the person you are redting for."
    >
      <SimpleForm
        defaultValues={singleCreateDefaultValues}
        toolbar={<FormToolbar />}
      >
        <SingleInputs mode="create" />
      </SimpleForm>
    </FormPageFrame>
  </Create>
);
