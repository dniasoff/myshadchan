import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useForm, type SubmitHandler } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import type { SignUpData } from "../types";
import { LoginSkeleton } from "./LoginSkeleton";
import { AuthLayout } from "./AuthLayout";
import { PasswordToggleButton } from "./PasswordToggleButton";
import { AUTH_FIELD_CLASSNAME } from "./authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

export const SignupPage = () => {
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const navigate = useNavigate();
  const translate = useTranslate();
  const [isPasswordRevealed, setIsPasswordRevealed] = useState(false);
  const { data: isInitialized, isPending } = useQuery({
    queryKey: ["init"],
    queryFn: async () => {
      return dataProvider.isInitialized();
    },
  });

  const { isPending: isSignUpPending, mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SignUpData) => {
      return dataProvider.signUp(data);
    },
    onSuccess: () => {
      // `dataProvider.signUp()` already persisted a session client-side
      // (`enable_confirmations = false`), so no second `login()` call is
      // needed or possible here: `authProvider.login()` now throws on any
      // non-OTP shape (AC-8), which a follow-up `{ email, password }` login
      // would be.
      notify("crm.auth.signup.initial_user_created", {
        messageArgs: {
          _: "Initial user successfully created",
        },
      });
      // FIXME: We should probably provide a hook for that in the ra-core package
      queryClient.invalidateQueries({
        queryKey: ["auth", "canAccess"],
      });
      navigate("/");
    },
    onError: (error) => {
      notify(error.message);
    },
  });

  const notify = useNotify();

  const {
    register,
    handleSubmit,
    formState: { isValid },
  } = useForm<SignUpData>({
    mode: "onChange",
  });

  if (isPending) {
    return <LoginSkeleton />;
  }

  // For the moment, we only allow one user to sign up. Other users must be created by the administrator.
  if (isInitialized) {
    return <Navigate to="/login" />;
  }

  const onSubmit: SubmitHandler<SignUpData> = async (data) => {
    mutate(data);
  };

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
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {translate("crm.auth.signup.title", {
              _: "Create your family's record",
            })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("crm.auth.signup.subtitle", {
              _: "Set up the first account for your household.",
            })}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="first_name">
                {translate("crm.auth.first_name")}
              </Label>
              <Input
                {...register("first_name", { required: true })}
                id="first_name"
                type="text"
                autoComplete="given-name"
                className={AUTH_FIELD_CLASSNAME}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="last_name">
                {translate("crm.auth.last_name")}
              </Label>
              <Input
                {...register("last_name", { required: true })}
                id="last_name"
                type="text"
                autoComplete="family-name"
                className={AUTH_FIELD_CLASSNAME}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{translate("ra.auth.email")}</Label>
            <Input
              {...register("email", { required: true })}
              id="email"
              type="email"
              autoComplete="email"
              className={AUTH_FIELD_CLASSNAME}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{translate("ra.auth.password")}</Label>
            <div className="relative">
              <Input
                {...register("password", { required: true })}
                id="password"
                type={isPasswordRevealed ? "text" : "password"}
                autoComplete="new-password"
                className={cn(AUTH_FIELD_CLASSNAME, "pe-11")}
                required
              />
              <PasswordToggleButton
                isRevealed={isPasswordRevealed}
                onToggle={() => setIsPasswordRevealed((revealed) => !revealed)}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={!isValid || isSignUpPending}
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
          >
            {isSignUpPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {translate("crm.auth.signup.creating", {
                  _: "Creating...",
                })}
              </>
            ) : (
              translate("crm.auth.signup.create_account", {
                _: "Create account",
              })
            )}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
};

SignupPage.path = "/sign-up";
