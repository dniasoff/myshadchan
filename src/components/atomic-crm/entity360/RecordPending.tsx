import type { ReactElement } from "react";
import { useTranslate } from "ra-core";

/**
 * AC 2 — the explicit pending state `buildEntityRoutes` passes as
 * `ShowBase`'s `loading` element. Without it `ShowBase` renders its children
 * (i.e. `Show`, normally `EntityShow`) even while the record is still
 * undefined, which would read as an empty page rather than "still loading."
 */
export function RecordPending(): ReactElement {
  const translate = useTranslate();

  return (
    <div
      role="status"
      className="flex items-center justify-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground"
    >
      {translate("crm.entity360.record_pending", { _: "Loading…" })}
    </div>
  );
}
