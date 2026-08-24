import { Clock9 } from "lucide-react";
import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { RecordLink } from "../entity360/RecordLink";
import { formatDueMoment } from "../misc/formatDueMoment";
import { TaskAssigneeChip } from "../tasks/TaskAssigneeChip";
import { useTaskAssignees } from "../tasks/useTaskAssignees";
import type { ContextMember } from "../types";
import type { DueReminderRow } from "./useDueReminders";
import { MAX_ROWS, useDueReminders } from "./useDueReminders";

/**
 * The dashboard's "Due now" card (Story 12.1, gap D1): an account-wide,
 * read-only glance at open reminders, mounted once and shared by
 * `Dashboard.tsx` (desktop) and `MobileDashboard.tsx` (mobile) — AC-1.
 *
 * Read-only by construction (AC-3, Ruling 2's shape for a rail/card summary
 * — `/reminders` stays the canonical place a reminder is acted on): no
 * checkbox, no Snooze, no "Add a reminder". The only navigation affordance
 * is the plain "See all reminders" link, exactly like `TasksRailSummary`'s
 * own tab link (`entity360/tabs/TasksRailSummary.tsx:149-154`) — navigation,
 * not a record mention, so it is a bare `<Link>`, never `RecordLink`.
 *
 * The list region below is a FIXED height, sized for `MAX_ROWS` rows
 * (AC-2): the skeleton, the rows, and the empty message all render inside
 * it, so the card measures identically whether it is loading, empty, or
 * full — the dashboard has a measured 0.122 CLS regression in its history
 * (`layout/DemoBanner.tsx:37-61`) and this card must not reproduce it. The
 * card never returns `null`.
 */

/** `h-72` (18rem / 288px) — not a computed/arbitrary value: three rows'
 * worth of label + text + due line + assignee chip, plus the overflow
 * line, comfortably fit with `overflow-hidden` as a hard backstop, and a
 * plain Tailwind scale step keeps this file's height budget legible
 * without an arbitrary-bracket value the tailwind-arbitrary-var guard has
 * to reason about (`scripts/check-tailwind-arbitrary-var.mjs`). */
const LIST_REGION_HEIGHT_CLASS = "h-72";

function DueReminderRowSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: MAX_ROWS }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

interface DueReminderRowViewProps {
  row: DueReminderRow;
  assigneesById: Map<Identifier, ContextMember>;
  isMultiMember: boolean;
}

function DueReminderRowView({
  row,
  assigneesById,
  isMultiMember,
}: DueReminderRowViewProps) {
  const translate = useTranslate();

  const labelText = row.primaryLabel ? (
    <>
      <span className="min-w-0 truncate">{row.primaryLabel}</span>
      {row.contextLabel ? (
        <span className="text-muted-foreground">
          {" · "}
          {translate("crm.reminders.dueCard.about", { _: "about" })}{" "}
          {row.contextLabel}
        </span>
      ) : null}
    </>
  ) : null;

  return (
    <li className="py-2">
      <div className="min-w-0">
        {labelText ? (
          row.link ? (
            <RecordLink
              resource={row.link.resource}
              id={row.link.id}
              className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-0.5 text-xs
                font-semibold text-primary outline-none transition-colors duration-[160ms]
                hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-background"
            >
              {labelText}
            </RecordLink>
          ) : (
            <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-0.5 text-xs font-semibold text-muted-foreground">
              {labelText}
            </span>
          )
        ) : null}

        <p className="mt-0.5 truncate text-sm leading-snug">{row.text}</p>

        {row.dueDate ? (
          <p
            className={cn(
              "mt-1 text-xs tabular-nums",
              row.isOverdue
                ? "text-attention-foreground"
                : "text-muted-foreground",
            )}
          >
            {row.isOverdue
              ? translate("crm.reminders.dueCard.since", {
                  when: formatDueMoment(row.dueDate),
                  _: "Since %{when}",
                })
              : translate("crm.reminders.dueCard.due", {
                  when: formatDueMoment(row.dueDate),
                  _: "Due %{when}",
                })}
          </p>
        ) : null}

        <div className="mt-1">
          <TaskAssigneeChip
            memberId={row.memberId}
            assigneesById={assigneesById}
            isMultiMember={isMultiMember}
          />
        </div>
      </div>
    </li>
  );
}

export const DueRemindersCard = () => {
  const translate = useTranslate();
  const { isPending, rows, totalCount } = useDueReminders();
  const { assigneesById, isMultiMember } = useTaskAssignees();

  const overflow = totalCount - rows.length;

  return (
    <Card
      data-role="due-reminders-card"
      className="flex flex-col gap-3 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full
            bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-primary"
          aria-hidden="true"
        >
          <Clock9 className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">
            {translate("crm.reminders.dueCard.title", { _: "Due now" })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {translate("crm.reminders.dueCard.subtitle", {
              _: "What's due across your family, soonest first.",
            })}
          </p>
        </div>
      </div>

      <div
        data-role="due-reminders-list"
        className={cn(LIST_REGION_HEIGHT_CLASS, "overflow-hidden")}
      >
        {isPending ? (
          <DueReminderRowSkeleton />
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              {translate("crm.reminders.dueCard.empty", {
                _: "Nothing due.",
              })}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((row) => (
              <DueReminderRowView
                key={String(row.id)}
                row={row}
                assigneesById={assigneesById}
                isMultiMember={isMultiMember}
              />
            ))}
            {overflow > 0 ? (
              <li className="pt-2 text-xs text-muted-foreground">
                {translate("crm.reminders.dueCard.overflow", {
                  smart_count: overflow,
                  _: "and %{smart_count} more",
                })}
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <Link to="/reminders" className="text-sm underline">
        {translate("crm.reminders.dueCard.seeAll", { _: "See all reminders" })}
      </Link>
    </Card>
  );
};
