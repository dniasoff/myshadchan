import type { Identifier } from "ra-core";
import { Form, useDataProvider, useNotify, useRefresh } from "ra-core";

import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { DateInput } from "@/components/admin/date-input";
import { SaveButton } from "@/components/admin/form";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";

import type { CrmDataProvider } from "../providers/types";
import type { Redt } from "../types";
import { formatRedtDate } from "./boardUtils";

/**
 * Redt history + "add a redt" (Screen 18 body). The same or a different
 * shadchan can redt a shidduch again; shidduchim.redt_date (kept in sync by a
 * DB trigger) always reflects the latest.
 */
export const RedtHistorySection = ({
  shidduchimId,
  history,
  shadchanName,
}: {
  shidduchimId: Identifier;
  history: Redt[];
  shadchanName: (shadchanId?: Identifier | null) => string;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();

  const earliestId = history.length
    ? history[history.length - 1].id
    : undefined;

  const onAddRedt = async (values: Record<string, unknown>) => {
    try {
      await dataProvider.addRedt({
        shidduchim_id: shidduchimId,
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

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-semibold">
        Redt history{" "}
        <span className="font-sans text-sm font-normal text-muted-foreground">
          ({history.length})
        </span>
      </h3>

      {history.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {history.map((redt, i) => (
            <li
              key={redt.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-2.5 text-sm"
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
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No redts logged yet.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <h4 className="mb-1 text-sm font-semibold">Add a redt</h4>
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
              <SaveButton label="Add redt" variant="secondary" />
            </div>
          </div>
        </Form>
      </div>
    </section>
  );
};
