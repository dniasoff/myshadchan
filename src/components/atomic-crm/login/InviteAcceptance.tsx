import { useState } from "react";
import { Loader2, Lock, UserPlus } from "lucide-react";
import {
  Form,
  required,
  useAuthProvider,
  useDataProvider,
  useNotify,
  useTranslate,
} from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import type { InvitePreview } from "../types";
import { AgeNotice } from "./AgeNotice";
import { AuthLayout } from "./AuthLayout";
import { LoginSkeleton } from "./LoginSkeleton";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

type InviteStep = "affirm" | "code";

/**
 * The invitee's ONLY path into the product (Story 2.7, AD-11/FR119). Reached
 * at /accept-invite/:token, unauthenticated. Looks up the invite via the
 * anon-callable get_invite_preview() (never the inviting account's own
 * data), then completes Story 2.6's email-OTP signup with
 * `allowSignup: true` and the invite token riding in `meta` —
 * the only caller in the product that ever passes `allowSignup: true`
 * (2.6's LoginPage hard-defaults `shouldCreateUser` to false). `email` is
 * read-only, taken from the invite, never typed by the invitee — there is
 * no email input anywhere in this component, unlike LoginPage's two-step
 * form.
 *
 * An invite that is not `pending` (expired, already accepted, revoked, or
 * simply not found) renders a clear, specific message instead of the
 * affirmation/OTP flow — get_invite_preview() returns no inviter name, so
 * the copy never promises one.
 *
 * Review finding #4: the invite is bound to a real membership and marked
 * `accepted` by `accept_invite()`, called here right after `verifyOtp()`
 * succeeds — never by the earlier OTP-request step. Requesting a code
 * (`authProvider.login({ requestOtp: true, ... })` in `requestCode()` below)
 * already creates the `auth.users` row; without this split, anyone who
 * merely obtained the invite link could burn it before ever proving mailbox
 * control, leaving the real invitee locked out with "this invite has
 * already been used."
 */
