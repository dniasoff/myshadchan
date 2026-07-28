import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { redirectToRecord } from "../entity360/routeConvention";
import { FormToolbar } from "../layout/FormToolbar";
import { ReferenceInputs } from "./ReferenceInputs";

export const ReferenceEdit = () => (
  <Edit redirect={redirectToRecord}>
    <SimpleForm toolbar={<FormToolbar />}>
      <ReferenceInputs />
    </SimpleForm>
  </Edit>
);
