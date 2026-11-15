import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { QueryClient } from "@tanstack/react-query";
import { REREAD_REQUEST_TIMEOUT_MS } from "../providers/commons/rereadWorkerClient";
import { REREAD_COPY, ResumeRereadControl } from "./ResumeRereadControl";
import { resetResumeReadAttemptsForTests } from "./resumeReadRequest";

const buildDataProvider = (
  reReadResume: CrmDataProvider["reReadResume"],
  readResume: CrmDataProvider["readResume"] = vi.fn(),
): CrmDataProvider =>
  ({ reReadResume, readResume }) as unknown as CrmDataProvider;

const mountedScreens: Array<{ unmount: () => void }> = [];

function unmountScreen(screen: { unmount: () => void }): void {
  screen.unmount();
  const index = mountedScreens.indexOf(screen);
  if (index >= 0) mountedScreens.splice(index, 1);
}

const renderControl = async (
  reReadResume: CrmDataProvider["reReadResume"],
  resumeId = 22,
  fileIdentity = `current-${resumeId}`,
  options: {
    isUnread?: boolean;
    readResume?: CrmDataProvider["readResume"];
  } = {},
) => {
  const dataProvider = buildDataProvider(reReadResume, options.readResume);
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const screen = await render(
    <CoreAdminContext
      dataProvider={dataProvider}
      queryClient={queryClient}
      i18nProvider={testI18nProvider}
    >
      <ResumeRereadControl
        resumeId={resumeId}
        fileIdentity={fileIdentity}
        isUnread={options.isUnread}
      />
      <Notification />
    </CoreAdminContext>,
  );
  mountedScreens.push(screen);
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
    resetResumeReadAttemptsForTests();
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
    let nextRequestId = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => {
        nextRequestId += 1;
        return `00000000-0000-4000-8000-00000000000${nextRequestId}`;
      }),
    });
  });

  afterEach(() => {
    for (const screen of mountedScreens) screen.unmount();
    mountedScreens.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
    expect(reReadResume).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: 22,
        requestId: "00000000-0000-4000-8000-000000000001",
        fileIdentity: "current-22",
      }),
    );

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
    ["not_entitled", REREAD_COPY.notEntitled],
    ["already_reading", REREAD_COPY.failed],
  ] as const)("maps %s to static copy", async (outcome, copy) => {
    const reReadResume = vi.fn().mockResolvedValue(outcome);
    const ids = {
      failed: 31,
      no_allowance: 32,
      not_entitled: 33,
      already_reading: 34,
    };
    const { screen } = await renderControl(reReadResume, ids[outcome]);
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
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("failed");
    const { screen } = await renderControl(reReadResume, 34);
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

    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.failed);
    expect(reReadResume.mock.calls[2][0].requestId).not.toBe(
      reReadResume.mock.calls[0][0].requestId,
    );
  });

  it("uses fill-empty read mode and reuses its idempotency key for an unread retry", async () => {
    const readResume = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("completed");
    const { screen } = await renderControl(vi.fn(), 40, "current-40", {
      isUnread: true,
      readResume,
    });

    await screen
      .getByRole("button", { name: REREAD_COPY.readTrigger, exact: true })
      .click();
    await screen
      .getByRole("button", { name: REREAD_COPY.readConfirm, exact: true })
      .click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.failed);
    await screen
      .getByRole("button", { name: REREAD_COPY.readConfirm, exact: true })
      .click();
    await expect
      .poll(
        () =>
          screen.container.querySelector<HTMLElement>('[role="status"]')
            ?.textContent,
      )
      .toBe(REREAD_COPY.readCompleted);

    expect(readResume).toHaveBeenCalledTimes(2);
    expect(readResume.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        resumeId: 40,
        fileIdentity: "current-40",
        mode: "fill_empty",
      }),
    );
    expect(readResume.mock.calls[1][0].requestId).toBe(
      readResume.mock.calls[0][0].requestId,
    );
  });

  it("times out a hung read, returns to idle, and retries with the same id", async () => {
    vi.useFakeTimers();
    const reReadResume = vi.fn().mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<"completed">((_resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("client timeout")),
            REREAD_REQUEST_TIMEOUT_MS,
          );
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const { screen } = await renderControl(reReadResume, 36);

    await screen.getByRole("button", { name: REREAD_COPY.trigger }).click();
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.reading);

    await vi.advanceTimersByTimeAsync(REREAD_REQUEST_TIMEOUT_MS);
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.failed);
    await screen.getByRole("button", { name: REREAD_COPY.confirm }).click();
    expect(reReadResume).toHaveBeenCalledTimes(2);
    expect(reReadResume.mock.calls[1][0].requestId).toBe(
      reReadResume.mock.calls[0][0].requestId,
    );
  });

  it("keeps the unresolved id across unmount/remount, then clears it on success", async () => {
    const reReadResume = vi
      .fn()
      .mockImplementation(({ signal }: { signal?: AbortSignal }) => {
        if (reReadResume.mock.calls.length === 0) {
          return new Promise<"completed">((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return Promise.resolve<"failed">("failed");
      });
    const first = await renderControl(reReadResume, 37, "current-37");
    await first.screen
      .getByRole("button", { name: REREAD_COPY.trigger })
      .click();
    await first.screen
      .getByRole("button", { name: REREAD_COPY.confirm })
      .click();
    unmountScreen(first.screen);
    await Promise.resolve();
    await Promise.resolve();

    const second = await renderControl(reReadResume, 37, "current-37");
    await second.screen
      .getByRole("button", { name: REREAD_COPY.trigger })
      .click();
    await second.screen
      .getByRole("button", { name: REREAD_COPY.confirm })
      .click();
    await expect
      .poll(() => openPanelStatus()?.textContent)
      .toBe(REREAD_COPY.failed);
    expect(reReadResume.mock.calls[1][0].requestId).toBe(
      reReadResume.mock.calls[0][0].requestId,
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
