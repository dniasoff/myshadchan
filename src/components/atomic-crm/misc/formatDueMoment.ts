import { format } from "date-fns";

/**
 * The one rendering of a task's `due_date` across the app: "24 Jul, 2:00 PM".
 *
 * It exists because the same field used to read two different ways — the
 * reminders hub said `24 Jul, 2:00 PM` while the task list said
 * `7/24/2026, 2:00:00 PM` (a raw `<DateField showDate showTime/>`), so one
 * task looked like two facts depending on which screen you were on.
 *
 * Scope, stated precisely because the tree has three date shapes and this is
 * only one of them: this formats *due dates*, which are near-term, so it
 * drops the year and uses 12-hour time. It is NOT the general timestamp
 * formatter — `entity360/tabs/interactionLabels.ts#formatTimelineDate`
 * renders historical `created_at` values as "d MMM yyyy, HH:mm" (year, 24-
 * hour), and `shidduchim/boardUtils.ts#formatRedtDate` renders a date-only
 * redt as "d MMM yyyy". Converging the three is deliberately out of this
 * round's scope; see `epics.md` → Unowned work.
 */
export const formatDueMoment = (dateString: string): string =>
  format(new Date(dateString), "d MMM, h:mm a");