export const InviteAcceptance = () => {
  const { token } = useParams<{ token: string }>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const authProvider = useAuthProvider();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const translate = useTranslate();
  const [step, setStep] = useState<InviteStep>("affirm");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const {
    data: invite,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: (): Promise<InvitePreview | null> =>
      dataProvider.getInvitePreview(token ?? ""),
    enabled: !!token,
  });

  const requestCode = () => {
    if (!authProvider || !invite || !token) {
      return Promise.reject(new Error("Authentication is not configured."));
    }
    return authProvider.login({
      email: invite.email,
      requestOtp: true,
      allowSignup: true,
      meta: { invite_token: token },
    });
  };

  const handleAffirm = () => {
    setIsRequesting(true);
    requestCode()
      .then(() => setStep("code"))
      .catch((error: unknown) => {
        notify(
          error instanceof Error ? error.message : "ra.auth.sign_in_error",
          {
            type: "error",
          },
        );
      })
      .finally(() => setIsRequesting(false));
  };

  // Guarded and flagged in flight, same as `LoginPage.handleResend()`: an
  // un-disabled "Resend code" on a slow mobile connection gets tapped again
  // and again, and each tap is another OTP request until Supabase rate-limits
  // the invitee out of the invite they are in the middle of accepting.
  const handleResend = () => {
    if (isResending) {
      return;
    }
    setIsResending(true);
    requestCode()
      .then(() => {
        notify("crm.auth.login.code_resent", {
          messageArgs: { _: "Code sent again" },
        });
      })
      .catch((error: unknown) => {
        notify(
          error instanceof Error ? error.message : "ra.auth.sign_in_error",
          {
            type: "error",
          },
        );
      })
      .finally(() => setIsResending(false));
  };

  // Review finding #4 (2.7): calls `authProvider.login()` directly rather
  // than ra-core's `useLogin()` wrapper, and navigates only after
  // `acceptInvite()` resolves. `useLogin()`'s own callback navigates the
  // instant `authProvider.login()` resolves (before returning control to
  // this component), which would race this component's post-verify
  // `acceptInvite()` call — the invite must be bound and marked accepted
  // BEFORE landing in the app shell, not after, or `OnboardingGate` could
  // flash its welcome screen for the split second the membership doesn't
  // exist yet.
  //
  // Invalidates `['auth']` (covering ra-core's `useAuthState()` query,
  // `['auth', 'checkAuth', ...]`) before navigating — found empirically via
  // a live e2e run: this route's `checkAuth()` had already been called
  // (and cached as unauthenticated) once on mount, since `chrome: "bare"`
  // routes still sit under `<Admin requireAuth>`'s top-level auth-state
  // observer. Landing on "/" right after a real login reused that STALE
  // cached "unauthenticated" result (react-query only refetches on a fresh
  // mount or explicit invalidation, neither of which a same-instance
  // client-side `navigate()` triggers on its own) — `requireAuth`'s
  // `logoutOnFailure` then fired an immediate, silent logout. Reproduced
  // and fixed against the running e2e stack, not merely reasoned about:
  // without this invalidation, `npx playwright test
  // e2e/invite-acceptance.spec.ts` failed exactly as the review predicted.
  // 2.6's own `LoginPage` never trips this because its `/login` route is
  // `<Admin>`'s OWN internal unauthenticated view (never previously
  // rendered while cached-false), not a bare custom route reached before
  // any auth check ever ran.
  const handleVerifyCode: SubmitHandler<FieldValues> = (values) => {
    if (!invite || !token || !authProvider) return;
    setIsVerifying(true);
    (async () => {
      await authProvider.login({
        email: invite.email,
        token: values.token,
        verifyOtp: true,
      });
      await dataProvider.acceptInvite(token);
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      navigate("/");
    })().catch((error: unknown) => {
      notify(
        error instanceof Error ? error.message : "crm.auth.login.invalid_code",
        { type: "error" },
      );
      setIsVerifying(false);
    });
  };

  if (!token || isPending) {
    return <LoginSkeleton />;
  }

  if (isError || !invite || invite.status !== "pending") {
    return (
      <AuthLayout>
        <InviteUnavailableMessage status={invite?.status} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden="true" />
          {translate("crm.auth.footer_private", {
            _: "Private to your family",
          })}
        </span>
      }
    >
      {step === "affirm" ? (
        <div className="space-y-6">
          <InvitePreviewSummary invite={invite} />
          <Button
            type="button"
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={isRequesting}
            onClick={handleAffirm}
          >
            {translate("crm.auth.continue", { _: "Continue" })}
          </Button>
          <AgeNotice />
          {isRequesting ? (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {translate("crm.auth.invite_sending_code", {
                _: "Sending your code…",
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-center">
            {/* h1: the affirm step's heading (InvitePreviewSummary) is an h1
                and this step replaces it, so an h2 left the code step with no
                top-level heading at all. */}
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {translate("crm.auth.login.title", { _: "Welcome back" })}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {translate("crm.auth.login.code_sent_to", {
                email: invite.email,
                _: "We sent a 6-digit code to %{email}.",
              })}
            </p>
          </div>

          <Form className="space-y-4" onSubmit={handleVerifyCode}>
            <TextInput
              label="crm.auth.login.code_label"
              source="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              inputClassName={AUTH_FIELD_CLASSNAME}
              validate={required()}
            />
            <Button
              type="submit"
              className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
              disabled={isVerifying}
            >
              {isVerifying ? (
                <Loader2
                  className="me-2 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {translate("ra.auth.sign_in")}
            </Button>
            <div className="flex items-center justify-center text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={isResending}
                className="text-muted-foreground hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResending ? (
                  <Loader2
                    className="me-1 inline size-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {translate("crm.auth.login.resend_code", {
                  _: "Resend code",
                })}
              </button>
            </div>
          </Form>
        </div>
      )}
    </AuthLayout>
  );
};

InviteAcceptance.path = "/accept-invite/:token";

/**
 * Human wording for `invites.role`. `get_invite_preview()` returns the raw
 * database enum, and interpolating that straight into the sentence below put
 * "…on MyShadchan as a parent_admin." on the very first screen an invitee ever
 * sees. The indefinite article stays in `crm.auth.invite_body`, so these are
 * bare nouns, not "a parent". `InvitePreview.role` is typed `string` (the RPC
 * is anon-callable and returns whatever the row holds), hence the fallback
 * rather than an exhaustive `Record<MemberRole, …>`.
 */
const ROLE_LABELS: Record<string, { key: string; fallback: string }> = {
  parent_admin: {
    key: "crm.auth.invite_role_parent_admin",
    fallback: "parent",
  },
  helper: { key: "crm.auth.invite_role_helper", fallback: "helper" },
  shadchan: { key: "crm.auth.invite_role_shadchan", fallback: "shadchan" },
  single: { key: "crm.auth.invite_role_single", fallback: "single" },
};

const UNKNOWN_ROLE_LABEL = {
  key: "crm.auth.invite_role_member",
  fallback: "member",
};

const InvitePreviewSummary = ({ invite }: { invite: InvitePreview }) => {
  const translate = useTranslate();
  const roleLabel = ROLE_LABELS[invite.role] ?? UNKNOWN_ROLE_LABEL;

  return (
    <div className="space-y-2 text-center">
      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
        style={{
          background: "color-mix(in oklch, var(--violet) 16%, transparent)",
        }}
      >
        <UserPlus
          className="size-6"
          style={{ color: "var(--violet)" }}
          aria-hidden="true"
        />
      </div>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {translate("crm.auth.invite_title", { _: "You've been invited" })}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {translate("crm.auth.invite_body", {
          _: "Join %{accountName} on MyShadchan as a %{role}.",
          accountName: invite.account_name,
          role: translate(roleLabel.key, { _: roleLabel.fallback }),
        })}
      </p>
      <p className="text-xs text-muted-foreground/80">{invite.email}</p>
    </div>
  );
};

/**
 * Renders when the invite is anything other than currently-pending: not
 * found (no row for this token), expired, already accepted, or revoked.
 * get_invite_preview() returns no inviter name, so none of these promise one.
 */
const InviteUnavailableMessage = ({
  status,
}: {
  status?: InvitePreview["status"];
}) => {
  const translate = useTranslate();
  const { title, body } = (() => {
    switch (status) {
      case "expired":
        return {
          title: translate("crm.auth.invite_expired_title", {
            _: "This invite has expired",
          }),
          body: translate("crm.auth.invite_expired_body", {
            _: "Ask the person who invited you for a new one.",
          }),
        };
      case "accepted":
        return {
          title: translate("crm.auth.invite_accepted_title", {
            _: "This invite has already been used",
          }),
          body: translate("crm.auth.invite_accepted_body", {
            _: "Sign in instead, or ask the person who invited you for a new invite.",
          }),
        };
      case "revoked":
        return {
          title: translate("crm.auth.invite_revoked_title", {
            _: "This invite has been revoked",
          }),
          body: translate("crm.auth.invite_revoked_body", {
            _: "Ask the person who invited you for a new one.",
          }),
        };
      default:
        return {
          title: translate("crm.auth.invite_not_found_title", {
            _: "This invite link isn't valid",
          }),
          body: translate("crm.auth.invite_not_found_body", {
            _: "Ask the person who invited you to send a new one.",
          }),
        };
    }
  })();

  return (
    <div className="space-y-2 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
};
