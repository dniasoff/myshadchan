import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { ReminderCreateSheet } from "./ReminderCreateSheet";
import { ReminderList } from "./ReminderList";
import { useReminders } from "./useReminders";

/**
 * The reminders hub (foundation-plan screens 26-27): the follow-through layer
 * on top of the polymorphic `tasks` resource (AD-13, FR44-46). Two calm
 * groups — Overdue (honey, never red) and Upcoming — each reminder linked
 * back to the shidduch/reference/shadchan it's about, plus a single primary
 * CTA to add one via a bottom sheet.
 */
export const RemindersPage = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { isPending, isEmpty, overdue, upcoming, complete, snooze } =
    useReminders();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Follow-through
          </p>
          <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em]">
            Reminders
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex h-11 items-center gap-2 rounded-xl px-4
            font-semibold text-primary-foreground
            bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
            shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
            transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
            hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
            active:scale-[0.97]
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
            focus-visible:ring-offset-background outline-none"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          Add a reminder
        </button>
      </div>

      <ReminderList
        isPending={isPending}
        isEmpty={isEmpty}
        overdue={overdue}
        upcoming={upcoming}
        onComplete={(item) => complete(item.task)}
        onSnooze={(item) => snooze(item.task)}
      />

      <ReminderCreateSheet open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
};

RemindersPage.path = "/reminders";
