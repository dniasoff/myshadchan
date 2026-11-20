import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type * as RaCore from "ra-core";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { PrivacySection } from "./PrivacySection";

const { useGetListMock } = vi.hoisted(() => ({
  useGetListMock: vi.fn(),
}));

vi.mock("ra-core", async () => ({
  ...(await vi.importActual<typeof RaCore>("ra-core")),
  useGetList: (...args: unknown[]) => useGetListMock(...args),
  useDataProvider: () => ({}),
}));

describe("PrivacySection shadchan total", () => {
  it("counts archived shadchanim because privacy totals include retained export/delete data", async () => {
    useGetListMock.mockImplementation((resource: string) => ({
      total: resource === "shadchanim" ? 7 : 0,
    }));

    await render(
      <CoreAdminContext
        dataProvider={{} as never}
        i18nProvider={testI18nProvider}
      >
        <PrivacySection />
      </CoreAdminContext>,
    );

    const shadchanCall = useGetListMock.mock.calls.find(
      ([resource]) => resource === "shadchanim",
    );
    expect(shadchanCall?.[1]).not.toHaveProperty("filter");
  });
});
