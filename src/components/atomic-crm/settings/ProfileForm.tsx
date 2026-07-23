import { useMutation } from "@tanstack/react-query";
import { CircleX, KeyRound, Pencil, Save } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useNotify,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useFormState } from "react-hook-form";

import { RecordField } from "@/components/admin/record-field";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import ImageEditorField from "../misc/ImageEditorField";
import type { CrmDataProvider } from "../providers/types";
import type { Sale, SalesFormData } from "../types";
import { LanguageSelector } from "./LanguageSelector";

export interface ProfileFormProps {
  isEditMode: boolean;
  setEditMode: (value: boolean) => void;
}

/**
 * The account card (design-artifacts ticket lane 7): avatar, name, email,
 * and the prominent language toggle — one QL card, one primary action
 * (Save while editing), subordinate secondaries otherwise.
 */
export const ProfileForm = ({ isEditMode, setEditMode }: ProfileFormProps) => {
  const notify = useNotify();
  const translate = useTranslate();
  const record = useRecordContext<Sale>();
  const { identity, refetch } = useGetIdentity();
  const { isDirty } = useFormState();
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

  const { mutate: mutateSale } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(record.id, data);
    },
    onSuccess: () => {
      refetch();
      notify("crm.profile.updated", {
        messageArgs: { _: "Your profile has been updated" },
      });
    },
    onError: () => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: { _: "An error occurred. Please try again." },
      });
    },
  });

  if (!identity) return null;

  return (
    <Card className="gap-5 rounded-2xl border-border p-6 shadow-sm">
      <CardContent className="space-y-5 p-0">
        <p className="text-sm text-muted-foreground">
          {translate("crm.profile.subtitle", {
            _: "Your account details.",
          })}
        </p>

        <div className="space-y-4">
          <ImageEditorField
            source="avatar"
            type="avatar"
            onSave={(values: SalesFormData) => mutateSale(values)}
            linkPosition="right"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextRender source="first_name" isEditMode={isEditMode} />
            <TextRender source="last_name" isEditMode={isEditMode} />
          </div>
          <TextRender source="email" isEditMode={isEditMode} />
          <LanguageSelector />
        </div>

        <div className="flex flex-row-reverse flex-wrap items-center justify-start gap-2 border-t border-border pt-5">
          {isEditMode ? (
            <Button
              type="submit"
              disabled={!isDirty}
              className="text-primary-foreground
                bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
                shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
                transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
                hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
                active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
            >
              <Save />
              {translate("ra.action.save")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditMode(true)}
            >
              <Pencil />
              {translate("ra.action.edit")}
            </Button>
          )}

          {isEditMode ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditMode(false)}
            >
              <CircleX />
              {translate("ra.action.cancel")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              type="button"
              onClick={() => updatePassword()}
            >
              <KeyRound />
              {translate("crm.profile.password.change")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const TextRender = ({
  source,
  isEditMode,
  className,
}: {
  source: string;
  isEditMode: boolean;
  className?: string;
}) => {
  const label = `resources.sales.fields.${source}`;
  if (isEditMode) {
    return (
      <TextInput
        source={source}
        label={label}
        helperText={false}
        className={className}
      />
    );
  }
  return (
    <div className={className}>
      <RecordField source={source} label={label} />
    </div>
  );
};
