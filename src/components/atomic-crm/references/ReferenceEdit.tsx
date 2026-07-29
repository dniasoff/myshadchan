import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { redirectToRecord } from "../entity360/routeConvention";
import { FormToolbar } from "../layout/FormToolbar";
import { ReferenceInputs } from "./ReferenceInputs";

export const ReferenceEdit = () => (
  // `disableBreadcrumb`: see ReferenceShow — the breadcrumb's "References"
  // crumb links to the list, a browse entry RULING 7 forbids.
  <Edit redirect={redirectToRecord} disableBreadcrumb>
    <SimpleForm toolbar={<FormToolbar />}>
      <ReferenceInputs />
    </SimpleForm>
  </Edit>
);
