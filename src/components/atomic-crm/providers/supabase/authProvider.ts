import type { AuthProvider } from "ra-core";
import { supabaseAuthProvider } from "ra-supabase-core";

import { canAccess } from "../commons/canAccess";
import { getSupabaseClient } from "./supabase";

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

// To speed up checks, we cache the initialization state
// and the current member in the local storage. They are cleared on logout.
const IS_INITIALIZED_CACHE_KEY = "RaStore.auth.is_initialized";
const CURRENT_MEMBER_CACHE_KEY = "RaStore.auth.current_member";

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export async function getIsInitialized() {
  const storage = getLocalStorage();
  const cachedValue = storage?.getItem(IS_INITIALIZED_CACHE_KEY);
  if (cachedValue != null) {
    return cachedValue === "true";
  }

  const { data } = await getSupabaseClient()
    .from("init_state")
    .select("is_initialized");
  const isInitialized = data?.at(0)?.is_initialized > 0;

  if (isInitialized) {
    storage?.setItem(IS_INITIALIZED_CACHE_KEY, "true");
  }

  return isInitialized;
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
  storage?.removeItem(IS_INITIALIZED_CACHE_KEY);
  storage?.removeItem(CURRENT_MEMBER_CACHE_KEY);
}

export const getAuthProvider = (): AuthProvider => {
  const baseAuthProvider = getBaseAuthProvider();
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
        const { error } = await getSupabaseClient().auth.signInWithOtp({
          email: params.email,
          options: {
            shouldCreateUser: params.allowSignup === true,
            data: params.meta,
          },
        });
        if (error) {
          // `shouldCreateUser: false` against an email with no existing
          // account rejects with GoTrue's "otp_disabled" code ("Signups not
          // allowed for otp" — verified against the local stack; despite the
          // name this is unrelated to project-level signup settings).
          // Swallowing only that code is what keeps an unknown email
          // indistinguishable from a known one client-side: both land on
          // the same "check your email" step, and the unknown one simply
          // never receives a code.
          if (error.code !== "otp_disabled") {
            throw error;
          }
        }
        return;
      }
      // Step two: verify the code the user typed back in.
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
      // No other login shape is supported — in particular, ra-supabase-core's
      // own password login (`baseAuthProvider.login`) must be unreachable.
      throw new Error("Unsupported login request.");
    },
    logout: async (params) => {
      clearCache();
      return baseAuthProvider.logout(params);
    },
    checkAuth: async (params) => {
      // Users are on the sign-up page, nothing to do
      if (
        window.location.pathname === "/sign-up" ||
        window.location.hash.includes("#/sign-up")
      ) {
        return;
      }

      const isInitialized = await getIsInitialized();

      if (!isInitialized) {
        await getSupabaseClient().auth.signOut();
        throw {
          redirectTo: "/sign-up",
          message: false,
        };
      }

      return baseAuthProvider.checkAuth(params);
    },
    canAccess: async (params) => {
      const isInitialized = await getIsInitialized();
      if (!isInitialized) return false;

      // Get the current user
      const member = await getMember();
      if (member == null) return false;

      // Compute access rights from the member role
      const role = member.administrator ? "admin" : "user";
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
