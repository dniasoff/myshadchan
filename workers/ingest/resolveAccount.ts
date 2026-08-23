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

export type DemoIngestClaim = {
  accountId: number;
  claimToken: string;
};

export type DemoIngestClaimResult =
  { outcome: "blocked" } | { outcome: "claimed"; claim: DemoIngestClaim };

/**
 * Atomically acquire a short-lived, service-only claim before an inbound
 * worker performs any external write. The claim is durable so clear_demo can
 * wait for work already admitted; it is token-bound and safely re-playable.
 */
export async function claimDemoIngest(
  accountId: number,
  env: BaseEnv,
): Promise<DemoIngestClaimResult> {
  const claimToken = crypto.randomUUID();
  const { data, error } = await getServiceRoleClient(env).rpc(
    "claim_demo_ingest",
    { p_account_id: accountId, p_claim_token: claimToken, p_ttl_seconds: 300 },
  );
  if (error) {
    console.error("ingest.demoClaim.error", error);
    throw new Error("could not establish inbound ingest lifecycle claim");
  }
  const result = (Array.isArray(data) ? data[0] : data) as {
    outcome?: string;
  } | null;
  if (result?.outcome === "blocked") return { outcome: "blocked" };
  if (result?.outcome === "claimed") {
    return {
      outcome: "claimed",
      claim: { accountId, claimToken },
    };
  }
  throw new Error("could not establish inbound ingest lifecycle claim");
}

/** Extend an admitted claim immediately before each external write boundary. */
export async function heartbeatDemoIngest(
  claim: DemoIngestClaim,
  env: BaseEnv,
): Promise<void> {
  const { data, error } = await getServiceRoleClient(env).rpc(
    "heartbeat_demo_ingest_claim",
    {
      p_account_id: claim.accountId,
      p_claim_token: claim.claimToken,
      p_ttl_seconds: 300,
    },
  );
  if (error || data !== true) {
    console.error("ingest.demoClaimHeartbeat.error", error);
    throw new Error("inbound ingest lifecycle claim expired");
  }
}

/** Release a claim after the inbox row is committed; release is idempotent. */
export async function releaseDemoIngest(
  claim: DemoIngestClaim,
  env: BaseEnv,
): Promise<void> {
  const { data, error } = await getServiceRoleClient(env).rpc(
    "release_demo_ingest_claim",
    {
      p_account_id: claim.accountId,
      p_claim_token: claim.claimToken,
    },
  );
  if (error || data !== true) {
    console.error("ingest.demoClaimRelease.error", error);
    throw new Error("could not release inbound ingest lifecycle claim");
  }
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
