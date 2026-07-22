import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "./env";

// AD-7: the service role bypasses RLS, so the *only* way a Worker touches a
// tenant table is through this scoped client. It injects/asserts the
// account_id predicate on every operation — the raw Supabase client is never
// exposed, so un-scoped access to a tenant table is unrepresentable.
export class ScopedAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedAccountError";
  }
}

type QueryBuilder = ReturnType<SupabaseClient["from"]>;

export interface ScopedTable {
  select(columns?: string): ReturnType<QueryBuilder["select"]>;
  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): ReturnType<QueryBuilder["insert"]>;
  update(values: Record<string, unknown>): ReturnType<QueryBuilder["update"]>;
  delete(): ReturnType<QueryBuilder["delete"]>;
}

export interface ScopedClient {
  accountId: string;
  from(table: string): ScopedTable;
}

export function forAccount(accountId: string, env: BaseEnv): ScopedClient {
  if (!accountId) {
    throw new ScopedAccountError(
      "forAccount() requires a non-empty accountId — un-scoped Worker access to tenant tables is not allowed (AD-7).",
    );
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return {
    accountId,
    from(table: string) {
      return {
        select: (columns = "*") =>
          client.from(table).select(columns).eq("account_id", accountId),
        insert: (values) => {
          const rows = Array.isArray(values) ? values : [values];
          const scoped = rows.map((row) => ({ ...row, account_id: accountId }));
          return client.from(table).insert(scoped);
        },
        update: (values) =>
          client.from(table).update(values).eq("account_id", accountId),
        delete: () => client.from(table).delete().eq("account_id", accountId),
      } as ScopedTable;
    },
  };
}
