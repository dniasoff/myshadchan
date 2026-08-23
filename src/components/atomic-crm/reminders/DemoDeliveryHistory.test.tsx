import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { DemoDeliveryHistory } from "./DemoDeliveryHistory";

const renderHistory = async (events: unknown[]) => {
  const dataProvider = {
    rpc: vi.fn().mockResolvedValue(events),
  } as unknown as CrmDataProvider;
  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      i18nProvider={testI18nProvider}
    >
      <DemoDeliveryHistory />
    </CoreAdminContext>,
  );
  return { screen, dataProvider };
};

describe("DemoDeliveryHistory", () => {
  it("renders sanitized simulated activity and no recipient/provider payload", async () => {
    const { screen, dataProvider } = await renderHistory([
      {
        event_type: "message",
        status: "sent",
        simulated: true,
        occurred_at: "2026-08-23T10:02:00.000Z",
        resource: "message",
      },
      {
        event_type: "reminder",
        status: "sent",
        simulated: true,
        occurred_at: "2026-08-23T10:01:00.000Z",
        resource: "task",
      },
      {
        event_type: "share",
        status: "accessed",
        simulated: true,
        occurred_at: "2026-08-23T10:00:00.000Z",
        resource: "profile",
        recipient_name: "Private recipient",
        provider_response: "secret-provider-payload",
      },
    ]);

    await expect
      .element(screen.getByText("Recent delivery activity"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Share · accessed"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Message · sent"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Reminder · sent"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Simulated").first())
      .toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("Private recipient");
    expect(screen.container.textContent).not.toContain(
      "secret-provider-payload",
    );
    expect(dataProvider.rpc).toHaveBeenCalledExactlyOnceWith(
      "demo_delivery_history",
      {},
    );
  });

  it("renders nothing when the caller has no demo delivery history", async () => {
    const { screen } = await renderHistory([]);

    await expect
      .element(screen.getByText("Recent delivery activity"))
      .not.toBeInTheDocument();
  });
});
