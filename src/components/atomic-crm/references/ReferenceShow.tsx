import { useRecordContext, useTranslate } from "ra-core";
import { Show } from "@/components/admin/show";
import { EditButton } from "@/components/admin/edit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/**
 * The reference detail page (§5b) — the thing the imported design never had.
 *
 * In the canvas a reference existed only inside one shidduch's tab, from a
 * hard-coded array, with no id you could route to. Here a reference is a real
 * record with its own page: header, timeline, notes, reminders, its call log per
 * single, and the cross-shidduch history that makes the book worth keeping.
 */

const ReferenceHeader = ({ reference }: { reference: Reference }) => {
  const translate = useTranslate();
  const { links } = useReferenceLinks(reference.id);
  const progress = summarizeCallProgress(links);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">
            {reference.name_en || reference.name_he}
          </h2>
          {reference.name_en && reference.name_he ? (
            <p className="text-base text-muted-foreground">
              {reference.name_he}
            </p>
          ) : null}
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

        <div className="text-end">
          <p className="text-sm font-medium tabular-nums">
            {translate("crm.references.header.progress", {
              contacted: progress.contacted,
              total: progress.total,
              _: "%{contacted} of %{total} conversations done",
            })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

const ReferenceShowLayout = () => {
  const record = useRecordContext<Reference>();
  const translate = useTranslate();
  const { links } = useReferenceLinks(record?.id);

  if (!record) return null;

  const name = record.name_en || record.name_he || "";

  return (
    <div className="flex flex-col gap-4">
      <ReferenceHeader reference={record} />

      <Tabs defaultValue="conversations">
        <TabsList className="flex-wrap">
          <TabsTrigger value="conversations">
            {translate("crm.references.tabs.conversations", {
              _: "Conversations",
            })}
          </TabsTrigger>
          <TabsTrigger value="timeline">
            {translate("crm.references.tabs.timeline", {
              _: "Timeline and notes",
            })}
          </TabsTrigger>
          <TabsTrigger value="reminders">
            {translate("crm.references.tabs.reminders", { _: "Reminders" })}
          </TabsTrigger>
          <TabsTrigger value="assistant">
            {translate("crm.references.tabs.assistant", { _: "Assistant" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="flex flex-col gap-4 pt-4">
          <RepeatRecognitionPanel referenceName={name} links={links} />
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
  <Show title={false} actions={<ReferenceShowActions />}>
    <ReferenceShowLayout />
  </Show>
);
