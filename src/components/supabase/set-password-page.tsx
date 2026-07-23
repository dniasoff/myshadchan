import { useState } from "react";
import { Form, required, useNotify, useTranslate } from "ra-core";
import { useSetPassword, useSupabaseAccessToken } from "ra-supabase-core";
import { AuthLayout } from "@/components/atomic-crm/login/AuthLayout";
import { PasswordInput } from "@/components/atomic-crm/login/PasswordInput";
import { PRIMARY_CTA_CLASSNAME } from "@/components/atomic-crm/login/primaryCtaClassName";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SetPasswordFormData {
  password: string;
  confirmPassword: string;
}

export const SetPasswordPage = () => {
  const [loading, setLoading] = useState(false);

  const access_token = useSupabaseAccessToken();
  const refresh_token = useSupabaseAccessToken({
    parameterName: "refresh_token",
  });

  const notify = useNotify();
  const translate = useTranslate();
  const [, { mutateAsync: setPassword }] = useSetPassword();

  const validate = (values: SetPasswordFormData) => {
    if (values.password !== values.confirmPassword) {
      return {
        password: "ra-supabase.validation.password_mismatch",
        confirmPassword: "ra-supabase.validation.password_mismatch",
      };
    }
    return {};
  };

  if (!access_token || !refresh_token) {
    if (process.env.NODE_ENV === "development") {
      console.error("Missing access_token or refresh_token for set password");
    }
    return (
      <AuthLayout>
        <p className="text-center text-sm text-muted-foreground">
          {translate("ra-supabase.auth.missing_tokens")}
        </p>
      </AuthLayout>
    );
  }

  const submit = async (values: SetPasswordFormData) => {
    try {
      setLoading(true);
      await setPassword({
        access_token,
        refresh_token,
        password: values.password,
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
        <h1 className="text-center font-display text-2xl font-bold tracking-tight">
          {translate("ra-supabase.set_password.new_password", {
            _: "Choose your password",
          })}
        </h1>
        <Form
          className="space-y-4"
          onSubmit={submit as any}
          validate={validate as any}
        >
          <PasswordInput
            label={translate("ra.auth.password", {
              _: "Password",
            })}
            autoComplete="new-password"
            source="password"
            validate={required()}
          />
          <PasswordInput
            label={translate("crm.auth.confirm_password", {
              _: "Confirm password",
            })}
            autoComplete="new-password"
            source="confirmPassword"
            validate={required()}
          />
          <Button
            type="submit"
            className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
            disabled={loading}
          >
            {translate("ra.action.save")}
          </Button>
        </Form>
      </div>
    </AuthLayout>
  );
};

SetPasswordPage.path = "set-password";
