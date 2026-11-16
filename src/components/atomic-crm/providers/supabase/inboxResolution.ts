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

/** Delete only the still-nameless, unchanged suggestion created by the attempt. */
export async function deleteOwnedInboxShidduch(
  params: OwnedShidduchDeleteParams,
): Promise<boolean> {
  let query = getSupabaseClient()
    .from("shidduchim")
    .delete()
    .eq("id", params.id)
    .is("name_en", null);
  if (params.singleId != null) query = query.eq("single_id", params.singleId);
  if (params.expectedCreatedAt != null) {
    query = query.eq("created_at", params.expectedCreatedAt);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error("Could not remove the failed suggestion attempt.");
  return Array.isArray(data) ? data.length > 0 : data != null;
}
