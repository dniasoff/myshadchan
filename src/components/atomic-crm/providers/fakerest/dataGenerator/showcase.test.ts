import { describe, expect, it, vi } from "vitest";

import { GENERATED_DEMO_IDENTITIES } from "../../../../../../supabase/functions/seed_demo/assets/identity_manifest";
import { ASSETS_BASE64 as EDGE_ASSETS_BASE64 } from "../../../../../../supabase/functions/seed_demo/assets/manifest_base64";
import { createDataProvider } from "../dataProvider";
import { DEMO_PROFILE_ASSETS } from "./fileAssets";
import { assetBase64, DEMO_SHARE_ASSET_KEY } from "./assets";
import generateData from "./index";
import { applyShowcaseOverlay, generateShowcaseData } from "./showcase";

const SHOWCASE_COLLECTIONS = [
  "invites",
  "single_preferences",
  "single_notes",
  "connection_invites",
  "threads",
  "thread_participants",
  "messages",
  "message_notifications",
  "task_notifications",
  "listing_withdrawal_locks",
  "share_links",
  "share_access_log",
  "child_grants",
  "trusted_senders",
] as const;

const REQUIRED_SHOWCASE_COLLECTIONS = [
  ...SHOWCASE_COLLECTIONS,
  "connections",
  "listings",
  "references",
  "reference_links",
  "redts",
  "shidduch_education",
  "resumes",
  "resume_photos",
  "entity_files",
  "medical_notes",
  "shidduchim_external_links",
  "date_records",
  "interactions",
  "tasks",
  "analytics_events",
  "inbox_items",
] as const;

