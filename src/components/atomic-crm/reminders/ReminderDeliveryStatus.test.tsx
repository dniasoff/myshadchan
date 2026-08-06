import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { CronHeartbeat } from "../types";
import { ReminderDeliveryStatus } from "./ReminderDeliveryStatus";

/**
 * Story 12.2, AC-9: the Settings → Preferences heartbeat row. Pins the three
 * states the AC names by wording ("Not set up yet" / "Sending" / "Paused"),
 * driven by three different `cron_heartbeat` fixtures, plus a fourth case —
 * a genuine fetch failure — that must NOT render "Sending" (a failed fetch
 * is not evidence the sweep is healthy) and must be distinguishable from
 * both "not set up" and "stale".
 *
 * A `retry: false` QueryClient is required for the error-path tests —
 * without it a rejecting getOne() retries with backoff before settling into
 * an error state, exactly the trap OnboardingGate.test.tsx's own comment
 * documents.
 */

const buildQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const notFoundError = () =>
  Object.assign(
    new Error("JSON object requested, multiple (or no) rows returned"),
    {
      status: 406,
    },
  );

const renderStatus = async (
  getOne: (
    resource: string,
    params: { id: unknown },
  ) => Promise<{ data: CronHeartbeat }>,
) => {
  const dataProvider = { getOne: vi.fn(getOne) } as unknown as CrmDataProvider;
  const queryClient = buildQueryClient();

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ReminderDeliveryStatus />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ReminderDeliveryStatus", () => {
  it('renders "Not set up yet" when no heartbeat row exists — the true state of production today', async () => {
    // Arrange / Act
    const { screen } = await renderStatus(() =>
      Promise.reject(notFoundError()),
    );

    // Assert
    await expect
      .element(screen.getByText("Not set up yet"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Sending")).not.toBeInTheDocument();
  });

  it('renders "Sending" when last_ok_at is within the 30-minute staleness window', async () => {
    // Arrange
    const fresh: CronHeartbeat = {
      id: "cron",
      worker: "cron",
      last_run_at: new Date().toISOString(),
      last_ok_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      last_error: null,
    };

    // Act
    const { screen } = await renderStatus((resource, params) => {
      expect(resource).toBe("cron_heartbeat");
      expect(params.id).toBe("cron");
      return Promise.resolve({ data: fresh });
    });

    // Assert
    await expect.element(screen.getByText("Sending")).toBeInTheDocument();
  });

  it('renders "Paused" when last_ok_at is older than the 30-minute staleness window', async () => {
    // Arrange
    const stale: CronHeartbeat = {
      id: "cron",
      worker: "cron",
      last_run_at: new Date().toISOString(),
      last_ok_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      last_error: "transport_failed",
    };

    // Act
    const { screen } = await renderStatus(() =>
      Promise.resolve({ data: stale }),
    );

    // Assert
    await expect.element(screen.getByText("Paused")).toBeInTheDocument();
  });

  it('renders "Paused" when a row exists but last_ok_at has never been set (every tick has failed)', async () => {
    // Arrange
    const neverOk: CronHeartbeat = {
      id: "cron",
      worker: "cron",
      last_run_at: new Date().toISOString(),
      last_ok_at: null,
      last_error: "rpc_failed",
    };

    // Act
    const { screen } = await renderStatus(() =>
      Promise.resolve({ data: neverOk }),
    );

    // Assert
    await expect.element(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("distinguishes a genuine fetch failure from both 'not set up' and 'stale' — never reports Sending on a failed fetch", async () => {
    // Arrange / Act — a 500, unlike the 406 "no row" case above.
    const { screen } = await renderStatus(() =>
      Promise.reject(
        Object.assign(new Error("network error"), { status: 500 }),
      ),
    );

    // Assert
    await expect
      .element(screen.getByText("Couldn't check"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Sending")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Not set up yet"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Paused")).not.toBeInTheDocument();
  });

  it("renders the row label", async () => {
    // Arrange / Act
    const { screen } = await renderStatus(() =>
      Promise.reject(notFoundError()),
    );

    // Assert
    await expect
      .element(screen.getByText("Reminder emails"))
      .toBeInTheDocument();
  });
});
