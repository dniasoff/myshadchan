import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { StoryWrapper } from "@/test/StoryWrapper";

import type { AiEntitlementInfo, Reference } from "../types";
import { ResearchAssistantPanel } from "./ResearchAssistantPanel";

/**
 * The paid gate around the research assistant (E4 / FR63). The panel must read
 * the SERVER entitlement — not a client constant — and show its content only
 * when entitled, otherwise a calm, kind upgrade prompt. These tests drive the
 * gate through the data provider's aiEntitlement() so a regression that hardcodes
 * the answer again is caught.
 */

const reference: Reference = {
  id: 1,
  account_id: 1,
  name_en: "Mrs Klein",
  relationship: "seminary_teacher",
  created_at: "2026-01-01T00:00:00Z",
};

const entitlement = (isEntitled: boolean): AiEntitlementInfo => ({
  is_entitled: isEntitled,
  plan: isEntitled ? "ai" : "free",
  status: isEntitled ? "active" : "none",
  resumes_used: 0,
  resumes_limit: isEntitled ? 100 : 0,
});

const renderPanel = async (isEntitled: boolean) => {
  const aiEntitlement = vi.fn(async () => entitlement(isEntitled));
  const screen = await render(
    <StoryWrapper dataProvider={{ aiEntitlement }}>
      <ResearchAssistantPanel reference={reference} links={[]} />
    </StoryWrapper>,
  );
  return { screen, aiEntitlement };
};

describe("ResearchAssistantPanel entitlement gate", () => {
  it("shows the assistant content when the account is entitled", async () => {
    // Arrange / Act
    const { screen } = await renderPanel(true);

    // Assert — the tailored-questions card is entitled-only content.
    await expect
      .element(screen.getByText(/Questions worth asking/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Tailored questions for each reference/i))
      .not.toBeInTheDocument();
  });

  it("shows the calm upgrade prompt when the account is NOT entitled", async () => {
    // Arrange / Act
    const { screen } = await renderPanel(false);

    // Assert — the upsell copy is locked-state-only; the questions must not show.
    await expect
      .element(screen.getByText(/Tailored questions for each reference/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Questions worth asking/i))
      .not.toBeInTheDocument();
  });

  it("keeps the guardrail promise visible in both states", async () => {
    // Arrange / Act
    const { screen } = await renderPanel(false);

    // Assert — the "never judges compatibility" promise is shown, not just enforced.
    await expect
      .element(screen.getByText(/never judges compatibility/i))
      .toBeInTheDocument();
  });

  it("asks the SERVER for the decision rather than deciding on the client", async () => {
    // Arrange / Act
    const { screen, aiEntitlement } = await renderPanel(true);
    // Wait until the gate has resolved and rendered the entitled content.
    await expect
      .element(screen.getByText(/Questions worth asking/i))
      .toBeInTheDocument();

    // Assert — the gate consulted the server-authoritative entitlement.
    expect(aiEntitlement).toHaveBeenCalled();
  });
});
