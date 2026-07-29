import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthProvider, useTranslate } from "ra-core";
import { AuthLayout } from "@/components/atomic-crm/login/AuthLayout";
import { Button } from "@/components/ui/button";

/**
 * Authorization UI for OAuth Consent Page
 *
 * When third-party apps initiate OAuth, users will be redirected to this page
 * to approve or deny the authorization request.
 *
 * Anonymous users will be redirected to the login page first.
 *
 * Hosted in `AuthLayout` — the same glass card, backdrop and brand lockup as
 * login/signup/invite. It used to render in `components/supabase/layout.tsx`,
 * the retired split-screen auth shell (its own logo, a hardcoded
 * `bg-zinc-900`): an entire second design system kept alive by this one
 * route. That file is deleted; this was its only importer.
 *
 * Inspired from https://supabase.com/docs/guides/auth/oauth-server/getting-started?queryGroups=oauth-setup&oauth-setup=dashboard#example-authorization-ui
 */
export function OAuthConsentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");
  const authProvider = useAuthProvider();
  const translate = useTranslate();

  const [authDetails, setAuthDetails] =
    useState<OAuthAuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    async function loadAuthDetails() {
      if (!authorizationId) {
        setError("Missing authorization_id");
        setLoading(false);
        return;
      }
      if (!authProvider) {
        setError("Auth provider not available");
        setLoading(false);
        return;
      }

      // Check if user is authenticated
      try {
        await authProvider.checkAuth({});
      } catch {
        navigate(
          `/login?redirect=/oauth/consent?authorization_id=${authorizationId}`,
        );
        return;
      }

      // Get authorization details using the authorization_id
      const { data, error } =
        await authProvider.getAuthorizationDetails(authorizationId);

      if (error) {
        setError(error.message);
      } else {
        setAuthDetails(data as OAuthAuthorizationDetails);
      }

      setLoading(false);
    }

    loadAuthDetails();
  }, [authProvider, authorizationId, navigate]);

  async function handleApprove() {
    if (!authorizationId || !authProvider) return;

    setSubmitting(true);
    const { data, error } =
      await authProvider.approveAuthorization(authorizationId);

    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      // Show success message and redirect to client app
      setApproved(true);
      window.location.href = data.redirect_url;
    }
  }

  async function handleDeny() {
    if (!authorizationId || !authProvider) return;

    setSubmitting(true);
    const { data, error } =
      await authProvider.denyAuthorization(authorizationId);
    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      // Redirect to client app with error
      window.location.href = data.redirect_url;
    }
  }

  if (loading) {
    return (
      <AuthLayout>
        <div className="flex flex-col space-y-2 text-center">
          <p className="text-muted-foreground">
            {translate("ra.message.loading", { _: "Loading..." })}
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (error) {
    return (
      <AuthLayout>
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {translate("ra.message.error", { _: "Error" })}
          </h1>
          <p className="text-destructive">{error}</p>
        </div>
      </AuthLayout>
    );
  }

  if (!authDetails) {
    return (
      <AuthLayout>
        <div className="flex flex-col space-y-2 text-center">
          <p className="text-muted-foreground">
            {translate("ra-supabase.oauth.no_request", {
              _: "No authorization request found",
            })}
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (approved) {
    return (
      <AuthLayout>
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {translate("ra-supabase.oauth.approved", {
              _: "Authorization Approved",
            })}
          </h1>
          <p className="text-muted-foreground">
            {translate("ra-supabase.oauth.close_tab", {
              _: "You can now close this tab.",
            })}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {translate("ra-supabase.oauth.authorize", {
            _: "Authorize Application",
          })}
        </h1>
        <p className="text-muted-foreground">
          {translate("ra-supabase.oauth.authorize_details", {
            _: "This application wants to access your account",
          })}
        </p>
      </div>

      {/* Plain sections rather than a `<Card>`: `AuthLayout` is already a
          card, and nesting one inside it produced a border-in-a-border every
          other auth screen avoids. */}
      <div className="mt-6 rounded-xl border border-border/70 p-4">
        <p className="font-medium">{authDetails.client.name}</p>
        <p className="mt-1 break-all text-sm text-muted-foreground">
          {authDetails.redirect_uri}
        </p>

        {authDetails.scope && authDetails.scope.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              {translate("ra-supabase.oauth.permissions", {
                _: "Requested permissions",
              })}
            </p>
            <ul className="list-inside list-disc space-y-1">
              {authDetails.scope.split(" ").map((scopeItem) => (
                <li key={scopeItem} className="text-sm">
                  {scopeItem}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        <Button
          variant="outline"
          onClick={handleDeny}
          disabled={submitting}
          className="flex-1"
        >
          {translate("ra.action.cancel", { _: "Deny" })}
        </Button>
        <Button
          onClick={handleApprove}
          disabled={submitting}
          className="flex-1"
        >
          {translate("ra.action.confirm", { _: "Approve" })}
        </Button>
      </div>
    </AuthLayout>
  );
}

OAuthConsentPage.path = "/oauth/consent";

/**
 * copied from @supabase/auth-js/src/lib/types.ts
 * to avoid adding a hard import to a Supabase package
 * because this page can also be used with FakeRest
 */
type OAuthAuthorizationDetails = {
  /** The authorization ID */
  authorization_id: string;
  /** Redirect URL - present if user already consented (can be used to trigger immediate redirect) */
  redirect_uri?: string;
  /** User object associated with the authorization */
  /** OAuth client requesting authorization */
  client: {
    /** Unique identifier for the OAuth client (UUID) */
    id: string;
    /** Human-readable name of the OAuth client */
    name: string;
    /** URI of the OAuth client's website */
    uri: string;
    /** URI of the OAuth client's logo */
    logo_uri: string;
  };
  user: {
    /** User ID (UUID) */
    id: string;
    /** User email */
    email: string;
  };
  /** Space-separated list of requested scopes */
  scope: string;
};
