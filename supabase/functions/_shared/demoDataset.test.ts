import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ENTITY_FILES,
  OFFICIAL_DEMO_BUNDLE,
  OFFICIAL_DEMO_SCENARIO_INVENTORY,
  PROFILE_ASSETS,
  RESUME_FILES,
  RESUME_PHOTOS,
  RIVKY_SUGGESTIONS,
  SHADCHANIM,
  SINGLES,
  validateDemoDataset,
  validateOfficialDemoBundle,
  YAAKOV_SUGGESTIONS,
} from "./demoDataset";
import { ASSETS_BASE64 } from "../seed_demo/assets/manifest_base64";
import { GENERATED_DEMO_IDENTITIES } from "../seed_demo/assets/identity_manifest";
import { ASSETS_BASE64 as FAKEREST_ASSETS_BASE64 } from "../../../src/components/atomic-crm/providers/fakerest/dataGenerator/assets_base64";

const DEMO_SHARE_ASSET_KEY = "misc/rivky-klein-for-leah-feldman.pdf";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("persistent demo dataset", () => {
  it("keeps the official scenario inventory exact and classifies message delivery as a message", () => {
    expect(() => validateOfficialDemoBundle()).not.toThrow();
    expect(OFFICIAL_DEMO_BUNDLE.scenarios).toEqual(
      OFFICIAL_DEMO_SCENARIO_INVENTORY,
    );
    // A message delivery needs a correspondent, and there is nobody to
    // message in a one-family demo. The deliveries that remain are the ones
    // the product sends TO this family.
    expect(
      OFFICIAL_DEMO_BUNDLE.scenarios.some(
        (scenario) => scenario.kind === "message",
      ),
    ).toBe(false);
    expect(
      OFFICIAL_DEMO_BUNDLE.scenarios.find(
        (scenario) => scenario.key === "simulated-reminder-email",
      ),
    ).toMatchObject({ kind: "reminder", state: "sent" });
  });

  it("keeps synthetic actor display names separate from their private credentials", () => {
    expect(OFFICIAL_DEMO_BUNDLE.actors).toEqual([
      expect.objectContaining({
        key: "dovid-klein",
        firstName: "Dovid",
        lastName: "Klein",
        contextKey: "primary-household",
        address: "dovid.klein@demo.invalid",
        role: "parent_admin",
      }),
      expect.objectContaining({
        key: "sarah-klein",
        firstName: "Sarah",
        lastName: "Klein",
        contextKey: "primary-household",
        address: "sarah.klein@demo.invalid",
        role: "parent_admin",
      }),
    ]);
  });

  it("is a single-tenant demo: one household, one synthetic actor", () => {
    // The demo is one family trying the product. It used to seed a shadchanus
    // office and a second household so the connection, cross-household grant
    // and two-party discussion scenarios had a counterparty — which also put a
    // context switcher in the app bar, because ContextSwitcher renders for any
    // login holding two or more contexts.
    //
    // Asserted as an exact list rather than `arrayContaining`, so a companion
    // context cannot be reintroduced without this failing. That matters: the
    // activation gate counts contexts, so a silent extra one fails a demo run
    // in production rather than here.
    expect(OFFICIAL_DEMO_BUNDLE.contexts).toEqual([
      {
        key: "primary-household",
        kind: "household",
        name: "The Klein Family",
        root: true,
      },
    ]);
    // Both actors sit in the ONE household: a second parent is the same
    // family, not a second tenant.
    expect(OFFICIAL_DEMO_BUNDLE.actors).toHaveLength(2);
    expect(
      OFFICIAL_DEMO_BUNDLE.actors.every(
        (actor) => actor.contextKey === "primary-household",
      ),
    ).toBe(true);
  });

  it("declares no scenario that would need a second account", () => {
    // Connections, child grants and two-party discussions are all real
    // product features with their own RLS suites — they are simply not part
    // of a one-family demo, and a scenario listed here with no counterparty
    // to seed it against would be a promise the seed cannot keep.
    const kinds = new Set(
      OFFICIAL_DEMO_BUNDLE.scenarios.map((scenario) => scenario.kind),
    );
    expect(kinds.has("connection")).toBe(false);
    expect(kinds.has("grant")).toBe(false);
    expect(kinds.has("discussion")).toBe(false);
    expect(
      OFFICIAL_DEMO_BUNDLE.scenarios.some((scenario) => scenario.dependsOn),
    ).toBe(false);
  });

  it("keeps the complete straight-only pipeline contract", () => {
    expect(() => validateDemoDataset()).not.toThrow();
    expect(SINGLES.map((single) => single.gender).sort()).toEqual([
      "female",
      "male",
    ]);
    expect(RIVKY_SUGGESTIONS).toHaveLength(13);
    expect(YAAKOV_SUGGESTIONS).toHaveLength(7);
    expect(SHADCHANIM).toHaveLength(5);
    expect(SHADCHANIM.map((shadchan) => shadchan.contacts.phone)).toEqual([
      "732-555-0101",
      "732-555-0102",
      "845-555-0103",
      "718-555-0104",
      "973-555-0105",
    ]);
    expect(
      RIVKY_SUGGESTIONS.every((suggestion) => suggestion.sex === "male"),
    ).toBe(true);
    expect(
      YAAKOV_SUGGESTIONS.every((suggestion) => suggestion.sex === "female"),
    ).toBe(true);

    const stages = [
      "new",
      "look_into",
      "not_sure",
      "for_sure_not",
      "yes",
      "unsure",
      "no",
    ];
    for (const suggestions of [RIVKY_SUGGESTIONS, YAAKOV_SUGGESTIONS]) {
      expect(new Set(suggestions.map((row) => row.targetState))).toEqual(
        new Set(stages),
      );
    }
  });

  it("maps all 22 identities to media-correct local assets", () => {
    expect(PROFILE_ASSETS).toHaveLength(22);
    expect(RESUME_FILES).toHaveLength(25);
    expect(RESUME_PHOTOS).toHaveLength(22);
    expect(Object.keys(ASSETS_BASE64)).toHaveLength(51);

    const usedAssetKeys = [
      ...RESUME_FILES.map((file) => file.assetKey),
      ...RESUME_PHOTOS.map((photo) => photo.assetKey),
      ...ENTITY_FILES.map((file) => file.assetKey),
      DEMO_SHARE_ASSET_KEY,
    ];
    for (const assetKey of usedAssetKeys) {
      expect(assetKey in ASSETS_BASE64, assetKey).toBe(true);
      expect(FAKEREST_ASSETS_BASE64[assetKey], assetKey).toBe(
        ASSETS_BASE64[assetKey],
      );
      const sourceBytes = readFileSync(
        new URL(`../seed_demo/assets/${assetKey}`, import.meta.url),
      );
      expect(sha256(sourceBytes), assetKey).toBe(
        sha256(Buffer.from(ASSETS_BASE64[assetKey], "base64")),
      );
      const bytes = atob(ASSETS_BASE64[assetKey]);
      if (assetKey.endsWith(".pdf")) {
        expect(bytes.slice(0, 4), assetKey).toBe("%PDF");
      } else {
        expect(
          [...bytes.slice(0, 3)].map((character) => character.charCodeAt(0)),
          assetKey,
        ).toEqual([0xff, 0xd8, 0xff]);
      }
    }

    expect(
      PROFILE_ASSETS.filter(
        (profile) => profile.visibility === "private_parent",
      ).map((profile) => profile.slug),
    ).toEqual(["yisroel-fried", "ariella-cohen"]);
  });

  it("matches the generator's canonical identity manifest", () => {
    const allSuggestions = [...RIVKY_SUGGESTIONS, ...YAAKOV_SUGGESTIONS];
    const ageOnShowcaseDate = (dob: string): number => {
      const born = new Date(`${dob}T00:00:00.000Z`);
      const on = new Date("2026-08-21T00:00:00.000Z");
      let age = on.getUTCFullYear() - born.getUTCFullYear();
      if (
        on.getUTCMonth() < born.getUTCMonth() ||
        (on.getUTCMonth() === born.getUTCMonth() &&
          on.getUTCDate() < born.getUTCDate())
      ) {
        age--;
      }
      return age;
    };
    const identities = PROFILE_ASSETS.map((profile) => {
      if (profile.singleKey) {
        const subjectIndex = SINGLES.findIndex(
          (single) => single.first_name_en === profile.singleKey,
        );
        const single = SINGLES[subjectIndex];
        return {
          slug: profile.slug,
          name: `${single.first_name_en} ${single.last_name_en}`,
          subjectType: "single",
          subjectId: subjectIndex + 1,
          targetSingleId: null,
          sex: single.gender,
          age: ageOnShowcaseDate(single.dob),
        };
      }
      const suggestionIndex = allSuggestions.findIndex(
        (suggestion) => suggestion.key === profile.suggestionKey,
      );
      const suggestion = allSuggestions[suggestionIndex];
      return {
        slug: profile.slug,
        name: suggestion.name_en,
        subjectType: "shidduch",
        subjectId: suggestionIndex + 1,
        targetSingleId: suggestionIndex < RIVKY_SUGGESTIONS.length ? 1 : 2,
        sex: suggestion.sex,
        age: suggestion.age,
      };
    });

    expect(identities).toEqual(GENERATED_DEMO_IDENTITIES);
  });
});
