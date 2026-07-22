import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { List } from "@/components/admin/list";

import { TopToolbar } from "../layout/TopToolbar";

const ShadchanListActions = () => (
  <TopToolbar>
    <CreateButton />
  </TopToolbar>
);

export const ShadchanList = () => (
  <List
    title={false}
    actions={<ShadchanListActions />}
    sort={{ field: "name", order: "ASC" }}
  >
    <DataTable>
      <DataTable.Col source="name" />
      <DataTable.Col source="location" />
      <DataTable.Col source="responsiveness" />
    </DataTable>
  </List>
);
