import { supabaseDataProvider } from "ra-supabase-core";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import type {
  AddEducationInput,
  AddRedtInput,
  AiEntitlementInfo,
  ChildGrant,
  ChildGrantAccessLevel,
  ChildGrantPreview,
  Connection,
  ConnectionInvitePreview,
  DemoOnboardingState,
  CreateReferenceForShidduchInput,
  CreateShidduchInput,
  CreateThreadInput,
  EntityFile,
  InboxItem,
  Invite,
  InvitableRole,
  InvitePreview,
  LinkReferenceInput,
  LogReferenceCallInput,
  MatchReferenceInput,
  MergeResolution,
  Member,
  MemberFormData,
  MyContext,
  MyPersona,
  Persona,
  PipelineState,
  RAFile,
  RedtViaConnectionInput,
  Reference,
  ReferenceLink,
  ReferenceMatchCandidate,
  ReferenceMergePreview,
  Resume,
  ResumePhoto,
  ShareAccessLog,
  Shidduch,
  ShidduchCatch,
  ShidduchEducation,
  Thread,
  ThreadParticipant,
  ThreadVisibility,
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { UNENTITLED_AI } from "../commons/aiEntitlement";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import {
  buildEntityFilesCleanupCallbacks,
  deleteEntityFile as deleteEntityFileImpl,
  signEntityFileUrl as signEntityFileUrlImpl,
  uploadEntityFile as uploadEntityFileImpl,
} from "./entityFiles";
import type {
  DeleteEntityFileParams,
  SignEntityFileUrlParams,
  UploadEntityFileParams,
} from "./entityFiles";
import { copyInboxAttachmentsToEntityFiles as copyInboxAttachmentsToEntityFilesImpl } from "./inboxAttachments";
import type { CopyInboxAttachmentsParams } from "./inboxAttachments";
import { trustSenderAndRelease } from "./trustedSenders";
import type { TrustSenderParams, TrustSenderResult } from "./trustedSenders";
import {
  signResumeFileUrl as signResumeFileUrlImpl,
  uploadResumeFile as uploadResumeFileImpl,
} from "./resumes";
import type {
  SignResumeFileUrlParams,
  UploadResumeFileParams,
} from "./resumes";
import {
  hideResumePhoto as hideResumePhotoImpl,
  signResumePhotoUrl as signResumePhotoUrlImpl,
  uploadResumePhoto as uploadResumePhotoImpl,
} from "./resumePhotos";
import type {
  HideResumePhotoParams,
  SignResumePhotoUrlParams,
  UploadResumePhotoParams,
} from "./resumePhotos";
import { buildResumeStorageCleanupCallbacks } from "./resumeStorageCleanup";
import { getSupabaseClient } from "./supabase";
import {
  getAnalyticsSummary,
  getCounterMetrics,
  setAnalyticsEnabled,
} from "./analytics";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
} from "../../analytics/types";

// Story 9.3: `public.listing_withdrawal_locks` deliberately has no `id`
// column at all (Dev Notes "Why a lock table, not a column on `singles`" —
// no identity column, no sequence). `@raphiniert/ra-data-postgrest`
// defaults every resource's primary key to `id` unless told otherwise, so
// without this every row would come back with `id: undefined`. Configuring
// `single_id` here makes the underlying primitive
// (`dataWithVirtualId`/`encodeId`) mirror it onto a client-side `id` field.
//
// Story 12.2: `public.cron_heartbeat`'s real primary key is `worker text`,
// the same shape — no `id` column exists. The story's own `CronHeartbeat`
// type doc comment (`../../types.ts`) already documents this requirement;
// without this entry `useGetOne("cron_heartbeat", { id: "cron" })` builds
// `id=eq.cron` against a table with no `id` column, which PostgREST answers
// with `400`/`42703`, not the `406` (no matching row) that
// `ReminderDeliveryStatus.tsx`'s AC-9 status resolution expects — permanently
// rendering "Couldn't check" instead of any of the three real states.
const PRIMARY_KEYS = new Map<string, string[]>([
  ["listing_withdrawal_locks", ["single_id"]],
  ["cron_heartbeat", ["worker"]],
]);

const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    primaryKeys: PRIMARY_KEYS,
    sortOrder: "asc,desc.nullslast" as any,
  });

