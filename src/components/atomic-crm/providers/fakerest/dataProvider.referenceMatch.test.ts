import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { ReferenceLink } from "../../types";

const makeProvider = () => createDataProvider({ latency: 0, silent: true });
const SINGLE_USER_ID = "reference-match-single";

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

describe("addResumeReferenceToShidduch", () => {
  it("reuses the matching reference and keeps retries idempotent", async () => {
    const dataProvider = makeProvider();

    const first = await dataProvider.addResumeReferenceToShidduch({
      shidduchim_id: 2,
      name_en: "Chaim Feldman",
      phone: "0542223344",
    });
    const { data: beforeRetry } = await dataProvider.getList("references", {
      filter: { name_en: "Chaim Feldman" },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    const second = await dataProvider.addResumeReferenceToShidduch({
      shidduchim_id: 2,
      name_en: "Chaim Feldman",
      phone: "0542223344",
    });

    expect(first.status).toBe("linked");
    expect(second).toEqual(first);
    expect(
      (
        await dataProvider.getList("references", {
          filter: { name_en: "Chaim Feldman" },
          pagination: { page: 1, perPage: 100 },
          sort: { field: "id", order: "ASC" },
        })
      ).data,
    ).toHaveLength(beforeRetry.length);
  });

  it("marks the link interaction with the RPC's resume-add provenance", async () => {
    const dataProvider = makeProvider();

    const result = await dataProvider.addResumeReferenceToShidduch({
      shidduchim_id: 2,
      name_en: "Resume Provenance Reference",
      phone: "732-555-0188",
    });

    const { data: interactions } = await dataProvider.getList("interactions", {
      filter: { reference_link_id: result.link_id, kind: "link_created" },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });

    expect(interactions).toHaveLength(1);
    expect(interactions[0].metadata).toEqual({
      shidduchim_id: 2,
      source: "resume_reference_add",
    });
  });

  it("does not create a row when the phone evidence is ambiguous", async () => {
    const dataProvider = makeProvider();
    const { data: before } = await dataProvider.getList("references", {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });

    const result = await dataProvider.addResumeReferenceToShidduch({
      shidduchim_id: 2,
      name_en: "Someone Else",
      phone: "0542223344",
    });

    const { data: after } = await dataProvider.getList("references", {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(after).toHaveLength(before.length);
  });

  it("rejects a single before the FakeRest add path can write", async () => {
    const db = generateData();
    db.account_members = [
      ...db.account_members,
      {
        id: 9001,
        account_id: db.accounts[0].id,
        user_id: SINGLE_USER_ID,
        role: "single",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: SINGLE_USER_ID }) },
    });

    await expect(
      dataProvider.addResumeReferenceToShidduch({
        shidduchim_id: 2,
        name_en: "Single Cannot Add",
      }),
    ).rejects.toThrow("a single cannot create references");
  });

  it("rejects an empty identity before the FakeRest add path can write", async () => {
    const dataProvider = makeProvider();

    await expect(
      dataProvider.addResumeReferenceToShidduch({
        shidduchim_id: 2,
        name_en: "   ",
        phone: "",
      }),
    ).rejects.toThrow("a reference needs a name or phone number");
  });

  it("serializes concurrent new-person adds like the account RPC", async () => {
    const dataProvider = makeProvider();
    const input = {
      shidduchim_id: 2,
      name_en: "Concurrent New Reference",
      phone: "732-555-0199",
    };

    const results = await Promise.all([
      dataProvider.addResumeReferenceToShidduch(input),
      dataProvider.addResumeReferenceToShidduch(input),
    ]);
    const { data: references } = await dataProvider.getList("references", {
      filter: { name_en: input.name_en },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    const { data: links } = await dataProvider.getList("reference_links", {
      filter: { reference_id: results[0].reference_id, shidduchim_id: 2 },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });

    expect(results.map((result) => result.reference_id)).toEqual([
      results[0].reference_id,
      results[0].reference_id,
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "created",
      "linked",
    ]);
    expect(references).toHaveLength(1);
    expect(links).toHaveLength(1);
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
