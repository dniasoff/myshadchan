import { createDataProvider } from "./dataProvider";
import type { ReferenceLink } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

const linksFor = async (
  dataProvider: ReturnType<typeof makeProvider>,
  referenceId: number,
): Promise<ReferenceLink[]> => {
  const { data } = await dataProvider.getList<ReferenceLink>(
    "reference_links",
    {
      filter: { reference_id: referenceId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
  );
  return data;
};

describe("previewReferenceMerge", () => {
  it("counts links, interactions and open tasks owned by the loser", async () => {
    // Arrange -- reference #2 (the near-duplicate) has exactly one link and
    // one open task in the seed data.
    const dataProvider = makeProvider();
    // Act
    const preview = await dataProvider.previewReferenceMerge(2, 1);
    // Assert
    expect(preview.loser.id).toBe(2);
    expect(preview.winner.id).toBe(1);
    expect(preview.reference_links_count).toBe(1);
    expect(preview.open_tasks_count).toBe(1);
    expect(preview.collisions).toEqual([]);
  });

  it("reports a collision when both references are linked to the same shidduch", async () => {
    // Arrange -- link reference #2 to shidduch #9, which reference #1 is
    // already linked to in the seed.
    const dataProvider = makeProvider();
    await dataProvider.linkReferenceToShidduch({
      reference_id: 2,
      shidduchim_id: 9,
    });
    // Act
    const preview = await dataProvider.previewReferenceMerge(2, 1);
    // Assert
    expect(preview.collisions).toHaveLength(1);
    expect(preview.collisions[0].shidduchim_id).toBe(9);
  });

  it("rejects previewing a reference that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(dataProvider.previewReferenceMerge(999999, 1)).rejects.toThrow(
      /not found/,
    );
  });
});

describe("mergeReferences", () => {
  it("rejects merging a reference into itself", async () => {
    const dataProvider = makeProvider();
    await expect(dataProvider.mergeReferences(1, 1)).rejects.toThrow(/itself/);
  });

  it("throws when a collision has no resolution", async () => {
    // Arrange
    const dataProvider = makeProvider();
    await dataProvider.linkReferenceToShidduch({
      reference_id: 2,
      shidduchim_id: 9,
    });
    // Act / Assert
    await expect(dataProvider.mergeReferences(2, 1, {})).rejects.toThrow(
      /unresolved/,
    );
  });

  it("moves non-colliding links, interactions and tasks, then deletes the loser", async () => {
    // Arrange -- no collision: reference #2's only link (shidduch #4) does
    // not overlap with reference #1's links (shidduch #1, #9, #12).
    const dataProvider = makeProvider();
    // Act
    const winnerId = await dataProvider.mergeReferences(2, 1, {});
    // Assert
    expect(winnerId).toBe(1);
    await expect(
      dataProvider.getOne("references", { id: 2 }),
    ).rejects.toThrow();

    const winnerLinks = await linksFor(dataProvider, 1);
    expect(
      winnerLinks.map((l) => Number(l.shidduchim_id)).sort((a, b) => a - b),
    ).toEqual([1, 4, 9, 12]);

    const { data: tasks } = await dataProvider.getList("tasks", {
      filter: { target_type: "reference", target_id: 1 },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    const openTasks = tasks.filter((task) => !task.done_date);
    expect(openTasks.length).toBeGreaterThanOrEqual(2); // reference #1's + #2's own reminder
  });

  it('resolution "both" concatenates what_they_said and merges the conversation log', async () => {
    // Arrange -- create a genuine collision on shidduch #9 with call data on
    // both sides.
    const dataProvider = makeProvider();
    const collidingLink = await dataProvider.linkReferenceToShidduch({
      reference_id: 2,
      shidduchim_id: 9,
    });
    await dataProvider.logReferenceCall({
      reference_link_id: collidingLink.id,
      call_status: "answered",
      what_they_said: "Loser side account.",
    });
    const { data: winnerLinkBefore } =
      await dataProvider.getList<ReferenceLink>("reference_links", {
        filter: { reference_id: 1, shidduchim_id: 9 },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
    const winnerLinkId = winnerLinkBefore[0].id;

    // Act
    await dataProvider.mergeReferences(2, 1, { "9": "both" });

    // Assert
    const { data: winnerLink } = await dataProvider.getOne<ReferenceLink>(
      "reference_links",
      { id: winnerLinkId },
    );
    expect(winnerLink.what_they_said).toContain("Loser side account.");
    expect((winnerLink.conversation_log ?? []).length).toBeGreaterThanOrEqual(
      2,
    );

    // The collision link itself is gone, but only that one row -- the rest
    // of the loser's links still moved over.
    const winnerLinks = await linksFor(dataProvider, 1);
    expect(winnerLinks.filter((l) => l.shidduchim_id === 9)).toHaveLength(1);
  });
});
