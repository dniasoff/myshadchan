import "./entityDescriptor";

import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
import type { Connection } from "../types";
import { ConnectionList } from "./ConnectionList";

/**
 * Story 8.5 — the AD-24 route table for `connections` (contract §5 rule 4),
 * following the exact shape `shadchanim/index.ts` / `references/index.ts`
 * established: `list` is `buildEntityRoutes`'s return value (a real routed
 * `Show`, `EntityShow` — no per-entity `ConnectionShow.tsx` wrapper, since
 * every migrated entity's `Show` slot is `EntityShow` directly and a thin
 * re-export of it would be exactly the bespoke layout code AD-24 forbids),
 * with explicit `hasShow: true` — `Resource.registerResource` computes
 * `hasShow: !!show || !!hasShow` (`ra-core/dist/core/Resource.js:32-34`), so
 * omitting it would leave every `<DataTable>`/`RecordLink` row unclickable.
 *
 * No `Edit`, no `hasEdit`, no `children`/`buildCreateRoutes`: a connection
 * has no edit form and no create form (Story 8.2's consent workflow —
 * `accept_connection_invite()` — is the only writer; there is no client
 * INSERT/UPDATE grant on `connections` at all, 06_grants.sql).
 */
export default {
  list: buildEntityRoutes({
    List: ConnectionList,
    Show: EntityShow,
  }),
  hasShow: true,
  recordRepresentation: (record: Connection) => record.household_account_name,
};
