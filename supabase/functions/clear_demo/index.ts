import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import {
  resolveAccountId,
  userScopedClient,
} from "../_shared/resolveDemoAccount.ts";

/**
 * Wipes every tenant row in the CALLER'S OWN account and clears
 * accounts.demo. Destructive and security-sensitive — see
 * design-artifacts/demo-onboarding-plan.md §6 for the full tenancy-safety
 * argument. Three independent layers make this impossible to turn into a
 * cross-tenant wipe:
 *
 *  1. accountId is resolved from the caller's own active account_members
 *     row via supabaseAdmin — never from the request body.
 *  2. Every delete runs on the USER-scoped client `db`, so RLS confines each
 *     statement to current_context_id() regardless of the WHERE clause.
 *  3. Every delete also carries an explicit `.eq('account_id', accountId)`
 *     filter (belt + braces) — there is no unfiltered/blanket delete here.
 *
 * Storage objects are removed via the service-role client before row deletion
 * so repeated seed/clear cycles do not leave orphaned files in the `documents`
 * or `entity-files` buckets.
 *
 * interactions and identity_signals are never deleted directly (authenticated
 * holds no DELETE grant on either) — they are removed by the
 * purge_polymorphic_dependents trigger on shidduchim/references, and by the
 * ON DELETE CASCADE from reference_links (interactions.reference_link_id).
 * Deletion order is FK-safe: every dependent of shidduchim/references is
 * removed before the parent, and singles go last because
 * shidduchim.single_id/date_records.single_id cascade from singles.
 */

// Deliberately explicit rather than looped over a table-name array — keeping
// the FK-safe order visible in the code is the whole point of this function.
const DELETE_ORDER = [
  "tasks",
  "reference_links",
  "redts",
  "shidduch_schools",
  "resume_photos",
  "resumes",
  "entity_files",
  "medical_notes",
  "shidduchim_external_links",
  "date_records",
  "shidduchim",
  "references",
  "shadchanim",
  "singles",
] as const;

async function collectStoragePaths(accountId: number): Promise<{
  documentPaths: string[];
  entityFilePaths: string[];
}> {
  // Resume files live in the `documents` bucket under `{account_id}/resumes/`.
  const { data: resumes, error: resumesError } = await supabaseAdmin
    .from("resumes")
    .select("files")
    .eq("account_id", accountId);
  if (resumesError) {
    throw new Error(`failed to list resumes: ${resumesError.message}`);
  }
  const resumeFilePaths: string[] = (resumes ?? [])
    .flatMap((r) =>
      Array.isArray(r.files) ? (r.files as Array<{ path?: string }>) : [],
    )
    .map((f) => f.path)
    .filter((p): p is string => !!p);

  // Resume photos live in the `documents` bucket under `{account_id}/photos/`.
  const { data: photos, error: photosError } = await supabaseAdmin
    .from("resume_photos")
    .select("path")
    .eq("account_id", accountId);
  if (photosError) {
    throw new Error(`failed to list resume_photos: ${photosError.message}`);
  }
  const photoPaths: string[] = (photos ?? [])
    .map((p) => p.path)
    .filter((p): p is string => !!p);

  // Entity files live in the `entity-files` bucket.
  const { data: entityFiles, error: entityFilesError } = await supabaseAdmin
    .from("entity_files")
    .select("storage_path")
    .eq("account_id", accountId);
  if (entityFilesError) {
    throw new Error(`failed to list entity_files: ${entityFilesError.message}`);
  }
  const entityFilePaths: string[] = (entityFiles ?? [])
    .map((f) => f.storage_path)
    .filter((p): p is string => !!p);

  return {
    documentPaths: [...resumeFilePaths, ...photoPaths],
    entityFilePaths,
  };
}

async function removeStorageObjects(
  documentPaths: string[],
  entityFilePaths: string[],
): Promise<void> {
  if (documentPaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("documents")
      .remove(documentPaths);
    if (error) {
      throw new Error(`failed to remove documents: ${error.message}`);
    }
  }
  if (entityFilePaths.length > 0) {
    const { error } = await supabaseAdmin.storage
      .from("entity-files")
      .remove(entityFilePaths);
    if (error) {
      throw new Error(`failed to remove entity-files: ${error.message}`);
    }
  }
}

async function clearDemoData(req: Request, accountId: number) {
  const db = userScopedClient(req);

  // Clean up storage objects before row deletion so the deletion order stays
  // FK-safe and no orphans are left behind if a later step fails.
  const { documentPaths, entityFilePaths } =
    await collectStoragePaths(accountId);
  await removeStorageObjects(documentPaths, entityFilePaths);

  for (const table of DELETE_ORDER) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) {
      throw new Error(`delete from ${table} failed: ${error.message}`);
    }
  }

  const { error: flagError } = await supabaseAdmin
    .from("accounts")
    .update({ demo: false })
    .eq("id", accountId);
  if (flagError)
    throw new Error(`failed to clear accounts.demo: ${flagError.message}`);

  return { cleared: true as const, accountId };
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, (req) =>
    AuthMiddleware(req, (req) =>
      UserMiddleware(req, async (req, user?: User) => {
        if (req.method !== "POST" && req.method !== "DELETE") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        if (!user) return createErrorResponse(401, "Unauthorized");

        const accountId = await resolveAccountId(user.id);
        if (!accountId) {
          return createErrorResponse(409, "No active account for user");
        }

        try {
          const summary = await clearDemoData(req, accountId);
          return new Response(JSON.stringify(summary), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (e) {
          console.error("clear_demo failed:", e);
          return createErrorResponse(
            500,
            (e as Error).message || "Failed to clear demo data",
          );
        }
      }),
    ),
  ),
);
