import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type Identifier } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  EntityFile,
  InboxItem,
  Shidduch,
} from "../types";
import { useResolveInboxItem } from "./useResolveInboxItem";

/**
 * Story 10.1 (Task 5, AC 5/6/7) + Story 10.5 idempotency:
 * `InboxResolveDialog.tsx`'s own test covers the "create a new suggestion"
 * path through the UI; this suite exercises `useResolveInboxItem.ts`'s three
 * functions directly, against a mocked `dataProvider`, since `ShareTarget.tsx`
 * is the OTHER caller and the shared module's own contract (which
 * dataProvider calls each function makes, in which order) deserves coverage
 * independent of either screen.
 */

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "whatsapp",
  raw_text: "Chaim Berkowitz, BMG",
  subject: null,
  sender: null,
  sender_needs_confirmation: false,
  attachments: null,
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
  ...overrides,
});

/**
 * A stateful mock that merges inbox_items updates so `getOne` reflects the
 * current row. This is the minimum fidelity needed to test Story 10.5's
 * resolve-window protocol (status: unresolved -> resolving -> resolved/dismissed).
 */
const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
  initialItem: InboxItem = buildItem(),
): CrmDataProvider => {
  let currentItem: InboxItem = { ...initialItem };

  const createShidduch = vi.fn(async (_input: CreateShidduchInput) => {
    return { id: 99 } as Shidduch;
  });

  const create = vi.fn(async (_resource: string, _params: unknown) => {
    return { data: { id: 100 } };
  });

  const copyInboxAttachmentsToEntityFiles = vi.fn(async () => {
    return [] as EntityFile[];
  });

  const getOne = vi.fn(async (resource: string, params: { id: Identifier }) => {
    if (resource === "inbox_items" && params.id === currentItem.id) {
      return { data: currentItem };
    }
    if (resource === "shidduchim" && params.id === 99) {
      return { data: { id: 99 } as Shidduch };
    }
    throw new Error(`Unexpected getOne: ${resource} ${params.id}`);
  });

  const update = vi.fn(async (resource: string, params: unknown) => {
    if (resource === "inbox_items") {
      const { data } = params as {
        id: Identifier;
        data: Partial<InboxItem>;
        previousData: InboxItem;
      };
      currentItem = { ...currentItem, ...data };
      return { data: currentItem };
    }
    return { data: {} };
  });

  return {
    createShidduch,
    create,
    copyInboxAttachmentsToEntityFiles,
    getOne,
    update,
    ...overrides,
  } as unknown as CrmDataProvider;
};

function ResolveProbe({ item }: { item: InboxItem }) {
  const { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem } =
    useResolveInboxItem();
  const [result, setResult] = useState("idle");

  const run = async (action: () => Promise<string>) => {
    try {
      setResult(await action());
    } catch (error) {
      setResult(`error:${error instanceof Error ? error.message : "unknown"}`);
    }
  };

  return (
    <div>
      <span>result:{result}</span>
      <button
        onClick={() =>
          run(async () => {
            const input: CreateShidduchInput = {
              single_id: 5,
              shadchan_id: 7,
            };
            const created = await resolveAsNewShidduch(item, input);
            return `new:${created.id}`;
          })
        }
      >
        resolveAsNewShidduch
      </button>
      <button
        onClick={() =>
          run(async () => {
            await resolveAsLinkToExisting(item, 42);
            return "linked";
          })
        }
      >
        resolveAsLinkToExisting
      </button>
      <button
        onClick={() =>
          run(async () => {
            await dismissInboxItem(item);
            return "dismissed";
          })
        }
      >
        dismissInboxItem
      </button>
    </div>
  );
}

const renderProbe = async (
  item: InboxItem,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides, item);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResolveProbe item={item} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

describe("useResolveInboxItem — resolveAsNewShidduch (AC 7: the sole createShidduch path)", () => {
  it("creates via dataProvider.createShidduch, then marks the item resolved and linked", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ single_id: 5, shadchan_id: 7 }),
    );

    // Story 10.5: three-step protocol (resolving -> stash created id -> resolved)
    expect(dataProvider.update).toHaveBeenCalledTimes(3);

    const resolvingCall = (dataProvider.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(resolvingCall[0]).toBe("inbox_items");
    expect(resolvingCall[1].data).toMatchObject({
      status: "resolving",
      resolution_attempt_id: expect.any(String),
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
      },
    });

    const stashCall = (dataProvider.update as ReturnType<typeof vi.fn>).mock
      .calls[1];
    expect(stashCall[0]).toBe("inbox_items");
    expect(stashCall[1].data).toMatchObject({
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
        resolved_shidduchim_id: 99,
      },
    });

    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "resolved",
          resolved_shidduchim_id: 99,
          single_id: 5,
          shadchan_id: 7,
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("is idempotent: a second resolveAsNewShidduch returns the existing shidduch without creating another", async () => {
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
  });
});