// The SOLE INSERT path into shidduchim (AD-4 invariant 1): the create_shidduch
// RPC. The board's create form calls dataProvider.createShidduch() directly;
// the UI never issues a raw dataProvider.create("shidduchim"). At the DB, a
// BEFORE INSERT trigger (enforce_shidduch_initial_state) additionally blocks
// creating a row straight into a decision state.
const createShidduchViaRpc = async (
  input: CreateShidduchInput,
): Promise<Shidduch> => {
  const { data, error } = await getSupabaseClient().rpc("create_shidduch", {
    p_single_id: input.single_id,
    p_shadchan_id: input.shadchan_id ?? null,
    p_name_en: input.name_en ?? null,
    p_name_he: input.name_he ?? null,
    p_father_en: input.father_en ?? null,
    p_father_he: input.father_he ?? null,
    p_mother_en: input.mother_en ?? null,
    p_mother_he: input.mother_he ?? null,
    p_dob: input.dob ?? null,
    p_background: input.background ?? null,
    p_marital_status: input.marital_status ?? null,
    p_existing_children_note: input.existing_children_note ?? null,
    p_seminary_en: input.seminary_en ?? null,
    p_seminary_he: input.seminary_he ?? null,
    p_shul_en: input.shul_en ?? null,
    p_shul_he: input.shul_he ?? null,
    p_location_en: input.location_en ?? null,
    p_location_he: input.location_he ?? null,
    p_age: input.age ?? null,
    p_height: input.height ?? null,
    p_origin: input.origin ?? "manual",
    p_initial_state: input.initial_state ?? "new",
    p_visibility: input.visibility ?? "shared",
    p_redt_date: input.redt_date ?? null,
    p_person_gender: input.person_gender ?? null,
    p_kohen_status: input.kohen_status ?? "unknown",
  });
  if (error) {
    console.error("createShidduch.error", error);
    throw new Error(error.message || "Failed to create shidduch");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Shidduch;
};

// Story 7.1 (AC-1, AC-2, AC-7)/Story 7.4 (AC-1): the SOLE creation path for
// a thread and its initial participants together (mirrors
// create_shidduch()'s "one creation path" precedent above) — the SPA never
// calls dataProvider.create("threads", …) directly. `p_connection_id` is
// forwarded when supplied; no built UI sets `input.connection_id` yet (this
// story ships the capability, not a surface — see the story's Dev Notes).
const createThreadViaRpc = async (
  input: CreateThreadInput,
): Promise<Thread> => {
  const { data, error } = await getSupabaseClient().rpc("create_thread", {
    p_subject_type: input.subject_type,
    p_subject_id: input.subject_id ?? null,
    p_participant_member_ids: input.participant_member_ids ?? [],
    p_visibility: input.visibility ?? null,
    p_connection_id: input.connection_id ?? null,
  });
  if (error) {
    console.error("createThread.error", error);
    throw new Error(error.message || "Failed to start the discussion");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Thread;
};

// Story 7.3 (AC-1, AC-4, AC-8): flips an EXISTING thread's visibility "by
// agreement" (FR97) — any current thread_participants member, not only its
// creator (Dev Notes, "Why any participant, not just the creator, can flip
// visibility"). The RPC itself is the enforcement (readability +
// participation, two distinct SQLSTATEs); this wrapper only shapes the call,
// exactly like createThreadViaRpc above.
const setThreadVisibilityViaRpc = async (
  threadId: Identifier,
  visibility: ThreadVisibility,
): Promise<Thread> => {
  const { data, error } = await getSupabaseClient().rpc(
    "set_thread_visibility",
    {
      p_thread_id: threadId,
      p_visibility: visibility,
    },
  );
  if (error) {
    console.error("setThreadVisibility.error", error);
    throw new Error(
      error.message || "Failed to update this discussion's privacy",
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Thread;
};

// Story 7.5 (AC-1, AC-2): the SOLE write path for the caller's own
// `thread_participants.last_read_at` — marks a thread read the moment the
// caller opens it (ThreadPanel.tsx). The RPC's own predicate
// (`tp.member_id = current_member_id() and tp.thread_id = p_thread_id`) IS
// the authorization check: a caller with no matching participant row simply
// updates zero rows rather than raising, so this wrapper never needs a
// client-side participation guard of its own — same shape as
// setThreadVisibilityViaRpc above. Return type is nullable, unlike that
// sibling: `mark_thread_read()`'s SQL (`RETURNS public.thread_participants`,
// not SETOF) resolves to a NULL composite — PostgREST serializes that to a
// bare JSON `null` — on the zero-rows-affected case AC-2 requires, and the
// caller (ThreadPanel.tsx) never reads the resolved value, only whether the
// call settled.
const markThreadReadViaRpc = async (
  threadId: Identifier,
): Promise<ThreadParticipant | null> => {
  const { data, error } = await getSupabaseClient().rpc("mark_thread_read", {
    p_thread_id: threadId,
  });
  if (error) {
    console.error("markThreadRead.error", error);
    throw new Error(error.message || "Failed to mark this discussion read");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ThreadParticipant | null;
};

// Story 8.2 (AC-1, AC-2): the five consent-workflow RPC wrappers — same
// shape as createShidduchViaRpc/createThreadViaRpc above (destructure
// `{ data, error }`, log+throw on error). Every write on connections/
// connection_invites goes through one of these SECURITY DEFINER functions
// (02_functions.sql); the client has no other path (06_grants.sql).
const createConnectionInviteViaRpc = async (): Promise<string> => {
  const { data, error } = await getSupabaseClient().rpc(
    "create_connection_invite",
  );
  if (error) {
    console.error("createConnectionInvite.error", error);
    throw new Error(error.message || "Failed to create that invite link");
  }
  return data as string;
};

const revokeConnectionInviteViaRpc = async (
  inviteId: Identifier,
): Promise<void> => {
  const { error } = await getSupabaseClient().rpc("revoke_connection_invite", {
    p_invite_id: inviteId,
  });
  if (error) {
    console.error("revokeConnectionInvite.error", error);
    throw new Error(error.message || "Failed to revoke that invite");
  }
};

// Story 9.3 (AC-4): the sole remover of a listing_withdrawal_locks row. A
// wrong-caller invocation (anyone but the single/self-manager the lock
// belongs to) is a SILENT no-op at the database (consent_to_republish_
// listing() fails closed rather than raising, AD-19's style) — this wrapper
// does not paper over that with a client-side check; it exists only to
// surface the ONE genuine error class, a network/RPC failure.
const consentToRepublishListingViaRpc = async (
  singleId: Identifier,
): Promise<void> => {
  const { error } = await getSupabaseClient().rpc(
    "consent_to_republish_listing",
    { p_single_id: singleId },
  );
  if (error) {
    console.error("consentToRepublishListing.error", error);
    throw new Error(error.message || "Failed to consent to republishing");
  }
};

// Story 9.5 (Task 6): revocation MUST touch only `revoked_at` — a generic
// `dataProvider.update("share_links", { data: fullRecord, ... })` sends
// every field present in `data` to PostgREST, and Task 2's grant is
// `update (revoked_at)` only (column-level, no table-level `update` at
// all). PostgREST refuses a PATCH naming a column the caller has no
// UPDATE privilege on regardless of whether that column's VALUE actually
// changed, so this bypasses the generic dataProvider path entirely and
// issues a raw PATCH naming ONLY `revoked_at`. `enforce_share_link_revoke_
// once` (02_functions.sql) is the server-side half of "one-way" (AC-6); this
// wrapper does not attempt to pre-check that itself — a wrong-state revoke
// attempt surfaces as the same ordinary trigger-raised error every other
// failure here does.
const revokeShareLinkViaUpdate = async (id: Identifier): Promise<void> => {
  const { error } = await getSupabaseClient()
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("revokeShareLink.error", error);
    throw new Error(error.message || "Failed to revoke that share link");
  }
};

// Story 9.5 (AC-8): the sharer's own access-log view. A plain read — RLS
// ("Share access log readable by link owner", 05_policies.sql) already
// narrows this to links the caller manages, via share_links' own manager
// scoping, so this wrapper adds no authorization of its own, only a
// documented, thin client surface (mirrors createShidduchViaRpc's own
// shape: a small function this file's return object exposes, rather than
// every caller re-deriving the same getList params by hand).
const getShareAccessLogViaGetList = async (
  baseDataProvider: DataProvider,
  shareLinkId: Identifier,
): Promise<ShareAccessLog[]> => {
  const { data } = await baseDataProvider.getList<ShareAccessLog>(
    "share_access_log",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "accessed_at", order: "DESC" },
      filter: { share_link_id: shareLinkId },
    },
  );
  return data;
};

// Read-only (Task 3): the acceptor has no SELECT path to connection_invites,
// so this is the one purpose-built read letting the accept screen show who
// is inviting before the user commits. Resolves to null for an unknown,
// expired or already-consumed token — never an error — mirroring
// getInvitePreview's own null-for-not-found shape above.
const previewConnectionInviteViaRpc = async (
  token: string,
): Promise<ConnectionInvitePreview | null> => {
  const { data, error } = await getSupabaseClient().rpc(
    "preview_connection_invite",
    { p_token: token },
  );
  if (error) {
    console.error("previewConnectionInvite.error", error);
    throw new Error("Failed to look up this invite");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ConnectionInvitePreview | null;
};

const acceptConnectionInviteViaRpc = async (
  token: string,
): Promise<Connection> => {
  const { data, error } = await getSupabaseClient().rpc(
    "accept_connection_invite",
    { p_token: token },
  );
  if (error) {
    console.error("acceptConnectionInvite.error", error);
    throw new Error(error.message || "Failed to accept that invite");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Connection;
};

const endConnectionViaRpc = async (
  connectionId: Identifier,
): Promise<Connection> => {
  const { data, error } = await getSupabaseClient().rpc("end_connection", {
    p_connection_id: connectionId,
  });
  if (error) {
    console.error("endConnection.error", error);
    throw new Error(error.message || "Failed to end that connection");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Connection;
};

// Story 13.1: child grant lifecycle RPC wrappers — same shape as
// connection_invites (create/revoke/preview/accept/sever/regrant). All writes
// go through these SECURITY DEFINER functions; the client has no direct DML
// access to child_grants (06_grants.sql).
const createChildGrantViaRpc = async (
  targetSingleId: Identifier,
  granteeEmail: string,
  accessLevel: ChildGrantAccessLevel,
): Promise<string> => {
  const { data, error } = await getSupabaseClient().rpc("create_child_grant", {
    p_target_single_id: targetSingleId,
    p_grantee_email: granteeEmail,
    p_access_level: accessLevel,
  });
  if (error) {
    console.error("createChildGrant.error", error);
    throw new Error(error.message || "Failed to create that grant");
  }
  return data as string;
};

// New RPC: lets the proposer change an already-accepted grant's tier
// without severing and re-granting.
const updateChildGrantAccessViaRpc = async (
  grantId: Identifier,
  accessLevel: ChildGrantAccessLevel,
): Promise<void> => {
  const { error } = await getSupabaseClient().rpc("update_child_grant_access", {
    p_grant_id: grantId,
    p_access_level: accessLevel,
  });
  if (error) {
    console.error("updateChildGrantAccess.error", error);
    throw new Error(
      error.message || "Failed to update that grant's access level",
    );
  }
};

const revokeChildGrantViaRpc = async (grantId: Identifier): Promise<void> => {
  const { error } = await getSupabaseClient().rpc("revoke_child_grant", {
    p_grant_id: grantId,
  });
  if (error) {
    console.error("revokeChildGrant.error", error);
    throw new Error(error.message || "Failed to revoke that grant");
  }
};

const previewChildGrantViaRpc = async (
  token: string,
): Promise<ChildGrantPreview | null> => {
  const { data, error } = await getSupabaseClient().rpc("preview_child_grant", {
    p_token: token,
  });
  if (error) {
    console.error("previewChildGrant.error", error);
    throw new Error("Failed to look up this grant");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ChildGrantPreview | null;
};

const acceptChildGrantViaRpc = async (token: string): Promise<ChildGrant> => {
  const { data, error } = await getSupabaseClient().rpc("accept_child_grant", {
    p_token: token,
  });
  if (error) {
    console.error("acceptChildGrant.error", error);
    throw new Error(error.message || "Failed to accept that grant");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as ChildGrant;
};

const severChildGrantViaRpc = async (
  grantId: Identifier,
): Promise<ChildGrant> => {
  const { data, error } = await getSupabaseClient().rpc("sever_child_grant", {
    p_grant_id: grantId,
  });
  if (error) {
    console.error("severChildGrant.error", error);
    throw new Error(error.message || "Failed to sever that grant");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as ChildGrant;
};

const regrantChildGrantViaRpc = async (
  grantId: Identifier,
): Promise<string> => {
  const { data, error } = await getSupabaseClient().rpc("regrant_child_grant", {
    p_grant_id: grantId,
  });
  if (error) {
    console.error("regrantChildGrant.error", error);
    throw new Error(error.message || "Failed to re-grant that grant");
  }
  return data as string;
};

// Story 8.3 (AC-1, AC-2, AC-3, AC-5): a connected shadchan's redt — inbound
// capture (AD-6), scoped by connection, never a direct write into the
// household's inbox_items (05_policies.sql's "Inbox items scoped to
// account" keys strictly on account_id = current_context_id(), never
// satisfied by a shadchan whose active context is their own shadchanus
// account). Same shape as createShidduchViaRpc above.
const redtViaConnectionViaRpc = async (
  input: RedtViaConnectionInput,
): Promise<InboxItem> => {
  const { data, error } = await getSupabaseClient().rpc("redt_via_connection", {
    p_connection_id: input.connection_id,
    p_subject: input.subject ?? null,
    p_raw_text: input.raw_text,
    p_attachments: input.attachments ?? null,
  });
  if (error) {
    console.error("redtViaConnection.error", error);
    throw new Error(error.message || "Failed to send that redt");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as InboxItem;
};

// Exported for `dataProviderReads.test.ts`: the read redirects below are now a
// privilege requirement, not only an AD-10 convention, so the test exercises
// what ships rather than a re-implementation of it.
export const getDataProviderWithCustomMethods = () => {
  const baseDataProvider = getBaseDataProvider();

  return {
    ...baseDataProvider,
    async getList(resource: string, params: GetListParams) {
      if (resource === "shidduchim") {
        // Board list/detail reads go through the summary view (AD-10).
        return baseDataProvider.getList("shidduchim_summary", params);
      }
      if (resource === "references") {
        // The reference book reads counts (linked shidduchim, open tasks, last
        // conversation) from the summary view rather than N+1 fetching them.
        return baseDataProvider.getList("references_summary", params);
      }
      if (resource === "reference_links") {
        // Both the per-shidduch call-log cards and the repeat-recognition panel
        // need the joined shidduch/single names, so they read the summary view.
        return baseDataProvider.getList("reference_links_summary", params);
      }
      if (
        resource === "analytics_events" ||
        resource === "analytics_events_summary"
      ) {
        // Analytics events summary view (Story 15.2, AD-10).
        return baseDataProvider.getList("analytics_events_summary", params);
      }

      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "shidduchim") {
        return baseDataProvider.getOne("shidduchim_summary", params);
      }
      if (resource === "references") {
        return baseDataProvider.getOne("references_summary", params);
      }
      if (resource === "reference_links") {
        return baseDataProvider.getOne("reference_links_summary", params);
      }

      return baseDataProvider.getOne(resource, params);
    },
    // `getMany` has to redirect too, and unlike getList/getOne above this is
    // not merely an AD-10 convention any more — it is load-bearing.
    // public.shidduchim no longer grants `authenticated` a table-level SELECT:
    // the close_reason column privilege is what enforces Story 6.3's AC-4, and
    // Postgres has no "all columns except one" grant, so SELECT is granted
    // column by column WITHOUT close_reason (06_grants.sql). PostgREST's
    // default representation is `select=*`, which needs SELECT on EVERY
    // column, so a raw `getMany("shidduchim")` now answers
    // `403 {"code":"42501","message":"permission denied for table shidduchim"}`
    // — the reminders hub would render its shidduch reminders as a bare error
    // instead of a label. shidduchim_summary carries the same rows (it is
    // `security_invoker = on`, so RLS is unchanged) plus the joined names the
    // hub wants, and reads close_reason through the masking accessor.
    // Any NEW read of shidduchim must go through the view for the same reason.
    async getMany(resource: string, params: any) {
      if (resource === "shidduchim") {
        return baseDataProvider.getMany("shidduchim_summary", params);
      }
      return baseDataProvider.getMany(resource, params);
    },
    async create(resource: string, params: any) {
      if (resource === "shidduchim") {
        return { data: await createShidduchViaRpc(params.data ?? {}) } as any;
      }
      return baseDataProvider.create(resource, params);
    },

    async memberUpdate(id: Identifier, data: Partial<MemberFormData>) {
      const { email, first_name, last_name, administrator, avatar, disabled } =
        data;

      const { data: updatedData, error } =
        await getSupabaseClient().functions.invoke<{
          data: Member;
        }>("users", {
          method: "PATCH",
          body: {
            member_id: id,
            email,
            first_name,
            last_name,
            administrator,
            disabled,
            avatar,
          },
        });

      if (!updatedData || error) {
        console.error("memberUpdate.error", error);
        throw new Error("Failed to update account manager");
      }

      return updatedData.data;
    },
    // The SOLE INSERT path into shidduchim (AD-4 invariant 1) — the reusable
    // primitive a future fileInboxItem() (Epic-6) wraps. Backed by the
    // create_shidduch RPC; see createShidduchViaRpc above.
    createShidduch: createShidduchViaRpc,
    // Story 7.1 (AC-1, AC-2, AC-7): the SOLE creation path for a thread —
    // see createThreadViaRpc above. Plain dataProvider.create("messages", …)
    // / getList("messages"|"thread_participants", …) need no wrapper — RLS
    // and the triggers (set_message_defaults, set_thread_participant_
    // defaults) do the rest.
    createThread: createThreadViaRpc,
    // Story 7.3 (AC-1) — see setThreadVisibilityViaRpc above.
    setThreadVisibility: setThreadVisibilityViaRpc,
    // Story 7.5 (AC-1, AC-2) — see markThreadReadViaRpc above.
    markThreadRead: markThreadReadViaRpc,
    // Story 8.2 (AC-1, AC-2, AC-3) — see the five wrappers above.
    createConnectionInvite: createConnectionInviteViaRpc,
    revokeConnectionInvite: revokeConnectionInviteViaRpc,
    previewConnectionInvite: previewConnectionInviteViaRpc,
    acceptConnectionInvite: acceptConnectionInviteViaRpc,
    endConnection: endConnectionViaRpc,
    // Story 13.1: child grant lifecycle — see the six wrappers above.
    createChildGrant: createChildGrantViaRpc,
    revokeChildGrant: revokeChildGrantViaRpc,
    previewChildGrant: previewChildGrantViaRpc,
    acceptChildGrant: acceptChildGrantViaRpc,
    severChildGrant: severChildGrantViaRpc,
    regrantChildGrant: regrantChildGrantViaRpc,
    updateChildGrantAccess: updateChildGrantAccessViaRpc,
    // Story 8.3 (Task 5) — see redtViaConnectionViaRpc above.
    redtViaConnection: redtViaConnectionViaRpc,
    // Story 9.3 (AC-4) — see consentToRepublishListingViaRpc above.
    consentToRepublishListing: consentToRepublishListingViaRpc,
    // Story 9.5 (Task 6) — see revokeShareLinkViaUpdate above.
    revokeShareLink: revokeShareLinkViaUpdate,
    async getShareAccessLog(
      shareLinkId: Identifier,
    ): Promise<ShareAccessLog[]> {
      return getShareAccessLogViaGetList(baseDataProvider, shareLinkId);
    },
    // Story 7.3 (Task 4): "who am I" in the ACTIVE context's
    // `account_members.id` space — the id `thread_participants.member_id`
    // is keyed on, and a DIFFERENT id space from `getIdentity().id`
    // (`members.id`, ThreadPanel.tsx's own comment documents this trap for
    // the composer). No existing primitive resolves this without a round
    // trip; current_member_id() is exactly what the private branch of
    // thread_is_readable() and set_thread_visibility() already call
    // server-side, exposed here for the ONE client-side use that needs it:
    // deriving whether the caller is a participant from the thread's
    // already-loaded participant list, without re-deriving identity per
    // thread (ThreadPanel.tsx caches this query).
    async getCurrentMemberId(): Promise<Identifier | null> {
      const { data, error } =
        await getSupabaseClient().rpc("current_member_id");
      if (error) {
        console.error("current_member_id.error", error);
        return null;
      }
      return (data ?? null) as Identifier | null;
    },
    // The SOLE writer of pipeline_state (AD-4 invariant 2). Calls the
    // transition_shidduch RPC, which enforces the transitions-as-data graph.
    async transitionShidduch(
      id: Identifier,
      from: PipelineState,
      to: PipelineState,
      closeReason?: string,
    ): Promise<Shidduch> {
      const { data, error } = await getSupabaseClient().rpc(
        "transition_shidduch",
        {
          p_id: id,
          p_from: from,
          p_to: to,
          p_close_reason: closeReason ?? null,
        },
      );
      if (error) {
        console.error("transitionShidduch.error", error);
        throw new Error(error.message || "Failed to move shidduch");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as Shidduch;
    },
    // Append a redt to a shidduch (same or different shadchan, new date). The DB
    // trigger keeps shidduchim.redt_date (= latest) in sync. Returns the
    // refreshed shidduch.
    async addRedt(input: AddRedtInput): Promise<Shidduch> {
      const { data, error } = await getSupabaseClient().rpc("add_redt", {
        p_shidduchim_id: input.shidduchim_id,
        p_shadchan_id: input.shadchan_id ?? null,
        p_redt_date: input.redt_date ?? null,
        p_note: input.note ?? null,
      });
      if (error) {
        console.error("addRedt.error", error);
        throw new Error(error.message || "Failed to add redt");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as Shidduch;
    },
    // Link a school/seminary/yeshiva (with optional years) to a shidduch. A
    // single can have several. Returns the created education row.
    async addEducation(input: AddEducationInput): Promise<ShidduchEducation> {
      const { data, error } = await getSupabaseClient().rpc("add_education", {
        p_shidduchim_id: input.shidduchim_id,
        p_kind: input.kind ?? "seminary",
        p_name_en: input.name_en ?? null,
        p_name_he: input.name_he ?? null,
        p_start_year: input.start_year ?? null,
        p_end_year: input.end_year ?? null,
      });
      if (error) {
        console.error("addEducation.error", error);
        throw new Error(error.message || "Failed to add school");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ShidduchEducation;
    },

    /**
     * Dedupe "catch" (E3): "you've come across this person before". Given one
     * shidduch, returns prior suggestions (for any single in this family) and any
     * honestly-corroborated prior date for the same person, each with confidence
     * and deciding facts. Read-only — nothing merges. Backed by catch_shidduch(),
     * which reuses the shared identity matcher (AD-5). FREE, never entitlement-gated.
     */
    async catchShidduch(id: Identifier): Promise<ShidduchCatch> {
      const { data, error } = await getSupabaseClient().rpc("catch_shidduch", {
        p_shidduchim_id: id,
      });
      if (error) {
        console.error("catchShidduch.error", error);
        throw new Error(error.message || "Failed to check for prior matches");
      }
      return (data ?? {
        has_catch: false,
        suggestions: [],
        dates: [],
      }) as ShidduchCatch;
    },

    // ---------------------------------------------------------------------
    // References (FR20, FR39-43). Match-on-entry is FREE and never gated by
    // subscription state — do not add an entitlement check to any of these.
    // ---------------------------------------------------------------------

    /**
     * Match-on-entry: given what the user has typed so far, ask the shared
     * identity service whether this person is already in the book. The SPA
     * passes raw strings — all normalization happens in the database (AD-5).
     * Returns candidates with confidence and deciding facts; the user always
     * confirms or dismisses. Nothing is ever linked automatically.
     */
    async matchReferenceOnEntry(
      input: MatchReferenceInput,
    ): Promise<ReferenceMatchCandidate[]> {
      const { data, error } = await getSupabaseClient().rpc(
        "match_reference_on_entry",
        {
          p_name_en: input.name_en ?? null,
          p_name_he: input.name_he ?? null,
          p_phone: input.phone ?? null,
          p_school: input.school ?? null,
          p_exclude_id: input.exclude_id ?? null,
        },
      );
      if (error) {
        console.error("matchReferenceOnEntry.error", error);
        throw new Error(error.message || "Failed to look for existing people");
      }
      return (data ?? []) as ReferenceMatchCandidate[];
    },

    /**
     * The confirm half of match-on-entry: link the mention to the reference the
     * user recognised, instead of creating a duplicate. Idempotent.
     */
    async linkReferenceToShidduch(
      input: LinkReferenceInput,
    ): Promise<ReferenceLink> {
      const { data, error } = await getSupabaseClient().rpc(
        "link_reference_to_shidduch",
        {
          p_reference_id: input.reference_id,
          p_shidduchim_id: input.shidduchim_id,
          p_relationship_override: input.relationship_override ?? null,
        },
      );
      if (error) {
        console.error("linkReferenceToShidduch.error", error);
        throw new Error(error.message || "Failed to link the reference");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ReferenceLink;
    },

    /**
     * Creates a reference and attaches it to a shidduch in ONE statement
     * (RULING 7 R7). Replaces create-then-link, where a failure between the
     * two calls left an orphan reference attached to nothing.
     */
    async createReferenceForShidduch(
      input: CreateReferenceForShidduchInput,
    ): Promise<Reference> {
      const { data, error } = await getSupabaseClient().rpc(
        "create_reference_for_shidduch",
        {
          p_shidduchim_id: input.shidduchim_id,
          p_name_en: input.name_en ?? null,
          p_name_he: input.name_he ?? null,
          p_relationship: input.relationship ?? null,
          p_phone: input.phone ?? null,
          p_school: input.school ?? null,
          p_grad_year: input.grad_year ?? null,
          p_relationship_override: input.relationship_override ?? null,
        },
      );
      if (error) {
        console.error("createReferenceForShidduch.error", error);
        throw new Error(error.message || "Failed to create the reference");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as Reference;
    },

    /**
     * The one write path for call capture. The mid-call screen and the guided
     * call script both come through here, so the assistant can never become a
     * second, disconnected data path.
     */
    async logReferenceCall(
      input: LogReferenceCallInput,
    ): Promise<ReferenceLink> {
      const { data, error } = await getSupabaseClient().rpc(
        "log_reference_call",
        {
          p_reference_link_id: input.reference_link_id,
          p_call_status: input.call_status ?? null,
          p_what_they_said: input.what_they_said ?? null,
          p_source: input.source ?? "manual",
        },
      );
      if (error) {
        console.error("logReferenceCall.error", error);
        throw new Error(error.message || "Failed to save the call");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ReferenceLink;
    },

    /**
     * What a merge would do, before anything is destroyed. `collisions` is the
     * case where both duplicate references hold a call log for the SAME
     * shidduch. The UI must make the user resolve each one.
     */
    async previewReferenceMerge(
      loserId: Identifier,
      winnerId: Identifier,
    ): Promise<ReferenceMergePreview> {
      const { data, error } = await getSupabaseClient().rpc(
        "preview_reference_merge",
        { p_loser_id: loserId, p_winner_id: winnerId },
      );
      if (error) {
        console.error("previewReferenceMerge.error", error);
        throw new Error(error.message || "Failed to prepare the merge");
      }
      return data as ReferenceMergePreview;
    },

    /**
     * Merge two duplicate references. `resolutions` is keyed by shidduchim_id;
     * the database refuses the merge if any collision is unanswered, rather than
     * silently discarding one side's call log.
     */
    async mergeReferences(
      loserId: Identifier,
      winnerId: Identifier,
      resolutions: Record<string, MergeResolution> = {},
    ): Promise<Identifier> {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "merge_references",
        {
          method: "POST",
          body: { loserId, winnerId, resolutions },
        },
      );
      if (error) {
        console.error("merge_references.error", error);
        throw new Error(
          (data as { error?: string } | null)?.error ??
            "Failed to merge references",
        );
      }
      return (data as { winnerId: Identifier }).winnerId;
    },

    // ---------------------------------------------------------------------
    // Demo / onboarding (Stage B). Thin wrappers around the seed_demo /
    // clear_demo edge functions and the current_account_demo() RPC — see
    // supabase/functions/seed_demo|clear_demo/index.ts and 02_functions.sql.
    // ---------------------------------------------------------------------
    async seedDemo(): Promise<{ seeded: boolean; reason?: string }> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        seeded: boolean;
        reason?: string;
      }>("seed_demo", { method: "POST" });
      if (error || !data) {
        console.error("seed_demo.error", error);
        throw new Error("Failed to load the demo data");
      }
      return data;
    },
    // `releaseDemoFlag` is required (not defaulted) here on purpose: this is
    // the only frontend caller of clear_demo, and the two possible intents
    // (permanently exit demo mode vs. a reseed refresh that must keep the
    // account demo-flagged) are different enough that a call site should
    // never be able to omit the choice by accident. clear_demo's own default
    // (absent -> false) is what protects admin_reseed_demo_accounts, which
    // calls the edge function directly rather than through this method.
    async clearDemo(
      releaseDemoFlag: boolean,
    ): Promise<{ cleared: boolean; personaWarning?: string }> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        cleared: boolean;
        personaWarning?: string;
      }>("clear_demo", { method: "POST", body: { releaseDemoFlag } });
      if (error || !data) {
        console.error("clear_demo.error", error);
        throw new Error("Failed to clear the demo data");
      }
      return data;
    },
    async currentAccountDemo(): Promise<boolean> {
      const { data, error } = await getSupabaseClient().rpc(
        "current_account_demo",
      );
      if (error) {
        console.error("current_account_demo.error", error);
        return false; // fail-soft: no banner rather than a broken app
      }
      return data === true;
    },
    // Context switcher (2.4 AC-5/AC-6): every context the caller belongs to,
    // one row per account. Fail-loud, like getMyPersonas — a swallowed error
    // here would read as "only one context" and silently hide the switcher.
    async getMyContexts(): Promise<MyContext[]> {
      const { data, error } = await getSupabaseClient().rpc("my_contexts");
      if (error) {
        console.error("my_contexts.error", error);
        throw new Error("Failed to load your contexts");
      }
      return (data ?? []) as MyContext[];
    },
    // The one validated way to switch which context is active (AD-19):
    // set_active_context() raises if the caller has no live active
    // membership of accountId, so a failed switch surfaces as an error
    // rather than silently leaving the old context active.
    async switchActiveContext(accountId: Identifier): Promise<void> {
      const { error } = await getSupabaseClient().rpc("set_active_context", {
        p_account_id: accountId,
      });
      if (error) {
        console.error("set_active_context.error", error);
        throw new Error("Couldn't switch context. Try again.");
      }
    },
    async prepareDemoOnboarding(): Promise<DemoOnboardingState> {
      const { data, error } = await getSupabaseClient().rpc(
        "prepare_demo_onboarding",
      );
      if (error || !data) {
        console.error("prepare_demo_onboarding.error", error);
        throw new Error("Couldn't prepare the demo. Try again.");
      }
      return data as DemoOnboardingState;
    },
    async cancelDemoOnboarding(): Promise<void> {
      const { error } = await getSupabaseClient().rpc("cancel_demo_onboarding");
      if (error) {
        console.error("cancel_demo_onboarding.error", error);
        throw new Error("Couldn't finish onboarding. Try again.");
      }
    },
    async getDemoOnboardingState(): Promise<DemoOnboardingState | null> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_demo_onboarding_state",
      );
      if (error) {
        console.error("get_demo_onboarding_state.error", error);
        throw new Error("Failed to load onboarding state");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row ? (row as DemoOnboardingState) : null;
    },
    // "What am I" (2.2 AC-8, 2.3 AC-9): the one read `OnboardingGate` and the
    // onboarding screen both call. Fail-loud, unlike `currentAccountDemo`
    // above — a swallowed error here would read as "no personas yet" and
    // silently re-run onboarding for an existing user.
    /**
     * Whether this login still owes the 18+ affirmation (`OnboardingGate`).
     *
     * Fails toward NOT blocking, deliberately, and unlike its neighbours: a
     * transient RPC failure must not lock every signed-in user out behind a
     * consent screen whose button also needs the network. `OnboardingGate`
     * holds the same posture for personas/contexts ("fails TOWARD the
     * shell"). The affirmation is a self-declaration, so the cost of missing
     * one on a broken read is far below the cost of a global lockout — and
     * `age_affirmation_pending()` stays true until `affirm_age()` actually
     * writes, so the ask simply returns on the next successful read.
     */
    async ageAffirmationPending(): Promise<boolean> {
      const { data, error } = await getSupabaseClient().rpc(
        "age_affirmation_pending",
      );
      if (error) {
        console.error("age_affirmation_pending.error", error);
        return false;
      }
      return data === true;
    },
    /**
     * Records the 18+ affirmation for this login. Fail-loud: the caller is
     * about to be let into the app on the strength of it, so a swallowed
     * failure would admit them having recorded nothing.
     */
    async affirmAge(): Promise<void> {
      const { error } = await getSupabaseClient().rpc("affirm_age");
      if (error) {
        console.error("affirm_age.error", error);
        throw new Error("Couldn't save your confirmation. Please try again.");
      }
    },
    async getMyPersonas(): Promise<MyPersona[]> {
      const { data, error } = await getSupabaseClient().rpc("my_personas");
      if (error) {
        console.error("my_personas.error", error);
        throw new Error("Failed to load your account");
      }
      return (data ?? []) as MyPersona[];
    },
    // Provisions one persona (2.2 AC-6, 2.3 AC-3). Always fail-loud: a
    // swallowed provisioning failure strands the caller with no context.
    async addPersona(persona: Persona): Promise<void> {
      const { error } = await getSupabaseClient().rpc("add_persona", {
        p_persona: persona,
      });
      if (error) {
        console.error("add_persona.error", error);
        throw new Error("Couldn't set that up. Try again.");
      }
    },
    // Retires one persona (2.5 AC-2). Unlike addPersona()'s generic message
    // above, this propagates the RPC's own error message rather than
    // swallowing it: remove_persona()'s two guards (AC-5) raise a specific,
    // human-readable reason ("cannot remove your only persona", "ask your
    // household admin", "cannot remove parent — ...") that Settings needs
    // verbatim to pick a translated, specific error — the opposite of
    // aiEntitlement()'s deliberate fail-soft UNENTITLED_AI below.
    async removePersona(persona: Persona): Promise<void> {
      const { error } = await getSupabaseClient().rpc("remove_persona", {
        p_persona: persona,
      });
      if (error) {
        console.error("remove_persona.error", error);
        throw new Error(error.message);
      }
    },
    // Removes another person from the household (Story 13.2). Admin-only.
    // Archives the target's membership and/or singles row — never deletes.
    // p_target_type: 'member' archives account_members, 'single' archives singles.
    async removePersonaAdmin(
      targetAccountMemberId: Identifier,
      targetType: "member" | "single",
    ): Promise<void> {
      const { error } = await getSupabaseClient().rpc("remove_persona_admin", {
        p_target_account_member_id: targetAccountMemberId,
        p_target_type: targetType,
      });
      if (error) {
        console.error("remove_persona_admin.error", error);
        throw new Error(error.message);
      }
    },
    // Restores an archived person to the household (Story 13.2). Admin-only.
    // Unlimited undo — restorable at any time by anyone who could have removed them.
    // p_target_type: 'member' restores account_members, 'single' restores singles.
    async restorePersonaAdmin(
      targetAccountMemberId: Identifier,
      targetType: "member" | "single",
    ): Promise<void> {
      const { error } = await getSupabaseClient().rpc("restore_persona_admin", {
        p_target_account_member_id: targetAccountMemberId,
        p_target_type: targetType,
      });
      if (error) {
        console.error("restore_persona_admin.error", error);
        throw new Error(error.message);
      }
    },

    // ---------------------------------------------------------------------
    // Billing / AI entitlement (E4). The ai_entitlement() RPC is the SINGLE
    // server-authoritative answer to "may this account spend inference?". The
    // client cannot forge it — the decision derives from the SELECT-only
    // `subscription` table, whose only writer is service_role. There is
    // deliberately NO client method here that grants entitlement; the Billing
    // page's Subscribe CTA is a stub (no real payment provider is wired yet).
    // ---------------------------------------------------------------------
    async aiEntitlement(): Promise<AiEntitlementInfo> {
      const { data, error } = await getSupabaseClient().rpc("ai_entitlement");
      if (error) {
        console.error("ai_entitlement.error", error);
        // Fail closed: on any error, treat the account as unentitled (free) so
        // a broken read can never accidentally unlock the paid surface.
        return UNENTITLED_AI;
      }
      return (data ?? UNENTITLED_AI) as AiEntitlementInfo;
    },

    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },

    // ---------------------------------------------------------------------
    // Invite-only signup (Story 2.7). get_invite_preview() is deliberately
    // anon-callable (02_functions.sql) — this is the ONE dataProvider method
    // an unauthenticated invitee ever calls, backing /accept-invite/:token
    // before any session exists. Returns null when the token matches no
    // invite at all, distinct from a found-but-unusable one (status carries
    // that — 'expired'/'accepted'/'revoked' — see get_invite_preview's own
    // comment for the computed-status rule).
    // ---------------------------------------------------------------------
    async getInvitePreview(token: string): Promise<InvitePreview | null> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_invite_preview",
        { p_token: token },
      );
      if (error) {
        console.error("get_invite_preview.error", error);
        throw new Error("Failed to look up this invite");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as InvitePreview | null;
    },
    // Review finding #4 (2.7): binds the invite to a real membership and
    // marks it `accepted` only once a genuine session exists —
    // InviteAcceptance.tsx calls this immediately after its own
    // verifyOtp() succeeds, never at the earlier OTP-request step
    // (requestOtp()/authProvider.login({requestOtp: true}) above already
    // creates the auth.users row; GoTrue does that the moment the code is
    // requested, before anyone has typed anything back — see
    // accept_invite()'s own comment in 02_functions.sql for why no
    // auth.users column can be used to tell "requested" from "verified"
    // apart here). Propagates accept_invite()'s own message: it is already
    // the specific, safe-to-show copy (mirrors get_invite_preview's
    // wording), not a generic one.
    async acceptInvite(token: string): Promise<void> {
      const { error } = await getSupabaseClient().rpc("accept_invite", {
        p_token: token,
      });
      if (error) {
        console.error("accept_invite.error", error);
        throw new Error(error.message);
      }
    },
    // ---------------------------------------------------------------------
    // Invites as the one membership mechanism (Story 2.8 AC-5). Thin RPC
    // wrappers over create_invite()/revoke_invite() (02_functions.sql), the
    // exact `getSupabaseClient().rpc(...)` shape addRedt/catchShidduch use
    // above. The SELECT-only RLS/grant posture on the invites table (2.7
    // AC-2) means these two RPCs are the only way `authenticated` ever
    // writes it — this file never calls dataProvider.create against it
    // directly (AC-8).
    //
    // Story 6.1 (AC-1/AC-2): `targetSingleId` is the third, optional
    // parameter `singles/SingleLoginInvite.tsx` passes for a `single`-role
    // invite — `p_target_single_id`, `create_invite()`'s own last
    // parameter (02_functions.sql). `InvitesSection.tsx`'s generic form
    // never passes it (its role selector no longer offers `single` at all,
    // roleAuthority.ts).
    //
    // Review fix (FINDING 3): the RPC payload omits `p_target_single_id`
    // entirely when it is null/undefined, rather than always sending it as
    // `null`. `create_invite()`'s 3-argument signature is a NEW overload —
    // the migration that adds it and drops the old 2-argument one is a
    // separate deploy step from this frontend change. If the frontend ships
    // first (or the two land in the same deploy but the migration hasn't
    // run yet), PostgREST's schema cache still only knows the 2-argument
    // function; a call naming a third parameter — even `null` — matches no
    // known signature and fails for EVERY invite, `single`-role or not.
    // Omitting the key keeps every pre-existing (helper/parent_admin/
    // shadchan) invite call working across that window; only a `single`-
    // role invite from the new Single-360 entry point ever needs the
    // post-migration signature at all.
    // ---------------------------------------------------------------------
    async createInvite(
      email: string,
      role: InvitableRole,
      targetSingleId?: Identifier | null,
    ): Promise<Invite> {
      const { data, error } = await getSupabaseClient().rpc("create_invite", {
        p_email: email,
        p_role: role,
        ...(targetSingleId != null
          ? { p_target_single_id: targetSingleId }
          : {}),
      });
      if (error) {
        console.error("create_invite.error", error);
        throw new Error(error.message || "Failed to send that invite");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as Invite;
    },
    async revokeInvite(id: Identifier): Promise<void> {
      const { error } = await getSupabaseClient().rpc("revoke_invite", {
        p_invite_id: id,
      });
      if (error) {
        console.error("revoke_invite.error", error);
        throw new Error(error.message || "Failed to revoke that invite");
      }
    },

    // ---------------------------------------------------------------------
    // Files tab (Story 3.7, contract §8 rule 5 / AC 4). Implementations live
    // in ./entityFiles.ts (this file is already ~730 lines —
    // .claude/rules/coding-style.md file-size guidance) and are mirrored in
    // providers/fakerest/internal/entityFiles.ts.
    // ---------------------------------------------------------------------
    async uploadEntityFile(
      params: UploadEntityFileParams,
    ): Promise<EntityFile> {
      return uploadEntityFileImpl(baseDataProvider, params);
    },
    async signEntityFileUrl(params: SignEntityFileUrlParams): Promise<string> {
      return signEntityFileUrlImpl(params);
    },
    async deleteEntityFile(params: DeleteEntityFileParams): Promise<void> {
      return deleteEntityFileImpl(baseDataProvider, params);
    },
    async copyInboxAttachmentsToEntityFiles(
      params: CopyInboxAttachmentsParams,
    ): Promise<EntityFile[]> {
      return copyInboxAttachmentsToEntityFilesImpl(params);
    },
    // Epic 11 (Needs review tab): the "TRUST SENDER" action — see
    // ./trustedSenders.ts's own doc comment for the atomicity/idempotency
    // reasoning (no schema change available in this pass, so this is two
    // client-side writes in the order that fails safe, not one RPC).
    async trustSender(params: TrustSenderParams): Promise<TrustSenderResult> {
      return trustSenderAndRelease(params);
    },
    // ---------------------------------------------------------------------
    // Resume tab (Story 5.3). Implementation lives in ./resumes.ts, mirroring
    // ./entityFiles.ts's own split — this file is already large
    // (.claude/rules/coding-style.md file-size guidance).
    // ---------------------------------------------------------------------
    async uploadResumeFile(params: UploadResumeFileParams): Promise<Resume> {
      return uploadResumeFileImpl(params);
    },
    async signResumeFileUrl(params: SignResumeFileUrlParams): Promise<string> {
      return signResumeFileUrlImpl(params);
    },

    // ---------------------------------------------------------------------
    // Photo tab (Story 5.4). Implementation lives in ./resumePhotos.ts,
    // mirroring ./resumes.ts's own split.
    // ---------------------------------------------------------------------
    async uploadResumePhoto(
      params: UploadResumePhotoParams,
    ): Promise<ResumePhoto> {
      return uploadResumePhotoImpl(params);
    },
    async signResumePhotoUrl(
      params: SignResumePhotoUrlParams,
    ): Promise<string> {
      return signResumePhotoUrlImpl(params);
    },
    async hideResumePhoto(params: HideResumePhotoParams): Promise<ResumePhoto> {
      return hideResumePhotoImpl(params);
    },
    // ---------------------------------------------------------------------
    // Analytics (Story 15.2) -- Custom methods for dashboard metrics.
    // ---------------------------------------------------------------------
    async getAnalyticsSummary(): Promise<AnalyticsEventsSummaryRow | null> {
      return getAnalyticsSummary();
    },
    async getCounterMetrics(): Promise<CounterMetrics> {
      return getCounterMetrics();
    },
    async setAnalyticsEnabled(enabled: boolean): Promise<void> {
      return setAnalyticsEnabled(enabled);
    },
    // Resolve the current account ID from the server-side context pointer.
    // This is the same logic used internally for uploads (Story 10.1).
    async getCurrentAccountId(): Promise<number> {
      return getCurrentAccountId();
    },
    // Generic RPC handler for calling Postgres functions.
    async rpc(fnName: string, args: Record<string, unknown>) {
      const { data, error } = await getSupabaseClient().rpc(fnName, args);
      if (error) {
        console.error(`rpc(${fnName}).error`, error);
        throw new Error(error.message || `RPC ${fnName} failed`);
      }
      return data;
    },
  } satisfies DataProvider;
};

export type CrmDataProvider = ReturnType<
  typeof getDataProviderWithCustomMethods
>;

// Story 3.7 (AC 7b): byte cleanup for the four `entity_files` parent
// resources. Built in ./entityFiles.ts (review fix, F5) so the
// ENTITY_TARGET_TYPES -> RESOURCE_FOR_TARGET mapping and the callback body
// are unit-testable independent of this whole custom-methods overlay —
// `entityFiles.test.ts` exercises this exact array, not a re-implementation.
// `purge_polymorphic_dependents()` (02_functions.sql) removes the
// `entity_files` CATALOG rows once the parent delete's trigger fires; it
// cannot reach the Storage API, so this runs BEFORE that — the rows are
// still present here — and removes the objects via
// `removeEntityFileObjects`. A parent deleted by any path that skips the
// SPA's dataProvider (service_role, psql, a future edge function) leaves the
// bytes orphaned; that residual limitation is named, not hidden (AC 7c).
const entityFilesCleanupCallbacks: ResourceCallbacks[] =
  buildEntityFilesCleanupCallbacks();

// Story 9.5 (AC-11, AC-12): the `resumes`/`resume_photos` byte-cleanup
// equivalent — see resumeStorageCleanup.ts's own doc comment. Exported the
// same way `entityFilesCleanupCallbacks` is (review-fix F2 precedent) so
// `resumeStorageCleanup.test.ts` exercises the exact array that ships.
export const resumeStorageCleanupCallbacks: ResourceCallbacks[] =
  buildResumeStorageCleanupCallbacks();

// Exported for `dataProvider.test.ts` (review fix, F2): the array's own
// wiring — which resource string each hook is keyed to, and which real
// columns each searches — had no test anywhere in the repo, so a re-keyed
// hook (the dead-hook trap) or a typo'd column name stayed green through
// typecheck/lint/every CI guard. Exporting the array itself, rather than
// re-deriving an equivalent one in the test, is what actually exercises
// what ships.
export const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "members",
    beforeSave: async (data: Member, _, __) => {
      if (data.avatar) {
        await uploadToBucket(data.avatar);
      }
      return data;
    },
  },
  {
    // The reference book's search. Searching the normalized columns as well as
    // the raw ones is what makes it bilingual-tolerant: "Chaim" typed with or
    // without punctuation, and either name script, reaches the same person.
    resource: "references_summary",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name_en",
        "name_he",
        "name_norm_en",
        "name_norm_he",
        "phone",
        "school",
        "relationship",
      ])(params);
    },
  },
  {
    // Story 4.1 (AC 4): the singles roster's search. Keyed to "singles" —
    // the resource name SingleList's <List> is actually given. `singles` has
    // no `_summary` redirect (see getDataProviderWithCustomMethods's getList
    // override above), so this hook can never fall into the dead-hook trap
    // (Dev Notes, "The dead-hook trap") the way a redirect-backed resource
    // could.
    resource: "singles",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "first_name_en",
        "last_name_en",
        "first_name_he",
        "last_name_he",
      ])(params);
    },
  },
  {
    // Story 4.1 (AC 4): the shadchan book's search. Same as `singles` above —
    // "shadchanim" has no redirect either.
    resource: "shadchanim",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["name", "name_he", "location"])(params);
    },
  },
  {
    // Review fix, story 8-5 (F1 — BLOCKING): the Connections list's search
    // box had no hook here, so `ra-supabase-core`'s `defaultListOp = 'eq'`
    // turned `{q:"Klein"}` into `?q=eq.Klein` — `connections` has no `q`
    // column, so every real search 400'd (`42703`) while the component test
    // stayed green only because it runs on `ra-data-fakerest`'s generic `q`
    // handling, which the shipped Supabase provider does not have. Keyed to
    // "connections" — the resource `ConnectionList.tsx`'s `<EntityList>` is
    // actually given, and there is no `connections_summary` redirect to fall
    // into the dead-hook trap. `household_account_name` is the one column
    // AC-1's placeholder ("Search by family name") promises; it is `not
    // null` on every row (01_tables.sql), so no result is ever excluded by a
    // null column the way an optional field could.
    resource: "connections",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["household_account_name"])(params);
    },
  },
  {
    // Story 4.3 (AC 3): the shidduchim pipeline's search. Keyed to
    // "shidduchim" — the resource `ShidduchimList.tsx`'s `<List>` is
    // actually given — never "shidduchim_summary", even though
    // `getDataProviderWithCustomMethods`'s `getList` override above
    // redirects reads to that view internally. This is the one live
    // redirect-backed resource in the epic that a search hook is keyed to,
    // so 4.1's dead-hook rule (Dev Notes, "The dead-hook trap": a hook keyed
    // to the redirect TARGET never sees the request, since
    // `withLifecycleCallbacks` matches on the resource name the caller
    // used, before any redirect runs) is load-bearing here, not academic.
    //
    // Story 5.2 AC-3: the old combined "parents" column pair is dropped from
    // `public.shidduchim` and `shidduchim_summary` in the same diff (father/
    // mother replace it as two separate pairs). This column list is updated
    // here, in lockstep, to `father_en, father_he, mother_en, mother_he` —
    // leaving the retired pair here after the columns drop would 400 every
    // shidduchim search.
    resource: "shidduchim",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name_en",
        "name_he",
        "shadchan_name",
        "shadchan_name_he",
        "father_en",
        "father_he",
        "mother_en",
        "mother_he",
        "location_en",
        "location_he",
      ])(params);
    },
  },
  ...entityFilesCleanupCallbacks,
  ...resumeStorageCleanupCallbacks,
];

