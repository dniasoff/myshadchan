import type { Identifier } from "ra-core";
import type {
  EntityFile,
  ResumeFileVersion,
  ResumePhoto,
} from "../../../types";
import {
  assetFile,
  assetFileName,
  assetMimeType,
  type AssetKey,
} from "./assets";
import type { Db } from "./types";

/**
 * In-memory "bytes" for the demo's seeded files. The FakeRest provider has
 * no real storage backend, so the same base64 assets are turned into File
 * objects here and their object URLs are kept in these maps.
 */
export interface SeededFileBlobs {
  resumeFiles: Map<string, string>;
  resumePhotos: Map<string, string>;
  entityFiles: Map<string, string>;
}

/**
 * Symbol used to attach the seeded blob maps to the generated Db object so
 * createDataProvider() can populate its own session-local maps without
 * changing the public Db interface.
 */
export const SEEDED_FILE_BLOBS: unique symbol = Symbol("seededFileBlobs");

type SeededDb = Db & { [SEEDED_FILE_BLOBS]?: SeededFileBlobs };

const DEMO_ASSET_TIMESTAMP = "2026-08-01T00:00:00.000Z";
const DEMO_REFERENCE_TIME = new Date(DEMO_ASSET_TIMESTAMP).getTime();

type DemoProfileSubject =
  | { singleId: number; shidduchimId?: never }
  | { singleId?: never; shidduchimId: number };

export interface DemoProfileAsset {
  name: string;
  slug: string;
  subject: DemoProfileSubject;
  sex: "female" | "male";
  targetSingleId: 1 | 2 | null;
  resumeAsset: AssetKey;
  previousResumeAssets?: readonly AssetKey[];
  photoAsset: AssetKey;
  visibility: ResumePhoto["visibility"];
}

/**
 * Canonical identity-to-asset contract for the rich demo. Shidduch ids 1-13
 * are men suggested to Rivky; ids 14-20 are women suggested to Yaakov.
 */
export const DEMO_PROFILE_ASSETS: readonly DemoProfileAsset[] = [
  {
    name: "Rivky Klein",
    slug: "rivky-klein",
    subject: { singleId: 1 },
    sex: "female",
    targetSingleId: null,
    resumeAsset: "resumes/rivky-klein.pdf",
    previousResumeAssets: ["resumes/rivky-klein-2025.pdf"],
    photoAsset: "portraits/rivky-klein.jpg",
    visibility: "shared",
  },
  {
    name: "Yaakov Klein",
    slug: "yaakov-klein",
    subject: { singleId: 2 },
    sex: "male",
    targetSingleId: null,
    resumeAsset: "resumes/yaakov-klein.pdf",
    previousResumeAssets: ["resumes/yaakov-klein-2025.pdf"],
    photoAsset: "portraits/yaakov-klein.jpg",
    visibility: "shared",
  },
  ...[
    [1, 1, "Ari Rosenberg", "ari-rosenberg", "shared"],
    [2, 1, "Menachem Stern", "menachem-stern", "shared"],
    [3, 1, "Boruch Sofer", "boruch-sofer", "shared"],
    [4, 1, "Dovid Berkowitz", "dovid-berkowitz", "shared"],
    [5, 1, "Shmuli Katz", "shmuli-katz", "shared"],
    [6, 1, "Yisroel Fried", "yisroel-fried", "private_parent"],
    [7, 1, "Yehuda Klein", "yehuda-klein", "shared"],
    [8, 1, "Moshe Diamond", "moshe-diamond", "shared"],
    [9, 1, "Eli Traube", "eli-traube", "shared"],
    [10, 1, "Chaim Landau", "chaim-landau", "shared"],
    [11, 1, "Yosef Gross", "yosef-gross", "shared"],
    [12, 1, "Tzvi Adler", "tzvi-adler", "shared"],
    [13, 1, "Naftali Berger", "naftali-berger", "shared"],
    [14, 2, "Leah Steinberg", "leah-steinberg", "shared"],
    [15, 2, "Miriam Roth", "miriam-roth", "shared"],
    [16, 2, "Sara Weinberg", "sara-weinberg", "shared"],
    [17, 2, "Tamar Weiss", "tamar-weiss", "shared"],
    [18, 2, "Ariella Cohen", "ariella-cohen", "private_parent"],
    [19, 2, "Chani Levine", "chani-levine", "shared"],
    [20, 2, "Miriam Kaplan", "miriam-kaplan", "shared"],
  ].map(([id, targetSingleId, name, slug, visibility]) => ({
    name: name as string,
    slug: slug as string,
    subject: { shidduchimId: id as number },
    sex: (targetSingleId === 1 ? "male" : "female") as "male" | "female",
    targetSingleId: targetSingleId as 1 | 2,
    resumeAsset: `resumes/${slug}.pdf` as AssetKey,
    previousResumeAssets:
      slug === "menachem-stern"
        ? (["resumes/menachem-stern-2025.pdf"] as readonly AssetKey[])
        : undefined,
    photoAsset: `portraits/${slug}.jpg` as AssetKey,
    visibility: visibility as ResumePhoto["visibility"],
  })),
];

