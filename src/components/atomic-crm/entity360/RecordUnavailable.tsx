import type { ReactElement } from "react";
import { useResourceContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { buildBrowseFallbackPath } from "./entityPaths";
import { getEntityDescriptor } from "./registry";

/**
 * AC 2 — the explicit handled state `buildEntityRoutes` passes as
 * `ShowBase`'s `error` element. Passing a defined `error` element is itself
 * what sets `useShowController`'s `redirectOnError` to `false`
 * (`ra-core/dist/controller/show/ShowBase.js:35-40`), so a fetch error (a
 * pasted link to a record from a non-active context, AD-19) lands here
 * instead of silently redirecting to the list — `location.pathname` stays
 * exactly where the deep link pointed.
 *
 * The way out is `buildBrowseFallbackPath`, not `buildListPath`: for a
 * no-browse entity (`descriptor.browsable === false` — RULING 7's
 * `references`) "back to the list" was an offer to browse a surface the
 * owner closed, reached from the one screen a stale deep link is guaranteed
 * to land on. Those entities get the dashboard instead, with a label that
 * says so.
 */
export function RecordUnavailable(): ReactElement {
  const resource = useResourceContext();
  const translate = useTranslate();

  if (!resource) {
    throw new Error(
      "RecordUnavailable must be rendered within a ResourceContextProvider",
    );
  }

  const isBrowsable = getEntityDescriptor(resource)?.browsable !== false;

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground"
    >
      <p>
        {translate("crm.entity360.record_unavailable", {
          _: "This record is unavailable.",
        })}
      </p>
      <Link
        to={buildBrowseFallbackPath(resource)}
        className="font-medium text-foreground underline underline-offset-4"
      >
        {isBrowsable
          ? translate("crm.entity360.record_unavailable_link", {
              _: "Back to the list",
            })
          : translate("crm.entity360.record_unavailable_home_link", {
              _: "Back to the dashboard",
            })}
      </Link>
    </div>
  );
}
