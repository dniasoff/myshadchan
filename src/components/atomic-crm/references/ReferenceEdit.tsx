import { Edit } from "@/components/admin/edit";
import { SimpleForm } from "@/components/admin/simple-form";

import { RecordUnavailable } from "../entity360/RecordUnavailable";
import { redirectToRecord } from "../entity360/routeConvention";
import { FormToolbar } from "../layout/FormToolbar";
import { ReferenceInputs } from "./ReferenceInputs";

export const ReferenceEdit = () => (
  // `disableBreadcrumb`: the default breadcrumb renders "Home / References /
  // <name>", where "References" is a LINK to the list — a browse entry
  // RULING 7 forbids.
  //
  // `redirectOnError={false}` + an explicit `error` element: `useEditController`
  // defaults `redirectOnError` to `"list"`, so a stale deep link
  // (`#/references/9999/edit`) navigated the user into `#/references`, which
  // RULING 7 says is not a destination. Now the URL stays put and
  // `RecordUnavailable` renders instead.
  <Edit
    redirect={redirectToRecord}
    disableBreadcrumb
    redirectOnError={false}
    error={<RecordUnavailable />}
  >
    <SimpleForm toolbar={<FormToolbar />}>
      <ReferenceInputs />
    </SimpleForm>
  </Edit>
);
