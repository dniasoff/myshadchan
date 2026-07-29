import { useRecordContext, useTranslate } from "ra-core";
import { Show } from "@/components/admin/show";
import { EditButton } from "@/components/admin/edit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityAvatar } from "../entity360/EntityAvatar";
import { RecordUnavailable } from "../entity360/RecordUnavailable";
import { TopToolbar } from "../layout/TopToolbar";
import type { Reference } from "../types";
import { ReferenceCallLog } from "./ReferenceCallLog";
import { ReferenceMergeButton } from "./ReferenceMergeButton";
import { ReferenceTasks } from "./ReferenceTasks";
import { ReferenceTimeline } from "./ReferenceTimeline";
import { RepeatRecognitionPanel } from "./RepeatRecognitionPanel";
import { ResearchAssistantPanel } from "./ResearchAssistantPanel";
import { summarizeCallProgress } from "./callStatus";
import { useReferenceLinks } from "./useReferenceLinks";

/** Active tab gets an indigo tint + underline (design-language §5.4 family). */
const activeTabClassName =
  "data-[state=active]:text-primary data-[state=active]:bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] data-[state=active]:shadow-none";

/**
 * The reference detail page (§5b) — the thing the imported design never had.
 *
 * In the canvas a reference existed only inside one shidduch's tab, from a
 * hard-coded array, with no id you could route to. Here a reference is a real
 * record with its own page: header, timeline, notes, reminders, its call log per
 * single, and the cross-shidduch history that makes the book worth keeping.
 */

/** Exported for direct render coverage of the AC 5 EntityAvatar rewire
 * (`ReferenceHeader.test.tsx`) — otherwise only reachable through the full
 * `ShowBase` record context. */
export const ReferenceHeader = ({ reference }: { reference: Reference }) => {
  const translate = useTranslate();
  const { links, isPending: linksPending } = useReferenceLinks(reference.id);
  const progress = summarizeCallProgress(links);
  const name = reference.name_en || "?";
  const meterPct =
    progress.total > 0
      ? Math.round((progress.contacted / progress.total) * 100)
      : 0;

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <EntityAvatar
            seed={reference.name_en ?? String(reference.id)}
            monogramSource={reference.name_en}
            className="h-12 w-12 rounded-xl text-base"
          />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold leading-tight">
              {name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                reference.relationship,
                reference.phone,
                reference.school,
                reference.grad_year ? String(reference.grad_year) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {reference.relationship ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {translate("crm.references.header.relationshipNote", {
                  _: "Shown per single below when it differs.",
                })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="w-full max-w-[220px] shrink-0 sm:w-[220px]">
          {linksPending ? (
            // Same footprint as the settled meter below (text row + gap +
            // bar), so the header's height never shifts once the count
            // resolves. Without this, `progress.total` is 0 while
            // `useReferenceLinks` is in flight, so the real meter would
            // briefly claim "0 of 0 conversations done" on a reference that
            // has some — the same false-empty state as the RULING 7
            // `RepeatRecognitionPanel` finding, and it comes from the same
            // ignored `isPending`.
            <div aria-busy="true">
              <Skeleton className="ms-auto h-5 w-40" />
              <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
            </div>
          ) : (
            <>
              <p className="text-end text-sm font-medium tabular-nums">
                {translate("crm.references.header.progress", {
                  contacted: progress.contacted,
                  total: progress.total,
                  _: "%{contacted} of %{total} conversations done",
                })}
              </p>
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={meterPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-positive transition-[width] duration-[320ms] ease-[var(--ease-out)]"
                  style={{ width: `${meterPct}%` }}
                />
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/** Header + tab shell skeleton while the record loads (was a bare `null`). */
const ReferenceShowSkeleton = () => (
  <div className="flex flex-col gap-4" aria-hidden="true">
    <div className="h-[92px] animate-pulse rounded-2xl bg-muted" />
    <div className="h-9 w-full max-w-md animate-pulse rounded-lg bg-muted" />
    <div className="h-40 animate-pulse rounded-2xl bg-muted" />
  </div>
);

const ReferenceShowLayout = () => {
  const record = useRecordContext<Reference>();
  const translate = useTranslate();
  const { links, isPending: linksPending } = useReferenceLinks(record?.id);

  if (!record) return <ReferenceShowSkeleton />;

  const name = record.name_en || "";

  return (
    <div className="flex flex-col gap-4">
      <ReferenceHeader reference={record} />

      <Tabs defaultValue="conversations">
        {/* Intrinsic width, not `w-full`: the triggers carry `flex-1`, so a
            full-width list stretched 4 tabs to ~280px each and read as a nav
            bar. `justify-start` was dead against that `flex-1` anyway. */}
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="conversations" className={activeTabClassName}>
            {translate("crm.references.tabs.conversations", {
              _: "Conversations",
            })}
          </TabsTrigger>
          <TabsTrigger value="timeline" className={activeTabClassName}>
            {translate("crm.references.tabs.timeline", {
              _: "Timeline and notes",
            })}
          </TabsTrigger>
          <TabsTrigger value="reminders" className={activeTabClassName}>
            {translate("crm.references.tabs.reminders", { _: "Reminders" })}
          </TabsTrigger>
          <TabsTrigger value="assistant" className={activeTabClassName}>
            {translate("crm.references.tabs.assistant", { _: "Assistant" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="flex flex-col gap-4 pt-4">
          <RepeatRecognitionPanel
            referenceName={name}
            links={links}
            isPending={linksPending}
          />
          <ReferenceCallLog links={links} />
        </TabsContent>

        <TabsContent value="timeline" className="pt-4">
          <ReferenceTimeline referenceId={record.id} links={links} />
        </TabsContent>

        <TabsContent value="reminders" className="pt-4">
          <ReferenceTasks referenceId={record.id} />
        </TabsContent>

        <TabsContent value="assistant" className="pt-4">
          <ResearchAssistantPanel reference={record} links={links} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const ReferenceShowActions = () => (
  <TopToolbar>
    <EditButton />
    <ReferenceMergeButton />
  </TopToolbar>
);

export const ReferenceShow = () => (
  // `disableBreadcrumb`: the default breadcrumb renders "Home / References /
  // <name>", where "References" is a LINK to the reference list — a one-click
  // browse entry reached from inside the sanctioned in-shidduch path, which is
  // exactly what RULING 7 forbids. Suppressed on all three reference record
  // surfaces (show/edit/create).
  //
  // `redirectOnError={false}` + an explicit `error` element: `useShowController`
  // defaults `redirectOnError` to `"list"`, so a stale deep link
  // (`#/references/9999`, a record from a non-active context) NAVIGATED the
  // user into `#/references` — the one surface RULING 7 says is not a
  // destination. Now the URL stays put and `RecordUnavailable` renders, whose
  // own way out is `/` for a no-browse entity.
  <Show
    title={false}
    disableBreadcrumb
    actions={<ReferenceShowActions />}
    redirectOnError={false}
    error={<RecordUnavailable />}
  >
    <ReferenceShowLayout />
  </Show>
);
