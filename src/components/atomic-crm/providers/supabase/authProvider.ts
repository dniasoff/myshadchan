import type { AuthProvider } from "ra-core";
import { supabaseAuthProvider } from "ra-supabase-core";

import type { MemberRole, MyContext } from "../../types";
import { NoAccountFoundError } from "../commons/authErrors";
import { canAccess } from "../commons/canAccess";
import { pickActiveRole } from "../commons/roleAuthority";
import { readOAuthCallbackError } from "./oauthCallback";
import { getSupabaseClient } from "./supabase";

// The route `admin.tsx` already wires up via `authCallbackPage={AuthCallback}`
// (ra-core registers it at this exact path regardless of anything in this
// app's own route manifest). Pointing `signInWithOAuth()`'s `redirectTo` here
// — instead of the plain app root the old (pre-deletion) Google button used
// — is what makes an OAuth rejection land on a route the HashRouter actually
// matches, so `handleCallback()` below gets a chance to run at all instead of
// the browser showing whatever an unmatched `#error=...` hash resolves to.
const AUTH_CALLBACK_PATH = "/auth-callback";
const getBaseAuthProvider = () =>
  supabaseAuthProvider(getSupabaseClient(), {
    getIdentity: async () => {
      const member = await getMember();

      if (member == null) {
        throw new Error();
      }

      return {
        id: member.id,
        fullName: `${member.first_name} ${member.last_name}`,
        avatar: member.avatar?.src,
      };
    },
  });

// To speed up checks, we cache the current member in the local storage. It
// is cleared on logout.
const CURRENT_MEMBER_CACHE_KEY = "RaStore.auth.current_member";

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

const getMember = async () => {
  const storage = getLocalStorage();
  const cachedValue = storage?.getItem(CURRENT_MEMBER_CACHE_KEY);
  if (cachedValue != null) {
    return JSON.parse(cachedValue);
  }

  const { data: dataSession, error: errorSession } =
    await getSupabaseClient().auth.getSession();

  // Shouldn't happen after login but just in case
  if (dataSession?.session?.user == null || errorSession) {
    return undefined;
  }

  const { data: dataMember, error: errorMember } = await getSupabaseClient()
    .from("members")
    .select("id, first_name, last_name, avatar, administrator")
    .match({ user_id: dataSession?.session?.user.id })
    .single();

  // Shouldn't happen either as all users are members but just in case
  if (dataMember == null || errorMember) {
    return undefined;
  }

  storage?.setItem(CURRENT_MEMBER_CACHE_KEY, JSON.stringify(dataMember));
  return dataMember;
};

function clearCache() {
  const storage = getLocalStorage();
  storage?.removeItem(CURRENT_MEMBER_CACHE_KEY);
}

// Story 3.4 AC 8 — `canAccess`'s role source, resolved from the ACTIVE
// context (`pickActiveRole`), never from `getMember()`'s cached
// per-login member row. Concurrent `canAccess()` calls are deduped onto a
// SINGLE `my_contexts()` RPC via this module-scoped in-flight promise,
// released the instant it settles: a call issued after the burst starts a
// fresh RPC, so there is no time window in which a stale role could be
// served. The role itself is never written to `localStorage` —
// `CURRENT_MEMBER_CACHE_KEY` above stays untouched and keeps serving only
// `getIdentity`.
let inFlightRole: Promise<MemberRole | undefined> | null = null;

async function resolveActiveRole(): Promise<MemberRole | undefined> {
  if (inFlightRole) {
    return inFlightRole;
  }

  const promise = (async (): Promise<MemberRole | undefined> => {
    const { data, error } = await getSupabaseClient().rpc("my_contexts");
    if (error) {
      console.error("my_contexts.error", error);
      return undefined;
    }
    return pickActiveRole(data as MyContext[] | undefined);
  })();

  inFlightRole = promise;
  try {
    return await promise;
  } finally {
    inFlightRole = null;
  }
}

// GoTrue error codes that are safe to treat as a successful resend. The
// `otp_disabled` response is handled separately: the sign-in screen needs to
// tell an unregistered visitor why it cannot advance to a code step.
const SILENT_OTP_ERROR_CODES = new Set([
  // GoTrue's per-address send-frequency guard. A *known* email hits this on
  // a second request inside `max_frequency`; the caller already holds a valid
  // code from the first request, so silently no-oping here is safe.
  "over_email_send_rate_limit",
]);

