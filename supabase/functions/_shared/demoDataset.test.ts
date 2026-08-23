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
    expect(
      OFFICIAL_DEMO_BUNDLE.scenarios.find(
        (scenario) => scenario.key === "simulated-message-email",
      ),
    ).toMatchObject({ kind: "message", state: "sent" });
  });

  it("keeps synthetic actor display names separate from their private credentials", () => {
    expect(OFFICIAL_DEMO_BUNDLE.actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "dovid-klein",
          firstName: "Dovid",
          lastName: "Klein",
          contextKey: "primary-household",
          address: "dovid.klein@demo.invalid",
        }),
        expect.objectContaining({
          key: "leah-feldman",
          firstName: "Leah",
          lastName: "Feldman",
          address: "leah.feldman@demo.invalid",
        }),
        expect.objectContaining({
          key: "miriam-gross",
          firstName: "Miriam",
          lastName: "Gross",
          address: "miriam.gross@demo.invalid",
        }),
      ]),
    );
    expect(
      OFFICIAL_DEMO_BUNDLE.actors.map(({ key, role }) => ({ key, role })),
    ).toEqual(
      expect.arrayContaining([
        { key: "dovid-klein", role: "parent_admin" },
        { key: "leah-feldman", role: "shadchan" },
        { key: "miriam-gross", role: "parent_admin" },
      ]),
    );
    expect(OFFICIAL_DEMO_BUNDLE.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "primary-household",
          kind: "household",
          name: "The Klein Family",
          root: true,
        }),
        expect.objectContaining({
          key: "feldman-shadchanus",
          kind: "shadchanus",
        }),
        expect.objectContaining({
          key: "gross-household",
          kind: "household",
        }),
      ]),
    );
  });

  it("keeps the complete straight-only pipeline contract", () => {
    expect(() => validateDemoDataset()).not.toThrow();
    expect(SINGLES.map((single) => single.gender).sort()).toEqual([
      "female",
      "male",
    ]);
    expect(RIVKY_SUGGESTIONS).toHaveLength(13);
    expect(YAAKOV_SUGGESTIONS).toHaveLength(7);
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
