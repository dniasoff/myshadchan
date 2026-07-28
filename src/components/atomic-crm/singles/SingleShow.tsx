import { differenceInYears } from "date-fns";
import { useRecordContext } from "ra-core";
import { EditButton } from "@/components/admin/edit-button";
import { Show } from "@/components/admin/show";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { PipelineSnapshot } from "../dashboard/PipelineSnapshot";
import { EntityAvatar } from "../entity360/EntityAvatar";
import { TopToolbar } from "../layout/TopToolbar";
import type { Single } from "../types";

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
};

// 2.5 AC-8: SingleList/SingleShow keep archived singles reachable (the full
// family record), so the pill must read "Archived" rather than the generic
// non-active "Paused" — mirrors SingleCard.tsx's own STATUS_LABEL.
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

/** Format a YYYY-MM-DD date of birth as "9 Jul 2010" (timezone-safe). */
const formatDob = (dateString?: string | null): string | null => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  const date = new Date(year, month - 1, day);
  const age = differenceInYears(new Date(), date);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${formatted} (age ${age})`;
};

/** Exported for direct render coverage of the AC 5 EntityAvatar rewire
 * (`SingleProfileHeader.test.tsx`) — otherwise only reachable through the
 * full `ShowBase` record context. */
export const SingleProfileHeader = ({ single }: { single: Single }) => {
  const nameEn = [single.first_name_en, single.last_name_en]
    .filter(Boolean)
    .join(" ");
  const monogramSeed = nameEn || undefined;
  const dob = formatDob(single.dob);
  const isActive = single.status === "active";
  const statusLabel = STATUS_LABEL[single.status] ?? single.status;

  return (
    <Card className="shadow-sm">
      <CardContent className="flex flex-wrap items-start gap-4">
        <EntityAvatar
          seed={monogramSeed ?? String(single.id)}
          monogramSource={monogramSeed}
          className="h-14 w-14 rounded-2xl text-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Family roster
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {nameEn || `Single #${single.id}`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[GENDER_LABEL[single.gender ?? ""], single.community, dob]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
            !isActive && "bg-secondary text-muted-foreground",
          )}
          style={
            isActive
              ? {
                  color:
                    "color-mix(in oklch, var(--positive) var(--chip-text-mix), black)",
                  backgroundColor:
                    "color-mix(in oklch, var(--positive) 16%, transparent)",
                  boxShadow:
                    "inset 0 0 0 1px color-mix(in oklch, var(--positive) 28%, transparent)",
                }
              : undefined
          }
        >
          {isActive ? (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--positive)" }}
              aria-hidden="true"
            />
          ) : null}
          {statusLabel}
        </span>
      </CardContent>
    </Card>
  );
};

const SingleShowLayout = () => {
  const record = useRecordContext<Single>();
  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <SingleProfileHeader single={record} />
      <PipelineSnapshot singleId={record.id} />
    </div>
  );
};

const SingleShowActions = () => (
  <TopToolbar>
    <EditButton />
  </TopToolbar>
);

/**
 * The single profile (screen 32b): identity + status at a glance, and the
 * same "moment" pipeline-snapshot component the dashboard uses (reused, not
 * reimplemented) as the "open pipeline" affordance for this single.
 */
export const SingleShow = () => (
  <Show title={false} actions={<SingleShowActions />}>
    <SingleShowLayout />
  </Show>
);
