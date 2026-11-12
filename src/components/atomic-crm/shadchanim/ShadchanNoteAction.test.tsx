import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Interaction } from "../types";
import { ShadchanNoteAction } from "./ShadchanNoteAction";

const NOTE: Interaction & {
  author_name: string | null;
} = {
  id: 22,
  account_id: 1,
  target_type: "shadchan",
  target_id: 7,
  scope: "account",
  kind: "note",
  body: "Line one\n\nעברית and a very long URL-like-word-that-must-wrap",
  created_at: "2026-02-03T00:00:00.000Z",
  deleted_at: null,
  author_name: "Rivka Stern",
};

const renderAction = async () =>
  render(
    <TestMemoryRouter initialEntries={["/shadchanim"]}>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ShadchanNoteAction
          shadchan={{ id: 7, name: "Rivka Stern" }}
          note={NOTE}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanNoteAction", () => {
  it("keeps private note text out of the trigger until the dialog opens", async () => {
    const screen = await renderAction();
    const trigger = screen.getByRole("button", {
      name: "Open note for Rivka Stern",
    });

    await expect.element(trigger).toHaveTextContent("Note");
    expect(trigger.element().getAttribute("title")).toBeNull();
    expect(document.body.textContent).not.toContain("Line one");
  });

  it("opens the newest note in an accessible dialog with a safe notes-tab link", async () => {
    const screen = await renderAction();

    await screen
      .getByRole("button", { name: "Open note for Rivka Stern" })
      .click();

    await expect
      .element(screen.getByRole("dialog", { name: "Rivka Stern — note" }))
      .toBeVisible();
    await expect.element(screen.getByText("Line one")).toBeVisible();
    await expect
      .element(screen.getByText("Written by Rivka Stern · 3 Feb 2026, 00:00"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "View all notes" }))
      .toHaveAttribute("href", "/shadchanim/7/notes");

    expect(window.location.search).not.toContain("Line");
    await screen.getByRole("button", { name: "Close" }).first().click();
    await expect
      .element(screen.getByRole("dialog", { name: "Rivka Stern — note" }))
      .not.toBeInTheDocument();
  });

  it("uses the fallback for a blank historical body", async () => {
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext i18nProvider={testI18nProvider}>
          <ShadchanNoteAction
            shadchan={{ id: 7, name: "Rivka Stern" }}
            note={{ ...NOTE, body: null }}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen
      .getByRole("button", { name: "Open note for Rivka Stern" })
      .click();
    await expect
      .element(screen.getByText("This note has no text."))
      .toBeVisible();
  });
});
