import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { ShidduchExternalLink } from "../types";
import { ExternalLinksTab } from "./ExternalLinksTab";

/**
 * Story 5.6's falsifiable claims for the shidduch-only External links tab:
 * empty/loading/error states (Task 5), the invalid-URL rejection before
 * insert (AC 4), the `rel="noopener noreferrer"` + `target="_blank"`
 * rendered attributes (AC 5), and the real FakeRest round trip scoped by
 * `shidduchim_id` (mirroring `MedicalTab.test.tsx`'s AD-10 mirror check).
 */

let nextId = 1;
const buildLink = (
  overrides: Partial<ShidduchExternalLink> = {},
): ShidduchExternalLink => ({
  id: nextId++,
  account_id: 1,
  shidduchim_id: 1,
  url: "https://example.com/profile",
  label: "Example profile",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const renderTabWithMock = async (
  shidduchimId: number,
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ data: buildLink() }),
    delete: vi.fn().mockResolvedValue({ data: buildLink() }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={{ id: shidduchimId }}>
          <ExternalLinksTab />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ExternalLinksTab — loading, empty and error states", () => {
  it("shows a skeleton placeholder while the query is in flight, with no empty-state copy", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderTabWithMock(1, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect
      .element(screen.getByText("No external links yet."))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when there are no links", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(1, { getList });

    // Assert
    await expect
      .element(screen.getByText("No external links yet."))
      .toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab, and keeps the add form usable", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderTabWithMock(1, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the external links."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add link" }))
      .toBeInTheDocument();
  });
});

describe("ExternalLinksTab — AC 4: adding a link", () => {
  it("rejects a URL that does not parse before insert, with a visible message, and never calls create", async () => {
    // Arrange
    const create = vi.fn();
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(1, { create, getList });
    await screen
      .getByPlaceholder("https://example.com/profile")
      .fill("not a url");
    await screen.getByRole("button", { name: "Add link" }).click();

    // Assert
    await expect
      .element(screen.getByText("Enter a valid URL (including https://)."))
      .toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("inserts a valid link scoped to this shidduch, with the optional label", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: buildLink() });
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(7, { create, getList });
    await screen
      .getByPlaceholder("https://example.com/profile")
      .fill("https://shidduch-site.example/profile/42");
    await screen.getByPlaceholder("Label (optional)").fill("Their profile");
    await screen.getByRole("button", { name: "Add link" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [resource, params] = create.mock.calls[0];
    expect(resource).toBe("shidduchim_external_links");
    expect(params.data).toEqual({
      shidduchim_id: 7,
      url: "https://shidduch-site.example/profile/42",
      label: "Their profile",
    });
  });

  it("sends a null label when none is entered", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: buildLink() });
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(1, { create, getList });
    await screen
      .getByPlaceholder("https://example.com/profile")
      .fill("https://example.com/x");
    await screen.getByRole("button", { name: "Add link" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].data.label).toBeNull();
  });

  it("clears the form after a successful add", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: buildLink() });
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(1, { create, getList });
    const urlInput = screen.getByPlaceholder("https://example.com/profile");
    await urlInput.fill("https://example.com/x");
    await screen.getByRole("button", { name: "Add link" }).click();

    // Assert
    await expect.element(urlInput).toHaveValue("");
  });

  it("does not submit while the URL field is empty", async () => {
    // Arrange
    const create = vi.fn();
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTabWithMock(1, { create, getList });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Add link" }))
      .toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ExternalLinksTab — AC 5: rendered link attributes", () => {
  it("renders each link with target=_blank and rel=noopener noreferrer, falling back to the URL when unlabeled", async () => {
    // Arrange
    const labeled = buildLink({
      id: 1,
      url: "https://example.com/labeled",
      label: "Labeled link",
    });
    const unlabeled = buildLink({
      id: 2,
      url: "https://example.com/bare",
      label: null,
    });
    const getList = vi
      .fn()
      .mockResolvedValue({ data: [labeled, unlabeled], total: 2 });

    // Act
    const { screen } = await renderTabWithMock(1, { getList });

    // Assert — the rendered attributes, not the source string (AC 5's own
    // falsifiable).
    const labeledAnchor = screen.getByRole("link", { name: "Labeled link" });
    await expect.element(labeledAnchor).toBeInTheDocument();
    expect(labeledAnchor.element().getAttribute("href")).toBe(
      "https://example.com/labeled",
    );
    expect(labeledAnchor.element().getAttribute("target")).toBe("_blank");
    expect(labeledAnchor.element().getAttribute("rel")).toBe(
      "noopener noreferrer",
    );

    const bareAnchor = screen.getByRole("link", {
      name: "https://example.com/bare",
    });
    await expect.element(bareAnchor).toBeInTheDocument();
  });
});

