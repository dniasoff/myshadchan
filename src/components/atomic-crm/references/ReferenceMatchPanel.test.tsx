import { render } from "vitest-browser-react";
import type { Identifier } from "ra-core";
import { TestMemoryRouter } from "ra-core";
import type { ReferenceMatchCandidate } from "../types";
import { ReferenceMatchPanel } from "./ReferenceMatchPanel";

/**
 * These tests pin the invariants of match-on-entry (AD-5/FR20): the user is
 * shown WHY two records look alike, and nothing happens without a click.
 */

const candidate = (
  overrides: Partial<ReferenceMatchCandidate> = {},
): ReferenceMatchCandidate => ({
  reference_id: 7,
  confidence: 0.9,
  deciding_facts: [
    { signal: "phone", detail: "phone number matches exactly" },
    {
      signal: "name",
      detail: "name matches as a Hebrew/English spelling variant",
    },
  ],
  name_en: "Rabbi Chaim Cohen",
  name_he: null,
  phone: "054-123-4567",
  relationship: "shul rabbi",
  school: "Yeshivas Ohr",
  grad_year: null,
  linked_shidduchim_count: 2,
  ...overrides,
});

const renderPanel = async (props: {
  candidates: ReferenceMatchCandidate[];
  onConfirm?: (candidate: ReferenceMatchCandidate) => void;
  onDismiss?: (referenceId: Identifier) => void;
}) =>
  render(
    <TestMemoryRouter>
      <ReferenceMatchPanel
        candidates={props.candidates}
        onConfirm={props.onConfirm ?? (() => {})}
        onDismiss={props.onDismiss ?? (() => {})}
      />
    </TestMemoryRouter>,
  );

describe("ReferenceMatchPanel", () => {
  it("renders nothing when there is no possible match", async () => {
    // Arrange / Act
    const screen = await renderPanel({ candidates: [] });

    // Assert
    await expect
      .element(screen.getByText(/You may have spoken to this person before/i))
      .not.toBeInTheDocument();
  });

  it("shows the deciding facts rather than only a score", async () => {
    // Arrange / Act
    const screen = await renderPanel({ candidates: [candidate()] });

    // Assert
    await expect
      .element(screen.getByText(/phone number matches exactly/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Hebrew\/English spelling variant/i))
      .toBeInTheDocument();
  });

  it("tells the user how much history the candidate already carries", async () => {
    // Arrange / Act
    const screen = await renderPanel({ candidates: [candidate()] });

    // Assert
    await expect
      .element(screen.getByText(/Already linked to 2 other singles/i))
      .toBeInTheDocument();
  });

  it("offers exactly two choices and takes neither on its own", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    // Act
    const screen = await renderPanel({
      candidates: [candidate()],
      onConfirm,
      onDismiss,
    });
    await expect
      .element(screen.getByRole("button", { name: /Yes, this is/i }))
      .toBeInTheDocument();

    // Assert — rendering alone must never link or dismiss anything.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("links only when the user confirms", async () => {
    // Arrange
    const onConfirm = vi.fn();
    const match = candidate();
    const screen = await renderPanel({ candidates: [match], onConfirm });

    // Act
    await screen.getByRole("button", { name: /Yes, this is/i }).click();

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(match);
  });

  it("dismisses the candidate when the user says it is somebody else", async () => {
    // Arrange
    const onDismiss = vi.fn();
    const screen = await renderPanel({ candidates: [candidate()], onDismiss });

    // Act
    await screen.getByRole("button", { name: /No, different person/i }).click();

    // Assert
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("describes a weaker match less confidently", async () => {
    // Arrange / Act
    const screen = await renderPanel({
      candidates: [
        candidate({
          confidence: 0.6,
          deciding_facts: [
            { signal: "school", detail: "same school or seminary" },
          ],
        }),
      ],
    });

    // Assert
    await expect
      .element(screen.getByText(/Possible match/i))
      .toBeInTheDocument();
  });

  it("lists every candidate when several people look similar", async () => {
    // Arrange / Act
    const screen = await renderPanel({
      candidates: [
        candidate({ reference_id: 7, name_en: "Chaim Cohen" }),
        candidate({ reference_id: 8, name_en: "Haim Cohen" }),
      ],
    });

    // Assert — each candidate gets its own link through to the real record.
    await expect
      .element(screen.getByRole("link", { name: "Chaim Cohen" }))
      .toBeInTheDocument();
    // "Haim" is a substring of "Chaim", so this needs an exact match — which is
    // exactly the spelling-variant case the matcher exists to catch.
    await expect
      .element(screen.getByRole("link", { name: "Haim Cohen", exact: true }))
      .toBeInTheDocument();
  });
});
