import { useState } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { Connection } from "../types";
import { RedtComposeDialog } from "./RedtComposeDialog";

/**
 * Story 8.5 (AC-4): the Connection 360's launch point for Story 8.3's
 * `RedtComposeDialog` — that story built only the dialog itself, deferring
 * WHERE it opens from to this story. Pre-binds `connectionId` to the
 * record's own id; disabled with an explanatory reason once the connection
 * has ended (AC-5) — a `title` attribute on the wrapping `<span>` rather
 * than a Radix tooltip on the disabled `<button>` itself, since a disabled
 * element does not reliably receive the hover/focus events a tooltip
 * trigger needs.
 *
 * Story 8.5 mounted this in `rightRail`, where a full-width button was the
 * right shape for a 320px column. It now renders in the `actions` region
 * (see `entityDescriptorRegions.tsx` for why), which is page-width — hence
 * `w-full sm:w-auto`: a comfortable full-width tap target on a phone, an
 * ordinary button from `sm:` up rather than one stretched across the page.
 */
export const ConnectionSendRedtAction = ({
  connection,
}: {
  connection: Connection;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const isEnded = connection.status === "ended";
  const disabledReason = translate("crm.connections.sendRedt.disabledReason", {
    _: "This connection has ended — a redt can no longer be sent through it.",
  });

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-start">
      <span
        className="inline-block w-full sm:w-auto"
        title={isEnded ? disabledReason : undefined}
      >
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={isEnded}
          onClick={() => setOpen(true)}
        >
          {translate("crm.connections.sendRedt.button", {
            _: "Send a redt",
          })}
        </Button>
      </span>
      {isEnded ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}
      <RedtComposeDialog
        connectionId={connection.id}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
};
