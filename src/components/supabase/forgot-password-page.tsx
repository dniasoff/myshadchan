import { useState } from "react";
import { useResetPassword } from "ra-supabase-core";
import { Form, required, useNotify, useRedirect, useTranslate } from "ra-core";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import { AuthLayout } from "@/components/atomic-crm/login/AuthLayout";
import { AUTH_FIELD_CLASSNAME } from "@/components/atomic-crm/login/authFieldClassName";
import { PRIMARY_CTA_CLASSNAME } from "@/components/atomic-crm/login/primaryCtaClassName";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormData {
  email: string;
}

export const ForgotPasswordPage = () => {
  const [loading, setLoading] = useState(false);

  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();
  const [, { mutateAsync: resetPassword }] = useResetPassword({
    onSuccess: () => {
      redirect("/login?passwordRecoveryEmailSent=1");
    },
    onError: () => undefined,
  });

  const submit = async (values: FormData) => {
    try {
      setLoading(true);
      await resetPassword({
        email: values.email,
      });
    } catch (error: unknown) {
      notify(
        typeof error === "string"
          ? error
          : typeof error === "undefined" ||
              !(error instanceof Error) ||
              !error.message
            ? "ra.auth.sign_in_error"
            : error.message,
        {
          type: "warning",
          messageArgs: {
            _:
              typeof error === "string"
                ? error
                : error instanceof Error && error.message
                  ? error.message
                  : undefined,
          },
        },
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {translate("ra-supabase.reset_password.forgot_password", {
              _: "Forgot password?",
            })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("ra-supabase.reset_password.forgot_password_details", {
              _: "Enter your email to receive a reset password link.",
            })}
          </p>
        </div>
        <Form<FormData>
          className="space-y-4"
          onSubmit={submit as SubmitHandler<FieldValues>}
        >
          <TextInput
            source="email"
            label={translate("ra.auth.email", {
              _: "Email",
            })}
            type="email"
            autoComplete="email"
            inputClassName={AUTH_FIELD_CLASSNAME}
            validate={required()}
          />
          <Button
            type="submit"
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={loading}
          >
            {translate("crm.action.reset_password", {
              _: "Reset password",
            })}
          </Button>
        </Form>
      </div>
    </AuthLayout>
  );
};

ForgotPasswordPage.path = "forgot-password";
