import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";

import { redirectToRecord } from "../entity360/routeConvention";
import { SingleFormFrame } from "./SingleFormFrame";
import { SingleInputs } from "./SingleInputs";
import { FormToolbar } from "../layout/FormToolbar";

export const SingleCreate = () => (
  <Create redirect={redirectToRecord} title={false}>
    <SingleFormFrame
      heading="Add a single"
      description="A shidduchim pipeline belongs to a single — the person you are redting for."
    >
      <SimpleForm toolbar={<FormToolbar />}>
        <SingleInputs />
      </SimpleForm>
    </SingleFormFrame>
  </Create>
);
