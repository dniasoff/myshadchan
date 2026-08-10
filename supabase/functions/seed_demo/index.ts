import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import {
  resolveAccountId,
  userScopedClient,
} from "../_shared/resolveDemoAccount.ts";
import {
  SINGLES,
  SHADCHANIM,
  REFERENCES,
  RIVKY_SUGGESTIONS,
  YAAKOV_SUGGESTIONS,
  REFERENCE_LINKS,
  TIMELINE_NOTES,
  STATUS_CHANGES,
  TASKS,
  EXTRA_REDTS,
  RESUME_FILES,
  RESUME_PHOTOS,
  ENTITY_FILES,
  MEDICAL_NOTES,
  EXTERNAL_LINKS,
  DATE_RECORDS,
  daysAgo,
  daysAgoIso,
  daysFromNowIso,
  type DemoSuggestion,
} from "../_shared/demoDataset.ts";
import { getAssetBytes, type AssetKey } from "./assets/manifest.ts";

/**
 * Plants the curated realistic demo dataset (singles/shadchanim/references/
 * shidduchim/tasks/interactions, plus resume files, photos, entity files,
 * medical notes, external links, and date records) into the caller's own,
 * currently-empty account, then flips accounts.demo = true.
 *
 * Every insert/RPC below runs through the USER-scoped client (`db`), never
 * supabaseAdmin, so RLS and the set_account_id_default()/create_shidduch()
 * account resolution land the data in the caller's account — never anywhere
 * else. supabaseAdmin is used only to resolve the caller's account_id (a read),
 * to upload bytes to storage (service role), and at the very end to set the demo
 * flag for that server-resolved id.
 */

// Tables checked by the empty-account guard below. Broader than "just
// singles": an account that already has shadchanim/references/shidduchim
// but (for whatever reason) zero singles should not be re-seeded either —
// re-seeding on top of partial data would produce a mixed, inconsistent
// state. Any row in any of these means "not empty".
const NON_EMPTY_GUARD_TABLES = [
  "singles",
  "shadchanim",
  "references",
  "shidduchim",
] as const;

// True when the account has no rows in any of NON_EMPTY_GUARD_TABLES. Reads
// via supabaseAdmin so the check is authoritative regardless of RLS
// visibility quirks.
async function isAccountEmpty(accountId: number): Promise<boolean> {
  const counts = await Promise.all(
    NON_EMPTY_GUARD_TABLES.map(async (table) => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      if (error) {
        throw new Error(`failed to check existing ${table}: ${error.message}`);
      }
      return count ?? 0;
    }),
  );
  return counts.every((count) => count === 0);
}

// Creates every suggestion in one pipeline (girl's boys or boy's girls).
// Decision states (yes/unsure/no) cannot be created directly (AD-4): each is
// created as look_into, then moved with transition_shidduch. Returns a map
// of suggestion key -> shidduchim id, so later steps (redts/links/notes/
// tasks/files) can address the right row.
async function seedSuggestions(
  db: SupabaseClient,
  singleId: number,
  suggestions: DemoSuggestion[],
  shadchanIdByKey: Map<string, number>,
): Promise<Map<string, number>> {
  const idByKey = new Map<string, number>();

  for (const s of suggestions) {
    const shadchanId = shadchanIdByKey.get(s.shadchanKey);
    const isDecisionState =
      s.targetState === "yes" ||
      s.targetState === "unsure" ||
      s.targetState === "no";
    const initialState = isDecisionState ? "look_into" : s.targetState;

    const { data, error } = await db.rpc("create_shidduch", {
      p_single_id: singleId,
      p_shadchan_id: shadchanId,
      p_name_en: s.name_en,
      p_father_en: s.father_en,
      p_mother_en: s.mother_en,
      p_seminary_en: s.seminary_en,
      p_location_en: s.location_en,
      p_age: s.age,
      p_height: s.height,
      p_initial_state: initialState,
      p_redt_date: daysAgo(s.redtDaysAgo),
    });
    if (error || !data?.[0]) {
      throw new Error(`create_shidduch failed for ${s.key}: ${error?.message}`);
    }
    const shidduchId = data[0].id as number;
    idByKey.set(s.key, shidduchId);

    if (isDecisionState) {
      const { error: transitionError } = await db.rpc("transition_shidduch", {
        p_id: shidduchId,
        p_from: "look_into",
        p_to: s.targetState,
        p_close_reason: s.closeReason ?? null,
      });
      if (transitionError) {
        throw new Error(
          `transition_shidduch failed for ${s.key}: ${transitionError.message}`,
        );
      }
    }
  }

  return idByKey;
}

