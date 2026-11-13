import { getSupabaseClient } from "../supabase/supabase";

export type EmailWorkerResponse = {
  status: "accepted";
};

/** The only browser call surface for the authenticated outbound-email Worker. */
export async function callEmailWorker(
  url: string,
  body: unknown,
): Promise<EmailWorkerResponse> {
  const {
    data: { session },
    error: sessionError,
  } = await getSupabaseClient().auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`${url.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const envelope = (await response.json()) as {
    success: boolean;
    data?: EmailWorkerResponse;
    error?: string;
  };
  if (!response.ok || !envelope.success) {
    const error = new Error(envelope.error ?? "Email request failed");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return envelope.data as EmailWorkerResponse;
}
