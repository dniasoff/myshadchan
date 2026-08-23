import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identifier } from "ra-core";

import type { Listing, ListingType } from "../types";
import { getAnonSupabaseClient } from "../providers/supabase/supabase";

export interface PublicListingsQuery {
  /** Free-text search over the opted-in text columns below; omitted or
   * empty returns every published listing (still capped by nothing here —
   * this story ships no pagination). */
  text?: string;
  /** Narrow to one branch of AD-21's shared `listings` table. Omitted
   * returns both. */
  type?: ListingType;
}

/**
 * The exact 13 columns `anon` holds column-level SELECT on
 * (`supabase/schemas/06_grants.sql`, "AC-8: `listings` is the sole
 * anon-readable relation") — `id`/`created_at`/`listing_type` plus every
 * opt-in `shadchan_*`/`single_*` field. `account_id`, `single_id` and
 * `published_by_member_id` are deliberately withheld there and MUST NEVER
 * be added here to match: table-level SELECT itself is revoked from
 * `anon` (only this column list is granted), so PostgREST/Postgres refuse
 * `select("*")` — or any select naming a column outside this list —
 * outright, with a `42501 permission denied` on every request, for every
 * anonymous visitor (Story 9.4 review finding F1). Kept as a single
 * exported list so the query's own `.select()` and `PublicListing` below
 * can never drift from each other, or from the grant.
 */
export const GRANTED_LISTING_COLUMNS = [
  "id",
  "created_at",
  "listing_type",
  "shadchan_name",
  "shadchan_area",
  "shadchan_contact_info",
  "single_first_name_en",
  "single_first_name_he",
  "single_age",
  "single_height",
  "single_community",
  "single_location",
  "single_summary",
] as const satisfies readonly (keyof Listing)[];

/**
 * The shape a row from this client can actually hold — `Listing` minus the
 * three internal identifiers `anon` is never granted SELECT on. Using this
 * instead of the full `Listing` type (Story 9.4 review finding F11) makes
 * a future `account_id`/`single_id`/`published_by_member_id` read a
 * compile error here, rather than a type assertion quietly papering over
 * a shape the public path can never produce.
 */
export type PublicListing = Pick<
  Listing,
  (typeof GRANTED_LISTING_COLUMNS)[number]
>;

/**
 * The opted-in text columns a free-text search matches against — every
 * text field a publisher can turn on, across both `listing_type` branches
 * (9.1's `shadchan_*`, 9.2's `single_*`). A field a publisher left off
 * holds `null` here, and `ilike` never matches `null`, so this list alone
 * is what keeps a search from ever surfacing an un-opted-in field's
 * content (AC-2).
 */
const SEARCHABLE_COLUMNS = [
  "shadchan_name",
  "shadchan_area",
  "single_first_name_en",
  "single_first_name_he",
  "single_community",
  "single_location",
] as const;

/**
 * Builds the `ilike` value for a `.or()` filter list, PostgREST-escaped.
 * PostgREST's `.or()` argument is a single comma/parenthesis-delimited
 * string, so a comma or parenthesis typed into the search box would
 * otherwise be read as the START of a second filter condition instead of
 * as literal text inside this one's value — a user-input-shaped
 * filter-syntax risk `.claude/rules/security-triggers.md` calls out for
 * "user input handling" even though the Supabase query builder itself
 * still parameterizes the request PostgREST sends to Postgres (this is not
 * a SQL-injection vector, only a filter-parsing one). Wrapping the value in
 * double quotes, with any literal backslash/double-quote escaped first, is
 * PostgREST's own documented escape for exactly this.
 */
const buildIlikeValue = (text: string): string =>
  `"${`%${text}%`.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Loads the published listings a visitor's search matches, straight off
 * `public.listings` (AD-21, the sole anon-readable relation) through a
 * dedicated session-less client (`getAnonSupabaseClient()`, Story 9.4
 * review finding F2) — NEVER `getSupabaseClient()`, whose singleton
 * hydrates any session already persisted in the browser and would
 * silently narrow this "public" query down to one signed-in member's own
 * account. `text` always reaches Postgres through `.ilike()`/`.or()`,
 * never concatenated into a raw SQL or filter string built from user
 * input. `.select()` names exactly `GRANTED_LISTING_COLUMNS` — never
 * `"*"`, which PostgREST expands to every column on the table; `anon`
 * holds column-level SELECT only, no table-level grant, so that expansion
 * is refused outright, 401/42501, on every request (review finding F1).
 *
 * A query error (network/config failure) is re-thrown as a plain `Error`
 * so `PublicSearchPage` can present it as a calm error state rather than a
 * stack trace (AC-6).
 */
/**
 * Shared read implementation for the anonymous marketplace and the
 * authenticated demo preview. The caller supplies the already-scoped client;
 * RLS remains the authority over which rows that client may see.
 */
export const loadListingsFromClient = async (
  client: SupabaseClient,
  query: PublicListingsQuery,
  accountIds?: readonly Identifier[],
): Promise<PublicListing[]> => {
  let builder = client
    .from("listings")
    .select(GRANTED_LISTING_COLUMNS.join(","))
    .order("created_at", { ascending: false });

  if (accountIds) {
    if (accountIds.length === 0) return [];
    builder = builder.in("account_id", accountIds);
  }

  if (query.type) {
    builder = builder.eq("listing_type", query.type);
  }

  const text = query.text?.trim();
  if (text) {
    const value = buildIlikeValue(text);
    const orFilter = SEARCHABLE_COLUMNS.map(
      (column) => `${column}.ilike.${value}`,
    ).join(",");
    builder = builder.or(orFilter);
  }

  const { data, error } = await builder;
  if (error) {
    throw new Error(error.message || "Failed to load listings");
  }
  // `.select()` is fed a runtime-built (not string-literal) column list, so
  // postgrest-js's template-literal type inference over the select string
  // can't resolve a row shape from it — `unknown` first, then the actual
  // shape `GRANTED_LISTING_COLUMNS` guarantees at runtime.
  return (data ?? []) as unknown as PublicListing[];
};

export const loadPublicListings = async (
  query: PublicListingsQuery,
): Promise<PublicListing[]> =>
  loadListingsFromClient(getAnonSupabaseClient(), query);
