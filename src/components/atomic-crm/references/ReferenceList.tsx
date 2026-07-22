import { useTranslate } from "ra-core";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { TopToolbar } from "../layout/TopToolbar";
import type { ReferenceSummary } from "../types";

/**
 * The reference book (§5a): every person the family has spoken to, across every
 * child and every shidduch in the account (FR51-52) — deliberately not scoped to
 * one single, because the whole point is that the same person gets asked about
 * several.
 *
 * Counts come from references_summary, so the list is one query rather than a
 * fetch per row.
 */

const referenceFilters = [
  <SearchInput source="q" alwaysOn key="q" />,
  <TextInput source="relationship" key="relationship" />,
  <SelectInput
    source="open_task_count@gt"
    label="Reminders"
    key="open_task_count"
    choices={[{ id: 0, name: "Has an open reminder" }]}
  />,
  <SelectInput
    source="contacted_count@eq"
    label="Spoken to"
    key="contacted_count"
    choices={[{ id: 0, name: "Not yet spoken to" }]}
  />,
];

const ReferenceListActions = () => (
  <TopToolbar>
    <CreateButton />
  </TopToolbar>
);

export const ReferenceList = () => {
  const translate = useTranslate();

  return (
    <List
      title={false}
      actions={<ReferenceListActions />}
      filters={referenceFilters}
      sort={{ field: "name_en", order: "ASC" }}
    >
      <DataTable rowClick="show">
        <DataTable.Col source="name_en" label="Name" />
        <DataTable.Col source="name_he" label="Name (HE)" />
        <DataTable.Col source="relationship" />
        <DataTable.Col source="phone" />
        <DataTable.Col source="school" />
        <DataTable.Col
          source="linked_shidduchim_count"
          label={translate("crm.references.list.linkedTo", {
            _: "Linked to",
          })}
          render={(record: ReferenceSummary) => (
            <span className="tabular-nums">
              {translate("crm.references.list.linkedCount", {
                smart_count: Number(record.linked_shidduchim_count ?? 0),
                _: "%{smart_count} singles",
              })}
            </span>
          )}
        />
        <DataTable.Col
          source="open_task_count"
          label={translate("crm.references.list.openReminders", {
            _: "Reminders",
          })}
        />
      </DataTable>
    </List>
  );
};
