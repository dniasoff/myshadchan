import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { QueryClient } from "@tanstack/react-query";
import { REREAD_COPY, ResumeRereadControl } from "./ResumeRereadControl";

const buildDataProvider = (
  reReadResume: CrmDataProvider["reReadResume"],
): CrmDataProvider => ({ reReadResume }) as unknown as CrmDataProvider;

const renderControl = async (reReadResume: CrmDataProvider["reReadResume"]) => {
  const dataProvider = buildDataProvider(reReadResume);
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      queryClient={queryClient}
      i18nProvider={testI18nProvider}
    >
      <ResumeRereadControl resumeId={22} />
      <Notification />
    </CoreAdminContext>,
  );
  return { screen, invalidateQueries };
};

const openPanel = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="dialog-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]',
  );

const openPanelStatus = () =>
  openPanel()?.querySelector<HTMLElement>('[role="status"]');

describe("ResumeRereadControl", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValue("00000000-0000-4000-8000-000000000001"),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requires confirmation, shows the reading state, disables the control, and refreshes on success", async () => {
    let resolve: ((outcome: "completed") => void) | undefined;
    const reReadResume = vi.fn().mockReturnValue(
      new Promise<"completed">((promiseResolve) => {
        resolve = promiseResolve;
      }),
    );
    const { screen, invalidateQueries } = await renderControl(reReadResume);

    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    expect(openPanel()).not.toBeNull();
    expect(openPanel()?.textContent).toContain(REREAD_COPY.description);
    expect(
      Array.from(openPanel()?.querySelectorAll("button") ?? []).map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual([REREAD_COPY.cancel, REREAD_COPY.confirm]);
    await expect
      .element(screen.getByRole("button", { name: REREAD_COPY.cancel }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: REREAD_COPY.confirm }))
      .toBeVisible();

    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.reading);
    await expect
      .element(screen.getByRole("button", { name: REREAD_COPY.confirm }))
      .toBeDisabled();
    expect(
      screen.container.querySelectorAll("button[disabled]").length,
    ).toBeGreaterThan(0);
    expect(reReadResume).toHaveBeenCalledWith({
      resumeId: 22,
      requestId: "00000000-0000-4000-8000-000000000001",
    });

    resolve?.("completed");
    await expect
      .poll(
        () =>
          screen.container.querySelector<HTMLElement>('[role="status"]')
            ?.textContent,
      )
      .toBe(REREAD_COPY.completed);
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it.each([
    ["failed", REREAD_COPY.failed],
    ["no_allowance", REREAD_COPY.noAllowance],
    ["already_reading", REREAD_COPY.failed],
  ] as const)("maps %s to static copy", async (outcome, copy) => {
    const reReadResume = vi.fn().mockResolvedValue(outcome);
    const { screen } = await renderControl(reReadResume);
    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect.poll(() => openPanelStatus()?.textContent).toBe(copy);
    await expect
      .element(screen.getByText("private server detail must not reach the UI"))
      .not.toBeInTheDocument();
  });

  it("reuses the same idempotency key when Re-read is retried in the same confirmation", async () => {
    const reReadResume = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("completed");
    const { screen } = await renderControl(reReadResume);
    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.failed);
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect
      .poll(
        () =>
          screen.container.querySelector<HTMLElement>('[role="status"]')
            ?.textContent,
      )
      .toBe(REREAD_COPY.completed);
    expect(reReadResume).toHaveBeenCalledTimes(2);
    expect(reReadResume.mock.calls[0][0].requestId).toBe(
      reReadResume.mock.calls[1][0].requestId,
    );
  });

  it("uses the phone bottom sheet treatment", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const reReadResume = vi.fn().mockResolvedValue("failed");
    const { screen } = await renderControl(reReadResume);
    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    expect(
      document.body.querySelector('[data-slot="sheet-content"]'),
    ).not.toBeNull();
  });
});
