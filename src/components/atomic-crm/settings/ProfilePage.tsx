import { useMutation } from "@tanstack/react-query";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import type { FieldValues } from "react-hook-form";

import type { CrmDataProvider } from "../providers/types";
import type { SalesFormData } from "../types";
import { ProfileForm } from "./ProfileForm";

/**
 * Desktop /profile — the signed-in user's own account details (design-artifacts
 * ticket lane 7, screens 37-39). The MCP-server and inbound-email cards that
 * shipped with the Atomic CRM template were developer plumbing, not
 * parent-facing, and have been removed from this surface (the inbound-email
 * edge function itself is untouched — only its exposure here is gone).
 */
export const ProfilePage = () => {
  const [isEditMode, setEditMode] = useState(false);
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("sales", {
    id: identity?.id,
  });
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (values: SalesFormData) => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(identity.id, values);
    },
    onSuccess: () => {
      refetchIdentity();
      refetchUser();
      setEditMode(false);
      notify("crm.profile.updated", {
        messageArgs: { _: "Your profile has been updated" },
      });
    },
    onError: () => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: { _: "An error occurred. Please try again" },
      });
    },
  });

  if (!identity) {
    return (
      <div className="mx-auto mt-8 max-w-lg space-y-4">
        <div className="h-56 animate-pulse rounded-2xl bg-secondary/50" />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-lg space-y-6 px-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.profile.eyebrow", { _: "Account" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold tracking-tight">
          {translate("crm.profile.title", { _: "Profile" })}
        </h1>
      </div>
      <Form
        onSubmit={(values: FieldValues) => mutate(values as SalesFormData)}
        record={data}
      >
        <ProfileForm isEditMode={isEditMode} setEditMode={setEditMode} />
      </Form>
    </div>
  );
};

ProfilePage.path = "/profile";
