import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { MyContext } from "../types";
import {
  useSingleListingShapeHint,
  useSingleListingShapeHintWarmer,
  type SingleListingShapeHint,
} from "./singleListingShapeHint";

/**
 * CLS fix (Epic 9 layout-shift regression — see this module's own header
 * comment). `SHAPE_HINT_KEY` is private to the module; tests target it by
 * the same literal string `settings/SingleListingSection.test.tsx` and
 * `layout/DemoBanner.test.tsx` use for their own hint keys.
 */
const SHAPE_HINT_KEY = "settings.singleListing.lastShape";

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
  name: "Rivka the Shadchan",
  role: "shadchan",
  is_active: true,
};

function ShapeHintProbe() {
  const hint = useSingleListingShapeHint();
  return <span>hint:{JSON.stringify(hint)}</span>;
}

function ShapeHintWarmerProbe() {
  useSingleListingShapeHintWarmer();
  return null;
}

describe("useSingleListingShapeHint — read side", () => {
  it("returns null when no hint has been stored", async () => {
    // Arrange / Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={{} as CrmDataProvider}
          queryClient={new QueryClient()}
          i18nProvider={testI18nProvider}
          store={memoryStore()}
        >
          <ShapeHintProbe />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect.element(screen.getByText("hint:null")).toBeInTheDocument();
  });

  it("returns the stored hint when valid", async () => {
    // Arrange
    const store = memoryStore({
      [SHAPE_HINT_KEY]: { isHousehold: true, rowCount: 3 },
    });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={{} as CrmDataProvider}
          queryClient={new QueryClient()}
          i18nProvider={testI18nProvider}
          store={store}
        >
          <ShapeHintProbe />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(
        screen.getByText(
          `hint:${JSON.stringify({ isHousehold: true, rowCount: 3 })}`,
        ),
      )
      .toBeInTheDocument();
  });

  it.each([
    ["a non-boolean isHousehold", { isHousehold: "yes", rowCount: 1 }],
    ["a negative rowCount", { isHousehold: true, rowCount: -1 }],
    ["a non-finite rowCount", { isHousehold: true, rowCount: Infinity }],
    ["a bare string", "household"],
  ])(
    "returns null for a corrupted stored value (%s)",
    async (_label, corrupted) => {
      // Arrange — a hand-edited or stale-shape localStorage value must
      // never be trusted into a render.
      const store = memoryStore({ [SHAPE_HINT_KEY]: corrupted });

      // Act
      const screen = await render(
        <TestMemoryRouter>
          <CoreAdminContext
            dataProvider={{} as CrmDataProvider}
            queryClient={new QueryClient()}
            i18nProvider={testI18nProvider}
            store={store}
          >
            <ShapeHintProbe />
          </CoreAdminContext>
        </TestMemoryRouter>,
      );

      // Assert
      await expect.element(screen.getByText("hint:null")).toBeInTheDocument();
    },
  );
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyContexts: vi.fn().mockResolvedValue([]),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderWarmer = async (
  dataProviderOverrides: Partial<CrmDataProvider>,
  store = memoryStore(),
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
        store={store}
      >
        <ShapeHintWarmerProbe />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { store, dataProvider };
};

describe("useSingleListingShapeHintWarmer — write side", () => {
  it("does not write while useMyContexts() is pending", async () => {
    // Arrange
    const { store } = await renderWarmer({
      getMyContexts: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    // Assert — never resolves, so nothing to write yet.
    expect(store.getItem(SHAPE_HINT_KEY, null)).toBeNull();
  });

  it("writes { isHousehold: true, rowCount } once both queries resolve for a household", async () => {
    // Arrange
    const { store } = await renderWarmer({
      getMyContexts: vi.fn().mockResolvedValue([household]),
      getList: vi.fn().mockResolvedValue({ data: [{ id: 1 }], total: 4 }),
    });

    // Assert — `total` from the count-only query, not `data.length` (the
    // query is deliberately `perPage: 1`, so `data` alone would say 1).
    await expect
      .poll(() =>
        store.getItem<SingleListingShapeHint | null>(SHAPE_HINT_KEY, null),
      )
      .toEqual({ isHousehold: true, rowCount: 4 });
  });

  it("writes { isHousehold: false, rowCount: 0 } once resolved for a shadchanus account", async () => {
    // Arrange — the singles-count query still fires (unconditional, see
    // the module's own comment on why), but its result is discarded for a
    // non-household context.
    const getList = vi.fn().mockResolvedValue({ data: [{ id: 1 }], total: 9 });
    const { store } = await renderWarmer({
      getMyContexts: vi.fn().mockResolvedValue([shadchanus]),
      getList,
    });

    // Assert
    await expect
      .poll(() =>
        store.getItem<SingleListingShapeHint | null>(SHAPE_HINT_KEY, null),
      )
      .toEqual({ isHousehold: false, rowCount: 0 });
    expect(getList).toHaveBeenCalled();
  });

  it("does not rewrite the store when the resolved value already matches the stored hint", async () => {
    // Arrange — seed the exact value the resolution will also produce.
    const store = memoryStore({
      [SHAPE_HINT_KEY]: { isHousehold: true, rowCount: 2 },
    });
    const setItem = vi.spyOn(store, "setItem");

    // Act
    await renderWarmer(
      {
        getMyContexts: vi.fn().mockResolvedValue([household]),
        getList: vi.fn().mockResolvedValue({ data: [{ id: 1 }], total: 2 }),
      },
      store,
    );
    await expect
      .poll(() =>
        store.getItem<SingleListingShapeHint | null>(SHAPE_HINT_KEY, null),
      )
      .toEqual({ isHousehold: true, rowCount: 2 });

    // Assert — the value settled correctly without ever being re-written,
    // proving the skip-when-unchanged guard actually held (not just that
    // the end state happens to match).
    expect(setItem).not.toHaveBeenCalled();
  });
});
