/**
 * Google OAuth is opt-in per deployment: the provider also has to be enabled in
 * the Supabase dashboard, and there is no way to detect that from the browser —
 * signInWithOAuth() navigates away before the server is ever asked, so a
 * disabled provider only surfaces as GoTrue's "Unsupported provider: provider
 * is not enabled" on the page the browser lands on.
 *
 * Rather than offer a control that fails after the redirect, the button is not
 * rendered at all unless the deployment says the provider is configured.
 */
export const isGoogleOAuthEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === "true";
