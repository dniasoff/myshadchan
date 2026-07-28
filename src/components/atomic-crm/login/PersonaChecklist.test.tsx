import React from "react";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { PersonaChecklist } from "./PersonaChecklist";
import type { Persona } from "../types";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <CoreAdminContext
    dataProvider={fakeDataProvider({})}
    i18nProvider={{
      translate: (key, options) =>
        typeof options?._ === "string" ? options._ : key,
      changeLocale: () => Promise.resolve(),
      getLocale: () => "en",
    }}
  >
    {children}
  </CoreAdminContext>
);

const PERSONA_LABELS: Record<Persona, string> = {
  single: "I'm looking for a shidduch for myself",
  parent: "I'm looking for a shidduch for my children",
  shadchan: "I'm a matchmaker (shadchan)",
};

describe("PersonaChecklist", () => {
  it("renders exactly three checkboxes, all unchecked when value is empty", async () => {
    // Arrange / Act
    const screen = await render(
      <PersonaChecklist value={[]} onChange={vi.fn()} />,
      { wrapper: Wrapper },
    );

    // Assert
    for (const label of Object.values(PERSONA_LABELS)) {
      const checkbox = screen.getByRole("checkbox", { name: label });
      await expect.element(checkbox).toBeVisible();
      await expect.element(checkbox).not.toBeChecked();
    }
  });

  it("reflects already-ticked personas as checked", async () => {
    // Arrange / Act
    const screen = await render(
      <PersonaChecklist value={["parent", "shadchan"]} onChange={vi.fn()} />,
      { wrapper: Wrapper },
    );

    // Assert
    await expect
      .element(screen.getByRole("checkbox", { name: PERSONA_LABELS.parent }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("checkbox", { name: PERSONA_LABELS.shadchan }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("checkbox", { name: PERSONA_LABELS.single }))
      .not.toBeChecked();
  });

  it("calls onChange with the persona appended when an unticked box is clicked", async () => {
    // Arrange
    const onChange = vi.fn();
    const screen = await render(
      <PersonaChecklist value={["single"]} onChange={onChange} />,
      { wrapper: Wrapper },
    );

    // Act
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.parent }).click();

    // Assert
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["single", "parent"]);
  });

  it("calls onChange with the persona removed when a ticked box is clicked", async () => {
    // Arrange
    const onChange = vi.fn();
    const screen = await render(
      <PersonaChecklist value={["single", "parent"]} onChange={onChange} />,
      { wrapper: Wrapper },
    );

    // Act
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.single }).click();

    // Assert
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["parent"]);
  });

  it("does not enforce an 'at least one' rule itself — unticking to zero is allowed", async () => {
    // Arrange: this is the caller's job (2.5 legitimately allows zero, for
    // persona removal), per PersonaChecklist's own doc comment.
    const onChange = vi.fn();
    const screen = await render(
      <PersonaChecklist value={["single"]} onChange={onChange} />,
      { wrapper: Wrapper },
    );

    // Act
    await screen.getByRole("checkbox", { name: PERSONA_LABELS.single }).click();

    // Assert
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
  });
});
