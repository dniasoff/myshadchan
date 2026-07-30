import { differenceInYears } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { EntityAvatar } from "../entity360/EntityAvatar";
import type { Single } from "../types";
import { GENDER_LABEL, STATUS_LABEL } from "./singleLabels";

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

/**
 * The single's identity card (screen 32b) — relocated here verbatim from
 * the entity's now-deleted routed record page (Story 5.8 AC 9). Exported
 * for direct render coverage of the AC 5 (Story 3.1) `EntityAvatar` rewire
 * (`SingleProfileHeader.test.tsx`) — otherwise only reachable through the
 * full `ShowBase` record context. Wrapped by `singles/entityDescriptor.tsx`'s
 * `SingleIdentityHeader` adapter to fit the descriptor's `identityHeader:
 * ComponentType<{ record: T }>` shape.
 */
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
