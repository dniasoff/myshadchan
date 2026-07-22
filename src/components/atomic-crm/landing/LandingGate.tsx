import { useEffect, useState, type ReactNode } from "react";
import { getSupabaseClient } from "../providers/supabase/supabase";
import { isPublicEntryUrl, type LandingUrl } from "./landingEntryUrl";
import { LandingPage } from "./LandingPage";

type SessionState = "pending" | "present" | "absent";

const hasSupabaseSession = async (): Promise<boolean> => {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session != null;
};

export interface LandingGateProps {
  /** The authenticated app, rendered for everyone who is not a fresh visitor. */
  children: ReactNode;
  checkSession?: () => Promise<boolean>;
  url?: LandingUrl;
}

/**
 * Decides which of the two front doors a visitor gets: the public landing page,
 * or the app. Only `/` is ever intercepted, and only for a visitor with no
 * session — every other path falls straight through to `<Admin>`, which remains
 * the real authentication boundary (this gate guards no data of its own).
 */
export const LandingGate = ({
  children,
  checkSession = hasSupabaseSession,
  url = window.location,
}: LandingGateProps) => {
  const isPublicEntry = isPublicEntryUrl(url);
  const [session, setSession] = useState<SessionState>("pending");

  useEffect(() => {
    if (!isPublicEntry) {
      return;
    }
    let isStale = false;
    checkSession()
      .then((hasSession) => {
        if (!isStale) {
          setSession(hasSession ? "present" : "absent");
        }
      })
      .catch(() => {
        // Treat an unreachable auth service as "not signed in": the landing
        // page is public, and its call to action leads back to sign-in.
        if (!isStale) {
          setSession("absent");
        }
      });
    return () => {
      isStale = true;
    };
  }, [checkSession, isPublicEntry]);

  if (!isPublicEntry || session === "present") {
    return <>{children}</>;
  }

  if (session === "pending") {
    // A blank warm surface for the few milliseconds the session check takes —
    // never a flash of the landing page at a signed-in user.
    return <div className="min-h-screen bg-background" aria-hidden="true" />;
  }

  return <LandingPage />;
};