function resumeOwnerSegment(subject: {
  singleId?: number;
  shidduchimId?: number;
}): string {
  if (subject.singleId != null) return `single-${subject.singleId}`;
  if (subject.shidduchimId != null) return `${subject.shidduchimId}`;
  throw new Error("resume subject must be a single or shidduch");
}

function deriveExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "";
}

async function uploadSeededResumeFile(
  accountId: number,
  params: {
    filename: string;
    assetKey: AssetKey;
    mimeType: string;
    singleId?: number;
    shidduchimId?: number;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const path = `${accountId}/resumes/${resumeOwnerSegment(params)}/${crypto.randomUUID()}-${params.filename}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("documents")
    .upload(path, bytes, { contentType: params.mimeType });
  if (uploadError) {
    throw new Error(
      `upload resume failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: rpcError } = await db.rpc("add_resume_file", {
    p_path: path,
    p_filename: params.filename,
    p_mime_type: params.mimeType,
    p_size: bytes.length,
    p_shidduchim_id: params.shidduchimId ?? null,
    p_single_id: params.singleId ?? null,
  });
  if (rpcError) {
    throw new Error(
      `add_resume_file failed for ${params.filename}: ${rpcError.message}`,
    );
  }
}

async function uploadSeededResumePhoto(
  accountId: number,
  params: {
    filename: string;
    assetKey: AssetKey;
    visibility: string;
    singleId?: number;
    shidduchimId?: number;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const path = `${accountId}/photos/${params.visibility}/${resumeOwnerSegment(params)}/${crypto.randomUUID()}-${params.filename}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("documents")
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (uploadError) {
    throw new Error(
      `upload photo failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: rpcError } = await db.rpc("add_resume_photo", {
    p_path: path,
    p_shidduchim_id: params.shidduchimId ?? null,
    p_single_id: params.singleId ?? null,
    p_visibility: params.visibility,
  });
  if (rpcError) {
    throw new Error(
      `add_resume_photo failed for ${params.filename}: ${rpcError.message}`,
    );
  }
}

