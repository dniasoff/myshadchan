import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { SingleDiligenceProgressTab } from "./SingleDiligenceProgressTab";

const renderTab = async (
  shidduchimId?: number,
  rpcOverride?: (fn: string, _args: any) => Promise<any>,
) => {
  const db = generateData();
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  if (rpcOverride) {
    dataProvider.rpc = rpcOverride;
  }

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider
          value={shidduchimId != null ? { id: shidduchimId } : undefined}
        >
          <SingleDiligenceProgressTab />
        </RecordContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, db, dataProvider };
};

describe("SingleDiligenceProgressTab", () => {
  it("renders nothing when no record is in context", async () => {
    const { screen } = await renderTab(undefined);

    expect(screen.container.textContent).toBe("");
  });

  it("renders progress text when RPC returns contacted/total/outstanding", async () => {
    const { screen } = await renderTab(1);

    await expect
      .element(screen.getByText("2 of 2 conversations done"))
      .toBeInTheDocument();
  });

  it("renders empty line when total is 0", async () => {
    // We need to mock the rpc to return total: 0 since the generated data has references
    const { screen } = await renderTab(1, async (fn) => {
      if (fn === "shidduch_diligence_progress") {
        return { contacted: 0, total: 0, outstanding: 0 };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    });

    await expect
      .element(screen.getByText("Nobody has been asked about this single yet."))
      .toBeInTheDocument();
  });

  it("does not render secret data even if RPC returns junk keys with content", async () => {
    const { screen } = await renderTab(1, async (fn) => {
      if (fn === "shidduch_diligence_progress") {
        return {
          contacted: 2,
          total: 5,
          outstanding: 3,
          notes: ["SECRET_NOTE_TEXT"],
          reference_name: "SECRET_PERSON",
        };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    });

    await expect
      .element(screen.getByText("2 of 5 conversations done"))
      .toBeInTheDocument();

    expect(screen.container.textContent).not.toContain("SECRET_NOTE_TEXT");
    expect(screen.container.textContent).not.toContain("SECRET_PERSON");
  });

  it("renders loading skeleton while fetching", async () => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const { screen } = await renderTab(1, async () => promise);

    // The skeleton should be visible while loading
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toBeInTheDocument();

    // Resolve the promise
    resolvePromise!({ contacted: 2, total: 5, outstanding: 3 });
    await expect
      .element(screen.getByText("2 of 5 conversations done"))
      .toBeInTheDocument();
  });

  it("renders error state when RPC fails", async () => {
    const { screen } = await renderTab(1, async () => {
      throw new Error("RPC failed");
    });

    await expect
      .element(
        screen.getByText("Could not load the summary. Please try again."),
      )
      .toBeInTheDocument();
  });
});
