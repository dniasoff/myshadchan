import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import { sendEmail } from "../shared/resend";

/**
 * Story 12.6 (FR75): grace window sweep.
 *
 * Runs on a daily schedule (wrangler.toml) to:
 * 1. Find subscriptions with status = 'past_due' and grace_ends_at < now()
 *    (expired grace) - lapse them to status = 'lapsed'.
 * 2. Find subscriptions with status = 'past_due' and grace_ends_at IS NULL
 *    (newly past_due) - set grace_ends_at = now() + 7 days and send dunning email.
 * 3. Other statuses (unpaid, canceled, incomplete_expired, paused) are handled
 *    by the billing webhook directly - they lapse immediately with no grace.
 *
 * FAIL-CLOSED: if this Worker stops, grace_ends_at expiry is enforced by the
 * database itself (ai_resume_limit_for_account checks now() < grace_ends_at).
 * An ungraced account is the fail-closed outcome.
 *
 * AC-10 COMPLIANCE: this file issues NO direct table query at all - every
 * read and write goes through the service_role-only RPCs below, never a
 * table query call. `noTenantTableAccess.guard.test.ts` (Story 7.5's AC-10
 * guard, scoped to all workers/cron files) is what proves this.
 */

export interface SweepGraceWindowResult {
  lapsed: number;
  graceStarted: number;
  dunningSent: number;
  errors: number;
}

export type SweepGraceWindowErrorCode =
  "rpc_failed" | "transport_failed" | "unknown";

export class SweepGraceWindowError extends Error {
  readonly code: SweepGraceWindowErrorCode;

  constructor(code: SweepGraceWindowErrorCode, message: string) {
    super(message);
    this.name = "SweepGraceWindowError";
    this.code = code;
  }
}

interface GraceSubscription {
  account_id: number;
  stripe_customer_id: string | null;
  grace_ends_at: string | null;
  status: string;
}

type ServiceRoleClient = SupabaseClient;

function getServiceRoleClient(env: BaseEnv): ServiceRoleClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Send dunning email via Resend (same transport as 12.2 reminders).
 * Uses get_account_owner_email RPC to avoid direct tenant table access (AC-10).
 */
async function sendDunningEmail(
  client: ServiceRoleClient,
  env: BaseEnv,
  accountId: number,
  graceEndsAt: string,
): Promise<boolean> {
  // Get the account owner's email via RPC
  const { data: owner, error: emailError } = await client.rpc(
    "get_account_owner_email",
    { p_account_id: accountId },
  );

  if (emailError) {
    console.error("sweepGraceWindow.emailRpcError", {
      accountId,
      error: summarizeErrorForLog(emailError),
    });
    return false;
  }

  const email = owner?.[0]?.email;
  if (!email) {
    console.warn("sweepGraceWindow.noOwnerEmail", { accountId });
    return false;
  }

  const graceEndDate = new Date(graceEndsAt).toLocaleDateString();
  const result = await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM,
    to: email,
    subject: "Your AI tier payment failed — grace period ends soon",
    text: `Your subscription payment could not be processed. Your AI features will continue to work until ${graceEndDate}, after which they will pause until payment is updated.

Update your payment method: ${env.APP_ORIGIN}/billing

— MyShadchan`,
    idempotencyKey: `dunning:${accountId}:${graceEndsAt.split("T")[0]}`,
  });

  return result.ok;
}

async function findGraceSubscriptions(
  client: ServiceRoleClient,
): Promise<GraceSubscription[]> {
  // Call RPC instead of direct table access (AC-10)
  const { data, error } = await client.rpc("find_grace_subscriptions");

  if (error) {
    console.error("sweepGraceWindow.findError", summarizeErrorForLog(error));
    throw new SweepGraceWindowError(
      "rpc_failed",
      "failed to find past_due subscriptions",
    );
  }

  return (data as GraceSubscription[]) ?? [];
}

export async function sweepGraceWindow(
  env: BaseEnv,
): Promise<SweepGraceWindowResult> {
  const client = getServiceRoleClient(env);
  const subs = await findGraceSubscriptions(client);

  let lapsed = 0;
  let graceStarted = 0;
  let dunningSent = 0;
  let errors = 0;

  const now = new Date().toISOString();

  for (const sub of subs) {
    try {
      if (sub.grace_ends_at && sub.grace_ends_at < now) {
        // Grace expired — lapse to 'lapsed' via RPC
        const { error } = await client.rpc("lapse_grace_subscription", {
          p_account_id: sub.account_id,
        });

        if (error) {
          console.error(
            "sweepGraceWindow.lapseError",
            summarizeErrorForLog(error),
            { accountId: sub.account_id },
          );
          errors += 1;
        } else {
          lapsed += 1;
          console.warn("sweepGraceWindow.lapsed", {
            accountId: sub.account_id,
          });
        }
      } else if (!sub.grace_ends_at) {
        // Newly past_due — start 7-day grace window via RPC
        const { data: newGraceEndsAt, error } = await client.rpc(
          "start_grace_window",
          { p_account_id: sub.account_id, p_grace_days: 7 },
        );

        if (error) {
          console.error(
            "sweepGraceWindow.graceStartError",
            summarizeErrorForLog(error),
            { accountId: sub.account_id },
          );
          errors += 1;
        } else {
          graceStarted += 1;
          console.warn("sweepGraceWindow.graceStarted", {
            accountId: sub.account_id,
            graceEndsAt: newGraceEndsAt,
          });

          // Send dunning email
          const sent = await sendDunningEmail(
            client,
            env,
            sub.account_id,
            newGraceEndsAt,
          );
          if (sent) dunningSent += 1;
        }
      }
    } catch (error) {
      console.error("sweepGraceWindow.rowError", summarizeErrorForLog(error), {
        accountId: sub.account_id,
      });
      errors += 1;
    }
  }

  return { lapsed, graceStarted, dunningSent, errors };
}