describe("useResolveInboxItem — resolveAsLinkToExisting (AC 5: never a second suggestion)", () => {
  it("inserts a note interaction against the chosen shidduch and marks the item resolved, without ever calling createShidduch", async () => {
    // Arrange
    const item = buildItem({ raw_text: "Chaim Berkowitz" });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith("interactions", {
      data: {
        target_type: "shidduch",
        target_id: 42,
        kind: "note",
        body: "Chaim Berkowitz",
        scope: "shidduch",
        reference_link_id: null,
        metadata: { source: "inbox_item", inbox_item_id: item.id },
      },
    });
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();

    // Story 10.5: resolving -> note inserted -> resolved
    expect(dataProvider.update).toHaveBeenCalledTimes(3);
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "resolved",
          resolved_shidduchim_id: 42,
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("falls back to an empty body when the captured item has no raw_text (e.g. a photo-only share)", async () => {
    // Arrange
    const item = buildItem({ raw_text: null });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({ data: expect.objectContaining({ body: "" }) }),
    );
  });

  it("is idempotent: a second resolveAsLinkToExisting does not insert a second note", async () => {
    const item = buildItem({ raw_text: "Chaim Berkowitz" });
    const { screen, dataProvider } = await renderProbe(item);

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    expect(dataProvider.create).toHaveBeenCalledTimes(1);
  });

  it("Story 10.4: carries inbox attachments into the linked shidduch", async () => {
    const item = buildItem({
      raw_text: "Chaim Berkowitz",
      attachments: [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: "1/inbox-resume.pdf",
          src: "https://example.test/resume.pdf",
        },
      ],
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();

    expect(dataProvider.copyInboxAttachmentsToEntityFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: item.attachments,
        targetType: "shidduch",
        targetId: 42,
        visibility: "shared",
      }),
    );
  });
});

describe("useResolveInboxItem — dismissInboxItem (InboxResolveDialog's Dismiss, never lets the item disappear)", () => {
  it("marks the item dismissed, never deletes it", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "dismissInboxItem" }).click();

    // Assert
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();
    expect(dataProvider.update).toHaveBeenLastCalledWith(
      "inbox_items",
      expect.objectContaining({
        id: item.id,
        data: expect.objectContaining({
          status: "dismissed",
          resolution_attempt_id: null,
          resolution_input: null,
        }),
      }),
    );
  });

  it("is idempotent: a second dismiss is a no-op", async () => {
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    // Story 10.5: the first call moves unresolved -> resolving -> dismissed.
    // The second call observes resolved/dismissed and returns immediately.
    // Only the first call's second update (finalization) mutates the DB.
    expect(dataProvider.update).toHaveBeenCalledTimes(2);
  });
});

describe("useResolveInboxItem — Story 10.5 idempotency edge cases", () => {
  it("returns the existing shidduch when the item was already resolved as new", async () => {
    const item = buildItem({
      status: "resolved",
      resolved_shidduchim_id: 99,
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the item was already dismissed", async () => {
    const item = buildItem({ status: "dismissed" });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "dismissInboxItem" }).click();
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();

    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("throws when another incompatible resolution is already in progress", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "other-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 99, shadchan_id: null },
      },
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect
      .element(
        screen.getByText(
          "error:Another resolution is already in progress for inbox item 1.",
        ),
      )
      .toBeInTheDocument();

    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
  });

  it("resumes a compatible in-progress resolution (takeover) on retry", async () => {
    const item = buildItem({
      status: "resolving",
      resolution_attempt_id: "old-attempt",
      resolution_input: {
        action: "new",
        input: { single_id: 5, shadchan_id: 7 },
      },
    });
    const { screen, dataProvider } = await renderProbe(item);

    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();

    // Takes over the existing lock and completes the resolve.
    expect(dataProvider.createShidduch).toHaveBeenCalledTimes(1);
  });
});
