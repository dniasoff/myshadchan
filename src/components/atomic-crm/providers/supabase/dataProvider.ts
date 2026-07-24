import { supabaseDataProvider } from "ra-supabase-core";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import type {
  AddRedtInput,
  AddSchoolInput,
  ContactNote,
  CreateShidduchInput,
  Deal,
  DealNote,
  LinkReferenceInput,
  LogReferenceCallInput,
  MatchReferenceInput,
  MergeResolution,
  PipelineState,
  RAFile,
  ReferenceLink,
  ReferenceMatchCandidate,
  ReferenceMergePreview,
  Sale,
  SalesFormData,
  Shidduch,
  ShidduchCatch,
  ShidduchSchool,
  SignUpData,
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getIsInitialized } from "./authProvider";
import { getSupabaseClient } from "./supabase";

const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    sortOrder: "asc,desc.nullslast" as any,
  });

const processCompanyLogo = async (params: any) => {
  const logo = params.data.logo;

  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
  }

  return {
    ...params,
    data: {
      ...params.data,
      logo,
    },
  };
};

// The SOLE INSERT path into shidduchim (AD-4 invariant 1): the create_shidduch
// RPC. The board's create form calls dataProvider.createShidduch() directly;
// the UI never issues a raw dataProvider.create("shidduchim"). At the DB, a
// BEFORE INSERT trigger (enforce_shidduch_initial_state) additionally blocks
// creating a row straight into a decision state.
const createShidduchViaRpc = async (
  input: CreateShidduchInput,
): Promise<Shidduch> => {
  const { data, error } = await getSupabaseClient().rpc("create_shidduch", {
    p_child_id: input.child_id,
    p_shadchan_id: input.shadchan_id ?? null,
    p_name_en: input.name_en ?? null,
    p_name_he: input.name_he ?? null,
    p_parents_en: input.parents_en ?? null,
    p_parents_he: input.parents_he ?? null,
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
  });
  if (error) {
    console.error("createShidduch.error", error);
    throw new Error(error.message || "Failed to create shidduch");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as Shidduch;
};

const getDataProviderWithCustomMethods = () => {
  const baseDataProvider = getBaseDataProvider();

  return {
    ...baseDataProvider,
    async getList(resource: string, params: GetListParams) {
      if (resource === "companies") {
        return baseDataProvider.getList("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getList("contacts_summary", params);
      }
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
        // need the joined shidduch/child names, so they read the summary view.
        return baseDataProvider.getList("reference_links_summary", params);
      }
      if (resource === "activity_log") {
        const { data, total } = await baseDataProvider.getList(
          "activity_log",
          params,
        );
        // Rename snake_case view columns to camelCase to match Activity type
        return {
          data: data.map((row: any) => ({
            ...row,
            contactNote: row.contact_note ?? undefined,
            dealNote: row.deal_note ?? undefined,
            contact_note: undefined,
            deal_note: undefined,
          })),
          total,
        };
      }

      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "companies") {
        return baseDataProvider.getOne("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getOne("contacts_summary", params);
      }
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

    async signUp({ email, password, first_name, last_name }: SignUpData) {
      const response = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name,
            last_name,
          },
        },
      });

      if (!response.data?.user || response.error) {
        console.error("signUp.error", response.error);
        throw new Error(response?.error?.message || "Failed to create account");
      }

      // Update the is initialized cache
      (getIsInitialized as any)._is_initialized_cache = true;

      return {
        id: response.data.user.id,
        email,
        password,
      };
    },
    async salesCreate(body: SalesFormData) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: Sale;
      }>("users", {
        method: "POST",
        body,
      });

      if (!data || error) {
        console.error("salesCreate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(errorDetails?.message || "Failed to create the user");
      }

      return data.data;
    },
    async salesUpdate(
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ) {
      const { email, first_name, last_name, administrator, avatar, disabled } =
        data;

      const { data: updatedData, error } =
        await getSupabaseClient().functions.invoke<{
          data: Sale;
        }>("users", {
          method: "PATCH",
          body: {
            sales_id: id,
            email,
            first_name,
            last_name,
            administrator,
            disabled,
            avatar,
          },
        });

      if (!updatedData || error) {
        console.error("salesCreate.error", error);
        throw new Error("Failed to update account manager");
      }

      return updatedData.data;
    },
    async updatePassword(id: Identifier) {
      const { data: passwordUpdated, error } =
        await getSupabaseClient().functions.invoke<boolean>("update_password", {
          method: "PATCH",
          body: {
            sales_id: id,
          },
        });

      if (!passwordUpdated || error) {
        console.error("update_password.error", error);
        throw new Error("Failed to update password");
      }

      return passwordUpdated;
    },
    async unarchiveDeal(deal: Deal) {
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
          baseDataProvider.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    async isInitialized() {
      return getIsInitialized();
    },
    async mergeContacts(sourceId: Identifier, targetId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "merge_contacts",
        {
          method: "POST",
          body: { loserId: sourceId, winnerId: targetId },
        },
      );

      if (error) {
        console.error("merge_contacts.error", error);
        throw new Error("Failed to merge contacts");
      }

      return data;
    },
    // The SOLE INSERT path into shidduchim (AD-4 invariant 1) — the reusable
    // primitive a future fileInboxItem() (Epic-6) wraps. Backed by the
    // create_shidduch RPC; see createShidduchViaRpc above.
    createShidduch: createShidduchViaRpc,
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
    // single can have several. Returns the created school row.
    async addSchool(input: AddSchoolInput): Promise<ShidduchSchool> {
      const { data, error } = await getSupabaseClient().rpc("add_school", {
        p_shidduchim_id: input.shidduchim_id,
        p_kind: input.kind ?? "seminary",
        p_name_en: input.name_en ?? null,
        p_name_he: input.name_he ?? null,
        p_start_year: input.start_year ?? null,
        p_end_year: input.end_year ?? null,
      });
      if (error) {
        console.error("addSchool.error", error);
        throw new Error(error.message || "Failed to add school");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ShidduchSchool;
    },

    /**
     * Dedupe "catch" (E3): "you've come across this person before". Given one
     * shidduch, returns prior suggestions (for any child in this family) and any
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
     * case the contacts merge never has to handle: both duplicates hold a call
     * log for the SAME shidduch. The UI must make the user resolve each one.
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
    async clearDemo(): Promise<{ cleared: boolean }> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        cleared: boolean;
      }>("clear_demo", { method: "POST" });
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

    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    async updateConfiguration(
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.update("configuration", {
        id: 1,
        data: { config },
        previousData: { id: 1 },
      });
      return data.config as ConfigurationContextValue;
    },
  } satisfies DataProvider;
};

export type CrmDataProvider = ReturnType<
  typeof getDataProviderWithCustomMethods
>;

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
    return logo.src;
  }
  return logo?.src ?? "";
};

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "configuration",
    beforeUpdate: async (params) => {
      const config = params.data.config;
      if (config) {
        config.lightModeLogo = await processConfigLogo(config.lightModeLogo);
        config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
      }
      return params;
    },
  },
  {
    resource: "contact_notes",
    beforeSave: async (data: ContactNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "deal_notes",
    beforeSave: async (data: DealNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "sales",
    beforeSave: async (data: Sale, _, __) => {
      if (data.avatar) {
        await uploadToBucket(data.avatar);
      }
      return data;
    },
  },
  {
    resource: "contacts",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "first_name",
        "last_name",
        "company_name",
        "title",
        "email",
        "phone",
        "background",
      ])(params);
    },
  },
  {
    resource: "companies",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name",
        "phone_number",
        "website",
        "zipcode",
        "city",
        "state_abbr",
      ])(params);
    },
    beforeCreate: async (params) => {
      const createParams = await processCompanyLogo(params);

      return {
        ...createParams,
        data: {
          created_at: new Date().toISOString(),
          ...createParams.data,
        },
      };
    },
    beforeUpdate: async (params) => {
      return await processCompanyLogo(params);
    },
  },
  {
    resource: "contacts_summary",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["first_name", "last_name"])(params);
    },
  },
  {
    resource: "deals",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["name", "category", "description"])(params);
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

const applyFullTextSearch = (columns: string[]) => (params: GetListParams) => {
  if (!params.filter?.q) {
    return params;
  }
  const { q, ...filter } = params.filter;
  return {
    ...params,
    filter: {
      ...filter,
      "@or": columns.reduce((acc, column) => {
        if (column === "email")
          return {
            ...acc,
            [`email_fts@ilike`]: q,
          };
        if (column === "phone")
          return {
            ...acc,
            [`phone_fts@ilike`]: q,
          };
        else
          return {
            ...acc,
            [`${column}@ilike`]: q,
          };
      }, {}),
    },
  };
};

const uploadToBucket = async (fi: RAFile) => {
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
  const fileName = `${Math.random()}${fileExt}`;
  const filePath = `${fileName}`;
  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(filePath, dataContent);

  if (uploadError) {
    console.error("uploadError", uploadError);
    throw new Error("Failed to upload attachment");
  }

  const { data } = getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .getPublicUrl(filePath);

  fi.path = filePath;
  fi.src = data.publicUrl;

  // save MIME type
  const mimeType = file.type;
  fi.type = mimeType;

  return fi;
};
