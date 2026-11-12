import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Interaction } from "../types";
import "./entityDescriptor";
import { ShadchanCard } from "./ShadchanCard";

const NOTE: Interaction & { author_name: string | null } = {
  id: 1,
  account_id: 1,
  target_type: "shadchan",
  target_id: 7,
  scope: "account",
  kind: "note",
  body: "Private body",
  created_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  author_name: null,
};

const renderCard = (note?: typeof NOTE) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ShadchanCard
          shadchan={{
            id: 7,
            account_id: 1,
            name: "Rivka Stern",
            location: "Lakewood",
            created_at: "2026-01-01T00:00:00.000Z",
          }}
          suggestionCount={0}
          index={0}
          note={note}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanCard note action", () => {
  it("gates the action on a live note", async () => {
    const noNote = await renderCard();
    await expect
      .element(
        noNote.getByRole("button", { name: "Open note for Rivka Stern" }),
      )
      .not.toBeInTheDocument();
  });

  it("keeps the Note action outside the RecordLink", async () => {
    const withNote = await renderCard(NOTE);
    const link = withNote.getByRole("link", { name: "Open Rivka Stern file" });
    const button = withNote.getByRole("button", {
      name: "Open note for Rivka Stern",
    });

    expect(link.element().querySelector("button")).toBeNull();
    expect(button.element().closest("a")).toBeNull();
  });
});
