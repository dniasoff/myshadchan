/**
 * Tool descriptions for the MCP server, kept in their own module because they
 * are a contract with an AI client — an assistant's behaviour is driven by
 * this prose as much as by the validators. Keeping them here lets
 * `toolDescriptions.test.ts` assert on the contract, and lets every embedded
 * SQL example be executed through the real validators so the documentation
 * can never drift from what the server actually accepts.
 *
 * RULING 7 lives here as much as in `referenceScope.ts`: references are
 * scoped to a shidduch, so no description may advertise them as something to
 * list, search or create on their own.
 */

/** SELECT examples embedded in the `query` description. Must all validate. */
export const QUERY_EXAMPLES = [
  "SELECT id, name_en, name_he FROM shidduchim_summary WHERE pipeline_state = 'look_into'",
  "SELECT name_en, pipeline_state, redt_date FROM shidduchim_summary WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY redt_date DESC",
  "SELECT COUNT(*) as total_tasks, type FROM tasks WHERE done_date IS NULL GROUP BY type",
  "SELECT s.name_en, sh.name as shadchan_name FROM shidduchim_summary s JOIN shadchanim sh ON s.shadchan_id = sh.id WHERE s.pipeline_state = 'yes'",
  // The references serving one shidduch — reached through the shidduch.
  "SELECT reference_name_en, effective_relationship, call_status FROM reference_links_summary WHERE shidduchim_id = 42",
  // The cross-shidduch view: every match one reference has been consulted on.
  "SELECT shidduch_name_en, call_status, what_they_said FROM reference_links_summary WHERE reference_id = 7",
] as const;

/** DML examples embedded in the `mutate` description. Must all validate. */
export const MUTATE_EXAMPLES = [
  "INSERT INTO shadchanim (name, location) VALUES ('Mrs. Feldman', 'Lakewood')",
  "UPDATE shadchanim SET location = 'Passaic' WHERE id = 123",
  "DELETE FROM tasks WHERE id = 456",
  // Create a reference and attach it to its shidduch in one statement.
  `WITH new_ref AS (
  INSERT INTO "references" (name_en, relationship, phone)
  VALUES ('Rabbi Cohen', 'shul rabbi', '555-0100') RETURNING id
)
SELECT public.link_reference_to_shidduch(new_ref.id, 42) FROM new_ref`,
] as const;

/**
 * The reference rule, stated once and shared by the tools that can reach
 * reference rows. Enforced by `referenceScope.ts` — an assistant that ignores
 * it gets a validation error, not silent data.
 */
export const REFERENCE_SCOPE_RULE = `References are scoped to a shidduch and have no browse surface. Never list, page or free-text-search references, references_summary, reference_links or reference_links_summary: every statement that reads them must name a shidduch (WHERE shidduchim_id = <id>) or name a reference (WHERE reference_id = <id>). Naming a reference is what powers the cross-shidduch view — "which other matches have I spoken to this person about" — so that question is fully supported. A reference is never created on its own: create it and link it to its shidduch in a single statement via public.link_reference_to_shidduch.`;

export const GET_SCHEMA_DESCRIPTION = `Retrieve the database schema for the user's MyShadchan instance including all tables, views, columns, types, and foreign key relationships. Views (like shidduchim_summary) are read-only and provide pre-joined/aggregated data. Use them for search and list queries.

${REFERENCE_SCOPE_RULE}`;

export const QUERY_DESCRIPTION = `Read data from the user's CRM instance using SQL SELECT queries.

IMPORTANT: Before using this tool, you MUST call the get_schema tool first to understand what tables and columns are available in the database.

Use this tool when the user asks about their CRM data such as:
- Shidduchim (suggested matches) and shadchanim
- The pipeline and where each suggestion stands
- The references consulted on a particular shidduch, and their calls and diligence notes
- Tasks and follow-ups
- Custom fields and metadata

Row Level Security (RLS) is enforced - queries automatically return only data the authenticated user has permission to access.

Use the *_summary views (shidduchim_summary, singles_summary) for queries that need aggregated data or search capabilities.

${REFERENCE_SCOPE_RULE}

To filter by the current user: on tasks, add a WHERE member_id = auth.uid() clause. On other tables with a member_id column (e.g. singles), member_id references account_members, not the authenticated user — do not filter it against auth.uid().

This tool only supports SELECT queries. For INSERT, UPDATE, or DELETE operations, use the mutate tool.

Examples:
${QUERY_EXAMPLES.map((sql) => `- "${sql}"`).join("\n")}`;

export const MUTATE_DESCRIPTION = `Create, update, or delete data in the user's CRM instance using SQL.

IMPORTANT: Before using this tool, you MUST call the get_schema tool first to understand what tables and columns are available in the database.

Use this tool for data modifications such as:
- Creating new shadchanim, shidduchim, or tasks
- Updating existing records
- Deleting records

Row Level Security (RLS) is enforced - mutations only affect data the authenticated user has permission to modify.

${REFERENCE_SCOPE_RULE}

A bare INSERT INTO "references" is rejected: it would leave a reference with no shidduch, invisible in the match it was gathered for. Use the WITH ... link_reference_to_shidduch shape below, which is atomic and idempotent. To attach an existing reference to a further shidduch, call the same function.

IMPORTANT: On tasks, never specify member_id in INSERT or UPDATE statements — it is automatically set to the authenticated user by a database trigger. On other tables (e.g. singles.member_id), member_id references account_members and may be set normally.

For read-only queries, use the query tool instead.

Examples:
${MUTATE_EXAMPLES.map((sql) => `- "${sql}"`).join("\n")}`;
