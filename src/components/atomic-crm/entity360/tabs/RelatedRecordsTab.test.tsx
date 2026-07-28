import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import type { EntityDescriptor } from "../entityDescriptor";
import type { EntityRelationshipDescriptor } from "../relationshipDescriptor";
import { registerEntityDescriptor } from "../registry";
import { RelatedRecordsTab } from "./RelatedRecordsTab";

/**
 * Story 3-10 AC 7's four falsifiable cases, plus the pending/empty states
 * AC 7 also names. `RelatedRecordsTab` is built here (see its own doc
 * comment) to unblock Story 3.3b's AC 10, whose only caller this is.
 */

const SUBJECT_RESOURCE = "related-tab-subject";
const LINK_RESOURCE = "related-tab-link-target";

const registerLinkDescriptor = () => {
  const descriptor: EntityDescriptor = {
    name: LINK_RESOURCE,
    label: "Link target",
    buildRecordPath: (id) => `/${LINK_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

const renderRelatedRecordsTab = async (
  relationship: EntityRelationshipDescriptor,
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={SUBJECT_RESOURCE}>
          <RecordContextProvider value={{ id: 7 }}>
            <RelatedRecordsTab relationship={relationship} />
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("RelatedRecordsTab — (a) the many-to-many case, through a link view", () => {
  it("produces anchors targeting the link's resolved resource/id, labelled by linkLabel", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: "reference_links_summary",
      getFilter: (r) => ({ reference_id: r.id }),
      linkResource: LINK_RESOURCE,
      linkId: (row) => row.shidduchim_id,
      linkLabel: (row) => row.shidduch_name_en,
    };
    const getList = vi.fn().mockResolvedValue({
      data: [
        { id: 101, shidduchim_id: 1, shidduch_name_en: "Ari & Shira" },
        { id: 102, shidduchim_id: 2, shidduch_name_en: "Moshe & Rivka" },
      ],
      total: 2,
    });

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert — two anchors, targeting the shidduch's path (not the link
    // row's id), labelled by the shidduch's name.
    const linkA = screen.getByRole("link", { name: "Ari & Shira" });
    const linkB = screen.getByRole("link", { name: "Moshe & Rivka" });
    await expect.element(linkA).toBeInTheDocument();
    await expect.element(linkB).toBeInTheDocument();
    expect(linkA.element().getAttribute("href")).toBe(`/${LINK_RESOURCE}/1`);
    expect(linkB.element().getAttribute("href")).toBe(`/${LINK_RESOURCE}/2`);
  });
});

describe("RelatedRecordsTab — (b) the plain-FK case", () => {
  it("resolves anchors through the queried resource's own recordRepresentation", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ single_id: r.id }),
    };
    const getList = vi.fn().mockResolvedValue({
      data: [{ id: 9, name: "Default Representation Row" }],
      total: 1,
    });

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert — no linkLabel/linkResource declared, so the anchor text comes
    // from the row's own default recordRepresentation (its `name` field)
    // and the href from the queried resource itself.
    const link = screen.getByRole("link", {
      name: "Default Representation Row",
    });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(`/${LINK_RESOURCE}/9`);
  });
});

describe("RelatedRecordsTab — (c) getFilter's result reaches dataProvider.getList unmodified", () => {
  it("passes the record through getFilter, then straight to getList's filter param", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ shadchan_id: r.id, extra: "unmodified" }),
    };
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderRelatedRecordsTab(relationship, { getList });

    // Assert
    expect(getList).toHaveBeenCalledWith(
      LINK_RESOURCE,
      expect.objectContaining({
        filter: { shadchan_id: 7, extra: "unmodified" },
      }),
    );
  });
});

describe("RelatedRecordsTab — (d) a rejecting getList renders the error state", () => {
  it("shows an inline error message and no anchors", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ single_id: r.id }),
    };
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load related records."))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
  });
});

describe("RelatedRecordsTab — pending and empty states (UX-DR11)", () => {
  it("renders an accessible pending state while the query is in flight", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ single_id: r.id }),
    };
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert
    await expect.element(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the default empty label when the resource has no relationship.emptyLabel", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ single_id: r.id }),
    };
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert
    await expect
      .element(screen.getByText("Nothing here yet."))
      .toBeInTheDocument();
  });

  it("prefers relationship.emptyLabel over the translated default", async () => {
    // Arrange
    registerLinkDescriptor();
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: LINK_RESOURCE,
      getFilter: (r) => ({ single_id: r.id }),
      emptyLabel: "No shidduchim linked yet.",
    };
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderRelatedRecordsTab(relationship, {
      getList,
    });

    // Assert
    await expect
      .element(screen.getByText("No shidduchim linked yet."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Nothing here yet."))
      .not.toBeInTheDocument();
  });
});
