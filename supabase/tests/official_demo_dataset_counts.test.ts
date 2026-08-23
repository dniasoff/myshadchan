import { describe, expect, it } from "vitest";

import {
  ENTITY_FILES,
  PROFILE_ASSETS,
  RESUME_FILES,
  RESUME_PHOTOS,
  validateDemoDataset,
} from "../functions/_shared/demoDataset";

describe("official demo dataset storage baseline", () => {
  it("derives the manifest receipts from the curated dataset exports", () => {
    validateDemoDataset();

    const profileCount = PROFILE_ASSETS.length;
    const resumeCount = RESUME_FILES.length;
    const photoCount = RESUME_PHOTOS.length;
    const entityFileCount = ENTITY_FILES.length;
    const documentCount = resumeCount + photoCount;
    const totalCount = documentCount + entityFileCount;

    expect({ profileCount, resumeCount, photoCount, entityFileCount }).toEqual({
      profileCount: 22,
      resumeCount: 25,
      photoCount: 22,
      entityFileCount: 3,
    });
    expect({ totalCount, documentCount, entityFileCount }).toEqual({
      totalCount: 50,
      documentCount: 47,
      entityFileCount: 3,
    });
  });
});
