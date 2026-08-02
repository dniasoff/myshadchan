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
    <div className="flex flex-col gap-1.5">
      <span
        className="inline-block w-full"
        title={isEnded ? disabledReason : undefined}
      >
        <Button
          type="button"
          className="w-full"
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
