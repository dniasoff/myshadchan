import type { RaRecord } from "ra-core";
import { useTranslate } from "ra-core";

import { EntityList } from "../misc/EntityList";
import type { Connection } from "../types";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionRow } from "./ConnectionRow";

const ConnectionCardGridSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div
        key={index}
        className="h-[76px] animate-pulse rounded-2xl bg-muted"
      />
    ))}
  </div>
);

const ConnectionCardGrid = ({ data }: { data: RaRecord[] }) => {
  const connections = data as Connection[];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {connections.map((connection, index) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          index={index}
        />
      ))}
    </div>
  );
};

const ConnectionRowList = ({ data }: { data: RaRecord[] }) => {
  const connections = data as Connection[];
  return (
    <div className="flex flex-col gap-2">
      {connections.map((connection, index) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          index={index}
        />
      ))}
    </div>
  );
};

/**
 * The Connections list (Story 8.5, AC-1): a real `EntityList`-driven
 * roster — search, the List/Cards toggle, URL-held state, empty/loading/
 * error — no hand-rolled list component. No `createTo`/`createLabel`: a
 * connection is never created through a form (Story 8.2's consent workflow
 * is the only writer), so this list offers no "Add" affordance, unlike
 * `shadchanim`/`references`.
 */
export const ConnectionList = () => {
  const translate = useTranslate();

  return (
    <EntityList
      resource="connections"
      eyebrow={translate("crm.connections.list.eyebrow", {
        _: "Shadchanus",
      })}
      subtitle={translate("crm.connections.list.subtitle", {
        _: "Every family you're connected with, in one place.",
      })}
      searchPlaceholder={translate("crm.connections.list.searchPlaceholder", {
        _: "Search by family name",
      })}
      perPage={200}
      pagination={null}
      sort={{ field: "created_at", order: "DESC" }}
      sortFields={["household_account_name", "created_at"]}
      skeleton={<ConnectionCardGridSkeleton />}
      emptyState={{
        title: translate("crm.connections.list.emptyTitle", {
          _: "No connections yet",
        }),
        description: translate("crm.connections.list.emptyDescription", {
          _: "Once a family connects with you, they'll appear here — send them an invite from Settings to get started.",
        }),
      }}
      noMatchesMessage={translate("crm.connections.list.noMatches", {
        _: "No connections match this search.",
      })}
      defaultViewMode="cards"
      renderCards={(data) => <ConnectionCardGrid data={data} />}
      renderList={(data) => <ConnectionRowList data={data} />}
    />
  );
};
