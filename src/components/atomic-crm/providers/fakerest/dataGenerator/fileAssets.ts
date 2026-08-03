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

function createResumeFileEntry(
  accountId: number,
  file: File,
  ownerSegment: string,
): { path: string; entry: ResumeFileVersion } {
  const path = `${accountId}/resumes/${ownerSegment}/${crypto.randomUUID()}-${file.name}`;
  const entry: ResumeFileVersion = {
    path,
    filename: file.name,
    uploaded_at: new Date().toISOString(),
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
  const path = `${accountId}/photos/${visibility}/${ownerSegment}/${crypto.randomUUID()}-${file.name}`;
  return { path };
}

function createEntityFileEntry(
  accountId: number,
  file: File,
  targetType: EntityFile["target_type"],
  targetId: number,
): { path: string } {
  const ext = file.name.split(".").pop();
  const suffix = ext ? `.${ext}` : "";
  const path = `${accountId}/${targetType}/${targetId}/${crypto.randomUUID()}${suffix}`;
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
  return new Date(Date.now() - days * 86_400_000).toISOString();
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

  // Helper: ensure a resumes row exists for a subject and append a file.
  function appendResumeFile(
    subject: { singleId?: number; shidduchimId?: number },
    assetKey: AssetKey,
  ): void {
    const file = base64ToFile(assetKey);
    const segment = ownerSegmentForResume(subject);
    const { path, entry } = createResumeFileEntry(accountId, file, segment);
    blobs.resumeFiles.set(path, URL.createObjectURL(file));

    let resume = db.resumes.find(
      (r) =>
        (subject.singleId != null && r.single_id === subject.singleId) ||
        (subject.shidduchimId != null &&
          r.shidduchim_id === subject.shidduchimId),
    );
    if (resume) {
      resume.files = [...(resume.files ?? []), entry];
    } else {
      const id = nextId(db.resumes);
      resume = {
        id,
        account_id: accountId,
        single_id: subject.singleId ?? null,
        shidduchim_id: subject.shidduchimId ?? null,
        files: [entry],
        extracted: null,
        sections: null,
        created_at: new Date().toISOString(),
      };
      db.resumes.push(resume);
    }
  }

  // Helper: ensure a resumes row exists for a subject and insert a photo row.
  function insertResumePhoto(
    subject: { singleId?: number; shidduchimId?: number },
    assetKey: AssetKey,
    visibility: ResumePhoto["visibility"],
  ): void {
    const file = base64ToFile(assetKey);
    const segment = ownerSegmentForResume(subject);
    const { path } = createResumePhotoEntry(
      accountId,
      file,
      visibility,
      segment,
    );
    blobs.resumePhotos.set(path, URL.createObjectURL(file));

    let resume = db.resumes.find(
      (r) =>
        (subject.singleId != null && r.single_id === subject.singleId) ||
        (subject.shidduchimId != null &&
          r.shidduchim_id === subject.shidduchimId),
    );
    if (!resume) {
      const id = nextId(db.resumes);
      resume = {
        id,
        account_id: accountId,
        single_id: subject.singleId ?? null,
        shidduchim_id: subject.shidduchimId ?? null,
        files: [],
        extracted: null,
        sections: null,
        created_at: new Date().toISOString(),
      };
      db.resumes.push(resume);
    }

    const photoId = nextId(db.resume_photos);
    const photo: ResumePhoto = {
      id: photoId,
      account_id: accountId,
      resume_id: resume.id,
      path,
      uploaded_at: new Date().toISOString(),
      visibility,
      hidden_at: null,
    };
    db.resume_photos.push(photo);
  }

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

  // Resume files: the two singles + six representative shidduchim.
  appendResumeFile({ singleId: 1 }, "resumes/rivky-stern.pdf");
  appendResumeFile({ singleId: 2 }, "resumes/yaakov-stern.pdf");
  appendResumeFile({ shidduchimId: 1 }, "resumes/ahron-klein.pdf");
  appendResumeFile({ shidduchimId: 2 }, "resumes/eliezer-katz.pdf");
  appendResumeFile({ shidduchimId: 3 }, "resumes/yosef-mandel.pdf");
  appendResumeFile({ shidduchimId: 4 }, "resumes/esther-malka-weiss.pdf");
  appendResumeFile({ shidduchimId: 5 }, "resumes/devora-leah-gross.pdf");
  appendResumeFile({ shidduchimId: 6 }, "resumes/shira-feldman.pdf");

  // Resume photos: the two singles + four representative shidduchim.
  insertResumePhoto({ singleId: 1 }, "portraits/rivky-stern.jpg", "shared");
  insertResumePhoto({ singleId: 2 }, "portraits/yaakov-stern.jpg", "shared");
  insertResumePhoto({ shidduchimId: 1 }, "portraits/ahron-klein.jpg", "shared");
  insertResumePhoto(
    { shidduchimId: 2 },
    "portraits/eliezer-katz.jpg",
    "shared",
  );
  insertResumePhoto(
    { shidduchimId: 6 },
    "portraits/shira-feldman.jpg",
    "private_parent",
  );
  insertResumePhoto(
    { shidduchimId: 4 },
    "portraits/devora-leah-gross.jpg",
    "shared",
  );

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
