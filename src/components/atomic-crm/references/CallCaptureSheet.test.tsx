import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ReferenceLinkSummary } from "../types";
import { CallCaptureSheet } from "./CallCaptureSheet";

/**
 * Story 5.11 — this file did not exist before this story (Task 3: the
 * earlier draft's "existing CallCaptureSheet tests continue to pass
 * unchanged" was false; there were none).
 *
 * Covers AC 1 (tailored questions, no AI entitlement gate), AC 2 (universal
 * fallback), and AC 3 (the save path is unchanged by the new read-only
 * question display). AC 1's "no `useAiEntitlement` check" half is enforced
 * separately, at build time, by `entitlementGate.guard.test.ts` — this file
 * does not re-implement that scan, it only exercises the rendered UI.
 */

const buildLink = (
  overrides: Partial<ReferenceLinkSummary> = {},
): ReferenceLinkSummary => ({
  id: 1,
  account_id: 1,
  reference_id: 10,
  shidduchim_id: 20,
  call_status: "not_started",
  what_they_said: null,
  conversation_log: [],
  conversation_log_count: 0,
  effective_relationship: null,
  reference_name_en: "Chana Levy",
  shidduch_name_en: "Some Shidduch",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const renderCallCaptureSheet = async (
  link: ReferenceLinkSummary,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = {
    logReferenceCall: vi.fn().mockResolvedValue({ ...link }),
    ...dataProviderOverrides,
  } as unknown as CrmDataProvider;
  const onOpenChange = vi.fn();

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <CallCaptureSheet link={link} open onOpenChange={onOpenChange} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, onOpenChange };
};

describe("CallCaptureSheet — tailored questions, no paywall (AC 1)", () => {
  it("shows the tailored question set for the link's relationship, on the free tier", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: "seminary teacher" });

    // Act
    const { screen } = await renderCallCaptureSheet(link);
    await screen.getByText("Show questions").click();

    // Assert — a teacher-specific question, not merely the universal ones.
    await expect
      .element(
        screen.getByText(
          "How did they handle a subject or a situation they found difficult?",
        ),
      )
      .toBeVisible();
  });

  it("renders the question section unconditionally — no upgrade prompt, no gated state", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: "employer" });

    // Act
    const { screen } = await renderCallCaptureSheet(link);

    // Assert — the section header is visible immediately; nothing gates it.
    await expect.element(screen.getByText("Questions to ask")).toBeVisible();
  });
});

describe("CallCaptureSheet — falls back to the universal questions (AC 2)", () => {
  it("never renders an empty question list when the relationship is null", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: null });

    // Act
    const { screen } = await renderCallCaptureSheet(link);
    await screen.getByText("Show questions").click();

    // Assert — a universal question, reused verbatim from relationshipQuestions.ts.
    await expect
      .element(
        screen.getByText("How long have you known them, and in what setting?"),
      )
      .toBeVisible();
  });

  it("falls back rather than guessing for an unrecognised relationship", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: "dog walker" });

    // Act
    const { screen } = await renderCallCaptureSheet(link);
    await screen.getByText("Show questions").click();

    // Assert — the universal fallback question is present...
    await expect
      .element(
        screen.getByText("How long have you known them, and in what setting?"),
      )
      .toBeVisible();
    // ...and, the actual claim in this test's title: no relationship-specific
    // question is guessed at. Universal questions are appended to every set
    // (relationshipQuestions.ts), so a passing assertion on the line above
    // alone cannot tell "fell back" apart from "matched the wrong set" — this
    // one can, by pinning a teacher-only question's absence.
    await expect
      .element(
        screen.getByText(
          "How did they handle a subject or a situation they found difficult?",
        ),
      )
      .not.toBeInTheDocument();
  });
});

describe("CallCaptureSheet — the save path is unchanged (AC 3)", () => {
  it("logs the call with the selected status and note, and closes the sheet", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: "neighbour" });
    const { screen, dataProvider, onOpenChange } =
      await renderCallCaptureSheet(link);

    // Act
    await screen.getByRole("button", { name: "Answered" }).click();
    await screen
      .getByLabelText("What they said")
      .fill("Warm, reliable, always on time.");
    await screen.getByRole("button", { name: "Save and add to log" }).click();

    // Assert — the save path itself is untouched by this story's addition.
    // Poll on the sheet closing: it is the last effect of `handleSave`, so
    // by the time it fires every earlier call has already resolved.
    await expect.poll(() => onOpenChange.mock.calls.length).toBeGreaterThan(0);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dataProvider.logReferenceCall).toHaveBeenCalledWith({
      reference_link_id: 1,
      call_status: "answered",
      what_they_said: "Warm, reliable, always on time.",
      source: "manual",
    });
  });
});

describe("CallCaptureSheet — questions toggle label (review fix F5)", () => {
  it("flips the toggle label once the questions section is expanded", async () => {
    // Arrange
    const link = buildLink({ effective_relationship: "employer" });
    const { screen } = await renderCallCaptureSheet(link);
    await expect.element(screen.getByText("Show questions")).toBeVisible();

    // Act
    await screen.getByText("Show questions").click();

    // Assert — the label reflects the disclosure's actual state, not a
    // static string that would read wrong once expanded.
    await expect.element(screen.getByText("Hide questions")).toBeVisible();
    await expect
      .element(screen.getByText("Show questions"))
      .not.toBeInTheDocument();
  });
});
