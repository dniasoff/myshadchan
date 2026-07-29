import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `singles` descriptor so
// SingleCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { SingleList } from "./SingleList";

const SINGLES = [
  { id: 1, first_name_en: "Chaim", last_name_en: "Cohen", status: "active" },
  { id: 2, first_name_en: "Devorah", last_name_en: "Levi", status: "active" },
];

const renderSingleList = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={fakeDataProvider({
          singles: SINGLES,
          singles_summary: SINGLES.map((single) => ({
            ...single,
            total_shidduchim: 0,
            open_shidduchim: 0,
          })),
        })}
        i18nProvider={testI18nProvider}
      >
        <SingleList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("SingleList — retrofitted onto EntityList, search filters the roster (AC 3, 4)", () => {
  it("shows every single, then only the matching one once a search term is typed", async () => {
    // Arrange
    const screen = await renderSingleList();
    await expect.element(screen.getByText("Chaim Cohen")).toBeInTheDocument();
    await expect.element(screen.getByText("Devorah Levi")).toBeInTheDocument();

    // Act
    await screen.getByPlaceholder("Search by name").fill("Devorah");

    // Assert
    await expect.element(screen.getByText("Devorah Levi")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Chaim Cohen"))
      .not.toBeInTheDocument();
  });
});
