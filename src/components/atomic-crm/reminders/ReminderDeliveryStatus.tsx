import { useGetOne, useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";

import type { CronHeartbeat } from "../types";

/**
 * Story 12.2, AC-9: 2x the cron Worker's 15-minute sweep period
 * (`workers/cron/wrangler.toml`'s cron trigger) — a heartbeat older than
 * this is stale enough that the sweep is presumed paused, not merely
 * between ticks.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * PostgREST's `Accept: application/vnd.pgrst.object+json` header (what
 * `useGetOne` sends for a single-row read) answers a query matching ZERO
 * rows with `406 Not Acceptable` (`PGRST116`) — the honest "no heartbeat has
 * ever been written" case, not a transport failure. Duck-typed on `.status`
 * rather than importing an HttpError class, so this also matches whatever
 * shape a test's mocked dataProvider rejects with.
 */
const NO_ROW_STATUS = 406;

type DeliveryState =
  "not_set_up" | "sending" | "failing" | "paused" | "fetch_error";

/**
 * "no row" and "fetch failed" are deliberately distinct from each other and
 * from "stale" — a failed fetch is not evidence the sweep is healthy, and
 * must never be presented as "Sending" or silently folded into "Paused".
 *
 * Epic 12 review fix (R3): "sweep liveness" (last_ok_at fresh) and
 * "delivery health" (did the sweep's own emails actually go out) are now
 * two separate signals — `last_failed_count` is what
 * `record_cron_heartbeat()` records from `sweepReminders()`'s own
 * `result.failed`. A fresh `last_ok_at` alone used to be presented as
 * "Sending" even when EVERY email in the last tick failed (missing/invalid
 * Resend credentials being the concrete case that motivated this): the
 * sweep's own RPC calls all succeeded, so `last_ok_at` updated, but nothing
 * was actually delivered. "failing" is the new state that tells those two
 * apart — a fresh, non-stale heartbeat with a non-zero `last_failed_count`.
 */
const resolveDeliveryState = (
  data: CronHeartbeat | undefined,
  error: unknown,
): DeliveryState => {
  if (error) {
    const status = (error as { status?: number } | null | undefined)?.status;
    return status === NO_ROW_STATUS ? "not_set_up" : "fetch_error";
  }
  if (!data) return "not_set_up";
  if (!data.last_ok_at) return "paused";
  const staleness = Date.now() - new Date(data.last_ok_at).getTime();
  if (staleness > STALE_AFTER_MS) return "paused";
  return (data.last_failed_count ?? 0) > 0 ? "failing" : "sending";
};

/**
 * Story 12.2 (AC-9): the anti-recurrence control. A dead sweep and a healthy
 * one are otherwise indistinguishable from inside the app — this row is what
 * makes "not running" visible instead of silent. Lives in `reminders/` even
 * though it is mounted from `settings/PreferencesSection.tsx` (a reminders
 * concern rendered elsewhere; `settings/` already imports across folders).
 *
 * Reads `cron_heartbeat` as a single `getOne` — it is not a react-admin
 * resource, has no list/show/edit surface, and is never registered in
 * `root/routeManifest.ts`.
 */
export const ReminderDeliveryStatus = () => {
  const translate = useTranslate();
  const { data, error, isPending } = useGetOne<CronHeartbeat>(
    "cron_heartbeat",
    { id: "cron" },
    // `retry: false` is load-bearing, not a tidy-up. The empty-table case is
    // the NORMAL state until the cron Worker has run even once, and PostgREST
    // reports it as a 406 — which TanStack Query treats as a failed request
    // and retries with backoff. Until those retries are exhausted `isPending`
    // stays true and the row below renders NOTHING, so Settings sat blank for
    // 7-9 seconds on every load for every account. Caught by
    // `e2e/reminder-delivery-status.spec.ts`, which timed out at 5s waiting
    // for a row that was always going to arrive eventually. A 406 here is an
    // answer, not a failure; there is nothing to retry.
    { retry: false },
  );

  // While the first fetch is in flight there is nothing honest to report
  // yet — rendering a state here would risk a flash of "Not set up yet"
  // ahead of a real row. Mirrors CaptureSection's own "render nothing while
  // loading" convention.
  if (isPending) return null;

  const state = resolveDeliveryState(data, error);

  const STATE_LABEL: Record<
    DeliveryState,
    {
      text: string;
      variant: "default" | "secondary" | "outline" | "destructive";
    }
  > = {
    not_set_up: {
      text: translate("crm.reminders.deliveryStatus.notSetUp", {
        _: "Not set up yet",
      }),
      variant: "secondary",
    },
    sending: {
      text: translate("crm.reminders.deliveryStatus.sending", {
        _: "Sending",
      }),
      variant: "default",
    },
    failing: {
      text: translate("crm.reminders.deliveryStatus.failing", {
        _: "Delivery failing",
      }),
      variant: "destructive",
    },
    paused: {
      text: translate("crm.reminders.deliveryStatus.paused", {
        _: "Paused",
      }),
      variant: "outline",
    },
    fetch_error: {
      text: translate("crm.reminders.deliveryStatus.fetchError", {
        _: "Couldn't check",
      }),
      variant: "destructive",
    },
  };

  const { text, variant } = STATE_LABEL[state];

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle className="font-normal text-muted-foreground">
          {translate("crm.reminders.deliveryStatus.label", {
            _: "Reminder emails",
          })}
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <Badge variant={variant}>{text}</Badge>
      </ItemActions>
    </Item>
  );
};