export const getAuthProvider = (): AuthProvider => {
  // Password mutation is out of scope for a passwordless app (AC-8,
  // NFR-14): `ra-supabase-core`'s `supabaseAuthProvider` declares
  // `setPassword` / `resetPassword` alongside `login`. Only `login` is
  // narrowed below; destructure the other two out explicitly instead of
  // spreading the base provider wholesale, so they never resolve on the
  // app's auth seam.
  const {
    setPassword: _setPassword,
    resetPassword: _resetPassword,
    ...baseAuthProvider
  } = getBaseAuthProvider();
  return {
    ...baseAuthProvider,
    login: async (params) => {
      // Step one of the passwordless flow (AD-11 — no password, no second
      // authentication path): send a 6-digit email code. `shouldCreateUser`
      // defaults hard to `false` — only 2.7's invite-acceptance flow ever
      // passes `allowSignup: true` — so the login form itself can never be
      // used as open self-signup. `meta` forwards to `options.data`
      // (`raw_user_meta_data`), the same mechanism 2.7's invite token /
      // age-affirmation payload rides on.
      if (params.requestOtp) {
        // `captchaToken`: Supabase's captcha gate is a single project-wide
        // flag covering `/otp` among other endpoints (see the Turnstile
        // rollout notes) — there is no way to require it for register's
        // `allowSignup: true` calls while exempting this same sign-in call.
        // Once `security_captcha_enabled` is flipped on, an undefined token
        // here fails the SAME way for every visitor trying to sign in, not
        // just for new signups, so this is sent unconditionally rather than
        // only when `allowSignup` is set.
        const { error } = await getSupabaseClient().auth.signInWithOtp({
          email: params.email,
          options: {
            shouldCreateUser: params.allowSignup === true,
            data: params.meta,
            captchaToken: params.captchaToken,
          },
        });
        if (error) {
          // GoTrue reports an unregistered email as `otp_disabled` when
          // account creation is disabled for this request. Convert that
          // backend-specific result into a stable app error only for the
          // sign-in path; signup and invite flows retain their own handling.
          if (error.code === "otp_disabled" && params.allowSignup !== true) {
            throw new NoAccountFoundError();
          }
          if (!SILENT_OTP_ERROR_CODES.has(error.code ?? "")) {
            throw error;
          }
        }
        return;
      }
      // Step two: verify the code the user typed back in. Never needs a
      // captcha token — GoTrue's captcha middleware is not attached to the
      // `/verify` endpoint this call hits (verified against the actual
      // GoTrue router source, not assumed).
      if (params.verifyOtp) {
        const { error } = await getSupabaseClient().auth.verifyOtp({
          email: params.email,
          token: params.token,
          type: "email",
        });
        if (error) {
          throw error;
        }
        return;
      }
      // Standard social OAuth ("Continue with Google" — GoogleSignInButton
      // on /login, GoogleSignUpButton on /register; the two are the same
      // call, since with `check_signup_age()` retired neither can refuse to
      // create an account). `redirectTo` points at the framework's dedicated
      // auth-callback route (see AUTH_CALLBACK_PATH above), not the bare app
      // root: that is what lets a rejected/cancelled attempt land somewhere
      // `handleCallback()` below can turn into a calm message instead of an
      // unmatched route. Keep this URL byte-for-byte as it is — it has to
      // match Supabase Auth's exact redirect allow-list.
      if (params.oauthProvider) {
        const { error } = await getSupabaseClient().auth.signInWithOAuth({
          provider: params.oauthProvider,
          options: {
            redirectTo: `${window.location.origin}/#${AUTH_CALLBACK_PATH}`,
          },
        });
        if (error) {
          throw error;
        }
        return;
      }
      // No other login shape is supported — in particular, ra-supabase-core's
      // own password login (`baseAuthProvider.login`) must be unreachable.
      throw new Error("Unsupported login request.");
    },
    handleCallback: async (params) => {
      // An OAuth rejection (the visitor cancelled, or the provider is
      // misconfigured) lands here as
      // `error`/`error_code`/`error_description` in the URL — never as a
      // rejected promise, since `signInWithOAuth()` already navigated the
      // browser away before any of this could be known. Map it to a calm,
      // cause-accurate message BEFORE falling through to the base
      // provider's recovery/invite handling, which knows nothing about
      // OAuth and would silently resolve as if nothing happened.
      const callbackError = readOAuthCallbackError(window.location);
      if (callbackError) {
        throw new Error(callbackError.messageKey);
      }
      // `baseAuthProvider.handleCallback` is always defined at runtime (the
      // base `supabaseAuthProvider()` always sets it) — the `?.` is only to
      // satisfy `AuthProvider`'s own optional-property typing.
      return baseAuthProvider.handleCallback?.(params);
    },
    logout: async (params) => {
      clearCache();
      return baseAuthProvider.logout(params);
    },
    checkAuth: async (params) => {
      return baseAuthProvider.checkAuth(params);
    },
    canAccess: async (params) => {
      // Story 3.4 AC 8 — the active-context role, never
      // `member.administrator` (AD-2). `getMember()`/its localStorage cache
      // are untouched; they still serve `getIdentity` only.
      const role = await resolveActiveRole();
      return canAccess(role, params);
    },
    getAuthorizationDetails(authorizationId: string) {
      return getSupabaseClient().auth.oauth.getAuthorizationDetails(
        authorizationId,
      );
    },
    approveAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.approveAuthorization(
        authorizationId,
      );
    },
    denyAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.denyAuthorization(authorizationId);
    },
  };
};
