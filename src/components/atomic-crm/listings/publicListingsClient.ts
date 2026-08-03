import type { Listing, ListingType } from "../types";
import { getSupabaseClient } from "../providers/supabase/supabase";

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
 * `public.listings` (AD-21, the sole anon-readable relation) through the
 * shared Supabase client — with no session, it is already effectively
 * `anon` at the Postgres level, so no second client instance is needed.
 * `text` always reaches Postgres through `.ilike()`/`.or()`, never
 * concatenated into a raw SQL or filter string built from user input.
 *
 * A query error (network/config failure) is re-thrown as a plain `Error`
 * so `PublicSearchPage` can present it as a calm error state rather than a
 * stack trace (AC-6).
 */
export const loadPublicListings = async (
  query: PublicListingsQuery,
): Promise<Listing[]> => {
  let builder = getSupabaseClient()
    .from("listings")
    .select("*")
    .order("created_at", { ascending: false });

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
  return (data ?? []) as Listing[];
};