async function uploadSeededEntityFile(
  accountId: number,
  params: {
    targetType: string;
    targetId: number;
    filename: string;
    assetKey: AssetKey;
    mimeType: string;
    visibility: string;
  },
  db: SupabaseClient,
): Promise<void> {
  const bytes = await getAssetBytes(params.assetKey);
  const ext = deriveExtension(params.filename);
  const path = `${accountId}/${params.targetType}/${params.targetId}/${crypto.randomUUID()}${ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("entity-files")
    .upload(path, bytes, { contentType: params.mimeType });
  if (uploadError) {
    throw new Error(
      `upload entity file failed for ${params.filename}: ${uploadError.message}`,
    );
  }
  const { error: insertError } = await db.from("entity_files").insert({
    target_type: params.targetType,
    target_id: params.targetId,
    storage_path: path,
    file_name: params.filename,
    mime_type: params.mimeType,
    size_bytes: bytes.length,
    visibility: params.visibility,
  });
  if (insertError) {
    throw new Error(
      `insert entity_files failed for ${params.filename}: ${insertError.message}`,
    );
  }
}

async function seedDemoData(req: Request, accountId: number) {
  const db = userScopedClient(req);

  const { data: singles, error: singlesError } = await db
    .from("singles")
    .insert(SINGLES)
    .select("id, gender");
  if (singlesError || !singles) {
    throw new Error(`insert singles failed: ${singlesError?.message}`);
  }
  const girlId = singles.find((c) => c.gender === "female")?.id;
  const boyId = singles.find((c) => c.gender === "male")?.id;
  if (!girlId || !boyId) {
    throw new Error(
      "expected exactly one female and one male single after insert",
    );
  }

  const { data: shadchanim, error: shadchanimError } = await db
    .from("shadchanim")
    .insert(SHADCHANIM.map(({ key: _key, ...rest }) => rest))
    .select("id, name");
  if (shadchanimError || !shadchanim) {
    throw new Error(`insert shadchanim failed: ${shadchanimError?.message}`);
  }
  const shadchanIdByKey = new Map<string, number>();
  for (const s of SHADCHANIM) {
    const row = shadchanim.find((r) => r.name === s.name);
    if (!row) throw new Error(`shadchan not found after insert: ${s.name}`);
    shadchanIdByKey.set(s.key, row.id);
  }

  const references: Array<{ id: number; name_en: string }> = [];
  for (const r of REFERENCES) {
    const firstLink = REFERENCE_LINKS.find(
      (link) => link.referenceKey === r.key,
    );
    if (!firstLink) {
      throw new Error(
        `reference ${r.key} cannot be seeded without a shidduch to attach it to`,
      );
    }
    const { data, error } = await db.rpc("create_reference_for_shidduch", {
      p_shidduchim_id: suggestionIdByKey.get(firstLink.suggestionKey),
      p_name_en: r.name_en,
      p_name_he: null,
      p_relationship: r.relationship,
      p_phone: r.phone,
      p_school: r.school ?? null,
      p_grad_year: null,
      p_relationship_override: null,
    });
    if (error || !data?.[0]) {
      throw new Error(
        `create_reference_for_shidduch failed for ${r.key}: ${error?.message}`,
      );
    }
    references.push({ id: data[0].id as number, name_en: data[0].name_en });
  }
  const referenceIdByKey = new Map<string, number>();
  for (const r of REFERENCES) {
    const row = references.find((row) => row.name_en === r.name_en);
    if (!row) throw new Error(`reference not found after insert: ${r.name_en}`);
    referenceIdByKey.set(r.key, row.id);
  }

  const girlSuggestionIds = await seedSuggestions(
    db,
    girlId,
    RIVKY_SUGGESTIONS,
    shadchanIdByKey,
  );
  const boySuggestionIds = await seedSuggestions(
    db,
    boyId,
    YAAKOV_SUGGESTIONS,
    shadchanIdByKey,
  );
  const suggestionIdByKey = new Map<string, number>([
    ...girlSuggestionIds,
    ...boySuggestionIds,
  ]);

  for (const extra of EXTRA_REDTS) {
    const { error } = await db.rpc("add_redt", {
      p_shidduchim_id: suggestionIdByKey.get(extra.suggestionKey),
      p_shadchan_id: shadchanIdByKey.get(extra.shadchanKey),
      p_redt_date: daysAgo(extra.redtDaysAgo),
    });
    if (error) throw new Error(`add_redt failed: ${error.message}`);
  }

  let referenceLinkCount = 0;
  for (const link of REFERENCE_LINKS) {
    const { data: linkData, error: linkError } = await db.rpc(
      "link_reference_to_shidduch",
      {
        p_reference_id: referenceIdByKey.get(link.referenceKey),
        p_shidduchim_id: suggestionIdByKey.get(link.suggestionKey),
      },
    );
    if (linkError || !linkData?.[0]) {
      throw new Error(
        `link_reference_to_shidduch failed: ${linkError?.message}`,
      );
    }
    const { error: logError } = await db.rpc("log_reference_call", {
      p_reference_link_id: linkData[0].id,
      p_call_status: "answered",
      p_what_they_said: link.whatTheySaid,
      p_source: "manual",
    });
    if (logError)
      throw new Error(`log_reference_call failed: ${logError.message}`);
    referenceLinkCount++;
  }

  const notesToInsert = TIMELINE_NOTES.map((n) => ({
    target_type: "shidduch",
    scope: "shidduch",
    target_id: suggestionIdByKey.get(n.suggestionKey),
    reference_link_id: null,
    kind: "note",
    body: n.body,
    created_at: daysAgoIso(0),
  }));
  const statusChangesToInsert = STATUS_CHANGES.map((s) => ({
    target_type: "shidduch",
    scope: "shidduch",
    target_id: suggestionIdByKey.get(s.suggestionKey),
    reference_link_id: null,
    kind: "status_change",
    body: s.body ?? null,
    metadata: { from: s.from, to: s.to },
    created_at: daysAgoIso(s.atDaysAgo),
  }));
  const { error: notesError } = await db
    .from("interactions")
    .insert([...notesToInsert, ...statusChangesToInsert]);
  if (notesError)
    throw new Error(
      `insert timeline interactions failed: ${notesError.message}`,
    );

  const tasksToInsert = TASKS.map((t) => ({
    text: t.text,
    type: t.type,
    due_date: daysFromNowIso(t.dueDaysOffset),
    target_type: t.targetType,
    target_id:
      t.targetType === "shidduch"
        ? suggestionIdByKey.get(t.targetKey)
        : referenceIdByKey.get(t.targetKey),
  }));
  const { error: tasksError } = await db.from("tasks").insert(tasksToInsert);
  if (tasksError) throw new Error(`insert tasks failed: ${tasksError.message}`);

  for (const file of RESUME_FILES) {
    const singleId =
      file.singleKey === "Rivky"
        ? girlId
        : file.singleKey === "Yaakov"
          ? boyId
          : undefined;
    const shidduchimId = file.suggestionKey
      ? suggestionIdByKey.get(file.suggestionKey)
      : undefined;
    await uploadSeededResumeFile(
      accountId,
      { ...file, singleId, shidduchimId },
      db,
    );
  }

  for (const photo of RESUME_PHOTOS) {
    const singleId =
      photo.singleKey === "Rivky"
        ? girlId
        : photo.singleKey === "Yaakov"
          ? boyId
          : undefined;
    const shidduchimId = photo.suggestionKey
      ? suggestionIdByKey.get(photo.suggestionKey)
      : undefined;
    await uploadSeededResumePhoto(
      accountId,
      { ...photo, singleId, shidduchimId },
      db,
    );
  }

  for (const file of ENTITY_FILES) {
    const targetId =
      file.targetType === "shidduch"
        ? suggestionIdByKey.get(file.targetKey)
        : referenceIdByKey.get(file.targetKey);
    if (targetId == null) {
      throw new Error(`entity file target not found: ${file.targetKey}`);
    }
    await uploadSeededEntityFile(accountId, { ...file, targetId }, db);
  }

  const medicalNotesToInsert = MEDICAL_NOTES.map((n) => ({
    shidduchim_id: suggestionIdByKey.get(n.suggestionKey),
    body: n.body,
  }));
  const { error: medicalNotesError } = await db
    .from("medical_notes")
    .insert(medicalNotesToInsert);
  if (medicalNotesError) {
    throw new Error(
      `insert medical_notes failed: ${medicalNotesError.message}`,
    );
  }

  const externalLinksToInsert = EXTERNAL_LINKS.map((l) => ({
    shidduchim_id: suggestionIdByKey.get(l.suggestionKey),
    url: l.url,
    label: l.label,
  }));
  const { error: externalLinksError } = await db
    .from("shidduchim_external_links")
    .insert(externalLinksToInsert);
  if (externalLinksError) {
    throw new Error(
      `insert shidduchim_external_links failed: ${externalLinksError.message}`,
    );
  }

  const dateRecordsToInsert = DATE_RECORDS.map((r) => ({
    single_id: r.singleKey === "Rivky" ? girlId : boyId,
    person_name_en: r.personName,
    person_location: r.personLocation,
    date_on: r.dateOn,
    outcome: r.outcome,
    notes: r.notes,
  }));
  const { error: dateRecordsError } = await db
    .from("date_records")
    .insert(dateRecordsToInsert);
  if (dateRecordsError) {
    throw new Error(`insert date_records failed: ${dateRecordsError.message}`);
  }

  // The demo flag is written last, with the service-role client, scoped to
  // the account_id resolved server-side at the top of the handler — never
  // from anything the request supplied.
  const { error: flagError } = await supabaseAdmin
    .from("accounts")
    .update({ demo: true })
    .eq("id", accountId);
  if (flagError)
    throw new Error(`failed to set accounts.demo: ${flagError.message}`);

  return {
    seeded: true as const,
    accountId,
    singles: SINGLES.length,
    shadchanim: SHADCHANIM.length,
    references: REFERENCES.length,
    shidduchim: RIVKY_SUGGESTIONS.length + YAAKOV_SUGGESTIONS.length,
    referenceLinks: referenceLinkCount,
    interactions:
      notesToInsert.length +
      statusChangesToInsert.length +
      referenceLinkCount * 2,
    tasks: TASKS.length,
    resumeFiles: RESUME_FILES.length,
    resumePhotos: RESUME_PHOTOS.length,
    entityFiles: ENTITY_FILES.length,
    medicalNotes: MEDICAL_NOTES.length,
    externalLinks: EXTERNAL_LINKS.length,
    dateRecords: DATE_RECORDS.length,
  };
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req, user?: User) => {
        if (req.method !== "POST" && req.method !== "PATCH") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        if (!user) return createErrorResponse(401, "Unauthorized");

        const accountId = await resolveAccountId(user.id);
        if (!accountId) {
          return createErrorResponse(409, "No active account for user");
        }

        // Guard: only ever seed an empty account (checks singles,
        // shadchanim, references, and shidduchim — not singles alone —
        // so a partially-populated account can't be re-seeded into a
        // mixed state).
        let accountEmpty: boolean;
        try {
          accountEmpty = await isAccountEmpty(accountId);
        } catch (e) {
          console.error("seed_demo: failed to check existing data:", e);
          return createErrorResponse(500, "Internal Server Error");
        }
        if (!accountEmpty) {
          return new Response(
            JSON.stringify({ seeded: false, reason: "account_not_empty" }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        try {
          const summary = await seedDemoData(req, accountId);
          return new Response(JSON.stringify(summary), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (e) {
          console.error("seed_demo failed:", e);
          return createErrorResponse(
            500,
            (e as Error).message || "Failed to seed demo data",
          );
        }
      }),
    ),
  ),
);
