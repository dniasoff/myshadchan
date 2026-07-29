import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `shadchanim` descriptor so
// ShadchanCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanList } from "./ShadchanList";

const SHADCHANIM = [
  { id: 1, name: "Rivka Stern", responsiveness: "high" },
  { id: 2, name: "Moshe Adler", responsiveness: "medium" },
];

const renderShadchanList = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={fakeDataProvider({
          shadchanim: SHADCHANIM,
          shidduchim: [],
        })}
        i18nProvider={testI18nProvider}
      >
        <ShadchanList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanList — retrofitted onto EntityList, search filters the book (AC 3, 4)", () => {
  it("shows every shadchan, then only the matching one once a search term is typed", async () => {
    // Arrange
    const screen = await renderShadchanList();
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("Moshe Adler")).toBeInTheDocument();

    // Act
    await screen.getByPlaceholder("Search by name").fill("Rivka");

    // Assert
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Moshe Adler"))
      .not.toBeInTheDocument();
  });
});
