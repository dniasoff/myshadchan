import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";

/**
 * Merge two duplicate references.
 *
 * Unlike merge_contacts, the reassign-then-delete logic is NOT reimplemented
 * here: it lives in the merge_references() SQL function, which runs as one
 * transaction with the caller's RLS applied. That matters because a reference
 * merge has a failure mode contacts do not — both duplicates can hold a call log
 * for the SAME shidduch — and the resolution of that conflict has to be atomic
 * with the rest of the merge. This function is the transport: it authenticates,
 * validates the payload, and forwards the user's own JWT so the database sees
 * the real caller.
 *
 * Body: { loserId, winnerId, resolutions?: { [shidduchimId]: "winner" | "loser" | "both" } }
 *
 * A collision with no resolution is rejected by the database, and that refusal
 * is surfaced to the client verbatim so the UI can ask the user to choose.
 */

const RESOLUTIONS = new Set(["winner", "loser", "both"]);

type MergePayload = {
  loserId: unknown;
  winnerId: unknown;
  resolutions?: unknown;
};

function parseId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  return id;
}

function parseResolutions(
  value: unknown,
): Record<string, string> | { error: string } {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "resolutions must be an object keyed by shidduch id" };
  }

  const parsed: Record<string, string> = {};
  for (const [key, resolution] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (parseId(key) === null) {
      return { error: `invalid shidduch id in resolutions: ${key}` };
    }
    if (typeof resolution !== "string" || !RESOLUTIONS.has(resolution)) {
      return {
        error: `invalid resolution "${String(resolution)}" for shidduch ${key}`,
      };
    }
    parsed[key] = resolution;
  }
  return parsed;
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }

        let payload: MergePayload;
        try {
          payload = await req.json();
        } catch {
          return createErrorResponse(400, "Invalid JSON body");
        }

        const loserId = parseId(payload.loserId);
        const winnerId = parseId(payload.winnerId);
        if (loserId === null || winnerId === null) {
          return createErrorResponse(
            400,
            "loserId and winnerId must be positive integers",
          );
        }
        if (loserId === winnerId) {
          return createErrorResponse(
            400,
            "loserId and winnerId must be different references",
          );
        }

        const resolutions = parseResolutions(payload.resolutions);
        if ("error" in resolutions) {
          return createErrorResponse(400, resolutions.error as string);
        }

        // Forward the caller's JWT so RLS and current_account_id() resolve to
        // the real user. A service-role client here would bypass tenant
        // isolation entirely.
        const client = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
          {
            global: {
              headers: { Authorization: req.headers.get("Authorization")! },
            },
          },
        );

        const { data, error } = await client.rpc("merge_references", {
          p_loser_id: loserId,
          p_winner_id: winnerId,
          p_resolutions: resolutions,
        });

        if (error) {
          console.error("merge_references failed:", error);
          // The database's own message names the unresolved shidduch, which is
          // what the UI needs in order to ask the user to choose.
          return createErrorResponse(
            400,
            error.message || "Failed to merge references",
            { error: error.message },
          );
        }

        return new Response(JSON.stringify({ success: true, winnerId: data }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }),
    ),
  ),
);
