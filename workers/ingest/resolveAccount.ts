import { getServiceRoleClient } from "./serviceRoleClient";
import type { BaseEnv } from "../shared/env";

/**
 * Resolve a household's `account_id` from the RECIPIENT address alone —
 * never from the sender, never from the body. This is the entire security
 * boundary for which household a captured email is filed under (the
 * Postmark path's own F5 finding was exactly the failure mode of deriving
 * account attribution from something other than a trusted, server-owned
 * value — never reintroduce that shape here).
 *
 * `accounts.inbound_email_token` is `extensions.citext` — the database
 * already compares it case-insensitively, so the extracted local-part is
 * passed through UNCHANGED. Do NOT lowercase it in JS: that would be a
 * second, redundant normalisation mechanism living outside the column type
 * that already owns this.
 */
export async function resolveAccountId(
  recipient: string,
  env: BaseEnv,
): Promise<number | null> {
  const token = extractLocalPart(recipient);
  if (!token) return null;

  const { data, error } = await getServiceRoleClient(env)
    .from("accounts")
    .select("id")
    .eq("inbound_email_token", token)
    .maybeSingle();

  if (error) {
    console.error("ingest.resolveAccountId.error", error);
    return null;
  }

  const row = data as { id: number } | null;
  return row?.id ?? null;
}

/**
 * The local-part of a recipient address (`<token>@myshadchan.space` ->
 * `<token>`). Deliberately simple string slicing, not an email-validation
 * library: the value is only ever used as an exact-match lookup key against
 * a citext column, so an address with no `@`, or an empty local-part,
 * safely resolves to "no such token" rather than needing to be "valid".
 */
function extractLocalPart(recipient: string): string | null {
  const atIndex = recipient.indexOf("@");
  if (atIndex <= 0) return null;
  const localPart = recipient.slice(0, atIndex);
  return localPart.length > 0 ? localPart : null;
}
