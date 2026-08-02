import { useTranslate } from "ra-core";

import { EmptyState } from "../misc/EmptyState";

/**
 * Story 8.1 (AC-4): `/connections` must render a real screen from day one —
 * `root/routeManifest.ts`'s `findManifestViolations` fails on a nav target
 * that resolves to no route ("unreachable-nav-target"), so `SHADCHANUS_NAV`
 * having a `/connections` entry requires this file to exist before Story
 * 8.2's invite/accept workflow or Story 8.5's real Connections list/360 do.
 *
 * No data fetching, no `connections`/`connection_invites` query — this
 * screen is pure copy explaining the release boundary, not a stub that
 * queries a table Story 8.2 hasn't built an RPC for yet. Story 8.5 replaces
 * this file's `root/routeManifest.ts` registration with the real
 * descriptor-based resource; this component is not imported by anything
 * else, so it can be deleted outright at that point.
 */
export const ConnectionsPlaceholder = () => {
  const translate = useTranslate();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.shadchanus_context.eyebrow", { _: "Shadchanus" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em]">
          {translate("crm.navigation.connections", { _: "Connections" })}
        </h1>
      </div>
      <EmptyState
        title={translate("crm.connections_placeholder.empty_title", {
          _: "Connections are coming soon",
        })}
        description={translate(
          "crm.connections_placeholder.empty_description",
          {
            _: "This release lays the groundwork — inviting and connecting with a family arrives in a future update.",
          },
        )}
      />
    </div>
  );
};

ConnectionsPlaceholder.path = "/connections";
