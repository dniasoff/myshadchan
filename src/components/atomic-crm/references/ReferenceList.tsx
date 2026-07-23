import { useCreatePath, useListContext, useTranslate } from "ra-core";
import { Link } from "react-router";
import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import { EmptyState } from "../misc/EmptyState";
import { TopToolbar } from "../layout/TopToolbar";
import type { ReferenceSummary } from "../types";

/**
 * The reference book (§5a): every person the family has spoken to, across every
 * child and every shidduch in the account (FR51-52) — deliberately not scoped to
 * one single, because the whole point is that the same person gets asked about
 * several.
 *
 * Counts come from references_summary, so the list is one query rather than a
 * fetch per row. Visual-polish pass only — the query and filters are unchanged.
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

const ReferenceRow = ({
  record,
  index,
}: {
  record: ReferenceSummary;
  index: number;
}) => {
  const translate = useTranslate();
  const createPath = useCreatePath();
  const name = record.name_en || record.name_he || "?";
  const monogram = getMonogram(record.name_en || record.name_he);
  const avatarIndex = getAvatarIndex(record.name_en ?? String(record.id));
  const meta = [record.relationship, record.phone, record.school]
    .filter(Boolean)
    .join(" · ");
  const linkedCount = Number(record.linked_shidduchim_count ?? 0);
  const openTasks = Number(record.open_task_count ?? 0);

  return (
    <Link
      to={createPath({ resource: "references", id: record.id, type: "show" })}
      className="ql-enter block no-underline"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Card
        className="flex flex-row items-center gap-4 rounded-2xl p-4 shadow-sm
          transition-[box-shadow,transform] duration-[160ms] ease-[--ease-out]
          hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
      >
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
          aria-hidden="true"
        >
          {monogram}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold leading-tight">
            <span>{name}</span>
            {record.name_en && record.name_he ? (
              <span
                className="font-hebrew text-[13px] font-medium text-muted-foreground"
                dir="rtl"
              >
                {record.name_he}
              </span>
            ) : null}
          </div>
          {meta ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className="inline-flex h-6 items-center rounded-full ps-2.5 pe-2.5
              text-xs font-semibold tabular-nums text-primary
              bg-[color-mix(in_oklch,var(--primary)_12%,transparent)]"
          >
            {translate("crm.references.list.linkedCount", {
              smart_count: linkedCount,
              _: "%{smart_count} singles",
            })}
          </span>
          {openTasks > 0 ? (
            <span
              className="inline-flex h-6 items-center rounded-full ps-2.5 pe-2.5
                text-xs font-semibold tabular-nums text-attention-foreground
                bg-[color-mix(in_oklch,var(--attention)_28%,transparent)]"
            >
              {translate("crm.references.list.openReminders", {
                smart_count: openTasks,
                _: "%{smart_count} reminders",
              })}
            </span>
          ) : null}
        </div>
      </Card>
    </Link>
  );
};

const ReferenceListHeader = () => {
  const translate = useTranslate();

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {translate("crm.references.list.eyebrow", { _: "Reference book" })}
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {translate("resources.references.name", {
          smart_count: 2,
          _: "References",
        })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate("crm.references.list.subtitle", {
          _: "Everyone your family has spoken to about a single.",
        })}
      </p>
    </div>
  );
};

const ReferenceListLayout = () => {
  const translate = useTranslate();
  const { data, isPending, filterValues } = useListContext<ReferenceSummary>();
  const hasFilters = filterValues && Object.keys(filterValues).length > 0;

  if (isPending) {
    return (
      <div>
        <ReferenceListHeader />
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-2xl bg-muted"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!data?.length && !hasFilters) {
    return (
      <div>
        <ReferenceListHeader />
        <EmptyState
          title={translate("crm.references.list.emptyTitle", {
            _: "No references yet",
          })}
          description={translate("crm.references.list.emptyDescription", {
            _: "Add the first person you've spoken to about a single — the book grows from here, and every future mention of them links back to this one record.",
          })}
          actionLabel={translate("crm.references.list.emptyAction", {
            _: "Add a reference",
          })}
          actionTo="/references/create"
        />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div>
        <ReferenceListHeader />
        <p className={cn("py-10 text-center text-sm text-muted-foreground")}>
          {translate("crm.references.list.noMatches", {
            _: "No references match these filters.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div>
      <ReferenceListHeader />
      <div className="flex flex-col gap-3">
        {data.map((record, index) => (
          <ReferenceRow
            key={String(record.id)}
            record={record}
            index={index}
          />
        ))}
      </div>
    </div>
  );
};

export const ReferenceList = () => (
  <List
    title={false}
    actions={<ReferenceListActions />}
    filters={referenceFilters}
    sort={{ field: "name_en", order: "ASC" }}
  >
    <ReferenceListLayout />
  </List>
);
