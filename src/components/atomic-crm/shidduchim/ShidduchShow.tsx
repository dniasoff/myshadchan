import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useGetList,
  useGetOne,
  useNotify,
  useRedirect,
  useRefresh,
} from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { DateInput } from "@/components/admin/date-input";
import { SaveButton } from "@/components/admin/form";
import { NumberInput } from "@/components/admin/number-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type {
  Redt,
  SchoolKind,
  Shadchan,
  ShidduchSchool,
  ShidduchSummary,
} from "../types";
import { formatRedtDate } from "./boardUtils";
import { getPipelineStateDef } from "./pipelineStates";
import { ShidduchReferencesSection } from "../references/ShidduchReferencesSection";

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

export const ShidduchShow = ({
  open,
  id,
}: {
  open: boolean;
  id?: Identifier;
}) => {
  const redirect = useRedirect();
  const handleClose = () => redirect("/shidduchim");
  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-2xl">
        {id ? <ShidduchShowContent id={id} /> : null}
      </DialogContent>
    </Dialog>
  );
};

const ShidduchShowContent = ({ id }: { id: Identifier }) => {
  const { data: shidduch, isPending } = useGetOne<ShidduchSummary>(
    "shidduchim",
    { id },
  );
  const { data: redts } = useGetList<Redt>("redts", {
    filter: { shidduchim_id: id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "DESC" },
  });
  const { data: shadchanim } = useGetList<Shadchan>("shadchanim", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: schools } = useGetList<ShidduchSchool>("shidduch_schools", {
    filter: { shidduchim_id: id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();

  if (isPending || !shidduch) return null;

  const shadchanName = (shadchanId?: Identifier | null) =>
    shadchanim?.find((s) => s.id === shadchanId)?.name ?? "Unknown shadchan";
  const stateDef = getPipelineStateDef(shidduch.pipeline_state);
  const history = redts ?? [];
  const earliestId = history.length
    ? history[history.length - 1].id
    : undefined;
  const meta = [shidduch.location_en, shidduch.seminary_en]
    .filter(Boolean)
    .join(" · ");

  const onAddRedt = async (values: Record<string, unknown>) => {
    try {
      await dataProvider.addRedt({
        shidduchim_id: id,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        redt_date: (values.redt_date as string) ?? null,
        note: (values.note as string) ?? null,
      });
      notify("Redt added", { type: "info" });
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to add redt", {
        type: "error",
      });
    }
  };

  const schoolList = schools ?? [];

  const onAddSchool = async (values: Record<string, unknown>) => {
    try {
      await dataProvider.addSchool({
        shidduchim_id: id,
        kind: (values.kind as SchoolKind) ?? "seminary",
        name_en: (values.name_en as string) ?? null,
        name_he: (values.name_he as string) ?? null,
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
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="text-xl font-bold tracking-tight">
          {shidduch.name_en ?? "Shidduch"}
          {shidduch.name_he ? (
            <span
              className="font-hebrew ms-2 text-base font-medium text-muted-foreground"
              dir="rtl"
            >
              {shidduch.name_he}
            </span>
          ) : null}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {stateDef ? <Badge variant="outline">{stateDef.label}</Badge> : null}
          {meta ? <span>{meta}</span> : null}
        </div>
      </header>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          Schools &amp; seminaries{" "}
          <span className="font-normal text-muted-foreground">
            ({schoolList.length})
          </span>
        </h3>
        {schoolList.length ? (
          <ul className="flex flex-col gap-2">
            {schoolList.map((school) => (
              <li
                key={school.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {school.kind}
                  </Badge>
                  <span className="min-w-0 truncate">
                    {school.name_en ?? school.name_he ?? "—"}
                    {school.name_he && school.name_en ? (
                      <span
                        className="font-hebrew ms-1 text-muted-foreground"
                        dir="rtl"
                      >
                        {school.name_he}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatSchoolYears(school)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No schools yet.</p>
        )}
        <div className="mt-3">
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
                label="Name (EN)"
                helperText={false}
              />
              <TextInput
                source="name_he"
                label="Name (HE)"
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
                <SaveButton label="Add school" />
              </div>
            </div>
          </Form>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          Redt history{" "}
          <span className="font-normal text-muted-foreground">
            ({history.length})
          </span>
        </h3>
        <ul className="flex flex-col gap-2">
          {history.map((redt, i) => (
            <li
              key={redt.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm"
            >
              <span className="min-w-0">
                via {shadchanName(redt.shadchan_id)}
                {redt.note ? (
                  <span className="text-muted-foreground"> — {redt.note}</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {i === 0 && history.length > 1 ? "Latest · " : ""}
                {redt.id === earliestId && history.length > 1 ? "First · " : ""}
                {formatRedtDate(redt.redt_date)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ShidduchReferencesSection shidduchimId={id} />

      <section>
        <h3 className="mb-2 text-sm font-semibold">Add a redt</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          The same or a different shadchan can redt this again. The card&apos;s
          redt date always shows the most recent.
        </p>
        <Form
          onSubmit={onAddRedt}
          defaultValues={{ redt_date: new Date().toISOString().split("T")[0] }}
        >
          <div className="flex flex-col gap-3">
            <ReferenceInput source="shadchan_id" reference="shadchanim">
              <AutocompleteInput label="Shadchan" helperText={false} />
            </ReferenceInput>
            <DateInput
              source="redt_date"
              label="Redt date"
              helperText={false}
            />
            <TextInput source="note" label="Note" helperText={false} />
            <div className="flex justify-end">
              <SaveButton label="Add redt" />
            </div>
          </div>
        </Form>
      </section>
    </div>
  );
};
