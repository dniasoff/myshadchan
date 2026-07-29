import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Shadchan } from "../types";
// Side-effect import — registers the real `shadchanim` descriptor so
// `ShadchanRow`'s `RecordLink` resolves a real href instead of degrading to
// a plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanRow } from "./ShadchanRow";

const buildShadchan = (overrides: Partial<Shadchan> = {}): Shadchan => ({
  id: 1,
  account_id: 1,
  name: "Rivka Stern",
  location: "Lakewood",
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const renderRow = (shadchan: Shadchan, suggestionCount: number) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ShadchanRow
          shadchan={shadchan}
          suggestionCount={suggestionCount}
          index={0}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanRow — the List-mode counterpart to ShadchanCard (Story 4.2, AC 1, AC 5)", () => {
  it("renders a RecordLink to the shadchan's real record path, with the shadchan's name", async () => {
    // Arrange / Act
    const screen = await renderRow(buildShadchan({ id: 7 }), 0);

    // Assert
    await expect
      .element(screen.getByRole("link", { name: /Rivka Stern/ }))
      .toHaveAttribute("href", "/shadchanim/7/show");
  });

  it("labels a count of 1 'shidduch' (singular), never 'suggestion'", async () => {
    // Arrange / Act
    const screen = await renderRow(buildShadchan(), 1);

    // Assert
    await expect.element(screen.getByText("1 shidduch")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/suggestion/i))
      .not.toBeInTheDocument();
  });

  it("labels a count other than 1 'shidduchim' (plural), never 'suggestions'", async () => {
    // Arrange / Act
    const screen = await renderRow(buildShadchan(), 4);

    // Assert
    await expect.element(screen.getByText("4 shidduchim")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/suggestion/i))
      .not.toBeInTheDocument();
  });
});
