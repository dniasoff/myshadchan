import { getSupabaseClient } from "../supabase/supabase";

/**
 * The single client-side call surface for the billing Worker's two browser
 * routes, `/checkout` and `/portal` (Story 12.4). Reads the current session,
 * forwards the bearer token, and unwraps the Worker's
 * `{success,data,error}` envelope — the repo-wide Worker response shape
 * (`workers/shared/envelope.ts`'s `ok()`/`fail()`).
 *
 * Deliberately NOT `providers/commons/aiWorkerClient.ts`'s `callAiWorker`,
 * even though the shape is identical: that helper targets Workers sitting
 * behind `requireAiEntitlement` (Story 11.1), which answers `402` to
 * exactly the population trying to pay for entitlement in the first place.
 * Billing and AI inference are different clients calling different Workers
 * for different reasons — keep them separate rather than merging them in a
 * later "tidy-up".
 */
export async function callBillingWorker<T>(
  url: string,
  body: unknown,
): Promise<T> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Not authenticated");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw networkError instanceof Error
      ? networkError
      : new Error(String(networkError));
  }

  const envelope = (await response.json()) as {
    success: boolean;
    data?: T;
    error?: string;
  };

  if (!envelope.success) {
    throw new Error(envelope.error ?? "Billing request failed");
  }

  return envelope.data as T;
}
