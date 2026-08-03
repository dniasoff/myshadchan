import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";
import { CoreAdminContext, TestMemoryRouter, type DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { DiligenceDossierCard } from "./DiligenceDossierCard";

const { callAiWorker } = vi.hoisted(() => ({
  callAiWorker: vi.fn(),
}));

vi.mock("../providers/commons/aiWorkerClient", () => ({
  callAiWorker,
}));

const { useAiEntitlement } = vi.hoisted(() => ({
  useAiEntitlement: vi.fn(),
}));

vi.mock("./useAiEntitlement", () => ({
  useAiEntitlement,
  useAiEntitlementInfo: vi.fn(),
  AI_ENTITLEMENT_QUERY_KEY: ["aiEntitlement"],
}));

const dossierResponse = {
  spokenToCount: 2,
  outstandingCount: 1,
  endorsementCount: 1,
  reservationCount: 1,
  covered: ["Character", "Family"],
  gaps: ["Health"],
  hasContradiction: true,
  narrative: "Two references were spoken to; one warm, one reserved.",
};

const renderCard = async (entitled: boolean) => {
  useAiEntitlement.mockReturnValue({
    isEntitled: entitled,
    isLoading: false,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={
          {
            aiEntitlement: vi.fn(),
          } as unknown as DataProvider
        }
        i18nProvider={testI18nProvider}
        queryClient={queryClient}
      >
        <DiligenceDossierCard shidduchimId={42} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, queryClient };
};

describe("DiligenceDossierCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the upgrade prompt when not entitled", async () => {
    // Arrange / Act
    const { screen } = await renderCard(false);

    // Assert
    await expect
      .element(screen.getByText(/Cross-reference summary/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/See what everyone agreed on/i))
      .toBeInTheDocument();
    expect(callAiWorker).not.toHaveBeenCalled();
  });

  it("renders the dossier when entitled and the fetch succeeds", async () => {
    // Arrange
    callAiWorker.mockResolvedValue(dossierResponse);
    const { screen } = await renderCard(true);

    // Assert
    await expect
      .element(screen.getByText(/Cross-reference summary/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/References differ/i))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/Consensus/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/Covered/i)).toBeInTheDocument();
    await expect
      .element(screen.getByText(/Still missing/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(dossierResponse.narrative))
      .toBeInTheDocument();
    expect(callAiWorker).toHaveBeenCalledWith(
      expect.stringContaining("/dossier"),
      { shidduchim_id: 42 },
    );
  });

  it("renders an error state when the fetch fails", async () => {
    // Arrange
    callAiWorker.mockRejectedValue(new Error("gateway timeout"));
    const { screen } = await renderCard(true);

    // Assert
    await expect
      .element(screen.getByText(/Could not load the summary/i))
      .toBeInTheDocument();
  });
});
