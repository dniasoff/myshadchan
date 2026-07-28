import { createElement, type ComponentType, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, useGetOne } from "ra-core";
import type { RaRecord } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import type { CrmDataProvider } from "../providers/types";
import type { ShadchanStats } from "../types";
import type {
  EntityDescriptor,
  EntityRelationshipDescriptor,
  EntityTabDescriptor,
} from "./entityDescriptor";

/**
 * AC 2's proof that a region is a component boundary, not a data shape: a
 * `shadchan_stats`-shaped fixture (NOT `singles`, whose summary view carries
 * its counts inline and would pass even under the deleted
 * `(record) => stats[]` shape — contract §2 rule 1). Built with
 * `createElement` rather than JSX so this file can stay `.ts`, matching
 * `root/routeManifest.test.ts`'s precedent.
 */
const FixtureStatBand: ComponentType<{ record: RaRecord }> = ({ record }) => {
  const { data, isPending } = useGetOne<ShadchanStats>("shadchan_stats", {
    id: record.id,
  });
  if (isPending) {
    return createElement("div", null, "Loading stats...");
  }
  return createElement("div", null, `Suggestions: ${data?.nb_suggestions}`);
};

describe("EntityDescriptor — AC 1 negative fixtures (@ts-expect-error)", () => {
  it("rejects a descriptor literal missing the entity-level label", () => {
    // @ts-expect-error — label is REQUIRED (AC 1a)
    const descriptor: EntityDescriptor = {
      name: "fixture-missing-label",
      buildRecordPath: (id) => `/fixture/${id}`,
    };
    expect(descriptor).toBeDefined();
  });

  it("rejects a statBand typed as (record) => ReactNode instead of a ComponentType", () => {
    // Arrange — the deleted shape: a plain function taking the RECORD
    // itself, not a component taking `{ record }` as its props.
    const badStatBand: (record: RaRecord) => ReactNode = (record) =>
      createElement("div", null, String(record.id));

    const descriptor: EntityDescriptor = {
      name: "fixture-bad-statband",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
      // @ts-expect-error — statBand must be ComponentType<{record}>, not (record) => ReactNode (AC 1b)
      statBand: badStatBand,
    };
    expect(descriptor).toBeDefined();
  });

  it("rejects an excess `stats` property — deleted; `statBand` replaces it", () => {
    const descriptor: EntityDescriptor = {
      name: "fixture-stats-excess",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
      // @ts-expect-error — `stats` was deleted (AC 1c)
      stats: [],
    };
    expect(descriptor).toBeDefined();
  });

  it("rejects a tab with a free-string key not in the closed TabKey union", () => {
    const tabs: EntityTabDescriptor[] = [
      {
        // @ts-expect-error — "not-a-tab" is not a TabKey (AC 1d)
        key: "not-a-tab",
        render: () => null,
      },
    ];
    expect(tabs).toBeDefined();
  });

  it("rejects a tab with an excess `minVisibility` property — the field is `visibleTo`, an allow-list", () => {
    const tabs: EntityTabDescriptor[] = [
      {
        key: "overview",
        render: () => null,
        // @ts-expect-error — no `minVisibility`; use `visibleTo` (AC 1e)
        minVisibility: ["self_manager"],
      },
    ];
    expect(tabs).toBeDefined();
  });

  it("rejects a tab render that takes an argument — render is lazy, arity zero", () => {
    const tabs: EntityTabDescriptor[] = [
      {
        key: "overview",
        // @ts-expect-error — render takes no argument (AC 1f)
        render: (record: RaRecord) => record.id,
      },
    ];
    expect(tabs).toBeDefined();
  });
});

describe("EntityDescriptor — AC 1 positive fixtures (must compile clean)", () => {
  it("accepts a descriptor carrying only the three required fields", () => {
    const descriptor: EntityDescriptor = {
      name: "fixture-minimal",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
    };
    expect(descriptor.name).toBe("fixture-minimal");
  });

  it("accepts a tab literal carrying no label — the normal case under the owner's ruling", () => {
    const tab: EntityTabDescriptor = { key: "overview", render: () => null };
    expect(tab.label).toBeUndefined();
  });

  it("accepts 3.9's stub shape: empty tabs plus a full pendingTabs", () => {
    const descriptor: EntityDescriptor = {
      name: "fixture-stub",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
      tabs: [],
      pendingTabs: ["overview", "notes"],
    };
    expect(descriptor.pendingTabs).toEqual(["overview", "notes"]);
  });
});

describe("EntityRelationshipDescriptor — AC 6 worked examples", () => {
  it("reference -> shidduchim (many-to-many, through the reference_links_summary view)", () => {
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: "reference_links_summary",
      getFilter: (r: RaRecord) => ({ reference_id: r.id }),
      linkResource: "shidduchim",
      linkId: (row) => row.shidduchim_id,
    };
    expect(relationship.linkResource).toBe("shidduchim");
  });

  it("single -> shidduchim (plain FK; resource IS the link target)", () => {
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: "shidduchim",
      getFilter: (r: RaRecord) => ({ single_id: r.id }),
    };
    expect(relationship.getFilter({ id: 3 } as RaRecord)).toEqual({
      single_id: 3,
    });
  });

  it("shadchan -> shidduchim (plain FK; column is shadchan_id, as ShadchanSuggestions already queries it)", () => {
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: "shidduchim",
      getFilter: (r: RaRecord) => ({ shadchan_id: r.id }),
    };
    expect(relationship.getFilter({ id: 7 } as RaRecord)).toEqual({
      shadchan_id: 7,
    });
  });
});

describe("EntityDescriptor region renderers — AC 2 (component boundary, proven by a hook)", () => {
  it("a statBand ComponentType may call useGetOne, rendering its pending state and then its resolved values", async () => {
    // Arrange — a shadchan_stats-shaped fixture, per AC 2's own instruction.
    const stats: ShadchanStats = {
      id: 9,
      account_id: 1,
      nb_suggestions: 4,
      nb_progressed: 2,
      nb_reached_yes: 1,
    };
    let resolveGetOne: (value: { data: ShadchanStats }) => void = () => {};
    const getOnePromise = new Promise<{ data: ShadchanStats }>((resolve) => {
      resolveGetOne = resolve;
    });
    const dataProvider = {
      getOne: vi.fn().mockReturnValue(getOnePromise),
    } as unknown as CrmDataProvider;
    const record: RaRecord = { id: 9 };

    const descriptor: EntityDescriptor = {
      name: "fixture-hook-statband",
      buildRecordPath: (id) => `/fixture/${id}`,
      label: "Fixture",
      statBand: FixtureStatBand,
    };
    const StatBand = descriptor.statBand!;

    // Act
    const screen = await render(
      createElement(
        CoreAdminContext,
        { dataProvider, queryClient: new QueryClient() },
        createElement(StatBand, { record }),
      ),
    );

    // Assert — pending state renders first.
    await expect
      .element(screen.getByText("Loading stats..."))
      .toBeInTheDocument();

    // Act — resolve the query.
    resolveGetOne({ data: stats });

    // Assert — resolved values render.
    await expect
      .element(screen.getByText("Suggestions: 4"))
      .toBeInTheDocument();
  });
});
