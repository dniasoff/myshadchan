import type { Identifier } from "ra-core";
import { useGetList, useRecordContext } from "ra-core";

import type { Redt, Shadchan, ShidduchSummary } from "../types";
import {
  displaySuggestedByPhone,
  suggestedByPhoneHref,
} from "../inbox/suggestedBy";
import { RedtHistorySection } from "./RedtHistorySection";
import { ShidduchCatchSection } from "./ShidduchCatchSection";
import { ShidduchFactsCard } from "./ShidduchFactsCard";
import { SingleInputForm } from "./SingleInputForm";
import { ShidduchTodoBox } from "./ShidduchTodoBox";

/**
 * The `overview` tab's content (Story 5.1 AC 5/6) — the four presentational
 * sections relocated verbatim from the deleted `ShidduchShow.tsx`, together
 * with the data loading that used to sit above them there:
 * `EntityShow`/`ShowBase` fetch nothing beyond the record itself (contract
 * §2 rule 1), so the `redts` / `shadchanim` fetches move into this tab's own
 * module. `shadchanim` is fetched again by
 * `entityDescriptorRegions.tsx`'s `ShidduchIdentityHeader`; React Query
 * dedupes the identical query key, so this is one request, not two.
 */
export const ShidduchOverviewTab = () => {
  const record = useRecordContext<ShidduchSummary>();
  const { data: redts } = useGetList<Redt>("redts", {
    filter: { shidduchim_id: record?.id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "DESC" },
  });
  const { data: shadchanim } = useGetList<Shadchan>("shadchanim", {
    filter: { "archived_at@is": null },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  if (!record) return null;

  const shadchanName = (shadchanId?: Identifier | null) =>
    shadchanim?.find((shadchan) => shadchan.id === shadchanId)?.name ??
    "Unknown shadchan";
  const suggestedByPhone = displaySuggestedByPhone(record.suggested_by_phone);
  const suggestedByName = record.suggested_by_name?.trim() ?? "";

  return (
    <div className="flex flex-col gap-5">
      {/* Story 6.4 (AC 6): the single's write surface, above the catch
          section — a canonical tab is the host, never the read-only right
          rail (ShidduchRightRail.guard.test.ts). Renders nothing for any
          viewer other than a single. */}
      <SingleInputForm shidduchId={record.id} />

      <div
        data-slot="shidduch-shadchan-todo-layout"
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start"
      >
        <section
          aria-labelledby="shidduch-shadchan-heading"
          data-slot="shidduch-shadchan-block"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <h3
            id="shidduch-shadchan-heading"
            className="font-display text-lg font-semibold"
          >
            Shadchan
          </h3>
          <p className="mt-2 break-words text-sm text-muted-foreground">
            {record.shadchan_name?.trim() || "No shadchan recorded"}
          </p>
          {suggestedByName || suggestedByPhone ? (
            <div
              className="mt-4 border-t border-border pt-4"
              data-slot="shidduch-suggested-by"
            >
              <h4 className="text-sm font-semibold">Suggested by</h4>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {suggestedByName ? <span>{suggestedByName}</span> : null}
                {suggestedByName && suggestedByPhone ? " · " : null}
                {suggestedByPhone ? (
                  <a
                    href={
                      suggestedByPhoneHref(record.suggested_by_phone) ??
                      undefined
                    }
                    className="inline-flex min-h-11 items-center px-2 underline decoration-dotted underline-offset-2"
                  >
                    {suggestedByPhone}
                  </a>
                ) : null}
              </p>
            </div>
          ) : null}
        </section>

        <ShidduchTodoBox shidduch={record} />
      </div>

      <ShidduchCatchSection shidduchimId={record.id} />

      <ShidduchFactsCard shidduch={record} />

      <RedtHistorySection
        shidduchimId={record.id}
        history={redts ?? []}
        shadchanName={shadchanName}
      />
    </div>
  );
};