export const getDataProvider = () => {
  if (import.meta.env.VITE_SUPABASE_URL === undefined) {
    throw new Error("Please set the VITE_SUPABASE_URL environment variable");
  }
  if (import.meta.env.VITE_SB_PUBLISHABLE_KEY === undefined) {
    throw new Error(
      "Please set the VITE_SB_PUBLISHABLE_KEY environment variable",
    );
  }
  return withLifecycleCallbacks(
    getDataProviderWithCustomMethods(),
    lifeCycleCallbacks,
  ) as CrmDataProvider;
};

// Exported for `dataProvider.test.ts` (review fix, F1/F2): the sanitization
// below is the actual fix under test, and re-implementing an equivalent
// function inside the test would prove nothing about what ships.
export const applyFullTextSearch =
  (columns: string[]) => (params: GetListParams) => {
    if (!params.filter?.q) {
      return params;
    }
    const { q, ...filter } = params.filter;
    // Review fix (F1): PostgREST's logical-operator syntax — the `or=(...)`
    // query param this hook builds, via `@raphiniert/ra-data-postgrest`'s
    // `parseFilters` — is a comma-separated list of conditions, and neither
    // that library nor this hook escapes a comma embedded inside a search
    // term. Typing e.g. "Cohen, Chaim" therefore lands an unescaped `,`
    // inside the list, PostgREST fails to parse the resulting logic tree
    // (`PGRST100`), and the request 400s before RLS even runs — this is
    // AC-4's own named failure mode ("PostgREST answers 400"), and it is
    // unconditional: every caller of this hook (SingleList's/ShadchanList's
    // search box, plus every ReferenceInput/AutocompleteInput type-ahead on
    // these two resources) hits it the moment a comma is typed. The search
    // box asks for a loose per-word substring match — each word is already
    // OR'd across every column below, so a phrase's word order and
    // punctuation were never significant to begin with — so replacing a
    // comma with a space changes nothing about what can be found, only
    // whether the request survives to ask.
    const sanitizedQ = q.replace(/,/g, " ").trim();
    if (!sanitizedQ) {
      return { ...params, filter };
    }
    return {
      ...params,
      filter: {
        ...filter,
        "@or": columns.reduce((acc, column) => {
          if (column === "email")
            return {
              ...acc,
              [`email_fts@ilike`]: sanitizedQ,
            };
          if (column === "phone")
            return {
              ...acc,
              [`phone_fts@ilike`]: sanitizedQ,
            };
          else
            return {
              ...acc,
              [`${column}@ilike`]: sanitizedQ,
            };
        }, {}),
      },
    };
  };

