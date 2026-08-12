import {
  withLifecycleCallbacks,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import type {
  Account,
  AccountMember,
  AddEducationInput,
  AddRedtInput,
  AiEntitlementInfo,
  ChildGrant,
  ChildGrantAccessLevel,
  ChildGrantPreview,
  Connection,
  ConnectionInvitePreview,
  ContextMember,
  CreateReferenceForShidduchInput,
  CreateShidduchInput,
  CreateThreadInput,
  EntityFile,
  EntityTargetType,
  InboxItem,
  Invite,
  InvitableRole,
  InvitePreview,
  LinkReferenceInput,
  Listing,
  LogReferenceCallInput,
  MatchReferenceInput,
  MergeResolution,
  Member,
  MemberFormData,
  MyContext,
  MyPersona,
  Persona,
  PipelineState,
  RedtViaConnectionInput,
  Reference,
  ReferenceLink,
  ReferenceMatchCandidate,
  ReferenceMergePreview,
  Resume,
  ResumePhoto,
  ShareAccessLog,
  ShareLink,
  Shidduch,
  ShidduchCatch,
  ShidduchEducation,
  Thread,
  ThreadParticipant,
  ThreadVisibility,
} from "../../types";
import { ENTITY_TARGET_TYPES } from "../../types";
import {
  deleteEntityFile as deleteEntityFileImpl,
  signEntityFileUrl as signEntityFileUrlImpl,
  uploadEntityFile as uploadEntityFileImpl,
} from "./internal/entityFiles";
import { copyInboxAttachmentsToEntityFiles as copyInboxAttachmentsToEntityFilesImpl } from "./internal/inboxAttachments";
import type { CopyInboxAttachmentsParams } from "./internal/inboxAttachments";
import type {
  EntityFileBlobUrls,
  UploadEntityFileParams,
} from "./internal/entityFiles";
import {
  signResumeFileUrl as signResumeFileUrlImpl,
  uploadResumeFile as uploadResumeFileImpl,
} from "./internal/resumes";
import type {
  ResumeFileBlobUrls,
  UploadResumeFileParams,
} from "./internal/resumes";
import {
  hideResumePhoto as hideResumePhotoImpl,
  signResumePhotoUrl as signResumePhotoUrlImpl,
  uploadResumePhoto as uploadResumePhotoImpl,
} from "./internal/resumePhotos";
import type {
  ResumePhotoBlobUrls,
  UploadResumePhotoParams,
} from "./internal/resumePhotos";
import {
  INITIAL_PIPELINE_STATES,
  isValidTransition,
  PIPELINE_TRANSITIONS,
} from "../../shidduchim/pipelineStates";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { UNENTITLED_AI } from "../commons/aiEntitlement";
import type { CrmDataProvider } from "../types";
import {
  authProvider as defaultAuthProvider,
  USER_STORAGE_KEY,
} from "./authProvider";
import generateData from "./dataGenerator";
import { SEEDED_FILE_BLOBS } from "./dataGenerator/fileAssets";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";
import { resolveContextMembership } from "./internal/accountMemberships";
import {
  createReferenceForShidduch,
  linkReferenceToShidduch,
  logReferenceCall,
  computeDiligenceProgress,
} from "./internal/referenceLinks";
import { matchReferenceOnEntry } from "./internal/referenceMatch";
import { addPersona, getMyPersonas } from "./internal/personas";
import { removePersona } from "./internal/removePersona";
import {
  removePersonaAdmin,
  restorePersonaAdmin,
} from "./internal/removePersonaAdmin";
import { getMyContexts, switchActiveContext } from "./internal/contexts";
import { createInvite, revokeInvite } from "./internal/invites";
import {
  createConnectionInvite,
  revokeConnectionInvite,
  previewConnectionInvite,
  acceptConnectionInvite,
  endConnection,
} from "./internal/connections";
import {
  createChildGrant as createChildGrantImpl,
  revokeChildGrant as revokeChildGrantImpl,
  previewChildGrant as previewChildGrantImpl,
  acceptChildGrant as acceptChildGrantImpl,
  severChildGrant as severChildGrantImpl,
  regrantChildGrant as regrantChildGrantImpl,
  updateChildGrantAccess as updateChildGrantAccessImpl,
} from "./internal/grants";
import {
  createMessage,
  createThread,
  createThreadParticipant,
  markThreadRead as markThreadReadImpl,
  setThreadVisibility as setThreadVisibilityImpl,
} from "./internal/threads";
import { redtViaConnection as redtViaConnectionImpl } from "./internal/redting";
import { trustSenderAndRelease } from "./internal/trustedSenders";
import type {
  TrustSenderParams,
  TrustSenderResult,
} from "./internal/trustedSenders";
import {
  assertListingInsertNotLocked,
  consentToRepublishListing as consentToRepublishListingImpl,
  lockListingOnSingleWithdrawal,
} from "./internal/listingWithdrawal";
import { stampShareLinkDefaults } from "./internal/shareLinks";
import {
  catchShidduch,
  computeShidduchCatchCount,
} from "./internal/shidduchCatch";
import {
  mergeReferences,
  previewReferenceMerge,
} from "./internal/referenceMerge";
import {
  enrichReferenceLinks,
  enrichReferences,
} from "./internal/referenceSummary";
import {
  getAnalyticsSummary as getAnalyticsSummaryImpl,
  getCounterMetrics as getCounterMetricsImpl,
  setAnalyticsEnabled as setAnalyticsEnabledImpl,
} from "./internal/analytics";
import type {
  AnalyticsEventsSummaryRow,
  CounterMetrics,
} from "../../analytics/types";

export interface CreateFakeRestDataProviderOptions {
  db?: Db;
  latency?: number;
  authProvider?: Pick<typeof defaultAuthProvider, "getIdentity">;
  silent?: boolean;
}

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    return (await convertFileToBase64(logo)) as string;
  }
  return logo?.src ?? "";
};

/**
 * FakeRest mirror of the database's structural guarantees on `interactions`
 * (AD-3). Postgres enforces these with CHECK constraints and a revoked DELETE
 * grant; without the same rules here, demo mode would happily accept rows the
 * real backend rejects, and the demo would teach the wrong thing.
 *
 *   scope 'shidduch' + target 'reference'          -> must carry a reference_link_id
 *   scope 'shidduch' + target 'shidduch'           -> the target IS the parent, no link
 *   scope 'account'  + target 'reference'          -> no shidduch context, no link
 *   scope 'account'  + target 'shadchan'/'single'  -> always account-scoped (Story 3.5,
 *                                                      contract §8): neither entity has one
 *                                                      shidduch parent to derive visibility
 *                                                      from, so there is no fourth state.
 */
const assertValidInteraction = (data: {
  target_type?: string;
  scope?: string;
  reference_link_id?: unknown;
}) => {
  const targetType = data.target_type ?? "reference";
  const scope = data.scope ?? "account";
  const hasLink = data.reference_link_id != null;

  if (scope !== "shidduch" && scope !== "account") {
    throw new Error(`invalid interaction scope: ${scope}`);
  }
  if (!ENTITY_TARGET_TYPES.includes(targetType as EntityTargetType)) {
    throw new Error(`invalid interaction target_type: ${targetType}`);
  }

  const valid =
    (scope === "shidduch" && targetType === "reference" && hasLink) ||
    (scope === "shidduch" && targetType === "shidduch" && !hasLink) ||
    (scope === "account" && targetType === "reference" && !hasLink) ||
    (scope === "account" &&
      (targetType === "shadchan" || targetType === "single") &&
      !hasLink);

  if (!valid) {
    throw new Error(
      "an interaction must declare which parent its visibility derives from: " +
        `scope=${scope}, target_type=${targetType}, ` +
        `reference_link_id=${hasLink ? "set" : "null"}`,
    );
  }
};

