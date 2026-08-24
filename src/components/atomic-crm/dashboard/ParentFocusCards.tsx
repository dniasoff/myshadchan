import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { CircleCheck, Clock, MessageCircleQuestion, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ShidduchSummary } from "../types";
import {
  buildParentFocus,
  type ParentFocusItem,
  type ParentFocusKey,
} from "./parentFocus";

const ICONS: Record<ParentFocusKey, LucideIcon> = {
  needs_answer: MessageCircleQuestion,
  not_researched: Phone,
  waiting_a_while: Clock,
  moving_forward: CircleCheck,
};

/**
 * Only a number that is actually non-zero earns colour. At zero every card is
 * the same quiet neutral, so a settled dashboard reads as calm instead of as a
 * wall of warnings — the "relief, not alarm" voice AttentionSection is written
 * in (design-language §5.8).
 */
const TONE_TOKEN: Record<ParentFocusItem["tone"], string> = {
  action: "--st-new",
  attention: "--attention",
  progress: "--st-yes",
};

const FocusCard = ({
  item,
  pending,
}: {
  item: ParentFocusItem;
  pending: boolean;
}) => {
  const Icon = ICONS[item.key];
  const live = !pending && item.count > 0;
  const token = TONE_TOKEN[item.tone];

  return (
    <Card className={cn("gap-3 p-4 shadow-sm", pending && "animate-pulse")}>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          live ? "text-foreground" : "text-muted-foreground",
        )}
        style={
          live
            ? {
                backgroundColor: `color-mix(in oklch, var(${token}) 22%, transparent)`,
                boxShadow: `0 0 0 6px color-mix(in oklch, var(${token}) 8%, transparent)`,
              }
            : { backgroundColor: "var(--muted)" }
        }
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {item.label}
        </span>
        <span className="font-display text-2xl font-bold tabular-nums tracking-[-0.02em]">
          {item.count}
        </span>
        <span className="text-xs text-muted-foreground">{item.caption}</span>
      </span>
    </Card>
  );
};

export interface ParentFocusCardsProps {
  singleId: Identifier;
  /** Injected in tests so the staleness boundary is deterministic. */
  now?: Date;
}

/**
 * The four questions a parent actually opens this page to answer — see
 * `parentFocus.ts` for why these four and in this order.
 *
 * This replaces the platform metric strip that used to sit here (Story 15.2's
 * north-star and counter-metrics: cross-account leaks, mis-routed items,
 * duplicate false-positive rate, trial-to-paid conversion, AI cost per active
 * family). Those measure whether the PRODUCT is working and belong to whoever
 * runs it; they told a parent nothing about their own child's shidduchim, and
 * they were account-wide on a page that is otherwise entirely per-single. They
 * now render for administrators only (`Dashboard.tsx`).
 *
 * Reads the same `shidduchim` list `PipelineSnapshot` already fetches for this
 * single, so React Query serves both from one request — no second round trip,
 * and `nb_references` rides along on `shidduchim_summary` rather than costing a
 * per-row lookup.
 */
export const ParentFocusCards = ({ singleId, now }: ParentFocusCardsProps) => {
  const { data, isPending } = useGetList<ShidduchSummary>("shidduchim", {
    filter: { single_id: singleId },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "index", order: "ASC" },
  });

  // The loading state is the SAME row, pulsing, with zeros — not a set of
  // blank boxes with a guessed height. A skeleton whose height does not match
  // its content IS a layout shift: an earlier version used `h-[7.5rem]` and
  // moved the pipeline snapshot below it by 136px on a cold mobile load,
  // which e2e/dashboard-reminders-cls.spec.ts caught. Rendering the real
  // structure makes the heights identical by construction, so only the
  // numbers change when the data lands.
  const focus = buildParentFocus(
    isPending ? [] : (data ?? []),
    now ?? new Date(),
  );

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-busy={isPending || undefined}
    >
      {focus.map((item) => (
        <FocusCard key={item.key} item={item} pending={isPending} />
      ))}
    </div>
  );
};
