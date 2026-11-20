import { BellRing } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

import { buildTabPath } from "../entity360/entityPaths";
import type { Shadchan } from "../types";

export const ShadchanReminderAction = ({
  shadchan,
  count,
}: {
  shadchan: Pick<Shadchan, "id" | "name">;
  count: number;
}) => {
  const translate = useTranslate();
  const label = translate("crm.shadchanim.reminders.marker", {
    smart_count: count,
    _: count === 1 ? "1 reminder" : "%{smart_count} reminders",
  });

  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
      title={label}
    >
      <Link
        to={buildTabPath("shadchanim", shadchan.id, "tasks")}
        aria-label={label}
      >
        <BellRing aria-hidden="true" className="size-4" />
        <span className="sr-only">{label}</span>
      </Link>
    </Button>
  );
};
