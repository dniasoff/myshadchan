import { getSupabaseClient } from "../supabase/supabase";

/**
 * The single client-side call surface for every AI Worker route (Stories 11.2
 * and 11.3). Reads the current session, forwards the bearer token, and unwraps
 * the Worker's `{success,data,error}` envelope.
 */
export async function callAiWorker<T>(url: string, body: unknown): Promise<T> {
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
    throw new Error(envelope.error ?? "AI request failed");
  }

  return envelope.data as T;
}
