import { createDataProvider } from "./dataProvider";
import type { ReferenceLink } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });

describe("matchReferenceOnEntry", () => {
  it("returns no candidates when nothing identifying is supplied", async () => {
    // Arrange
    const dataProvider = makeProvider();
    // Act
    const candidates = await dataProvider.matchReferenceOnEntry({});
    // Assert
    expect(candidates).toEqual([]);
  });

  it("never returns a candidate on a name match alone", async () => {
    // Arrange -- "Yankel Cohen" (seed reference #8) has no school on file, so
    // a name-only query must not surface him.
    const dataProvider = makeProvider();
    // Act
    const candidates = await dataProvider.matchReferenceOnEntry({
      name_en: "Yankel Cohen",
    });
    // Assert
    expect(candidates).toEqual([]);
  });

  it("returns a candidate on a normalized phone match alone", async () => {
    // Arrange -- the deliberate near-duplicate pair shares one phone number
    // typed in two different formats.
    const dataProvider = makeProvider();
    // Act
    const candidates = await dataProvider.matchReferenceOnEntry({
      phone: "0542223344",
    });
    // Assert
    const ids = candidates.map((c) => c.reference_id).sort();
    expect(ids).toEqual([1, 2]);
    expect(candidates.every((c) => c.confidence >= 0.9)).toBe(true);
    expect(
      candidates.every((c) =>
        c.deciding_facts.some((f) => f.signal === "phone"),
      ),
    ).toBe(true);
  });

  it("returns a candidate on a name match corroborated by a matching school", async () => {
    // Arrange -- "Chaim Feldman" (reference #1) has school "Ner Yisroel".
    const dataProvider = makeProvider();
    // Act
    const candidates = await dataProvider.matchReferenceOnEntry({
      name_en: "Chaim Feldman",
      school: "Ner Yisroel",
    });
    // Assert
    expect(candidates.map((c) => c.reference_id)).toEqual([1]);
    expect(candidates[0].deciding_facts.map((f) => f.signal).sort()).toEqual([
      "name",
      "school",
    ]);
  });

  it("excludes exclude_id from its own candidate list", async () => {
    // Arrange
    const dataProvider = makeProvider();
    // Act -- re-matching reference #1 against the shared phone should only
    // surface reference #2, not itself.
    const candidates = await dataProvider.matchReferenceOnEntry({
      phone: "0542223344",
      exclude_id: 1,
    });
    // Assert
    expect(candidates.map((c) => c.reference_id)).toEqual([2]);
  });
});

describe("linkReferenceToShidduch", () => {
  it("creates a new link for a fresh (reference, shidduch) pair", async () => {
    // Arrange
    const dataProvider = makeProvider();
    // Act
    const link = await dataProvider.linkReferenceToShidduch({
      reference_id: 6,
      shidduchim_id: 2,
    });
    // Assert
    expect(link.reference_id).toBe(6);
    expect(link.shidduchim_id).toBe(2);
    expect(link.call_status).toBe("not_started");
  });

  it("is idempotent -- re-confirming an existing pair returns the existing link", async () => {
    // Arrange -- reference #1 is already linked to shidduch #1 in the seed.
    const dataProvider = makeProvider();
    const { data: before } = await dataProvider.getList<ReferenceLink>(
      "reference_links",
      {
        filter: { reference_id: 1 },
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      },
    );
    // Act
    const link = await dataProvider.linkReferenceToShidduch({
      reference_id: 1,
      shidduchim_id: 1,
    });
    const { data: after } = await dataProvider.getList<ReferenceLink>(
      "reference_links",
      {
        filter: { reference_id: 1 },
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      },
    );
    // Assert -- no new row was created
    expect(after).toHaveLength(before.length);
    expect(link.id).toBe(before.find((l) => l.shidduchim_id === 1)?.id);
  });

  it("rejects linking a reference that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.linkReferenceToShidduch({
        reference_id: 999999,
        shidduchim_id: 1,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects linking to a shidduch that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.linkReferenceToShidduch({
        reference_id: 1,
        shidduchim_id: 999999,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("logReferenceCall", () => {
  it("records the call, appends to the conversation log, and pushes an interaction", async () => {
    // Arrange -- link #4 (reference #2 -> shidduch #4) starts not_started.
    const dataProvider = makeProvider();
    // Act
    const updated = await dataProvider.logReferenceCall({
      reference_link_id: 4,
      call_status: "answered",
      what_they_said: "Great guy.",
    });
    // Assert
    expect(updated.call_status).toBe("answered");
    expect(updated.what_they_said).toBe("Great guy.");
    expect(updated.conversation_log).toHaveLength(1);
    expect(updated.conversation_log?.[0].text).toBe("Great guy.");

    const { data: interactions } = await dataProvider.getList("interactions", {
      filter: { reference_link_id: 4, kind: "call_logged" },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(interactions).toHaveLength(1);
  });

  it("keeps the previous call_status when none is supplied", async () => {
    // Arrange -- link #1 (reference #1 -> shidduch #1) starts "answered".
    const dataProvider = makeProvider();
    // Act
    const updated = await dataProvider.logReferenceCall({
      reference_link_id: 1,
      what_they_said: "Follow-up note.",
    });
    // Assert
    expect(updated.call_status).toBe("answered");
    expect(updated.conversation_log?.length).toBeGreaterThan(1);
  });

  it("rejects logging a call for a link that does not exist", async () => {
    const dataProvider = makeProvider();
    await expect(
      dataProvider.logReferenceCall({ reference_link_id: 999999 }),
    ).rejects.toThrow(/not found/);
  });
});