describe("ExternalLinksTab — remove a link", () => {
  it("asks first: the Remove tap alone deletes nothing", async () => {
    // Arrange — there is no undo behind this delete, and the control sits a
    // few pixels from the link it belongs to.
    const link = buildLink({ id: 3 });
    const getList = vi.fn().mockResolvedValue({ data: [link], total: 1 });
    const deleteOne = vi.fn().mockResolvedValue({ data: link });

    // Act
    const { screen } = await renderTabWithMock(1, {
      getList,
      delete: deleteOne,
    });
    await screen.getByRole("button", { name: "Remove", exact: true }).click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Yes, remove" }))
      .toBeVisible();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("removes the link through the dataProvider once the removal is confirmed", async () => {
    // Arrange
    const link = buildLink({ id: 3 });
    const getList = vi.fn().mockResolvedValue({ data: [link], total: 1 });
    const deleteOne = vi.fn().mockResolvedValue({ data: link });

    // Act
    const { screen } = await renderTabWithMock(1, {
      getList,
      delete: deleteOne,
    });
    await screen.getByRole("button", { name: "Remove", exact: true }).click();
    await screen.getByRole("button", { name: "Yes, remove" }).click();

    // Assert
    expect(deleteOne).toHaveBeenCalledTimes(1);
    const [resource, params] = deleteOne.mock.calls[0];
    expect(resource).toBe("shidduchim_external_links");
    expect(params.id).toBe(3);
  });

  it("cancelling the confirmation leaves the link alone", async () => {
    // Arrange
    const link = buildLink({ id: 4 });
    const getList = vi.fn().mockResolvedValue({ data: [link], total: 1 });
    const deleteOne = vi.fn().mockResolvedValue({ data: link });

    // Act
    const { screen } = await renderTabWithMock(1, {
      getList,
      delete: deleteOne,
    });
    await screen.getByRole("button", { name: "Remove", exact: true }).click();
    await screen.getByRole("button", { name: "Cancel" }).click();

    // Assert
    expect(deleteOne).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("button", { name: "Remove", exact: true }))
      .toBeVisible();
  });
});

describe("ExternalLinksTab — the URL field's naming and keyboard", () => {
  it("is named by a label that survives typing, and asks for a URL keyboard", async () => {
    // Arrange / Act — the field requires an absolute URL (`new URL()` has to
    // parse it), so a phone must not open the plain alphabetic keyboard for
    // it, and the placeholder that used to be its only name disappears at the
    // first keystroke.
    const { screen } = await renderTabWithMock(1, {});
    const urlInput = screen.getByLabelText("Link URL");

    // Assert
    await expect.element(urlInput).toHaveAttribute("type", "url");
    await expect.element(urlInput).toHaveAttribute("inputmode", "url");

    // Act
    await urlInput.fill("https://example.com/profile");

    // Assert — still named after the placeholder is gone.
    await expect
      .element(screen.getByLabelText("Link URL"))
      .toHaveValue("https://example.com/profile");
  });
});

describe("ExternalLinksTab — real FakeRest round trip (AD-10 mirror)", () => {
  const renderReal = async (shidduchimId: number) => {
    const db = generateData();
    db.shidduchim_external_links = [];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={{ id: shidduchimId }}>
            <ExternalLinksTab />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    return { screen, dataProvider };
  };

  it("adds a link that persists through the real dataProvider, scoped to this shidduch", async () => {
    // Act
    const { screen, dataProvider } = await renderReal(9);
    await screen
      .getByPlaceholder("https://example.com/profile")
      .fill("https://example.com/real");
    await screen.getByRole("button", { name: "Add link" }).click();

    // Assert
    await expect
      .element(screen.getByRole("link", { name: "https://example.com/real" }))
      .toBeInTheDocument();

    const { data } = await dataProvider.getList<ShidduchExternalLink>(
      "shidduchim_external_links",
      {
        filter: {},
        pagination: { page: 1, perPage: 10 },
        sort: { field: "id", order: "ASC" },
      },
    );
    expect(data).toHaveLength(1);
    expect(data[0].shidduchim_id).toBe(9);
    expect(data[0].url).toBe("https://example.com/real");
  });

  it("does not render a link belonging to a different shidduch", async () => {
    // Arrange
    const db = generateData();
    db.shidduchim_external_links = [
      buildLink({
        id: 1,
        shidduchim_id: 999,
        url: "https://elsewhere.example",
      }),
    ];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={{ id: 1 }}>
            <ExternalLinksTab />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText("No external links yet."))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "elsewhere.example",
    );
  });
});
