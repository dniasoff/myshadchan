import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { List } from "@/components/admin/list";

import { TopToolbar } from "../layout/TopToolbar";

const ChildListActions = () => (
  <TopToolbar>
    <CreateButton />
  </TopToolbar>
);

export const ChildList = () => (
  <List
    title={false}
    actions={<ChildListActions />}
    sort={{ field: "first_name_en", order: "ASC" }}
  >
    <DataTable>
      <DataTable.Col source="first_name_en" label="First name" />
      <DataTable.Col source="last_name_en" label="Last name" />
      <DataTable.Col source="community" />
      <DataTable.Col source="status" />
    </DataTable>
  </List>
);