const BASELINE_PROFILE_ASSETS = DEMO_PROFILE_ASSETS.filter(
  (profile) =>
    profile.subject.singleId != null ||
    (profile.subject.shidduchimId != null && profile.subject.shidduchimId <= 6),
);

function createResumeFileEntry(
  accountId: number,
  file: File,
  ownerSegment: string,
): { path: string; entry: ResumeFileVersion } {
  const path = `${accountId}/resumes/${ownerSegment}/demo-${file.name}`;
  const entry: ResumeFileVersion = {
    path,
    filename: file.name,
    uploaded_at: DEMO_ASSET_TIMESTAMP,
    uploaded_by: null,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
  };
  return { path, entry };
}

function createResumePhotoEntry(
  accountId: number,
  file: File,
  visibility: ResumePhoto["visibility"],
  ownerSegment: string,
): { path: string } {
  const path = `${accountId}/photos/${visibility}/${ownerSegment}/demo-${file.name}`;
  return { path };
}

function createEntityFileEntry(
  accountId: number,
  file: File,
  targetType: EntityFile["target_type"],
  targetId: number,
): { path: string } {
  const path = `${accountId}/${targetType}/${targetId}/demo-${file.name}`;
  return { path };
}

function base64ToFile(key: AssetKey): File {
  return assetFile(key, assetFileName(key));
}

function nextId(rows: Array<{ id: Identifier }>): number {
  return Number(rows[rows.length - 1]?.id ?? 0) + 1;
}

function ownerSegmentForResume(subject: {
  singleId?: number;
  shidduchimId?: number;
}): string {
  if (subject.singleId != null) return `single-${subject.singleId}`;
  if (subject.shidduchimId != null) return `${subject.shidduchimId}`;
  throw new Error("resume subject must be a single or shidduch");
}

function daysAgoIso(days: number): string {
  return new Date(DEMO_REFERENCE_TIME - days * 86_400_000).toISOString();
}

function profileResume(db: Db, subject: DemoProfileSubject) {
  return db.resumes.find(
    (resume) =>
      (subject.singleId != null && resume.single_id === subject.singleId) ||
      (subject.shidduchimId != null &&
        resume.shidduchim_id === subject.shidduchimId),
  );
}

function seedProfileAssets(
  db: Db,
  blobs: SeededFileBlobs,
  profiles: readonly DemoProfileAsset[],
): void {
  const accountId = Number(db.accounts?.[0]?.id ?? 1);

  for (const profile of profiles) {
    let resume = profileResume(db, profile.subject);
    const resumeAssets = [
      ...(profile.previousResumeAssets ?? []),
      profile.resumeAsset,
    ];

    for (const resumeAsset of resumeAssets) {
      const expectedName = assetFileName(resumeAsset);
      if (resume?.files?.some((file) => file.filename === expectedName)) {
        continue;
      }

      const file = base64ToFile(resumeAsset);
      const segment = ownerSegmentForResume(profile.subject);
      const { path, entry } = createResumeFileEntry(accountId, file, segment);
      blobs.resumeFiles.set(path, URL.createObjectURL(file));

      if (resume) {
        resume.files = [...(resume.files ?? []), entry];
      } else {
        resume = {
          id: nextId(db.resumes),
          account_id: accountId,
          single_id: profile.subject.singleId ?? null,
          shidduchim_id: profile.subject.shidduchimId ?? null,
          files: [entry],
          extracted: null,
          sections: null,
          created_at: DEMO_ASSET_TIMESTAMP,
        };
        db.resumes.push(resume);
      }
    }

    if (!resume) {
      throw new Error(`resume was not created for ${profile.slug}`);
    }

    const expectedPhotoName = assetFileName(profile.photoAsset);
    const alreadyHasPhoto = db.resume_photos.some(
      (photo) =>
        photo.resume_id === resume.id &&
        photo.path.endsWith(`-${expectedPhotoName}`),
    );
    if (alreadyHasPhoto) continue;

    const photoFile = base64ToFile(profile.photoAsset);
    const segment = ownerSegmentForResume(profile.subject);
    const { path } = createResumePhotoEntry(
      accountId,
      photoFile,
      profile.visibility,
      segment,
    );
    blobs.resumePhotos.set(path, URL.createObjectURL(photoFile));
    db.resume_photos.push({
      id: nextId(db.resume_photos),
      account_id: accountId,
      resume_id: resume.id,
      path,
      uploaded_at: DEMO_ASSET_TIMESTAMP,
      visibility: profile.visibility,
      hidden_at: null,
    });
  }
}

