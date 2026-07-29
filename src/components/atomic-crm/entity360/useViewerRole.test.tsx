import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MyContext } from "../types";
import { useViewerRole } from "./useViewerRole";

/**
 * Story 3.4 AC 3. Harness matches `layout/ContextSwitcher.test.tsx:59-87` —
 * `TestMemoryRouter` + `CoreAdminContext` + a `QueryClient` seeded on
 * `MY_CONTEXTS_QUERY_KEY`, the same `["myContexts"]` cache `useMyContexts`
 * itself reads. `getMyContexts` is always a genuine mock resolving/rejecting
 * on its own — react-query's default `refetchOnMount` calls it in the
 * background even when the cache is pre-seeded (`ContextSwitcher.test.tsx`
 * review finding #2).
 */

function ViewerRoleProbe() {
  const { role, isPending } = useViewerRole();
  return (
    <span>
      role:{String(role)} isPending:{String(isPending)}
    </span>
  );
}

const household: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const shadchanus: MyContext = {
  account_id: 2,
  kind: "shadchanus",
  name: "My Account",
  role: "shadchan",
  is_active: false,
};

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyContexts: vi.fn().mockResolvedValue([]),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderProbe = async (
  queryClient: QueryClient,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ViewerRoleProbe />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("useViewerRole — the active context's role, one login with two memberships", () => {
  it("resolves the household's parent_admin when it is the active context", async () => {
    // Arrange
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [household, shadchanus]);

    // Act
    const screen = await renderProbe(queryClient, {
      getMyContexts: vi.fn().mockResolvedValue([household, shadchanus]),
    });

    // Assert
    await expect
      .element(screen.getByText("role:parent_admin isPending:false"))
      .toBeInTheDocument();
  });

  it("resolves shadchan for the SAME login once switchActiveContext()/invalidateQueries() flip which row is_active", async () => {
    // Arrange — the two flags swapped, exactly what a context switch
    // produces (`layout/ContextSwitcher.tsx:94-98`): a hook that read a
    // per-login signal instead of the active context would return the same
    // value here as the test above and fail.
    const queryClient = new QueryClient();
    const switchedHousehold: MyContext = { ...household, is_active: false };
    const switchedShadchanus: MyContext = { ...shadchanus, is_active: true };
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      switchedHousehold,
      switchedShadchanus,
    ]);

    // Act
    const screen = await renderProbe(queryClient, {
      getMyContexts: vi
        .fn()
        .mockResolvedValue([switchedHousehold, switchedShadchanus]),
    });

    // Assert
    await expect
      .element(screen.getByText("role:shadchan isPending:false"))
      .toBeInTheDocument();
  });
});

describe("useViewerRole — no active membership (revoked-membership case)", () => {
  it("returns role: undefined, isPending: false when no row is is_active", async () => {
    // Arrange — current_context_id() is NULL server-side; my_contexts()
    // returns rows, but none is_active.
    const inactiveOnly: MyContext = { ...household, is_active: false };
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [inactiveOnly]);

    // Act
    const screen = await renderProbe(queryClient, {
      getMyContexts: vi.fn().mockResolvedValue([inactiveOnly]),
    });

    // Assert
    await expect
      .element(screen.getByText("role:undefined isPending:false"))
      .toBeInTheDocument();
  });
});

describe("useViewerRole — the query is in flight", () => {
  it("returns role: undefined, isPending: true", async () => {
    // Arrange — a query that never settles, and no seeded cache.
    const queryClient = new QueryClient();

    // Act
    const screen = await renderProbe(queryClient, {
      getMyContexts: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    // Assert
    await expect
      .element(screen.getByText("role:undefined isPending:true"))
      .toBeInTheDocument();
  });
});

describe("useViewerRole — the query rejects", () => {
  it("returns role: undefined, isPending: false, and does not throw", async () => {
    // Arrange — retry disabled so the query settles to its error state
    // promptly instead of retrying for real time.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Act
    const screen = await renderProbe(queryClient, {
      getMyContexts: vi.fn().mockRejectedValue(new Error("network error")),
    });

    // Assert
    await expect
      .element(screen.getByText("role:undefined isPending:false"))
      .toBeInTheDocument();
  });
});
