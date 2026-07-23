import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useDataProvider, useGetIdentity, useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";

/**
 * "Send a reset-password email" affordance, shared by the mobile and desktop
 * Settings surfaces so the two don't drift.
 */
export const ChangePasswordButton = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate: updatePassword } = useMutation({
    mutationKey: ["updatePassword"],
    mutationFn: async () => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.updatePassword(identity.id);
    },
    onSuccess: () => {
      notify("crm.profile.password_reset_sent", {
        messageArgs: {
          _: "A reset password email has been sent to your email address",
        },
      });
    },
    onError: (error: unknown) => {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    },
  });

  return (
    <Button
      variant="outline"
      className="h-auto w-full text-base"
      onClick={() => updatePassword()}
    >
      <KeyRound className="me-3 size-5" />
      {translate("crm.profile.password.change")}
    </Button>
  );
};