export const createDataProvider = ({
  db = generateData(),
  latency = 300,
  authProvider,
  silent = false,
}: CreateFakeRestDataProviderOptions = {}): CrmDataProvider => {
  const baseDataProvider = fakeRestDataProvider(db, !silent, latency);
  // Demo / onboarding (Stage B): mirrors accounts.demo for the FakeRest
  // session. Starts false; flipped by seedDemo/clearDemo below.
  let fakeDemo = false;
  // Context switcher (2.4 AC-6): mirrors member_state.active_account_id for
  // the FakeRest session. Story 2.1 added no fakerest member_state
  // emulation ("it changes no src/ file"), so this story is the first
  // consumer and adds the minimal fake state itself — no fake table, just
  // this closure-local variable, written only by switchActiveContext below.
  let activeAccountId: Identifier | null = null;
  const getIdentity = async () =>
    authProvider?.getIdentity?.() ?? defaultAuthProvider.getIdentity?.();

  // Files tab (Story 3.7): the AD-10 mirror's in-memory "bytes" — see
  // ./internal/entityFiles.ts. One map per createDataProvider() session, so
  // a fresh demo/test session never sees a previous one's blob URLs.
  const entityFileBlobUrls: EntityFileBlobUrls = new Map();

  // Resume tab (Story 5.3): the same in-memory "bytes" idea, kept in its own
  // map (a different bucket, `documents`, in the real backend) — see
  // ./internal/resumes.ts.
  const resumeFileBlobUrls: ResumeFileBlobUrls = new Map();

  // Photo tab (Story 5.4): the same in-memory "bytes" idea again, its own
  // map (a different `photos/` prefix of the same `documents` bucket in the
  // real backend) — see ./internal/resumePhotos.ts.
  const resumePhotoBlobUrls: ResumePhotoBlobUrls = new Map();

  // Richer demo data (seed_demo plan): if the generated Db included seeded
  // files, pre-populate the in-memory blob maps so those files can be signed
  // and downloaded in the demo without a separate upload round-trip.
  const seededBlobs = (db as any)[SEEDED_FILE_BLOBS];
  if (seededBlobs) {
    seededBlobs.resumeFiles?.forEach((url: string, path: string) =>
      resumeFileBlobUrls.set(path, url),
    );
    seededBlobs.resumePhotos?.forEach((url: string, path: string) =>
      resumePhotoBlobUrls.set(path, url),
    );
    seededBlobs.entityFiles?.forEach((url: string, path: string) =>
      entityFileBlobUrls.set(path, url),
    );
  }

  // Emulate the shidduchim_summary view (AD-10 FakeRest mirror): enrich each
  // shidduch with its shadchan name ("via {shadchan}"), single names, and
  // reference count, joining the in-memory tables.
  const enrichShidduchim = async (rows: any[]) => {
    if (rows.length === 0) return rows;
    const [
      { data: shadchanim },
      { data: singles },
      { data: allShidduchim },
      refLinksResult,
      redtsResult,
    ] = await Promise.all([
      baseDataProvider.getList("shadchanim", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
      baseDataProvider.getList("singles", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
      // The whole account's shidduchim, so catch_count can compare each row
      // against every other suggestion (mirrors shidduchim_catch_summary).
      baseDataProvider.getList("shidduchim", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
      baseDataProvider
        .getList("reference_links", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        })
        .catch(() => ({ data: [] as any[] })),
      baseDataProvider
        .getList("redts", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        })
        .catch(() => ({ data: [] as any[] })),
    ]);
    const shadchanById = new Map(shadchanim.map((s: any) => [s.id, s]));
    const singleById = new Map(singles.map((c: any) => [c.id, c]));
    const refLinks = refLinksResult.data;
    const redts = redtsResult.data;
    return rows.map((row: any) => {
      const sh = shadchanById.get(row.shadchan_id);
      const c = singleById.get(row.single_id);
      return {
        ...row,
        shadchan_name: sh?.name ?? null,
        shadchan_name_he: sh?.name_he ?? null,
        single_first_name_en: c?.first_name_en ?? null,
        single_first_name_he: c?.first_name_he ?? null,
        single_last_name_en: c?.last_name_en ?? null,
        single_last_name_he: c?.last_name_he ?? null,
        nb_references: refLinks.filter((rl: any) => rl.shidduchim_id === row.id)
          .length,
        nb_redts: redts.filter((r: any) => r.shidduchim_id === row.id).length,
        catch_count: computeShidduchCatchCount(row, allShidduchim as any[]),
      };
    });
  };

  // Story 3.6 — the FakeRest resolver behind both the actor_member_id
  // create-path stamp below and enrichInteractions()'s can_moderate: "the
  // demo caller's own identity plus their active membership in the
  // currently active account", the emulation counterpart of
  // `current_member_id()`.
  const resolveCallerMembership = async (): Promise<{
    userId: string;
    membership: AccountMember | null;
  } | null> => {
    const identity = await getIdentity();
    if (identity == null) return null;
    const userId = String(identity.id);
    const membership = await resolveContextMembership(
      baseDataProvider,
      userId,
      activeAccountId,
    );
    return { userId, membership };
  };

  // Files tab (Story 3.7): the FakeRest mirror of `current_context_id()` —
  // "the caller's currently active account", falling back to 1 only when no
  // identity/membership resolves at all (mirrors createShidduchImpl's own
  // `single?.account_id ?? 1` fallback below).
  const resolveCurrentAccountId = async (): Promise<Identifier> => {
    const caller = await resolveCallerMembership();
    return caller?.membership?.account_id ?? activeAccountId ?? 1;
  };

  // Story 12.3 (AD-10 FakeRest mirror): emulates `public.context_members` —
  // the ACTIVE `account_members` of the caller's ACTIVE context, joined to
  // `members` on `user_id` (never `account_members.id`, which is re-minted
  // on an archive/re-add round-trip — the same reasoning the real view's
  // own comment carries). `id` on the returned rows is `members.id`, the
  // same identity key `tasks.member_id` holds.
  const resolveContextMembers = async (): Promise<ContextMember[]> => {
    const [{ data: accountMembers }, { data: members }, accountId, caller] =
      await Promise.all([
        baseDataProvider.getList<AccountMember>("account_members", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        }),
        baseDataProvider.getList<Member>("members", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        }),
        resolveCurrentAccountId(),
        resolveCallerMembership(),
      ]);
    const memberByUserId = new Map(members.map((m) => [m.user_id, m]));

    return accountMembers
      .filter(
        (am) =>
          am.status === "active" && String(am.account_id) === String(accountId),
      )
      .map((am): ContextMember | null => {
        const profile = am.user_id ? memberByUserId.get(am.user_id) : undefined;
        // No matching members row — cannot happen for seeded/created data
        // (every account_members write has a member with the same
        // user_id), but skipped defensively rather than surfacing a row
        // with no resolvable id (ContextMember.id must be members.id).
        if (!profile) return null;
        const fullName = `${profile.first_name} ${profile.last_name}`.trim();
        return {
          id: profile.id,
          account_id: am.account_id,
          user_id: am.user_id ?? "",
          role: am.role,
          full_name: fullName || null,
          is_self: caller?.userId != null && am.user_id === caller.userId,
        };
      })
      .filter((row): row is ContextMember => row != null)
      .sort((a, b) => Number(a.id) - Number(b.id));
  };

  // Mirrors `public.is_owning_membership_role()` (02_functions.sql). Kept as
  // a local one-line predicate rather than imported from
  // `providers/commons/roleAuthority.ts`, which this story does not own.
  const isOwningMembershipRole = (role: string): boolean =>
    role === "parent_admin" || role === "self_manager";

  // Emulate the interactions_summary view (Story 3.6, AD-10 FakeRest
  // mirror): resolve each row's author_name and can_moderate the same way
  // the Postgres view and the UPDATE policy's moderation clause do, so a
  // note's author byline and edit/delete controls render correctly in demo
  // mode too. can_moderate mirrors `kind not in ('note', 'single_input') or
  // (kind = 'note' and can_moderate_note(...))` — never can_moderate_note()
  // alone (review fix, 3-6), and never on the `single_input` branch at all
  // (Story 6.4 review fix: this mirror still had the pre-6.4 shape, `kind <>
  // 'note' or can_moderate_note(...)`, so `row.kind !== "note"` alone made
  // canModerate true for every `single_input` row regardless of caller —
  // the demo UI offered an edit/delete control that this same file's own
  // `update()` guard unconditionally refuses, throwing instead of the
  // control simply not rendering. The real `interactions_summary` view had
  // the identical drift, fixed the same way in 03_views.sql) — see the
  // `canModerate` computation below.
  //
  // On the note-kind branch, can_moderate for a null actor_member_id follows
  // the SQL exactly: false on the author branch (there is no membership row
  // to match), true only if the demo caller holds an owning role in their
  // active context. Every legacy, authorless demo row
  // (dataGenerator/references.ts) is therefore moderatable by owners only,
  // never by its nominal "author" — there is none to compare against. This
  // is a demo-only mirror of a real production gap acknowledged in Story
  // 3.6's "Review Fix Notes" (S5): the same NULL-author shape exists for
  // real notes written before 3.5's actor_member_id-stamping trigger
  // landed, and — unlike this demo generator's non-note rows — a real such
  // note IS kind = 'note', so it is frozen to owning-role members only
  // until someone with an owning role touches it.
  const enrichInteractions = async (rows: any[]): Promise<any[]> => {
    if (rows.length === 0) return [];
    const [{ data: accountMembers }, { data: members }, caller] =
      await Promise.all([
        baseDataProvider.getList<AccountMember>("account_members", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        }),
        baseDataProvider.getList<Member>("members", {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        }),
        resolveCallerMembership(),
      ]);
    const membershipById = new Map(accountMembers.map((am) => [am.id, am]));
    const memberByUserId = new Map(members.map((m) => [m.user_id, m]));
    const callerOwnsCurrentContext =
      caller?.membership != null &&
      isOwningMembershipRole(caller.membership.role);

    return rows.map((row: any) => {
      const authorMembership =
        row.actor_member_id != null
          ? membershipById.get(row.actor_member_id)
          : undefined;

      // Mirrors `members`' own RLS: an author's name resolves only while
      // they hold an ACTIVE membership of THIS row's account — an author
      // who has since left the account yields `author_name: null`, never a
      // stale name.
      const authorIsActiveHere =
        authorMembership != null &&
        accountMembers.some(
          (am) =>
            am.status === "active" &&
            am.user_id === authorMembership.user_id &&
            String(am.account_id) === String(row.account_id),
        );
      const authorUserId = authorMembership?.user_id;
      const authorProfile =
        authorIsActiveHere && authorUserId != null
          ? memberByUserId.get(authorUserId)
          : undefined;
      const authorName = authorProfile
        ? `${authorProfile.first_name} ${authorProfile.last_name}`.trim()
        : "";

      // Mirrors can_moderate_note(): the caller wrote it (matched on
      // user_id, NEVER on actor_member_id — an archived-and-re-added author
      // keeps a different membership id for the same person), or the
      // caller holds an owning role in their currently active context.
      const isAuthor =
        authorMembership != null &&
        caller != null &&
        authorMembership.user_id === caller.userId;

      // Mirrors the UPDATE policy's moderation clause (05_policies.sql):
      // `kind not in ('note', 'single_input') or (kind = 'note' and
      // can_moderate_note(...))`. A row this enricher ever sees has already
      // passed the same account-scope visibility every other RLS-emulating
      // enricher here relies on, so for a kind that is neither `note` nor
      // `single_input` (call_logged, status_change, merge, link_created,
      // link_removed) the real policy lets ANY account member update it —
      // can_moderate must be `true` outright on that branch, not gated
      // behind isAuthor/callerOwnsCurrentContext. `single_input` reaches
      // neither branch (Story 6.4 AC 3: append-only for every role,
      // including its own author and a parent_admin) — can_moderate is
      // `false` there unconditionally, the one case this predicate is NOT
      // `row.kind !== "note"`.
      const canModerate =
        (row.kind !== "note" && row.kind !== "single_input") ||
        (row.kind === "note" && (isAuthor || callerOwnsCurrentContext));

      return {
        ...row,
        author_name: authorName || null,
        can_moderate: canModerate,
      };
    });
  };

  // Emulate the entity_files_summary view (Story 3.7, AD-10 FakeRest
  // mirror): resolve each row's uploaded_by_name the same user_id-keyed way
  // enrichInteractions resolves author_name above.
  const enrichEntityFiles = async (rows: any[]): Promise<any[]> => {
    if (rows.length === 0) return [];
    const [{ data: accountMembers }, { data: members }] = await Promise.all([
      baseDataProvider.getList<AccountMember>("account_members", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
      baseDataProvider.getList<Member>("members", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
    ]);
    const membershipById = new Map(accountMembers.map((am) => [am.id, am]));
    const memberByUserId = new Map(members.map((m) => [m.user_id, m]));

    return rows.map((row: any) => {
      const uploaderMembership =
        row.uploaded_by_member_id != null
          ? membershipById.get(row.uploaded_by_member_id)
          : undefined;
      const uploaderProfile =
        uploaderMembership?.user_id != null
          ? memberByUserId.get(uploaderMembership.user_id)
          : undefined;
      const uploadedByName = uploaderProfile
        ? `${uploaderProfile.first_name} ${uploaderProfile.last_name}`.trim()
        : "";

      return {
        ...row,
        uploaded_by_name: uploadedByName || null,
      };
    });
  };

  // Emulate the singles_summary view (E6 FakeRest mirror): add each single's
  // total suggestion count and "open" (still-in-triage) count by grouping the
  // in-memory shidduchim. Mirrors the SQL: open = new/look_into/not_sure.
  // Applied on the base "singles" resource because withSupabaseFilterAdapter
  // strips the "_summary" suffix before it reaches here (same reason the
  // shidduchim/references enrichers key off their base resource name).
  const OPEN_PIPELINE_STATES = new Set<PipelineState>([
    "new",
    "look_into",
    "not_sure",
  ]);
  const enrichSinglesSummary = async (rows: any[]) => {
    if (rows.length === 0) return rows;
    const { data: shidduchim } = await baseDataProvider.getList("shidduchim", {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    });
    return rows.map((single: any) => {
      const forSingle = shidduchim.filter(
        (s: any) => s.single_id === single.id,
      );
      return {
        ...single,
        total_shidduchim: forSingle.length,
        open_shidduchim: forSingle.filter((s: any) =>
          OPEN_PIPELINE_STATES.has(s.pipeline_state),
        ).length,
      };
    });
  };

  // Emulate the shadchan_stats view (E5 FakeRest mirror): per shadchan, count
  // suggestions attributed to it (shidduchim.shadchan_id), those that moved
  // past 'new', and those that reached 'yes'. Keyed on the shadchan's id so
  // getOne("shadchan_stats", { id }) resolves like the Postgres view.
  //
  // last_redt_date/nb_open_singles (Story 5.9, RULING 8) mirror the widened
  // view exactly: the latest redt_date among this shadchan's shidduchim
  // (null when there are none — no coalesce to a fabricated date), and the
  // count of DISTINCT singles among those shidduchim still in an open
  // pipeline state (reusing OPEN_PIPELINE_STATES, the same set
  // enrichSinglesSummary above uses, never a second "open" definition).
  const computeShadchanStats = async (shadchanim: any[]) => {
    if (shadchanim.length === 0) return shadchanim;
    const { data: shidduchim } = await baseDataProvider.getList("shidduchim", {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    });
    return shadchanim.map((sh: any) => {
      const forShadchan = shidduchim.filter(
        (s: any) => s.shadchan_id === sh.id,
      );
      const openSingleIds = new Set(
        forShadchan
          .filter((s: any) => OPEN_PIPELINE_STATES.has(s.pipeline_state))
          .map((s: any) => s.single_id),
      );
      const lastRedtDate = forShadchan.reduce<string | null>(
        (latest: string | null, s: any) =>
          !latest || (s.redt_date && s.redt_date > latest)
            ? (s.redt_date ?? latest)
            : latest,
        null,
      );
      return {
        id: sh.id,
        account_id: sh.account_id,
        nb_suggestions: forShadchan.length,
        nb_progressed: forShadchan.filter(
          (s: any) => s.pipeline_state !== "new",
        ).length,
        nb_reached_yes: forShadchan.filter(
          (s: any) => s.pipeline_state === "yes",
        ).length,
        last_redt_date: lastRedtDate,
        nb_open_singles: openSingleIds.size,
      };
    });
  };

  // FakeRest mirror of refresh_shidduch_redt_summary(): recompute a shidduch's
  // redt_date (= latest), shadchan_id (= latest redt's shadchan), and
  // first_suggested_by/at (= earliest) from its redt history.
  const recomputeShidduchRedtSummary = async (shidduchId: Identifier) => {
    const { data: redts } = await baseDataProvider.getList("redts", {
      filter: { shidduchim_id: shidduchId },
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    });
    if (redts.length === 0) return;
    const byDate = [...redts].sort(
      (a: any, b: any) =>
        a.redt_date.localeCompare(b.redt_date) || Number(a.id) - Number(b.id),
    );
    const first = byDate[0];
    const last = byDate[byDate.length - 1];
    const { data: shidduch } = await baseDataProvider.getOne("shidduchim", {
      id: shidduchId,
    });
    await baseDataProvider.update("shidduchim", {
      id: shidduchId,
      data: {
        redt_date: last.redt_date,
        shadchan_id: last.shadchan_id ?? null,
        first_suggested_by: first.shadchan_id ?? null,
        first_suggested_at: `${first.redt_date}T00:00:00.000Z`,
      },
      previousData: shidduch,
    });
  };

  // The SOLE INSERT path into shidduchim (AD-4 invariant 1) — FakeRest mirror of
  // the create_shidduch RPC. Validates the initial state and resolves the
  // account from the single so account_id is always populated. Used by both
  // the createShidduch method and the create() override below.
  const createShidduchImpl = async (
    input: CreateShidduchInput,
  ): Promise<Shidduch> => {
    const initialState: PipelineState = input.initial_state ?? "new";
    if (!INITIAL_PIPELINE_STATES.includes(initialState)) {
      throw new Error(
        `invalid initial pipeline_state: ${initialState} (decision states are reachable only from look_into)`,
      );
    }
    const { data: single } = await baseDataProvider.getOne("singles", {
      id: input.single_id,
    });
    const now = new Date().toISOString();
    const { data } = await baseDataProvider.create("shidduchim", {
      data: {
        account_id: single?.account_id ?? 1,
        single_id: input.single_id,
        shadchan_id: input.shadchan_id ?? null,
        name_en: input.name_en ?? null,
        name_he: input.name_he ?? null,
        father_en: input.father_en ?? null,
        father_he: input.father_he ?? null,
        mother_en: input.mother_en ?? null,
        mother_he: input.mother_he ?? null,
        dob: input.dob ?? null,
        background: input.background ?? null,
        marital_status: input.marital_status ?? null,
        existing_children_note: input.existing_children_note ?? null,
        seminary_en: input.seminary_en ?? null,
        seminary_he: input.seminary_he ?? null,
        shul_en: input.shul_en ?? null,
        shul_he: input.shul_he ?? null,
        location_en: input.location_en ?? null,
        location_he: input.location_he ?? null,
        age: input.age ?? null,
        height: input.height ?? null,
        pipeline_state: initialState,
        first_suggested_by: input.shadchan_id ?? null,
        first_suggested_at: now,
        redt_date: input.redt_date ?? now.split("T")[0],
        close_reason: null,
        origin: input.origin ?? "manual",
        owner_member_id: null,
        visibility: input.visibility ?? "shared",
        index: 0,
        created_at: now,
      },
    });
    // Record the first redt event so the redt history starts at creation.
    await baseDataProvider.create("redts", {
      data: {
        account_id: single?.account_id ?? 1,
        shidduchim_id: (data as Shidduch).id,
        shadchan_id: input.shadchan_id ?? null,
        redt_date: input.redt_date ?? now.split("T")[0],
        note: null,
        created_at: now,
      },
    });
    // Record the headline seminary/yeshiva as the first school (kind by gender).
    if (input.seminary_en || input.seminary_he) {
      await baseDataProvider.create("shidduch_education", {
        data: {
          account_id: single?.account_id ?? 1,
          shidduchim_id: (data as Shidduch).id,
          kind: single?.gender === "male" ? "seminary" : "yeshiva",
          name_en: input.seminary_en ?? null,
          name_he: input.seminary_he ?? null,
          start_year: null,
          end_year: null,
          created_at: now,
        },
      });
    }
    return data as Shidduch;
  };

  const dataProviderWithCustomMethod: CrmDataProvider = {
    ...baseDataProvider,
    async getList(resource: string, params: any) {
      if (resource === "shidduchim" || resource === "shidduchim_summary") {
        const { data, total } = await baseDataProvider.getList(
          "shidduchim",
          params,
        );
        return { data: await enrichShidduchim(data), total };
      }
      // Emulate the references_summary / reference_links_summary views
      // (AD-10 FakeRest mirror) the same way shidduchim_summary is emulated
      // above: fetch the raw rows, then join in the computed fields.
      if (resource === "references" || resource === "references_summary") {
        const { data, total } = await baseDataProvider.getList(
          "references",
          params,
        );
        return { data: await enrichReferences(baseDataProvider, data), total };
      }
      if (
        resource === "reference_links" ||
        resource === "reference_links_summary"
      ) {
        const { data, total } = await baseDataProvider.getList(
          "reference_links",
          params,
        );
        return {
          data: await enrichReferenceLinks(baseDataProvider, data),
          total,
        };
      }
      // Per-single pipeline counts (E6) — the singles roster reads the
      // singles_summary view, which the adapter has already collapsed to
      // "singles" here (see enrichSinglesSummary).
      if (resource === "singles") {
        const { data, total } = await baseDataProvider.getList(
          "singles",
          params,
        );
        return { data: await enrichSinglesSummary(data), total };
      }
      // Per-shadchan productivity counts (E5). "shadchan_stats" does not end in
      // "_summary", so the adapter leaves it intact and it arrives here as-is.
      if (resource === "shadchan_stats") {
        const { data, total } = await baseDataProvider.getList(
          "shadchanim",
          params,
        );
        return { data: await computeShadchanStats(data), total };
      }
      // Emulate the interactions_summary view (Story 3.6 AD-10 FakeRest
      // mirror) the same way references_summary is emulated above.
      if (resource === "interactions" || resource === "interactions_summary") {
        const { data, total } = await baseDataProvider.getList(
          "interactions",
          params,
        );
        return { data: await enrichInteractions(data), total };
      }
      // Emulate entity_files_summary (Story 3.7 AD-10 FakeRest mirror) the
      // same way interactions_summary is emulated above.
      if (resource === "entity_files" || resource === "entity_files_summary") {
        const { data, total } = await baseDataProvider.getList(
          "entity_files",
          params,
        );
        return { data: await enrichEntityFiles(data), total };
      }
      // Story 12.3 (Task 2): "context_members" does NOT end in "_summary" —
      // the adapter's suffix strip would otherwise collapse
      // "context_members_summary" onto the raw "account_members" table
      // (the same reasoning "shadchan_stats" above documents). It is
      // computed, not stored, so there is no `db.context_members` table.
      if (resource === "context_members") {
        const rows = await resolveContextMembers();
        return { data: rows, total: rows.length };
      }
      // Emulate the analytics_events_summary view (Story 15.2, AD-10 FakeRest mirror)
      if (
        resource === "analytics_events" ||
        resource === "analytics_events_summary"
      ) {
        const summary = await getAnalyticsSummaryImpl(
          baseDataProvider,
          activeAccountId as number,
        );
        return { data: [summary], total: 1 };
      }
      return baseDataProvider.getList(resource, params);
    },
    async getMany(resource: string, params: any) {
      // Story 12.3 (Task 6): `useGetList`'s own cache warm-up can issue a
      // `getMany` for a resource it already holds a `getList` result for —
      // "context_members" has no `db` table for the default `getMany` to
      // read, so it needs the same emulation as getList above.
      if (resource === "context_members") {
        const rows = await resolveContextMembers();
        const wantedIds = new Set(
          (params.ids ?? []).map((id: Identifier) => String(id)),
        );
        return {
          data: rows.filter((row) => wantedIds.has(String(row.id))),
        } as any;
      }
      return baseDataProvider.getMany(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "shidduchim" || resource === "shidduchim_summary") {
        const { data } = await baseDataProvider.getOne("shidduchim", params);
        const [enriched] = await enrichShidduchim([data]);
        return { data: enriched };
      }
      if (resource === "references" || resource === "references_summary") {
        const { data } = await baseDataProvider.getOne("references", params);
        const [enriched] = await enrichReferences(baseDataProvider, [data]);
        return { data: enriched };
      }
      if (
        resource === "reference_links" ||
        resource === "reference_links_summary"
      ) {
        const { data } = await baseDataProvider.getOne(
          "reference_links",
          params,
        );
        const [enriched] = await enrichReferenceLinks(baseDataProvider, [data]);
        return { data: enriched };
      }
      if (resource === "shadchan_stats") {
        const { data } = await baseDataProvider.getOne("shadchanim", params);
        const [stats] = await computeShadchanStats([data]);
        return { data: stats };
      }
      if (resource === "interactions" || resource === "interactions_summary") {
        const { data } = await baseDataProvider.getOne("interactions", params);
        const [enriched] = await enrichInteractions([data]);
        return { data: enriched };
      }
      if (resource === "entity_files" || resource === "entity_files_summary") {
        const { data } = await baseDataProvider.getOne("entity_files", params);
        const [enriched] = await enrichEntityFiles([data]);
        return { data: enriched };
      }
      return baseDataProvider.getOne(resource, params);
    },
    // Generic RPC handler for FakeRest — mirrors the Supabase provider's
    // ability to call Postgres functions via rpc(). Currently only handles
    // shidduch_diligence_progress (FR68/Story 16.2).
    async rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName === "shidduch_diligence_progress") {
        const shidduchimId = args.p_shidduchim_id as number;
        return computeDiligenceProgress(baseDataProvider, shidduchimId);
      }
      throw new Error(`FakeRest RPC not implemented: ${fnName}`);
    },
    async create(resource: string, params: any) {
      if (resource === "interactions") {
        assertValidInteraction(params.data ?? {});
        // Server-set, unconditionally overwritten — mirrors
        // set_interaction_actor_member_id() (Story 3.5): a client can never
        // attribute a row to another member, including by omission.
        const caller = await resolveCallerMembership();
        // Story 6.4 (AC 1/AC 7): mirrors "Single adds input on a visible
        // suggestion" (05_policies.sql) — only a single-role session may
        // create a `single_input` row. The policy's own visibility join
        // (own single, shared, single-visible pipeline state) is real RLS
        // enforced only at the database; this FakeRest mirror stops at the
        // role check, the narrow parity Task 4 asks for.
        if (
          params.data?.kind === "single_input" &&
          caller?.membership?.role !== "single"
        ) {
          throw new Error(
            "only a single may add their own input on a suggestion",
          );
        }
        return baseDataProvider.create(resource, {
          ...params,
          data: {
            ...params.data,
            actor_member_id: caller?.membership?.id ?? null,
          },
        });
      }
      // Story 7.1 (AC-4, AC-8): the ThreadPanel composer's own
      // dataProvider.create("messages", { thread_id, body }) call needs the
      // same server-stamped account_id/connection_id/sender_member_id
      // set_message_defaults() copies from the parent thread, and the same
      // participant gate the real INSERT policy enforces — see
      // ./internal/threads.ts's createMessage(). Cast to `any`: this
      // override's return type is a per-resource union DataProvider's own
      // generic `create<RecordType>` signature cannot express, exactly like
      // `params: any` above.
      if (resource === "messages") {
        const message = await createMessage(
          baseDataProvider,
          getIdentity,
          () => activeAccountId,
          params.data ?? {},
        );
        return { data: message } as any;
      }
      // Story 7.1 (AC-2, AC-8): defense-in-depth parity for a direct
      // dataProvider.create("thread_participants", …) — no built UI calls
      // this today (create_thread() seeds every participant this story's
      // SPA needs), but the real INSERT policy exists for exactly this case
      // (Dev Notes, "Why the INSERT policy still matters") and this mirror
      // matches it.
      if (resource === "thread_participants") {
        const participant = await createThreadParticipant(
          baseDataProvider,
          getIdentity,
          () => activeAccountId,
          params.data ?? {},
        );
        return { data: participant } as any;
      }
      // Review fix (F3): mirrors the amended "Single listings insert"
      // policy's added lock check (Story 9.3, AC-2) — a plain re-INSERT
      // for a single who withdrew and has not consented again must be
      // refused here too, or `make start-demo` never exercises the
      // "must consent again" branch of `PublishSingleListingSection.tsx`
      // at all (Task 6's "emulate the lock explicitly" covered the delete
      // trigger and the consent RPC, but not this insert-side check).
      // Runs BEFORE the account_id-stamping block below, against whichever
      // account_id will actually end up on the row (the caller's own, if
      // already set — never the case in practice, since `useListingUpsert`
      // deliberately omits it — otherwise the one `resolveCurrentAccountId()`
      // is about to stamp).
      if (
        resource === "listings" &&
        params.data?.listing_type === "single" &&
        params.data?.single_id != null
      ) {
        await assertListingInsertNotLocked(
          baseDataProvider,
          params.data.single_id,
          params.data.account_id ?? (await resolveCurrentAccountId()),
        );
      }
      // Story 9.1: mirrors set_account_id_default() (02_functions.sql) —
      // PublishShadchanListingSection.tsx never sends account_id itself
      // (same "the client never has to trust a client-sent account_id"
      // posture as medical_notes/shidduchim_external_links above), so
      // FakeRest has to stamp it the same way the real BEFORE INSERT
      // trigger does, or every listing this demo creates would come back
      // with no account_id at all and the panel's own
      // `getList("listings", { filter: { account_id } })` re-read would
      // never find it.
      if (resource === "listings" && params.data?.account_id == null) {
        return baseDataProvider.create(resource, {
          ...params,
          data: {
            ...params.data,
            account_id: await resolveCurrentAccountId(),
          },
        });
      }
      // Story 9.5 (AC-2) — see ./internal/shareLinks.ts's own doc comment.
      if (resource === "share_links") {
        return baseDataProvider.create(resource, {
          ...params,
          data: await stampShareLinkDefaults(
            baseDataProvider,
            getIdentity,
            () => activeAccountId,
            params.data ?? {},
          ),
        });
      }
      return baseDataProvider.create(resource, params);
    },
    async update(resource: string, params: any) {
      if (resource === "interactions") {
        const previous = params.previousData ?? {};
        // Story 6.4 (AC 3): a `single_input` row is append-only for every
        // role, including its own author and a `parent_admin` — mirrors the
        // real UPDATE policy's `kind not in ('note', 'single_input') or
        // (kind = 'note' and can_moderate_note(...))` clause, which never
        // admits `single_input` on either branch. Checked on the STORED
        // kind (previousData), never `params.data.kind` — kind is also not
        // client-writable in Postgres (06_grants.sql's column grant is
        // `body, metadata, deleted_at` only), so a payload can never change
        // a row INTO or OUT of this kind at update time either way.
        if (previous.kind === "single_input") {
          throw new Error(
            "a single's input is append-only and cannot be edited after submission",
          );
        }
        // The structural columns are not client-writable in Postgres
        // (column-level UPDATE is revoked), so they are not writable here.
        const structural = [
          "scope",
          "reference_link_id",
          "target_type",
          "target_id",
          "account_id",
        ] as const;
        for (const column of structural) {
          if (
            params.data?.[column] !== undefined &&
            params.data[column] !== previous[column]
          ) {
            throw new Error(
              `interactions.${column} cannot be changed after the fact`,
            );
          }
        }
      }
      return baseDataProvider.update(resource, params);
    },
    async delete(resource: string, params: any) {
      if (resource === "interactions") {
        // DELETE is revoked on interactions in Postgres: the diligence timeline
        // is append-only. Removing a whole conversation means deleting its
        // reference_link, which takes its own log with it.
        throw new Error(
          "the diligence timeline is append-only; delete the reference link instead",
        );
      }
      const result = await baseDataProvider.delete(resource, params);
      // Story 9.3: FakeRest has no triggers, so the AFTER DELETE lock trigger
      // (lock_listing_on_single_withdrawal, 02_functions.sql) gets called
      // explicitly here, right after the delete succeeds — same "hand-written
      // FakeRest twin" convention as every other Postgres-only behavior in
      // this file. `result.data` is the row `database.removeOne()` just
      // removed (ra-data-fakerest's own delete shape), never
      // `params.previousData` — a caller is not required to supply it.
      if (resource === "listings") {
        await lockListingOnSingleWithdrawal(
          baseDataProvider,
          getIdentity,
          () => activeAccountId,
          result.data as Listing,
        );
      }
      return result;
    },
    memberUpdate: async (
      id: Identifier,
      data: Partial<MemberFormData>,
    ): Promise<Member> => {
      const { data: previousData } = await dataProvider.getOne<Member>(
        "members",
        {
          id,
        },
      );

      if (!previousData) {
        throw new Error("User not found");
      }

      const { data: member } = await dataProvider.update<Member>("members", {
        id,
        data,
        previousData,
      });
      return { ...member, user_id: member.id.toString() };
    },
    // The SOLE INSERT path into shidduchim (AD-4 invariant 1) — the reusable
    // primitive a future fileInboxItem() wraps. The board's create form calls
    // this directly; raw dataProvider.create("shidduchim") is never used by the UI.
    createShidduch: createShidduchImpl,
    // Story 7.1 (AC-1, AC-2, AC-7)/Story 7.4 (AC-1, AC-7) — FakeRest mirror
    // of create_thread(). The SOLE creation path for a thread and its
    // initial participants; see ./internal/threads.ts.
    //
    // Story 7.2 (AC-3, AC-4): when the caller omits `visibility`, resolve it
    // from the OWNING side's `default_thread_visibility` (AD-22; FR96/FR99)
    // here, before delegating — the same resolution `create_thread()` does
    // server-side (02_functions.sql), for AD-10 parity in the demo build.
    // Story 7.4 (AC-7): when `input.connection_id` is supplied, the owning
    // side is the connection's HOUSEHOLD account, never the caller's own
    // (shadchanus) account — FR99 gives families the default posture. An
    // explicit `visibility` always wins and is forwarded unchanged. If
    // identity, membership or (on the connection axis) the connection
    // itself cannot be resolved, `resolvedInput` stays exactly `input` and
    // `createThread()` below raises its own error, same as before this
    // story.
    createThread: async (input: CreateThreadInput): Promise<Thread> => {
      let resolvedInput = input;
      if (input.visibility == null) {
        const identity = await getIdentity();
        const membership = identity
          ? await resolveContextMembership(
              baseDataProvider,
              String(identity.id),
              activeAccountId,
            )
          : null;
        if (membership) {
          let defaultSourceAccountId: Identifier | null = membership.account_id;
          if (input.connection_id != null) {
            const { data: connection } =
              await baseDataProvider.getOne<Connection>("connections", {
                id: input.connection_id,
              });
            defaultSourceAccountId = connection?.household_account_id ?? null;
          }
          if (defaultSourceAccountId != null) {
            const { data: account } = await baseDataProvider.getOne<Account>(
              "accounts",
              { id: defaultSourceAccountId },
            );
            resolvedInput = {
              ...input,
              visibility: account.default_thread_visibility,
            };
          }
        }
      }
      return createThread(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        resolvedInput,
      );
    },
    // Story 7.3 (AC-1, Task 3) — FakeRest mirror of set_thread_visibility();
    // see ./internal/threads.ts for the two refusals this reproduces.
    setThreadVisibility: (
      threadId: Identifier,
      visibility: ThreadVisibility,
    ): Promise<Thread> =>
      setThreadVisibilityImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        threadId,
        visibility,
      ),
    // Story 7.3 (Task 4) — FakeRest mirror of current_member_id(): "who am
    // I" in the account_members.id space, the same resolver
    // resolveCallerMembership() above already uses for sender_member_id
    // stamping and can_moderate. Exposed here for ThreadPanel.tsx's own
    // participation check (see supabase/dataProvider.ts's identical
    // getCurrentMemberId for why this id space, not getIdentity().id).
    async getCurrentMemberId(): Promise<Identifier | null> {
      const caller = await resolveCallerMembership();
      return caller?.membership?.id ?? null;
    },
    // Story 7.5 (AC-1, AC-2) — FakeRest mirror of mark_thread_read(); see
    // ./internal/threads.ts.
    markThreadRead: (threadId: Identifier): Promise<ThreadParticipant | null> =>
      markThreadReadImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        threadId,
      ),
    // The SOLE writer of pipeline_state (AD-4 invariant 2) — FakeRest mirror of
    // transition_shidduch. Enforces the transitions-as-data graph with the same
    // optimistic-concurrency check as Postgres.
    transitionShidduch: async (
      id: Identifier,
      from: PipelineState,
      to: PipelineState,
      closeReason?: string,
    ): Promise<Shidduch> => {
      const { data: current } = await baseDataProvider.getOne("shidduchim", {
        id,
      });
      if (!current) {
        throw new Error(`shidduch ${id} not found`);
      }
      if (current.pipeline_state !== from) {
        throw new Error(
          `stale transition: shidduch ${id} is in state ${current.pipeline_state}, not ${from}`,
        );
      }
      if (from === to) {
        return current as Shidduch;
      }
      if (!isValidTransition(from, to)) {
        throw new Error(`illegal pipeline transition: ${from} -> ${to}`);
      }
      const isTerminal = !PIPELINE_TRANSITIONS.some((t) => t.from_state === to);
      const { data } = await baseDataProvider.update("shidduchim", {
        id,
        data: {
          pipeline_state: to,
          close_reason: isTerminal
            ? (closeReason ?? current.close_reason ?? null)
            : null,
        },
        previousData: current,
      });
      return data as Shidduch;
    },
    // Append a redt (same or different shadchan, new date) — FakeRest mirror of
    // the add_redt RPC. Recomputes the shidduch's redt summary (redt_date =
    // latest) just like the Postgres trigger, then returns the refreshed row.
    addRedt: async (input: AddRedtInput): Promise<Shidduch> => {
      // getList (not getOne) so a missing id yields [] instead of throwing a
      // generic error — mirrors add_redt's "shidduch % not found".
      const { data: matches } = await baseDataProvider.getList("shidduchim", {
        filter: { id: input.shidduchim_id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      const shidduch = matches[0];
      if (!shidduch) {
        throw new Error(`shidduch ${input.shidduchim_id} not found`);
      }
      const now = new Date().toISOString();
      await baseDataProvider.create("redts", {
        data: {
          account_id: shidduch.account_id,
          shidduchim_id: input.shidduchim_id,
          shadchan_id: input.shadchan_id ?? null,
          redt_date: input.redt_date ?? now.split("T")[0],
          note: input.note ?? null,
          created_at: now,
        },
      });
      await recomputeShidduchRedtSummary(input.shidduchim_id);
      const { data: refreshed } = await baseDataProvider.getOne("shidduchim", {
        id: input.shidduchim_id,
      });
      return refreshed as Shidduch;
    },
    // Link a school/seminary/yeshiva to a shidduch — FakeRest mirror of add_education.
    addEducation: async (
      input: AddEducationInput,
    ): Promise<ShidduchEducation> => {
      const { data: matches } = await baseDataProvider.getList("shidduchim", {
        filter: { id: input.shidduchim_id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      const shidduch = matches[0];
      if (!shidduch) {
        throw new Error(`shidduch ${input.shidduchim_id} not found`);
      }
      const { data } = await baseDataProvider.create("shidduch_education", {
        data: {
          account_id: shidduch.account_id,
          shidduchim_id: input.shidduchim_id,
          kind: input.kind ?? "seminary",
          name_en: input.name_en ?? null,
          name_he: input.name_he ?? null,
          start_year: input.start_year ?? null,
          end_year: input.end_year ?? null,
          created_at: new Date().toISOString(),
        },
      });
      return data as ShidduchEducation;
    },
    // Dedupe "catch" (E3) -- FakeRest mirror of catch_shidduch(). Read-only,
    // nothing merges. FREE, never entitlement-gated (same as the Supabase side).
    catchShidduch: (id: Identifier): Promise<ShidduchCatch> =>
      catchShidduch(baseDataProvider, id),
    // ---------------------------------------------------------------------
    // References (FR20, FR39-43) -- FakeRest mirrors of the RPCs/edge function
    // in providers/supabase/dataProvider.ts. Match-on-entry is FREE and never
    // gated by subscription state, same as the Supabase side.
    // ---------------------------------------------------------------------
    matchReferenceOnEntry: (
      input: MatchReferenceInput,
    ): Promise<ReferenceMatchCandidate[]> =>
      matchReferenceOnEntry(baseDataProvider, input),
    linkReferenceToShidduch: (
      input: LinkReferenceInput,
    ): Promise<ReferenceLink> =>
      linkReferenceToShidduch(baseDataProvider, input),
    createReferenceForShidduch: (
      input: CreateReferenceForShidduchInput,
    ): Promise<Reference> =>
      createReferenceForShidduch(baseDataProvider, input),
    logReferenceCall: (input: LogReferenceCallInput): Promise<ReferenceLink> =>
      logReferenceCall(baseDataProvider, input),
    previewReferenceMerge: (
      loserId: Identifier,
      winnerId: Identifier,
    ): Promise<ReferenceMergePreview> =>
      previewReferenceMerge(baseDataProvider, loserId, winnerId),
    mergeReferences: (
      loserId: Identifier,
      winnerId: Identifier,
      resolutions: Record<string, MergeResolution> = {},
    ): Promise<Identifier> =>
      mergeReferences(baseDataProvider, loserId, winnerId, resolutions),
    // ---------------------------------------------------------------------
    // Demo / onboarding (Stage B) -- FakeRest stubs so demos/tests don't
    // break. `fakeDemo` is module-level so the flag stays self-consistent
    // across the three methods within one browser session.
    // ---------------------------------------------------------------------
    seedDemo: async (): Promise<{ seeded: boolean }> => {
      fakeDemo = true;
      return { seeded: true };
    },
    // `_releaseDemoFlag` mirrors the Supabase provider's now-required
    // parameter so `CrmDataProvider`'s signature matches on both providers,
    // but is otherwise unused: FakeRest has no second, opt-out caller
    // (there is no reseed orchestrator here, just one in-browser session),
    // so it always resets `fakeDemo` — the same unconditional behaviour this
    // stub always had. `personaWarning` is never returned here either: this
    // stub never deletes any FakeRest resource row (unlike the real
    // clear_demo edge function) and never calls the FakeRest
    // removePersona() mirror, so there is nothing here that could fail —
    // only the return SHAPE needs to match `CrmDataProvider`.
    clearDemo: async (
      _releaseDemoFlag: boolean,
    ): Promise<{ cleared: boolean; personaWarning?: string }> => {
      fakeDemo = false;
      return { cleared: true };
    },
    currentAccountDemo: async (): Promise<boolean> => fakeDemo,
    // "What am I" (2.2 AC-8, 2.3 AC-9) -- FakeRest mirrors of
    // my_personas()/add_persona() in ./internal/personas.ts. Derive from the
    // in-memory account_members/singles tables, never a stub.
    getMyPersonas: (): Promise<MyPersona[]> =>
      getMyPersonas(baseDataProvider, getIdentity),
    addPersona: (persona: Persona): Promise<void> =>
      addPersona(baseDataProvider, getIdentity, persona),
    // Persona lifecycle (2.5 AC-2) -- FakeRest mirror of remove_persona() in
    // ./internal/removePersona.ts. Shares the same closure-local
    // activeAccountId as switchActiveContext below for the AC-7
    // dangling-context handoff.
    removePersona: (persona: Persona): Promise<void> =>
      removePersona(
        baseDataProvider,
        getIdentity,
        persona,
        () => activeAccountId,
        (id) => {
          activeAccountId = id;
        },
      ),
    // Admin removal of another person (Story 13.2) -- FakeRest mirror of
    // remove_persona_admin() / restore_persona_admin() in
    // ./internal/removePersonaAdmin.ts.
    removePersonaAdmin: (
      targetAccountMemberId: Identifier,
      targetType: "member" | "single",
    ): Promise<void> =>
      removePersonaAdmin(
        baseDataProvider,
        getIdentity,
        targetAccountMemberId,
        targetType,
      ),
    restorePersonaAdmin: (
      targetAccountMemberId: Identifier,
      targetType: "member" | "single",
    ): Promise<void> =>
      restorePersonaAdmin(
        baseDataProvider,
        getIdentity,
        targetAccountMemberId,
        targetType,
      ),
    // Context switcher (2.4 AC-6) -- FakeRest mirrors of
    // my_contexts()/set_active_context() in ./internal/contexts.ts. Derive
    // from the in-memory account_members/accounts tables, never a stub.
    getMyContexts: (): Promise<MyContext[]> =>
      getMyContexts(baseDataProvider, getIdentity, () => activeAccountId),
    switchActiveContext: (accountId: Identifier): Promise<void> =>
      switchActiveContext(baseDataProvider, getIdentity, accountId, (id) => {
        activeAccountId = id;
      }),
    // Billing / AI entitlement (E4) -- FakeRest mirror of ai_entitlement().
    // Demo mode defaults to the FREE tier (unentitled) with a sample usage
    // number, so the Billing page renders realistically without a paid backend.
    // There is no client path to flip this to entitled, exactly as in Supabase.
    aiEntitlement: async (): Promise<AiEntitlementInfo> => ({
      ...UNENTITLED_AI,
      // A calm, non-zero sample so the usage meter has something to show in the
      // demo. Still plan 'free' / not entitled: the meter is illustrative only.
      resumes_used: 3,
    }),
    getConfiguration: async (): Promise<ConfigurationContextValue> => {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    // Invite-only signup (Story 2.7) -- FakeRest mirror of get_invite_preview().
    // Story 2.8 adds an `invites` collection for the INVITER side
    // (InvitesSection.tsx's list/create/revoke) but deliberately does not
    // wire the invitee-side acceptance flow up to it: that flow also needs
    // OTP request/verify against `auth.users`, which 2.6/2.7 deliberately
    // never emulated in FakeRest. Every token honestly resolves to "not
    // found" rather than a stub success, which is what InviteAcceptance's
    // "this invite link isn't valid" branch is for.
    getInvitePreview: async (_token: string): Promise<InvitePreview | null> =>
      null,
    // Story 2.7 review finding #4 -- FakeRest mirror of accept_invite().
    // Unreachable in the demo world for the same reason as getInvitePreview
    // above: getInvitePreview() always resolves "not found", so
    // InviteAcceptance never renders the OTP step that would call this.
    // Kept as a real, honest no-op rather than a throw, matching the
    // "satisfies the interface without pretending to be real" shape
    // getInvitePreview already uses.
    acceptInvite: async (_token: string): Promise<void> => undefined,
    // ---------------------------------------------------------------------
    // Invites as the one membership mechanism (Story 2.8 AC-5) -- FakeRest
    // mirrors of create_invite()/revoke_invite() in ./internal/invites.ts.
    // Both scope to the caller's CURRENT active context, exactly like
    // getMyContexts/switchActiveContext above -- shares the same
    // closure-local activeAccountId.
    //
    // Story 6.1: `targetSingleId` mirrors create_invite()'s own
    // p_target_single_id -- singles/SingleLoginInvite.tsx's one call site
    // for a `single`-role invite; InvitesSection.tsx's generic form never
    // passes it.
    // ---------------------------------------------------------------------
    createInvite: (
      email: string,
      role: InvitableRole,
      targetSingleId?: Identifier | null,
    ): Promise<Invite> =>
      createInvite(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        email,
        role,
        targetSingleId,
      ),
    revokeInvite: (id: Identifier): Promise<void> =>
      revokeInvite(baseDataProvider, getIdentity, () => activeAccountId, id),
    // ---------------------------------------------------------------------
    // Consent-based connection (Story 8.2) -- FakeRest mirrors of
    // ./internal/connections.ts, unlike getInvitePreview/acceptInvite above:
    // this flow needs only an already-authenticated, opposite-kind active
    // context, not the OTP/signup step FakeRest has never emulated, so it
    // is fully exercised here rather than stubbed.
    // ---------------------------------------------------------------------
    createConnectionInvite: (): Promise<string> =>
      createConnectionInvite(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
      ),
    revokeConnectionInvite: (id: Identifier): Promise<void> =>
      revokeConnectionInvite(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        id,
      ),
    previewConnectionInvite: (
      token: string,
    ): Promise<ConnectionInvitePreview | null> =>
      previewConnectionInvite(baseDataProvider, getIdentity, token),
    acceptConnectionInvite: (token: string): Promise<Connection> =>
      acceptConnectionInvite(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        token,
      ),
    endConnection: (connectionId: Identifier): Promise<Connection> =>
      endConnection(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        connectionId,
      ),
    // Story 13.1 (grant lifecycle) -- FakeRest mirrors of
    // ./internal/grants.ts. Mirrors the connection_invite shape: per-child,
    // household-to-household, with a status lifecycle.
    // ---------------------------------------------------------------------
    createChildGrant: (
      singleId: Identifier,
      email: string,
      accessLevel: ChildGrantAccessLevel,
    ): Promise<string> =>
      createChildGrantImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        singleId,
        email,
        accessLevel,
      ),
    revokeChildGrant: (id: Identifier): Promise<void> =>
      revokeChildGrantImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        id,
      ),
    previewChildGrant: (token: string): Promise<ChildGrantPreview | null> =>
      previewChildGrantImpl(baseDataProvider, getIdentity, token),
    acceptChildGrant: (token: string): Promise<ChildGrant> =>
      acceptChildGrantImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        token,
      ),
    severChildGrant: (id: Identifier): Promise<ChildGrant> =>
      severChildGrantImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        id,
      ),
    regrantChildGrant: (id: Identifier): Promise<string> =>
      regrantChildGrantImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        id,
      ),
    updateChildGrantAccess: (
      id: Identifier,
      accessLevel: ChildGrantAccessLevel,
    ): Promise<void> =>
      updateChildGrantAccessImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId as number,
        id,
        accessLevel,
      ),
    // Story 8.3 (Task 5) -- FakeRest mirror of ./internal/redting.ts.
    redtViaConnection: (input: RedtViaConnectionInput): Promise<InboxItem> =>
      redtViaConnectionImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        input,
      ),
    // Epic 11 (Needs review tab) -- FakeRest mirror of
    // ./internal/trustedSenders.ts. Unlike redtViaConnection above, this
    // needs no active-account resolution: the caller always supplies
    // `accountId` from the held item's own `account_id` (NeedsReviewDialog.tsx).
    trustSender: (params: TrustSenderParams): Promise<TrustSenderResult> =>
      trustSenderAndRelease(baseDataProvider, params),
    // Story 9.3 (AC-4) -- FakeRest mirror of ./internal/listingWithdrawal.ts.
    consentToRepublishListing: (singleId: Identifier): Promise<void> =>
      consentToRepublishListingImpl(
        baseDataProvider,
        getIdentity,
        () => activeAccountId,
        singleId,
      ),
    // Story 9.5 (Task 6): revocation only ever touches `revoked_at` in the
    // real provider (the column-level grant); FakeRest has no column-level
    // grants to mirror, so a plain `update` is enough here — the point of
    // this custom method is a stable client API shape, not re-deriving the
    // real backend's own privilege narrowing (which
    // `supabase/tests/share_links.sql` proves directly, not this file).
    revokeShareLink: async (id: Identifier): Promise<void> => {
      const { data: link } = await baseDataProvider.getOne<ShareLink>(
        "share_links",
        { id },
      );
      if (link.revoked_at) {
        // AC-6: one-way — a client-side no-op mirrors the real trigger's
        // raised exception closely enough for demo purposes (the SQL suite
        // is what proves the actual trigger).
        return;
      }
      await baseDataProvider.update("share_links", {
        id,
        data: { revoked_at: new Date().toISOString() },
        previousData: link,
      });
    },
    // Story 9.5 (AC-8) -- a plain read; FakeRest has no RLS to mirror, so
    // this is exactly `dataProvider.getList` under a documented name.
    getShareAccessLog: async (
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
    },
    // ---------------------------------------------------------------------
    // Files tab (Story 3.7) -- FakeRest mirrors of
    // providers/supabase/entityFiles.ts, backed by ./internal/entityFiles.ts.
    // ---------------------------------------------------------------------
    uploadEntityFile: async (
      params: UploadEntityFileParams,
    ): Promise<EntityFile> => {
      const [accountId, caller] = await Promise.all([
        resolveCurrentAccountId(),
        resolveCallerMembership(),
      ]);
      return uploadEntityFileImpl(
        baseDataProvider,
        entityFileBlobUrls,
        accountId,
        caller?.membership?.id ?? null,
        params,
      );
    },
    signEntityFileUrl: (params: {
      storagePath: string;
      fileName: string;
    }): Promise<string> =>
      signEntityFileUrlImpl(entityFileBlobUrls, params.storagePath),
    deleteEntityFile: (params: {
      id: Identifier;
      storagePath: string;
    }): Promise<void> =>
      deleteEntityFileImpl(baseDataProvider, entityFileBlobUrls, params),
    // Story 10.4: carry capture attachments into the linked shidduch's Files tab.
    copyInboxAttachmentsToEntityFiles: async (
      params: CopyInboxAttachmentsParams,
    ): Promise<EntityFile[]> => {
      const [accountId, caller] = await Promise.all([
        resolveCurrentAccountId(),
        resolveCallerMembership(),
      ]);
      return copyInboxAttachmentsToEntityFilesImpl(entityFileBlobUrls, {
        ...params,
        accountId,
        uploadedByMemberId: caller?.membership?.id ?? null,
      });
    },
    // ---------------------------------------------------------------------
    // Resume tab (Story 5.3) -- FakeRest mirrors of add_resume_file /
    // signed-URL minting, backed by ./internal/resumes.ts.
    // ---------------------------------------------------------------------
    uploadResumeFile: async (
      params: UploadResumeFileParams,
    ): Promise<Resume> => {
      const [accountId, caller] = await Promise.all([
        resolveCurrentAccountId(),
        resolveCallerMembership(),
      ]);
      return uploadResumeFileImpl(
        baseDataProvider,
        resumeFileBlobUrls,
        accountId,
        caller?.membership?.id ?? null,
        params,
      );
    },
    signResumeFileUrl: (params: {
      storagePath: string;
      fileName: string;
    }): Promise<string> =>
      signResumeFileUrlImpl(resumeFileBlobUrls, params.storagePath),
    // ---------------------------------------------------------------------
    // Photo tab (Story 5.4) -- FakeRest mirrors of add_resume_photo /
    // hide_resume_photo / signed-URL minting, backed by
    // ./internal/resumePhotos.ts.
    // ---------------------------------------------------------------------
    uploadResumePhoto: async (
      params: UploadResumePhotoParams,
    ): Promise<ResumePhoto> => {
      const accountId = await resolveCurrentAccountId();
      return uploadResumePhotoImpl(
        baseDataProvider,
        resumePhotoBlobUrls,
        accountId,
        params,
      );
    },
    signResumePhotoUrl: (params: { storagePath: string }): Promise<string> =>
      signResumePhotoUrlImpl(resumePhotoBlobUrls, params.storagePath),
    hideResumePhoto: (params: { id: Identifier }): Promise<ResumePhoto> =>
      hideResumePhotoImpl(baseDataProvider, params),
    // ---------------------------------------------------------------------
    // Analytics (Story 15.2) -- FakeRest mirrors of the analytics RPCs.
    // ---------------------------------------------------------------------
    getAnalyticsSummary: async (): Promise<AnalyticsEventsSummaryRow | null> =>
      getAnalyticsSummaryImpl(baseDataProvider, activeAccountId as number),
    getCounterMetrics: async (): Promise<CounterMetrics> =>
      getCounterMetricsImpl(baseDataProvider, activeAccountId as number),
    setAnalyticsEnabled: async (enabled: boolean): Promise<void> =>
      setAnalyticsEnabledImpl(
        baseDataProvider,
        activeAccountId as number,
        enabled,
      ),
    // Resolve the current account ID from the FakeRest session state.
    getCurrentAccountId: async (): Promise<number> => activeAccountId as number,
  };

  const dataProvider = withLifecycleCallbacks(
    withSupabaseFilterAdapter(dataProviderWithCustomMethod),
    [
      {
        resource: "configuration",
        beforeUpdate: async (params) => {
          const config = params.data.config;
          if (config) {
            config.lightModeLogo = await processConfigLogo(
              config.lightModeLogo,
            );
            config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
          }
          return params;
        },
      },
      {
        resource: "members",
        beforeCreate: async (params) => {
          const { data } = params;
          // If administrator role is not set, we simply set it to false
          if (data.administrator == null) {
            data.administrator = false;
          }
          return params;
        },
        afterSave: async (data) => {
          // Since the current user is stored in localStorage in fakerest authProvider
          // we need to update it to keep information up to date in the UI
          const currentUser = await getIdentity();
          if (currentUser?.id === data.id) {
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
          }
          return data;
        },
      } satisfies ResourceCallbacks<Member>,
    ],
  ) as CrmDataProvider;

  return dataProvider;
};

export const dataProvider = createDataProvider();

/**
 * Convert a `File` object returned by the upload input into a base 64 string.
 * That's not the most optimized way to store images in production, but it's
 * enough to illustrate the idea of dataprovider decoration.
 */
const convertFileToBase64 = (file: { rawFile: Blob }): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    // We know result is a string as we used readAsDataURL
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file.rawFile);
  });