describe("FakeRest showcase fixture", () => {
  it("keeps the controlled baseline empty for showcase-only collections", () => {
    const baseline = generateData();

    for (const collection of SHOWCASE_COLLECTIONS) {
      expect(baseline[collection], collection).toHaveLength(0);
    }
  });

  it("is a one-family showcase: the user holds exactly one context", () => {
    const baseline = generateData();
    const showcase = generateShowcaseData();

    // Only the family's own household is named and flagged as the demo
    // context; the others keep their generated names and are not the user's.
    expect(showcase.accounts[0].name).toBe("The Klein Family");
    expect(
      showcase.accounts.filter((account) => account.demo_bundle_context),
    ).toHaveLength(1);
    expect(showcase.members.find((member) => member.user_id === "0")).toEqual(
      baseline.members.find((member) => member.user_id === "0"),
    );
    expect(
      baseline.account_members.filter(
        (membership) => membership.user_id === "0",
      ),
    ).toHaveLength(2);
    expect(
      showcase.account_members
        .filter((membership) => membership.user_id === "0")
        .map(({ account_id, role, status }) => ({ account_id, role, status })),
      // Exactly one — two or more is what renders the context switcher.
    ).toEqual([{ account_id: 1, role: "parent_admin", status: "active" }]);
    expect(showcase.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: "1",
          first_name: "Dovid",
          last_name: "Klein",
        }),
        expect.objectContaining({
          user_id: "2",
          first_name: "Leah",
          last_name: "Feldman",
        }),
        expect.objectContaining({
          user_id: "3",
          first_name: "Miriam",
          last_name: "Gross",
        }),
      ]),
    );
  });

  it("covers both singles in every pipeline stage and preserves existing ids", () => {
    const baseline = generateData();
    const showcase = generateShowcaseData();
    const stages = [
      "new",
      "look_into",
      "not_sure",
      "for_sure_not",
      "yes",
      "unsure",
      "no",
    ];

    expect(showcase.shidduchim.length).toBeGreaterThanOrEqual(20);
    expect(showcase.shidduchim.map((row) => row.id)).toEqual(
      expect.arrayContaining(baseline.shidduchim.map((row) => row.id)),
    );

    for (const singleId of [1, 2]) {
      for (const stage of stages) {
        expect(
          showcase.shidduchim.some(
            (row) => row.single_id === singleId && row.pipeline_state === stage,
          ),
          `single ${singleId} has ${stage}`,
        ).toBe(true);
      }
    }
  });

  it("seeds non-empty linked workflow collections with valid core foreign keys", () => {
    const db = generateShowcaseData();
    const accountIds = new Set(db.accounts.map((row) => row.id));
    const memberIds = new Set(db.members.map((row) => row.id));
    const accountMemberIds = new Set(db.account_members.map((row) => row.id));
    const singleIds = new Set(db.singles.map((row) => row.id));
    const shidduchIds = new Set(db.shidduchim.map((row) => row.id));
    const connectionIds = new Set(db.connections.map((row) => row.id));
    const threadIds = new Set(db.threads.map((row) => row.id));
    const shareLinkIds = new Set(db.share_links.map((row) => row.id));

    for (const collection of REQUIRED_SHOWCASE_COLLECTIONS) {
      expect(db[collection], collection).not.toHaveLength(0);
    }
    expect(db.inbox_items.map((row) => row.status)).toEqual(
      expect.arrayContaining([
        "unresolved",
        "resolving",
        "resolved",
        "dismissed",
        "held",
      ]),
    );
    expect(
      db.inbox_items.some((row) => (row.attachments?.length ?? 0) > 0),
    ).toBe(true);
    for (const attachment of db.inbox_items.flatMap(
      (row) => row.attachments ?? [],
    )) {
      const decoded = atob(attachment.src.split(",")[1] ?? "");
      expect(decoded.startsWith("%PDF"), attachment.title).toBe(true);
      expect(decoded.includes("%%EOF"), attachment.title).toBe(true);
      expect(decoded.length, attachment.title).toBeGreaterThan(100_000);
    }

    expect(db.invites.every((row) => accountIds.has(row.account_id))).toBe(
      true,
    );
    expect(
      db.invites.every(
        (row) =>
          row.target_single_id == null ||
          singleIds.has(Number(row.target_single_id)),
      ),
    ).toBe(true);
    expect(
      db.single_preferences.every((row) => singleIds.has(row.single_id)),
    ).toBe(true);
    expect(db.single_notes.every((row) => singleIds.has(row.single_id))).toBe(
      true,
    );
    expect(
      db.connection_invites.every((row) =>
        accountIds.has(row.inviter_account_id),
      ),
    ).toBe(true);
    expect(
      db.threads.every(
        (row) =>
          (row.account_id == null &&
            connectionIds.has(Number(row.connection_id))) ||
          (row.account_id != null && accountIds.has(row.account_id)),
      ),
    ).toBe(true);
    expect(
      db.threads
        .filter((row) => row.subject_type === "shidduch")
        .every((row) => shidduchIds.has(Number(row.subject_id))),
    ).toBe(true);
    expect(
      db.thread_participants.every(
        (row) =>
          threadIds.has(row.thread_id) && accountMemberIds.has(row.member_id),
      ),
    ).toBe(true);
    expect(db.messages.every((row) => threadIds.has(row.thread_id))).toBe(true);
    expect(
      db.listing_withdrawal_locks.every((row) => singleIds.has(row.single_id)),
    ).toBe(true);
    expect(db.share_links.every((row) => singleIds.has(row.single_id))).toBe(
      true,
    );
    expect(
      db.share_access_log.every((row) => shareLinkIds.has(row.share_link_id)),
    ).toBe(true);
    expect(
      db.child_grants.every(
        (row) =>
          accountIds.has(row.proposer_account_id) &&
          singleIds.has(row.target_single_id) &&
          (row.grantee_account_id == null ||
            accountIds.has(row.grantee_account_id)),
      ),
    ).toBe(true);
    expect(
      db.trusted_senders.every(
        (row) => accountIds.has(row.account_id) && row.email.includes("@"),
      ),
    ).toBe(true);
    expect(db.trusted_senders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: 1,
          email: "mrs.feldman@demo.invalid",
        }),
        expect.objectContaining({
          account_id: 3,
          email: "goldenmatches@demo.invalid",
        }),
      ]),
    );
    expect(
      db.trusted_senders.every((row) =>
        [1, 3].includes(Number(row.account_id)),
      ),
    ).toBe(true);
    expect(
      db.inbox_items
        .filter((row) => row.resolved_shidduchim_id != null)
        .every((row) => shidduchIds.has(Number(row.resolved_shidduchim_id))),
    ).toBe(true);
    expect(db.tasks.flatMap((row) => row.delivery_channels)).not.toContain(
      "push",
    );
    expect(db.members.every((row) => memberIds.has(row.id))).toBe(true);
  });

  it("matches the official relationship, listing, and receipt graph exactly", () => {
    const db = generateShowcaseData();

    expect(db.invites).toHaveLength(3);
    expect(db.invites.map((row) => row.status).sort()).toEqual([
      "accepted",
      "accepted",
      "pending",
    ]);
    expect(db.connection_invites).toHaveLength(2);
    expect(db.connection_invites.map((row) => row.status).sort()).toEqual([
      "accepted",
      "revoked",
    ]);
    expect(db.child_grants).toHaveLength(2);
    expect(db.child_grants.map((row) => row.status).sort()).toEqual([
      "accepted",
      "revoked",
    ]);

    expect(db.threads).toHaveLength(1);
    expect(db.threads[0]).toMatchObject({
      account_id: null,
      connection_id: 1,
      subject_type: "relationship",
    });
    expect(db.thread_participants).toHaveLength(2);
    expect(db.thread_participants.every((row) => row.thread_id === 1)).toBe(
      true,
    );
    expect(db.messages).toHaveLength(2);
    expect(db.messages.every((row) => row.thread_id === 1)).toBe(true);
    expect(db.messages.every((row) => row.connection_id === 1)).toBe(true);

    expect(db.listings).toEqual([
      expect.objectContaining({
        account_id: 2,
        listing_type: "shadchan",
      }),
    ]);
    expect(db.listing_withdrawal_locks).toEqual([
      expect.objectContaining({ account_id: 1, single_id: 1 }),
    ]);

    expect(db.message_notifications).toHaveLength(2);
    expect(
      db.message_notifications.every(
        (row) => row.account_id === 1 && row.connection_id === 1,
      ),
    ).toBe(true);
    expect(db.share_access_log).toHaveLength(1);
    expect(db.share_access_log[0]).toMatchObject({
      share_link_id: 1,
      resource: "profile",
      simulated: true,
      recipient_shadchan_id: null,
    });
  });

  it("maps a polished resume and synthetic portrait to every opposite-sex profile", () => {
    const baseline = generateData();
    const db = generateShowcaseData();

    expect(DEMO_PROFILE_ASSETS).toHaveLength(22);
    expect(
      new Set(DEMO_PROFILE_ASSETS.map((profile) => profile.slug)).size,
    ).toBe(22);
    expect(baseline.resumes).toHaveLength(8);
    expect(db.resumes).toHaveLength(22);
    expect(db.resume_photos).toHaveLength(22);

    for (const profile of DEMO_PROFILE_ASSETS) {
      const targetSingle = profile.targetSingleId
        ? db.singles.find((single) => single.id === profile.targetSingleId)
        : undefined;
      if (targetSingle) {
        expect(profile.sex).toBe(
          targetSingle.gender === "female" ? "male" : "female",
        );
      }

      const resume = db.resumes.find((row) =>
        profile.subject.singleId != null
          ? row.single_id === profile.subject.singleId
          : row.shidduchim_id === profile.subject.shidduchimId,
      );
      expect(resume, profile.name).toBeDefined();
      const expectedResumeNames = [
        ...(profile.previousResumeAssets ?? []),
        profile.resumeAsset,
      ].map((asset) => asset.split("/").at(-1));
      expect(resume?.files?.map((file) => file.filename)).toEqual(
        expectedResumeNames,
      );

      const photo = db.resume_photos.find(
        (row) => row.resume_id === resume?.id,
      );
      expect(photo?.path, profile.name).toMatch(
        new RegExp(`${profile.slug}\\.jpg$`),
      );
      expect(photo?.visibility).toBe(profile.visibility);

      if (profile.subject.shidduchimId != null) {
        const suggestion = db.shidduchim.find(
          (row) => row.id === profile.subject.shidduchimId,
        );
        expect(suggestion?.name_en).toBe(profile.name);
        expect(suggestion?.single_id).toBe(profile.targetSingleId);
      }
    }

    expect(
      DEMO_PROFILE_ASSETS.map((profile) => ({
        slug: profile.slug,
        name: profile.name,
        subjectType: profile.subject.singleId != null ? "single" : "shidduch",
        subjectId:
          profile.subject.singleId ?? profile.subject.shidduchimId ?? null,
        targetSingleId: profile.targetSingleId,
        sex: profile.sex,
      })),
    ).toEqual(
      GENERATED_DEMO_IDENTITIES.map(({ age: _age, ...identity }) => identity),
    );
  });

  it("is deterministic for every persisted row and asset path", () => {
    const generatedAt = new Date("2026-08-23T07:10:13.244Z");
    const first = generateShowcaseData(generatedAt);
    const second = generateShowcaseData(generatedAt);
    const summarize = (db: ReturnType<typeof generateShowcaseData>) =>
      Object.fromEntries(
        Object.entries(db)
          .filter(([, value]) => Array.isArray(value))
          .map(([name, rows]) => [name, JSON.stringify(rows)]),
      );

    expect(summarize(first)).toEqual(summarize(second));
  });

  it("moves every seeded date field onto the generated showcase timeline", () => {
    const generatedAt = new Date("2030-01-02T03:04:05.000Z");
    const db = generateShowcaseData(generatedAt);
    const dateFields = [
      "created_at",
      "updated_at",
      "uploaded_at",
      "sent_at",
      "accessed_at",
      "accepted_at",
      "revoked_at",
      "expires_at",
      "due_date",
      "done_date",
      "locked_at",
      "last_read_at",
      "first_suggested_at",
      "redt_date",
      "date_on",
    ];
    const rows = Object.values(db).flatMap((value) =>
      Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [],
    );

    for (const field of dateFields) {
      const values = rows
        .map((row) => row[field])
        .filter((value): value is string => typeof value === "string");
      expect(values.length, field).toBeGreaterThan(0);
      expect(
        values.every((value) => value !== "2026-08-01T00:00:00.000Z"),
        field,
      ).toBe(true);
      expect(
        values.every((value) => !Number.isNaN(Date.parse(value))),
        field,
      ).toBe(true);
    }
  });

  it("ships matching, deterministic bytes for the polished pre-watermarked artifact", async () => {
    const encoded = assetBase64(DEMO_SHARE_ASSET_KEY);
    const decoded = atob(encoded);

    expect(decoded.startsWith("%PDF-1.4")).toBe(true);
    expect(decoded).toContain("%%EOF");
    expect(decoded.length).toBeGreaterThan(100_000);
    expect(encoded).toBe(EDGE_ASSETS_BASE64[DEMO_SHARE_ASSET_KEY]);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
    );
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(sha256).toBe(
      "6cef54fe67244b920569940d665b80a3bafcbda31e9f8b9cb1a50a13c5b3b86c",
    );
  });

  it("seedDemo and clearDemo replace the complete official graph", async () => {
    const db = generateData();
    const provider = createDataProvider({ db, latency: 0, silent: true });
    const listParams = {
      filter: {},
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" as const },
    };

    expect(await provider.currentAccountDemo()).toBe(false);
    await provider.seedDemo();
    expect(await provider.currentAccountDemo()).toBe(true);
    expect(
      (await provider.getList("share_links", listParams)).data,
    ).not.toHaveLength(0);
    expect(
      (await provider.getList("message_notifications", listParams)).data,
    ).toHaveLength(2);
    expect(
      (await provider.getList("message_notifications", listParams)).data,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ simulated: true, status: "sent" }),
      ]),
    );
    expect(
      (await provider.getList("task_notifications", listParams)).data,
    ).toEqual([expect.objectContaining({ simulated: true, status: "sent" })]);
    const history = await provider.rpc?.("demo_delivery_history", {});
    expect(history).toHaveLength(4);
    const deliveryHistory = history as Array<{
      event_type?: string;
      simulated?: boolean;
    }>;
    expect(deliveryHistory.map((event) => event.event_type).sort()).toEqual([
      "message",
      "message",
      "reminder",
      "share",
    ]);
    expect(deliveryHistory.every((event) => event.simulated === true)).toBe(
      true,
    );

    await provider.clearDemo(false);
    expect(await provider.currentAccountDemo()).toBe(false);
    for (const collection of SHOWCASE_COLLECTIONS) {
      expect(
        (await provider.getList(collection, listParams)).data,
        collection,
      ).toHaveLength(0);
    }
    expect(await provider.rpc?.("demo_delivery_history", {})).toEqual([]);
  });

  it("gives each FakeRest showcase instance fresh secret tokens and dynamic expiry", async () => {
    const first = createDataProvider({
      db: generateData(),
      latency: 0,
      silent: true,
    });
    const second = createDataProvider({
      db: generateData(),
      latency: 0,
      silent: true,
    });
    await first.seedDemo();
    await second.seedDemo();
    const params = {
      filter: {},
      pagination: { page: 1, perPage: 20 },
      sort: { field: "id", order: "ASC" as const },
    };
    const firstShare = (await first.getList("share_links", params)).data[0];
    const secondShare = (await second.getList("share_links", params)).data[0];
    expect(firstShare.token).not.toBe(secondShare.token);
    expect(firstShare.token).toHaveLength(72);
    expect(firstShare.expires_at).not.toBe("2026-08-31T00:00:00.000Z");
    expect(firstShare.expires_at).toBeTruthy();
    const invites = (await first.getList("invites", params)).data;
    expect(
      invites.every((invite) => invite.email.endsWith("@demo.invalid")),
    ).toBe(true);

    // No switch-away first: the showcase user holds ONE context now, so there
    // is nowhere to switch to. The property still worth asserting is that a
    // reseed leaves them on their own household, which the last line checks.
    await first.clearDemo(false);
    await first.seedDemo();
    const reseededShare = (await first.getList("share_links", params)).data[0];
    expect(reseededShare.token).not.toBe(firstShare.token);
    expect(reseededShare.expires_at).toBeTruthy();
    expect(await first.getCurrentAccountId()).toBe(1);
  });

  it("serializes concurrent seed and clear lifecycle operations", async () => {
    const provider = createDataProvider({
      db: generateData(),
      latency: 2,
      silent: true,
    });

    await Promise.all([provider.seedDemo(), provider.clearDemo(false)]);

    expect(await provider.currentAccountDemo()).toBe(false);
    expect(await provider.getCurrentAccountId()).toBe(1);
    expect(
      (
        await provider.getList("share_links", {
          filter: {},
          pagination: { page: 1, perPage: 1000 },
          sort: { field: "id", order: "ASC" },
        })
      ).data,
    ).toHaveLength(0);
  });

  it("rolls back the complete graph and blob state when a lifecycle mutation fails", async () => {
    const provider = createDataProvider({
      db: generateData(),
      latency: 0,
      silent: true,
    });
    const uploaded = await provider.uploadEntityFile({
      targetType: "single",
      targetId: 1,
      file: new File(["before-seed"], "before-seed.txt", {
        type: "text/plain",
      }),
    });
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {
        throw new Error("deterministic blob cleanup failure");
      });

    try {
      await expect(provider.seedDemo()).rejects.toThrow(
        "deterministic blob cleanup failure",
      );
      expect(await provider.currentAccountDemo()).toBe(false);
      expect(
        (await provider.getOne("entity_files", { id: uploaded.id })).data,
      ).toEqual(expect.objectContaining({ id: uploaded.id }));
      await expect(
        provider.signEntityFileUrl({
          storagePath: uploaded.storage_path,
          fileName: uploaded.file_name,
        }),
      ).resolves.toMatch(/^blob:/);
    } finally {
      revokeObjectUrl.mockRestore();
    }
  });

  it("preserves non-conflicting custom rows when applying the overlay", () => {
    const baseline = generateData();
    baseline.invites.push({
      id: 999,
      token: "custom-invite",
      email: "custom@example.test",
      account_id: 1,
      role: "helper",
      invited_by: 1,
      target_single_id: null,
      status: "pending",
      expires_at: "2026-10-01T00:00:00.000Z",
      accepted_at: null,
      created_at: "2026-08-01T00:00:00.000Z",
    });

    const showcase = applyShowcaseOverlay(baseline);

    expect(showcase.invites.some((row) => row.id === 999)).toBe(true);
  });

  it("mirrors manager-versus-single privacy for notes and preferences", async () => {
    const db = generateShowcaseData();
    const listParams = {
      filter: {},
      pagination: { page: 1, perPage: 50 },
      sort: { field: "id", order: "ASC" as const },
    };
    const parentProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: 0 }) },
    });

    expect(
      (await parentProvider.getList("single_notes", listParams)).data.map(
        (row) => row.id,
      ),
    ).toEqual([2]);
    expect(
      (await parentProvider.getList("single_preferences", listParams)).data.map(
        (row) => row.id,
      ),
    ).toEqual([1]);

    db.account_members.push({
      id: 99,
      account_id: 1,
      user_id: "rivky-demo",
      role: "single",
      status: "active",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const rivky = db.singles.find((single) => single.id === 1);
    if (!rivky) throw new Error("Rivky fixture missing");
    rivky.member_id = 99;
    const singleProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: "rivky-demo" }) },
    });

    expect(
      (
        await singleProvider.getList("single_notes", {
          ...listParams,
          filter: { single_id: 1 },
        })
      ).data.map((row) => row.id),
    ).toEqual([1]);
  });
});
