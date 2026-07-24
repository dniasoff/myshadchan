import { differenceInYears } from "date-fns";
import { useRecordContext } from "ra-core";
import { EditButton } from "@/components/admin/edit-button";
import { Show } from "@/components/admin/show";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { PipelineSnapshot } from "../dashboard/PipelineSnapshot";
import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import { TopToolbar } from "../layout/TopToolbar";
import type { Child } from "../types";
import { ChildPortalShare } from "./ChildPortalShare";

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
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

const ChildProfileHeader = ({ child }: { child: Child }) => {
  const nameEn = [child.first_name_en, child.last_name_en]
    .filter(Boolean)
    .join(" ");
  const monogramSeed = nameEn || undefined;
  const monogram = getMonogram(monogramSeed);
  const avatarIndex = getAvatarIndex(monogramSeed ?? String(child.id));
  const dob = formatDob(child.dob);
  const isActive = child.status === "active";

  return (
    <Card className="shadow-sm">
      <CardContent className="flex flex-wrap items-start gap-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-bold"
          style={{
            backgroundColor: `var(--avatar-${avatarIndex})`,
            color: "var(--avatar-ink)",
          }}
          aria-hidden="true"
        >
          {monogram}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Family roster
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {nameEn || `Child #${child.id}`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[GENDER_LABEL[child.gender ?? ""], child.community, dob]
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
          {isActive ? "Active" : "Paused"}
        </span>
      </CardContent>
    </Card>
  );
};

const ChildShowLayout = () => {
  const record = useRecordContext<Child>();
  if (!record) return null;

  const childName =
    record.first_name_en?.trim() || record.first_name_he?.trim() || null;

  return (
    <div className="flex flex-col gap-4">
      <ChildProfileHeader child={record} />
      <PipelineSnapshot childId={record.id} />
      <ChildPortalShare childId={record.id} childName={childName} />
    </div>
  );
};

const ChildShowActions = () => (
  <TopToolbar>
    <EditButton />
  </TopToolbar>
);

/**
 * The child profile (screen 32b): identity + status at a glance, and the
 * same "moment" pipeline-snapshot component the dashboard uses (reused, not
 * reimplemented) as the "open pipeline" affordance for this child.
 */
export const ChildShow = () => (
  <Show title={false} actions={<ChildShowActions />}>
    <ChildShowLayout />
  </Show>
);