/** Add the full profile asset set after the showcase overlay adds ids 17-20. */
export function seedShowcaseProfileAssets(db: Db): SeededDb {
  const seededDb = db as SeededDb;
  const blobs = seededDb[SEEDED_FILE_BLOBS] ?? {
    resumeFiles: new Map<string, string>(),
    resumePhotos: new Map<string, string>(),
    entityFiles: new Map<string, string>(),
  };
  seedProfileAssets(db, blobs, DEMO_PROFILE_ASSETS);
  seededDb[SEEDED_FILE_BLOBS] = blobs;
  return seededDb;
}

/**
 * Seeds resume files, resume photos, entity files, medical notes, external
 * links, date records, and enriched timeline interactions into the demo Db.
 * Returns the Db (with a symbol-attached blob map) so createDataProvider()
 * can serve signed URLs for the seeded files.
 *
 * Runs AFTER generateReferencesDomain() so real shidduchim/reference ids are
 * available.
 */
export function seedFileAssetsAndRelatedData(db: Db): SeededDb {
  const seededDb = db as SeededDb;
  const blobs: SeededFileBlobs = {
    resumeFiles: new Map(),
    resumePhotos: new Map(),
    entityFiles: new Map(),
  };

  const accountId = Number(db.accounts?.[0]?.id ?? 1);

  // Helper: insert an entity_files row and register the blob.
  function insertEntityFile(
    targetType: EntityFile["target_type"],
    targetId: number,
    assetKey: AssetKey,
    visibility: EntityFile["visibility"] = "shared",
  ): void {
    const file = base64ToFile(assetKey);
    const { path } = createEntityFileEntry(
      accountId,
      file,
      targetType,
      targetId,
    );
    blobs.entityFiles.set(path, URL.createObjectURL(file));

    const id = nextId(db.entity_files);
    const entityFile: EntityFile = {
      id,
      account_id: accountId,
      target_type: targetType,
      target_id: targetId,
      storage_path: path,
      file_name: file.name,
      mime_type: assetMimeType(assetKey),
      size_bytes: file.size,
      visibility,
      uploaded_by_member_id: null,
      created_at: new Date().toISOString(),
    };
    db.entity_files.push(entityFile);
  }

  // Keep the baseline fixture compact; the app-only showcase overlay fills
  // the remaining profiles after it creates the final four suggestions.
  seedProfileAssets(db, blobs, BASELINE_PROFILE_ASSETS);

  // Entity files: two shidduch files + one reference file.
  insertEntityFile("shidduch", 1, "misc/family-notes.pdf", "shared");
  insertEntityFile("shidduch", 2, "misc/reference-summary.pdf", "shared");
  insertEntityFile("reference", 1, "misc/stein-notes.pdf", "shared");

  // Medical notes.
  db.medical_notes.push(
    {
      id: 1,
      account_id: accountId,
      shidduchim_id: 2,
      author_member_id: null,
      body: "No concerns noted. Routine check with family doctor completed.",
      created_at: daysAgoIso(10),
    },
    {
      id: 2,
      account_id: accountId,
      shidduchim_id: 6,
      author_member_id: null,
      body: "Allergy to penicillin disclosed; not a concern for shidduch.",
      created_at: daysAgoIso(8),
    },
  );

  // External links.
  db.shidduchim_external_links.push(
    {
      id: 1,
      account_id: accountId,
      shidduchim_id: 2,
      url: "https://example-shidduch-site.com/profile/eliezer-katz",
      label: "Shidduch profile",
      created_at: daysAgoIso(12),
    },
    {
      id: 2,
      account_id: accountId,
      shidduchim_id: 5,
      url: "https://example-shidduch-site.com/profile/devora-leah-gross",
      label: "Shidduch profile",
      created_at: daysAgoIso(11),
    },
  );

  // Date records for closed shidduchim.
  db.date_records.push(
    {
      id: 1,
      account_id: accountId,
      single_id: 2,
      person_name_en: "Bracha Gold",
      person_name_he: null,
      person_parents: null,
      person_seminary: null,
      person_location: "Lakewood, NJ",
      date_on: new Date(Date.now() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      outcome: "no",
      notes: "Nice girl, ages didn't work out.",
      created_at: daysAgoIso(30),
    },
    {
      id: 2,
      account_id: accountId,
      single_id: 1,
      person_name_en: "Naftali Berger",
      person_name_he: null,
      person_parents: null,
      person_seminary: null,
      person_location: "Lakewood, NJ",
      date_on: new Date(Date.now() - 35 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      outcome: "no",
      notes: "Different hashkafos.",
      created_at: daysAgoIso(35),
    },
  );

  // Timeline enrichment: notes and status_change interactions.
  const timelineNotes: Array<{
    shidduchimId: number;
    body: string;
    daysAgo: number;
  }> = [
    {
      shidduchimId: 2,
      body: "Parents sound very interested. Waiting to hear back after they check into our side.",
      daysAgo: 3,
    },
    {
      shidduchimId: 4,
      body: "Resume looks strong. Shadchan says he is a masmid with excellent middos; checking references.",
      daysAgo: 5,
    },
    {
      shidduchimId: 6,
      body: "Great phone call with the mother; very promising.",
      daysAgo: 6,
    },
    {
      shidduchimId: 10,
      body: "Both sides very interested; moving forward.",
      daysAgo: 8,
    },
    {
      shidduchimId: 11,
      body: "Parents spoke last night. Both sides are warm and practical; scheduling a second call.",
      daysAgo: 9,
    },
    {
      shidduchimId: 13,
      body: "Different hashkafos — not the right fit. Spoke to shadchan respectfully.",
      daysAgo: 12,
    },
  ];

  const statusChanges: Array<{
    shidduchimId: number;
    from: "look_into";
    to: "yes" | "unsure" | "no";
    body: string;
    daysAgo: number;
  }> = [
    {
      shidduchimId: 10,
      from: "look_into",
      to: "yes",
      body: "Both sides very interested; moving forward.",
      daysAgo: 15,
    },
    {
      shidduchimId: 11,
      from: "look_into",
      to: "yes",
      body: "Parents are very warm; moving ahead.",
      daysAgo: 14,
    },
    {
      shidduchimId: 12,
      from: "look_into",
      to: "unsure",
      body: "Still checking references; undecided.",
      daysAgo: 13,
    },
    {
      shidduchimId: 13,
      from: "look_into",
      to: "no",
      body: "Different hashkafos — not the right fit.",
      daysAgo: 18,
    },
    {
      shidduchimId: 16,
      from: "look_into",
      to: "yes",
      body: "Great phone call with the mother; very promising.",
      daysAgo: 10,
    },
  ];

  let interactionId = nextId(db.interactions);

  for (const note of timelineNotes) {
    db.interactions.push({
      id: interactionId++,
      account_id: accountId,
      target_type: "shidduch",
      target_id: note.shidduchimId,
      scope: "shidduch",
      reference_link_id: null,
      actor_member_id: null,
      kind: "note",
      body: note.body,
      metadata: null,
      created_at: daysAgoIso(note.daysAgo),
      deleted_at: null,
    });
  }

  for (const change of statusChanges) {
    db.interactions.push({
      id: interactionId++,
      account_id: accountId,
      target_type: "shidduch",
      target_id: change.shidduchimId,
      scope: "shidduch",
      reference_link_id: null,
      actor_member_id: null,
      kind: "status_change",
      body: change.body,
      metadata: { from: change.from, to: change.to },
      created_at: daysAgoIso(change.daysAgo),
      deleted_at: null,
    });
  }

  seededDb[SEEDED_FILE_BLOBS] = blobs;
  return seededDb;
}