/** How long a generated attachment URL stays valid. The durable reference is the
 * object `path`; readers re-sign. AD-9's Worker proxy-stream is the eventual answer
 * (see epics.md "Unowned work" S1). */
const ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

/**
 * The caller's ACTIVE account id, used to namespace attachment object keys so the
 * `Attachments writable within account` storage policy (keyed on
 * `current_context_id()`) accepts the upload. Since Story 2.1 (AC-7), `accounts` is
 * RLS-scoped to every membership the caller holds — active or not — so a first-row
 * pick off that table is an arbitrary context, not necessarily the active one.
 * `current_context_id()` is the single source of truth for "which context", so this
 * calls that RPC directly rather than reading `accounts`.
 */
const getCurrentAccountId = async (): Promise<number> => {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");

  if (error || data == null) {
    throw new Error("Cannot resolve the account for this attachment upload");
  }
  return data as number;
};

// Story 10.1 (Task 4): exported so `ShareTarget.tsx` can upload a shared
// photo through the exact same path `members.avatar` already uses — one
// upload primitive across every entry point, not a second copy. Was a
// module-private `const` (used only internally, above) before this story.
//
// Story 10.6: optional `pathPrefix` lets share-target include the owning
// `inbox_items` id in the object key (`{accountId}/inbox/{inboxItemId}/...`)
// so the DB row is created before the bytes, and orphaned objects are
// recoverable by their owning row id.
export const uploadToBucket = async (fi: RAFile, pathPrefix?: string) => {
  if (!fi.src.startsWith("blob:") && !fi.src.startsWith("data:")) {
    // Sign URL check if path exists in the bucket
    if (fi.path) {
      const { error } = await getSupabaseClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .createSignedUrl(fi.path, 60);

      if (!error) {
        return fi;
      }
    }
  }

  const dataContent = fi.src
    ? await fetch(fi.src)
        .then((res) => {
          if (res.status !== 200) {
            return null;
          }
          return res.blob();
        })
        .catch(() => null)
    : fi.rawFile;

  if (dataContent == null) {
    // We weren't able to download the file from its src (e.g. user must be signed in on another website to access it)
    // or the file has no content (not probable)
    // In that case, just return it as is: when trying to download it, users should be redirected to the other website
    // and see they need to be signed in. It will then be their responsibility to upload the file back to the note.
    return fi;
  }

  const file = fi.rawFile;
  const fileParts = file.name.split(".");
  const fileExt = fileParts.length > 1 ? `.${file.name.split(".").pop()}` : "";
  // Account-prefixed, CSPRNG key. The attachments bucket is private and its RLS
  // policies scope on this first path segment, so an unprefixed key is rejected.
  const accountId = await getCurrentAccountId();
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const filePath = `${accountId}/${prefix}${crypto.randomUUID()}${fileExt}`;
  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(filePath, dataContent);

  if (uploadError) {
    console.error("uploadError", uploadError);
    throw new Error("Failed to upload attachment");
  }

  // Signed, expiring URL — never a public one (AD-9, PRV-5, PRV-8). `path` is the
  // durable reference; `src` expires and is re-signed on read.
  const { data, error: signError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrl(filePath, ATTACHMENT_URL_TTL_SECONDS);

  if (signError || !data) {
    console.error("signError", signError);
    throw new Error("Failed to sign attachment URL");
  }

  fi.path = filePath;
  fi.src = data.signedUrl;

  // save MIME type
  const mimeType = file.type;
  fi.type = mimeType;

  return fi;
};
