import type { Identifier } from "ra-core";

import type { InboxItem, ResumeFileVersion } from "../../types";
import { getSupabaseClient } from "./supabase";

/**
 * The resolution lock is a conditional PostgREST update, not a read followed
 * by ra-data-postgrest's ordinary PATCH. `previousData` is not a WHERE
 * predicate in that adapter, so it cannot serialize two Inbox tabs.
 */
export type InboxResolutionUpdateParams = {
  id: Identifier;
  data: Record<string, unknown>;
  status: InboxItem["status"];
  expectedResolutionAttemptId?: string;
  expectedLockAcquiredAt?: string;
  expectedLockAcquiredAtIsNull?: boolean;
  staleBefore?: string;
};

export async function updateInboxItemResolution(
  params: InboxResolutionUpdateParams,
): Promise<InboxItem | null> {
  let query = getSupabaseClient()
    .from("inbox_items")
    .update(params.data)
    .eq("id", params.id)
    .eq("status", params.status);

  if (params.expectedResolutionAttemptId !== undefined) {
    query = query.eq(
      "resolution_attempt_id",
      params.expectedResolutionAttemptId,
    );
  }
  if (params.expectedLockAcquiredAt !== undefined) {
    query = query.filter(
      "resolution_input->>lock_acquired_at",
      "eq",
      params.expectedLockAcquiredAt,
    );
  }
  if (params.expectedLockAcquiredAtIsNull) {
    query = query.filter("resolution_input->>lock_acquired_at", "is", "null");
  }
  if (params.staleBefore !== undefined) {
    query = query.filter(
      "resolution_input->>lock_acquired_at",
      "lt",
      params.staleBefore,
    );
  }

  const { data, error } = await query.select(
    "id,status,resolution_attempt_id,resolution_input,resolved_shidduchim_id,single_id,shadchan_id",
  );
  if (error) {
    throw new Error("Could not update this Inbox item.");
  }
  return ((Array.isArray(data) ? data[0] : data) as InboxItem | null) ?? null;
}

export type OwnedResumeDeleteParams = {
  id: Identifier;
  shidduchimId: Identifier;
  expectedFiles: ResumeFileVersion[];
};

export type OwnedResumeFileDeleteParams = {
  id: Identifier;
  shidduchimId: Identifier;
  expectedFiles: ResumeFileVersion[];
  storagePath: string;
  sourceInboxItemId: Identifier;
  sourceInboxAttachmentPath: string;
};

export type OwnedShidduchDeleteParams = {
  id: Identifier;
  singleId?: Identifier | null;
  expectedCreatedAt?: string | null;
};

/** Delete only an unchanged resume row owned by the failed attempt. */
export async function deleteOwnedInboxResume(
  params: OwnedResumeDeleteParams,
): Promise<boolean> {
  const query = getSupabaseClient()
    .from("resumes")
    .delete()
    .eq("id", params.id)
    .eq("shidduchim_id", params.shidduchimId)
    .eq("files", JSON.stringify(params.expectedFiles));
  const { data, error } = await query.select("id");
  if (error) throw new Error("Could not remove the failed resume attempt.");
  return Array.isArray(data) ? data.length > 0 : data != null;
}

/**
 * Remove exactly one Inbox-provenance file from an unchanged resume row.
 * The catalog CAS happens before Storage cleanup; if Storage reports a
 * failure after the CAS, a retry sees the missing catalog entry and can make
 * the deterministic object cleanup idempotently. It never deletes a
 * different file or an entire user-owned resume row.
 */
export async function deleteOwnedInboxResumeFile(
  params: OwnedResumeFileDeleteParams,
): Promise<boolean> {
  const fileIndex = params.expectedFiles.findIndex(
    (file) =>
      file.path === params.storagePath &&
      String(file.source_inbox_item_id) === String(params.sourceInboxItemId) &&
      file.source_inbox_attachment_path === params.sourceInboxAttachmentPath,
  );
  if (fileIndex === -1) return true;

  const nextFiles = params.expectedFiles.filter(
    (_, index) => index !== fileIndex,
  );
  const { data, error } = await getSupabaseClient()
    .from("resumes")
    .update({ files: nextFiles })
    .eq("id", params.id)
    .eq("shidduchim_id", params.shidduchimId)
    .eq("files", JSON.stringify(params.expectedFiles))
    .select("id");
  if (error) throw new Error("Could not roll back the captured resume file.");
  const updated = Array.isArray(data) ? data.length > 0 : data != null;
  if (!updated) return false;

  const { error: storageError } = await getSupabaseClient()
    .storage.from("documents")
    .remove([params.storagePath]);
  if (storageError) {
    throw new Error("Could not roll back the captured resume file.");
  }
  return true;
}

/** Delete only the still-nameless, unchanged suggestion created by the attempt. */
export async function deleteOwnedInboxShidduch(
  params: OwnedShidduchDeleteParams,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc(
    "delete_owned_inbox_shidduch",
    {
      p_id: params.id,
      p_single_id: params.singleId ?? null,
      p_created_at: params.expectedCreatedAt ?? null,
    },
  );
  if (error) throw new Error("Could not remove the failed suggestion attempt.");
  return Boolean(data);
}
