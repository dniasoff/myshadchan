import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";

import type { CrmDataProvider } from "../providers/types";

export type DemoDeliveryEvent = {
  event_type: "message" | "reminder" | "share";
  status: string;
  simulated: boolean;
  occurred_at: string;
  resource: string;
};

const EVENT_LABELS: Record<DemoDeliveryEvent["event_type"], string> = {
  message: "Message",
  reminder: "Reminder",
  share: "Share",
};

/**
 * The database function is deliberately the only source for this surface. It
 * returns event type/status/time/resource, never recipient addresses, message
 * bodies, provider errors, IPs, tokens, or storage paths.
 */
export const DemoDeliveryHistory = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data, isPending } = useQuery({
    queryKey: ["demoDeliveryHistory"],
    queryFn: () =>
      dataProvider.rpc?.("demo_delivery_history", {}) as Promise<
        DemoDeliveryEvent[]
      >,
    retry: false,
  });

  if (isPending || !data || data.length === 0) return null;

  return (
    <Item size="sm" className="items-start">
      <ItemContent className="gap-2">
        <ItemTitle className="font-normal text-muted-foreground">
          {translate("crm.reminders.demoHistory.title", {
            _: "Recent delivery activity",
          })}
        </ItemTitle>
        <div className="space-y-1 text-sm">
          {data.slice(0, 5).map((event, index) => (
            <div
              className="flex items-center justify-between gap-3"
              key={`${event.occurred_at}-${event.event_type}-${index}`}
            >
              <span>
                {EVENT_LABELS[event.event_type] ?? "Delivery"} · {event.status}
              </span>
              {event.simulated && (
                <Badge variant="outline" className="text-xs font-normal">
                  {translate("crm.reminders.demoHistory.simulated", {
                    _: "Simulated",
                  })}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </ItemContent>
    </Item>
  );
};
