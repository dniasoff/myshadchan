import type { Identifier } from "ra-core";
import { Form, useDataProvider, useNotify, useRefresh } from "ra-core";

import { NumberInput } from "@/components/admin/number-input";
import { SaveButton } from "@/components/admin/form";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Badge } from "@/components/ui/badge";

import type { CrmDataProvider } from "../providers/types";
import type { SchoolKind, ShidduchSchool } from "../types";

const SCHOOL_KIND_CHOICES = [
  { id: "seminary", name: "Seminary" },
  { id: "yeshiva", name: "Yeshiva" },
  { id: "school", name: "School" },
  { id: "college", name: "College" },
  { id: "other", name: "Other" },
];

const formatSchoolYears = (school: ShidduchSchool): string => {
  if (school.start_year && school.end_year)
    return `${school.start_year}–${school.end_year}`;
  return school.end_year?.toString() ?? school.start_year?.toString() ?? "";
};

/** Schools & seminaries + "add a school" (Screen 18 body). */
export const ShidduchSchoolsSection = ({
  shidduchimId,
  schools,
}: {
  shidduchimId: Identifier;
  schools: ShidduchSchool[];
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();

  const onAddSchool = async (values: Record<string, unknown>) => {
    try {
      await dataProvider.addSchool({
        shidduchim_id: shidduchimId,
        kind: (values.kind as SchoolKind) ?? "seminary",
        name_en: (values.name_en as string) ?? null,
        start_year:
          values.start_year != null ? Number(values.start_year) : null,
        end_year: values.end_year != null ? Number(values.end_year) : null,
      });
      notify("School added", { type: "info" });
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to add school", {
        type: "error",
      });
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-semibold">
        Schools &amp; seminaries{" "}
        <span className="font-sans text-sm font-normal text-muted-foreground">
          ({schools.length})
        </span>
      </h3>

      {schools.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {schools.map((school) => (
            <li
              key={school.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-2.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {school.kind}
                </Badge>
                <span className="min-w-0 truncate">
                  {school.name_en ?? "—"}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatSchoolYears(school)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No schools yet.</p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <h4 className="mb-3 text-sm font-semibold">Add a school</h4>
        <Form onSubmit={onAddSchool} defaultValues={{ kind: "seminary" }}>
          <div className="flex flex-col gap-3">
            <SelectInput
              source="kind"
              label="Type"
              choices={SCHOOL_KIND_CHOICES}
              helperText={false}
            />
            <TextInput
              source="name_en"
              label="Name"
              helperText={false}
            />
            <div className="flex gap-3">
              <NumberInput
                source="start_year"
                label="From year"
                helperText={false}
              />
              <NumberInput
                source="end_year"
                label="To year"
                helperText={false}
              />
            </div>
            <div className="flex justify-end">
              <SaveButton label="Add school" variant="secondary" />
            </div>
          </div>
        </Form>
      </div>
    </section>
  );
};
