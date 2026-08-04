import { vi } from "vitest";
import { buildRawEmail, streamFromString } from "./emailFixtures";

/**
 * Shared test harness for `workers/ingest`'s integration suite
 * (`index.test.ts`, `index.senderAndAttachments.test.ts`). Deliberately
 * factored OUT of either test file (coding-style.md: grow the file count,
 * not the file).
 *
 * The `vi.mock("@supabase/supabase-js", ...)` call below lives HERE, not in
 * either test file: Vitest's module transform applies to every module a
 * test file's import graph pulls in, not only `*.test.ts` files, so a
 * `vi.mock` call at this module's top level registers the mock the moment
 * a test file imports anything from here — before that test file's own
 * later `import ... from "./index"` (and its transitive
 * `@supabase/supabase-js` import) ever resolves. Each test file gets its
 * own fresh copy of this module's state (Vitest isolates modules per test
 * file by default), so the two test files never share fake-DB state despite
 * both importing the same source module.
 *
 * This only works because nothing exported below needs `vi.hoisted()`'s
 * "run before my own imports" trick — every value here is defined in plain
 * top-to-bottom order, and the one thing that DOES need hoisting-like
 * ordering (registering the mock before `@supabase/supabase-js` is ever
 * really imported) is satisfied by ordinary ES module evaluation order
 * instead: this file, and its `vi.mock` call, always finishes evaluating
 * before a THEN-imported `./index` gets a chance to import the real thing.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const tables: Tables = {};
export const insertedRows: Tables = {};
let insertError: { message: string } | null = null;

// Loose (`==`) equality: `forAccount()`'s string accountId ("1")
// legitimately matches a numeric `account_id` column (1) — this fake
// reproduces that PostgREST-over-HTTP coercion rather than being stricter
// than the real thing it stands in for. citext columns
// (`inbound_email_token`, `members.email`, `trusted_senders.email`) are
// matched case-insensitively for the same reason.
function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => {
    const rowVal = row[col];
    if (typeof rowVal === "string" && typeof val === "string") {
      return rowVal.toLowerCase() === val.toLowerCase();
    }
    return rowVal == val;
  });
}

function makeQuery(tableName: string) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    async maybeSingle() {
      const rows = (tables[tableName] ?? []).filter((row) =>
        matches(row, filters),
      );
      return { data: rows[0] ?? null, error: null };
    },
    async insert(values: Row | Row[]) {
      if (insertError) return { data: null, error: insertError };
      // `forAccount()`'s real `insert()` always wraps its argument into an
      // array before calling this — even for a single row — so this fake
      // must unwrap it the same way rather than pushing the array itself
      // as one opaque "row".
      const rows = Array.isArray(values) ? values : [values];
      (insertedRows[tableName] ??= []).push(...rows);
      (tables[tableName] ??= []).push(...rows);
      return { data: null, error: null };
    },
  };
  return builder;
}

/** A minimal in-memory fake of the two `@supabase/supabase-js` surfaces
 * this Worker touches: `.from(table).select().eq()...maybeSingle()/insert()`
 * (Postgres — both the raw service-role client and `forAccount()`'s scoped
 * client resolve here) and `.storage.from(bucket).upload()/createSignedUrl()`.
 * Same "mock the client entirely" idiom `forAccount.test.ts` and
 * `share/index.test.ts` already use in this repo. */
export const from = vi.fn((tableName: string) => makeQuery(tableName));

export const upload = vi.fn(
  async (): Promise<{ error: { message: string } | null }> => ({
    error: null,
  }),
);
export const createSignedUrl = vi.fn(
  async (
    path: string,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  }> => ({
    data: { signedUrl: `https://example.supabase.co/signed/${path}` },
    error: null,
  }),
);
export const storageFrom = vi.fn(() => ({ upload, createSignedUrl }));

export function resetFakeDb(): void {
  for (const key of Object.keys(tables)) delete tables[key];
  for (const key of Object.keys(insertedRows)) delete insertedRows[key];
  insertError = null;
  from.mockClear();
  upload.mockClear();
  createSignedUrl.mockClear();
  storageFrom.mockClear();
}

export function setInsertError(err: { message: string } | null): void {
  insertError = err;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from, storage: { from: storageFrom } }),
}));

/** The fixture data both test files seed before every test: one household
 * per token, one active member each, and one trusted address for account 1. */
export function seedDefaultTables(tables: Tables): void {
  tables.accounts = [
    { id: 1, inbound_email_token: "abc123def456" },
    { id: 2, inbound_email_token: "fedcba654321" },
  ];
  tables.members = [
    { user_id: "user-a", email: "known.parent@example.com" },
    { user_id: "user-b", email: "other.household@example.com" },
  ];
  tables.account_members = [
    { account_id: 1, user_id: "user-a", status: "active" },
    { account_id: 2, user_id: "user-b", status: "active" },
  ];
  tables.trusted_senders = [{ account_id: 1, email: "trusted@example.com" }];
}

/** A `ForwardableEmailMessage` fake: real enough to exercise `setReject` and
 * the `.raw`/`.from`/`.to` surface this Worker actually reads. */
export function makeMessage(overrides: {
  from?: string;
  to?: string;
  raw?: string;
}): ForwardableEmailMessage & { rejected: string[] } {
  const rejected: string[] = [];
  const from = overrides.from ?? "mrs.feldman@example.com";
  const to = overrides.to ?? "abc123def456@myshadchan.space";
  return {
    from,
    to,
    // `parseEmail`'s `fromEmail` (parsed from the raw body's `From:` header)
    // takes priority over this envelope `from` (see `handleInboundEmail`) —
    // so a caller-supplied `from` must also land in the raw MIME body's own
    // header, not just the envelope, or classification would silently test
    // against the fixture's default sender instead of the intended one.
    raw: streamFromString(overrides.raw ?? buildRawEmail({ from, to })),
    headers: new Headers(),
    rawSize: 0,
    rejected,
    setReject(reason: string) {
      rejected.push(reason);
    },
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage & { rejected: string[] };
}
