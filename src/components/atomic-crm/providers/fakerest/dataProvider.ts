import {
  withLifecycleCallbacks,
  type CreateParams,
  type DataProvider,
  type Identifier,
  type ResourceCallbacks,
  type UpdateParams,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import type {
  AddRedtInput,
  AddSchoolInput,
  Company,
  Contact,
  ContactNote,
  CreateShidduchInput,
  Deal,
  DealNote,
  LinkReferenceInput,
  LogReferenceCallInput,
  MatchReferenceInput,
  MergeResolution,
  PipelineState,
  ReferenceLink,
  ReferenceMatchCandidate,
  ReferenceMergePreview,
  Sale,
  SalesFormData,
  Shidduch,
  ShidduchSchool,
  SignUpData,
  Task,
} from "../../types";
import {
  INITIAL_PIPELINE_STATES,
  isValidTransition,
  PIPELINE_TRANSITIONS,
} from "../../shidduchim/pipelineStates";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { getActivityLog } from "../commons/activity";
import { getCompanyAvatar } from "../commons/getCompanyAvatar";
import { getContactAvatar } from "../commons/getContactAvatar";
import { mergeContacts } from "../commons/mergeContacts";
import type { CrmDataProvider } from "../types";
import {
  authProvider as defaultAuthProvider,
  USER_STORAGE_KEY,
} from "./authProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";
import {
  linkReferenceToShidduch,
  logReferenceCall,
} from "./internal/referenceLinks";
import { matchReferenceOnEntry } from "./internal/referenceMatch";
import {
  mergeReferences,
  previewReferenceMerge,
} from "./internal/referenceMerge";
import {
  enrichReferenceLinks,
  enrichReferences,
} from "./internal/referenceSummary";

const TASK_MARKED_AS_DONE = "TASK_MARKED_AS_DONE";
const TASK_MARKED_AS_UNDONE = "TASK_MARKED_AS_UNDONE";
const TASK_DONE_NOT_CHANGED = "TASK_DONE_NOT_CHANGED";

const processCompanyLogo = async (params: any) => {
  let logo = params.data.logo;

  if (typeof logo !== "object" || logo === null || !logo.src) {
    logo = await getCompanyAvatar(params.data);
  } else if (logo.rawFile instanceof File) {
    const base64Logo = await convertFileToBase64(logo);
    logo = { src: base64Logo, title: logo.title };
  }

  return {
    ...params,
    data: {
      ...params.data,
      logo,
    },
  };
};

async function processContactAvatar(
  params: UpdateParams<Contact>,
): Promise<UpdateParams<Contact>>;

async function processContactAvatar(
  params: CreateParams<Contact>,
): Promise<CreateParams<Contact>>;

async function processContactAvatar(
  params: CreateParams<Contact> | UpdateParams<Contact>,
): Promise<CreateParams<Contact> | UpdateParams<Contact>> {
  const { data } = params;
  if (data.avatar?.src || !data.email_jsonb || !data.email_jsonb.length) {
    return params;
  }
  const avatarUrl = await getContactAvatar(data);

  // Clone the data and modify the clone
  const newData = { ...data, avatar: { src: avatarUrl || undefined } };

  return { ...params, data: newData };
}

async function fetchAndUpdateCompanyData(
  params: UpdateParams<Contact>,
  dataProvider: DataProvider,
): Promise<UpdateParams<Contact>>;

async function fetchAndUpdateCompanyData(
  params: CreateParams<Contact>,
  dataProvider: DataProvider,
): Promise<CreateParams<Contact>>;

async function fetchAndUpdateCompanyData(
  params: CreateParams<Contact> | UpdateParams<Contact>,
  dataProvider: DataProvider,
): Promise<CreateParams<Contact> | UpdateParams<Contact>> {
  const { data } = params;
  const newData = { ...data };

  if (!newData.company_id) {
    return params;
  }

  const { data: company } = await dataProvider.getOne("companies", {
    id: newData.company_id,
  });

  if (!company) {
    return params;
  }

  newData.company_name = company.name;
  return { ...params, data: newData };
}

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

const preserveAttachmentMimeType = <
  NoteType extends { attachments?: Array<{ rawFile?: File; type?: string }> },
>(
  note: NoteType,
): NoteType => ({
  ...note,
  attachments: (note.attachments ?? []).map((attachment) => ({
    ...attachment,
    type: attachment.type ?? attachment.rawFile?.type,
  })),
});

/**
 * FakeRest mirror of the database's structural guarantees on `interactions`
 * (AD-3). Postgres enforces these with CHECK constraints and a revoked DELETE
 * grant; without the same rules here, demo mode would happily accept rows the
 * real backend rejects, and the demo would teach the wrong thing.
 *
 *   scope 'shidduch' + target 'reference' -> must carry a reference_link_id
 *   scope 'shidduch' + target 'shidduch'  -> the target IS the parent, no link
 *   scope 'account'                       -> reference-targeted only, no link
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
  if (targetType !== "reference" && targetType !== "shidduch") {
    throw new Error(`invalid interaction target_type: ${targetType}`);
  }

  const valid =
    (scope === "shidduch" && targetType === "reference" && hasLink) ||
    (scope === "shidduch" && targetType === "shidduch" && !hasLink) ||
    (scope === "account" && targetType === "reference" && !hasLink);

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
  let taskUpdateType = TASK_DONE_NOT_CHANGED;
  const getIdentity = async () =>
    authProvider?.getIdentity?.() ?? defaultAuthProvider.getIdentity?.();

  const updateCompany = async (
    companyId: Identifier,
    updateFn: (company: Company) => Partial<Company>,
  ) => {
    const { data: company } = await dataProvider.getOne<Company>("companies", {
      id: companyId,
    });

    return await dataProvider.update("companies", {
      id: companyId,
      data: {
        ...updateFn(company),
      },
      previousData: company,
    });
  };

  // Emulate the shidduchim_summary view (AD-10 FakeRest mirror): enrich each
  // shidduch with its shadchan name ("via {shadchan}"), child names, and
  // reference count, joining the in-memory tables.
  const enrichShidduchim = async (rows: any[]) => {
    if (rows.length === 0) return rows;
    const [
      { data: shadchanim },
      { data: children },
      refLinksResult,
      redtsResult,
    ] = await Promise.all([
      baseDataProvider.getList("shadchanim", {
        filter: {},
        pagination: { page: 1, perPage: 10_000 },
        sort: { field: "id", order: "ASC" },
      }),
      baseDataProvider.getList("children", {
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
    const childById = new Map(children.map((c: any) => [c.id, c]));
    const refLinks = refLinksResult.data;
    const redts = redtsResult.data;
    return rows.map((row: any) => {
      const sh = shadchanById.get(row.shadchan_id);
      const c = childById.get(row.child_id);
      return {
        ...row,
        shadchan_name: sh?.name ?? null,
        shadchan_name_he: sh?.name_he ?? null,
        child_first_name_en: c?.first_name_en ?? null,
        child_first_name_he: c?.first_name_he ?? null,
        child_last_name_en: c?.last_name_en ?? null,
        child_last_name_he: c?.last_name_he ?? null,
        nb_references: refLinks.filter((rl: any) => rl.shidduchim_id === row.id)
          .length,
        nb_redts: redts.filter((r: any) => r.shidduchim_id === row.id).length,
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
  // account from the child so account_id is always populated. Used by both
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
    const { data: child } = await baseDataProvider.getOne("children", {
      id: input.child_id,
    });
    const now = new Date().toISOString();
    const { data } = await baseDataProvider.create("shidduchim", {
      data: {
        account_id: child?.account_id ?? 1,
        child_id: input.child_id,
        shadchan_id: input.shadchan_id ?? null,
        name_en: input.name_en ?? null,
        name_he: input.name_he ?? null,
        parents_en: input.parents_en ?? null,
        parents_he: input.parents_he ?? null,
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
        account_id: child?.account_id ?? 1,
        shidduchim_id: (data as Shidduch).id,
        shadchan_id: input.shadchan_id ?? null,
        redt_date: input.redt_date ?? now.split("T")[0],
        note: null,
        created_at: now,
      },
    });
    // Record the headline seminary/yeshiva as the first school (kind by gender).
    if (input.seminary_en || input.seminary_he) {
      await baseDataProvider.create("shidduch_schools", {
        data: {
          account_id: child?.account_id ?? 1,
          shidduchim_id: (data as Shidduch).id,
          kind: child?.gender === "male" ? "seminary" : "yeshiva",
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
      if (resource === "activity_log") {
        const { filter = {}, pagination } = params;
        const all = await getActivityLog(
          withSupabaseFilterAdapter(baseDataProvider),
          filter.company_id,
          filter.sales_id,
        );
        const { page, perPage } = pagination;
        const start = (page - 1) * perPage;
        return { data: all.slice(start, start + perPage), total: all.length };
      }
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
      return baseDataProvider.getList(resource, params);
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
      return baseDataProvider.getOne(resource, params);
    },
    async create(resource: string, params: any) {
      if (resource === "interactions") {
        assertValidInteraction(params.data ?? {});
      }
      return baseDataProvider.create(resource, params);
    },
    async update(resource: string, params: any) {
      if (resource === "interactions") {
        // The structural columns are not client-writable in Postgres
        // (column-level UPDATE is revoked), so they are not writable here.
        const structural = [
          "scope",
          "reference_link_id",
          "target_type",
          "target_id",
          "account_id",
        ] as const;
        const previous = params.previousData ?? {};
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
      return baseDataProvider.delete(resource, params);
    },
    unarchiveDeal: async (deal: Deal) => {
      // get all deals where stage is the same as the deal to unarchive
      const { data: deals } = await baseDataProvider.getList<Deal>("deals", {
        filter: { stage: deal.stage },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "index", order: "ASC" },
      });

      // set index for each deal starting from 1, if the deal to unarchive is found, set its index to the last one
      const updatedDeals = deals.map((d, index) => ({
        ...d,
        index: d.id === deal.id ? 0 : index + 1,
        archived_at: d.id === deal.id ? null : d.archived_at,
      }));

      return await Promise.all(
        updatedDeals.map((updatedDeal) =>
          dataProvider.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    signUp: async ({
      email,
      password,
      first_name,
      last_name,
    }: SignUpData): Promise<{
      id: string;
      email: string;
      password: string;
    }> => {
      const user = await baseDataProvider.create("sales", {
        data: {
          email,
          first_name,
          last_name,
        },
      });

      return {
        ...user.data,
        password,
      };
    },
    salesCreate: async ({ ...data }: SalesFormData): Promise<Sale> => {
      const response = await dataProvider.create("sales", {
        data: {
          ...data,
          password: "new_password",
        },
      });

      return response.data;
    },
    salesUpdate: async (
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ): Promise<Sale> => {
      const { data: previousData } = await dataProvider.getOne<Sale>("sales", {
        id,
      });

      if (!previousData) {
        throw new Error("User not found");
      }

      const { data: sale } = await dataProvider.update<Sale>("sales", {
        id,
        data,
        previousData,
      });
      return { ...sale, user_id: sale.id.toString() };
    },
    isInitialized: async (): Promise<boolean> => {
      const sales = await dataProvider.getList<Sale>("sales", {
        filter: {},
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      if (sales.data.length === 0) {
        return false;
      }
      return true;
    },
    updatePassword: async (id: Identifier): Promise<true> => {
      const currentUser = await getIdentity();
      if (!currentUser) {
        throw new Error("User not found");
      }
      const { data: previousData } = await dataProvider.getOne<Sale>("sales", {
        id: currentUser.id,
      });

      if (!previousData) {
        throw new Error("User not found");
      }

      await dataProvider.update("sales", {
        id,
        data: {
          password: "demo_newPassword",
        },
        previousData,
      });

      return true;
    },
    mergeContacts: async (sourceId: Identifier, targetId: Identifier) => {
      return mergeContacts(sourceId, targetId, baseDataProvider);
    },
    // The SOLE INSERT path into shidduchim (AD-4 invariant 1) — the reusable
    // primitive a future fileInboxItem() wraps. The board's create form calls
    // this directly; raw dataProvider.create("shidduchim") is never used by the UI.
    createShidduch: createShidduchImpl,
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
    // Link a school/seminary/yeshiva to a shidduch — FakeRest mirror of add_school.
    addSchool: async (input: AddSchoolInput): Promise<ShidduchSchool> => {
      const { data: matches } = await baseDataProvider.getList("shidduchim", {
        filter: { id: input.shidduchim_id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      const shidduch = matches[0];
      if (!shidduch) {
        throw new Error(`shidduch ${input.shidduchim_id} not found`);
      }
      const { data } = await baseDataProvider.create("shidduch_schools", {
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
      return data as ShidduchSchool;
    },
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
    getConfiguration: async (): Promise<ConfigurationContextValue> => {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    updateConfiguration: async (
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> => {
      const { data: prev } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      await baseDataProvider.update("configuration", {
        id: 1,
        data: { config },
        previousData: prev,
      });
      return config;
    },
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
        resource: "sales",
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
        beforeDelete: async (params) => {
          if (params.meta?.identity?.id == null) {
            throw new Error("Identity MUST be set in meta");
          }

          const newSaleId = params.meta.identity.id as Identifier;

          const [companies, contacts, contactNotes, deals] = await Promise.all([
            dataProvider.getList("companies", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("contacts", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("contact_notes", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("deals", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
          ]);

          await Promise.all([
            dataProvider.updateMany("companies", {
              ids: companies.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("contacts", {
              ids: contacts.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("contact_notes", {
              ids: contactNotes.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("deals", {
              ids: deals.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
          ]);

          return params;
        },
      } satisfies ResourceCallbacks<Sale>,
      {
        resource: "contacts",
        beforeCreate: async (createParams, dataProvider) => {
          const params = {
            ...createParams,
            data: {
              ...createParams.data,
              first_seen:
                createParams.data.first_seen ?? new Date().toISOString(),
              last_seen:
                createParams.data.last_seen ?? new Date().toISOString(),
            },
          };
          const newParams = await processContactAvatar(params);
          return fetchAndUpdateCompanyData(newParams, dataProvider);
        },
        afterCreate: async (result) => {
          if (result.data.company_id != null) {
            await updateCompany(result.data.company_id, (company) => ({
              nb_contacts: (company.nb_contacts ?? 0) + 1,
            }));
          }

          return result;
        },
        beforeUpdate: async (params) => {
          const newParams = await processContactAvatar(params);
          return fetchAndUpdateCompanyData(newParams, dataProvider);
        },
        afterDelete: async (result) => {
          if (result.data.company_id != null) {
            await updateCompany(result.data.company_id, (company) => ({
              nb_contacts: (company.nb_contacts ?? 1) - 1,
            }));
          }

          return result;
        },
      } satisfies ResourceCallbacks<Contact>,
      {
        resource: "tasks",
        afterCreate: async (result, dataProvider) => {
          // update the task count in the related contact
          const { contact_id } = result.data;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          await dataProvider.update("contacts", {
            id: contact_id,
            data: {
              nb_tasks: (contact.nb_tasks ?? 0) + 1,
            },
            previousData: contact,
          });
          return result;
        },
        beforeUpdate: async (params) => {
          const { data, previousData } = params;
          if (previousData.done_date !== data.done_date) {
            taskUpdateType = data.done_date
              ? TASK_MARKED_AS_DONE
              : TASK_MARKED_AS_UNDONE;
          } else {
            taskUpdateType = TASK_DONE_NOT_CHANGED;
          }
          return params;
        },
        afterUpdate: async (result, dataProvider) => {
          // update the contact: if the task is done, decrement the nb tasks, otherwise increment it
          const { contact_id } = result.data;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          if (taskUpdateType !== TASK_DONE_NOT_CHANGED) {
            await dataProvider.update("contacts", {
              id: contact_id,
              data: {
                nb_tasks:
                  taskUpdateType === TASK_MARKED_AS_DONE
                    ? (contact.nb_tasks ?? 0) - 1
                    : (contact.nb_tasks ?? 0) + 1,
              },
              previousData: contact,
            });
          }
          return result;
        },
        afterDelete: async (result, dataProvider) => {
          // update the task count in the related contact
          const { contact_id } = result.data;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          await dataProvider.update("contacts", {
            id: contact_id,
            data: {
              nb_tasks: (contact.nb_tasks ?? 0) - 1,
            },
            previousData: contact,
          });
          return result;
        },
      } satisfies ResourceCallbacks<Task>,
      {
        resource: "companies",
        beforeCreate: async (params) => {
          const createParams = await processCompanyLogo(params);

          return {
            ...createParams,
            data: {
              ...createParams.data,
              created_at: new Date().toISOString(),
            },
          };
        },
        beforeUpdate: async (params) => {
          return await processCompanyLogo(params);
        },
        afterUpdate: async (result, dataProvider) => {
          // get all contacts of the company and for each contact, update the company_name
          const { id, name } = result.data;
          const { data: contacts } = await dataProvider.getList("contacts", {
            filter: { company_id: id },
            pagination: { page: 1, perPage: 1000 },
            sort: { field: "id", order: "ASC" },
          });

          const contactIds = contacts.map((contact) => contact.id);
          await dataProvider.updateMany("contacts", {
            ids: contactIds,
            data: { company_name: name },
          });
          return result;
        },
      } satisfies ResourceCallbacks<Company>,
      {
        resource: "deals",
        beforeCreate: async (params) => {
          return {
            ...params,
            data: {
              ...params.data,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };
        },
        afterCreate: async (result) => {
          await updateCompany(result.data.company_id, (company) => ({
            nb_deals: (company.nb_deals ?? 0) + 1,
          }));

          return result;
        },
        beforeUpdate: async (params) => {
          return {
            ...params,
            data: {
              ...params.data,
              updated_at: new Date().toISOString(),
            },
          };
        },
        afterDelete: async (result) => {
          await updateCompany(result.data.company_id, (company) => ({
            nb_deals: (company.nb_deals ?? 1) - 1,
          }));

          return result;
        },
      } satisfies ResourceCallbacks<Deal>,
      {
        resource: "contact_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<ContactNote>,
      {
        resource: "deal_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<DealNote>,
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
