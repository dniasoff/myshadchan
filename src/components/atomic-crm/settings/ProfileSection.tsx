import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useNotify,
  useTranslate,
} from "ra-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";

import ImageEditorField from "../misc/ImageEditorField";
import type { CrmDataProvider } from "../providers/types";
import type { SalesFormData } from "../types";
import { SectionLabel } from "./SectionLabel";

/** Avatar + tap-to-edit name/email rows — the mobile Settings account card. */
export const ProfileSection = () => {
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("sales", {
    id: identity?.id,
  });
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();

  const saveField = useCallback(
    async (field: string, value: string) => {
      if (!identity || !data) return;
      const current = data[field as keyof typeof data];
      if (value === current) return;

      const queryKey = [
        "sales",
        "getOne",
        { id: String(identity.id), meta: undefined },
      ];
      const previousData = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: any) =>
        old ? { ...old, [field]: value } : old,
      );

      try {
        await dataProvider.salesUpdate(identity.id, {
          ...data,
          [field]: value,
        } as SalesFormData);
        refetchIdentity();
        refetchUser();
        notify("crm.profile.updated", {
          messageArgs: { _: "Your profile has been updated" },
        });
      } catch {
        queryClient.setQueryData(queryKey, previousData);
        notify("crm.profile.update_error", {
          type: "error",
          messageArgs: { _: "An error occurred. Please try again" },
        });
      }
    },
    [
      identity,
      data,
      dataProvider,
      refetchIdentity,
      refetchUser,
      notify,
      queryClient,
    ],
  );

  const handleAvatarUpdate = useCallback(
    async (values: SalesFormData) => {
      if (!data) return;
      try {
        await dataProvider.salesUpdate(data.id, values);
        refetchIdentity();
        refetchUser();
        notify("crm.profile.updated", {
          messageArgs: { _: "Your profile has been updated" },
        });
      } catch {
        notify("crm.profile.update_error", {
          type: "error",
          messageArgs: { _: "An error occurred. Please try again." },
        });
      }
    },
    [data, dataProvider, refetchIdentity, refetchUser, notify],
  );

  if (!identity || !data) return null;

  return (
    <div>
      <SectionLabel>
        {translate("crm.profile.title", { _: "Profile" })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Form record={data}>
          <Item size="sm">
            <ItemContent>
              <ImageEditorField
                source="avatar"
                type="avatar"
                onSave={handleAvatarUpdate}
                linkPosition="right"
              />
            </ItemContent>
          </Item>
        </Form>

        <ItemSeparator />

        <InlineEditRow
          label={translate("resources.sales.fields.first_name")}
          value={data.first_name ?? ""}
          onSave={(v) => saveField("first_name", v)}
        />

        <ItemSeparator />

        <InlineEditRow
          label={translate("resources.sales.fields.last_name")}
          value={data.last_name ?? ""}
          onSave={(v) => saveField("last_name", v)}
        />

        <ItemSeparator />

        <InlineEditRow
          label={translate("resources.sales.fields.email")}
          value={data.email ?? ""}
          onSave={(v) => saveField("email", v)}
        />
      </ItemGroup>
    </div>
  );
};

const InlineEditRow = ({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
  }, [editValue, value, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (isEditing) {
    return (
      <Item size="sm">
        <ItemContent>
          <ItemTitle className="font-normal text-muted-foreground">
            {label}
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="bg-transparent text-end !text-base outline-none w-48"
          />
        </ItemActions>
      </Item>
    );
  }

  return (
    <Item
      size="sm"
      className="cursor-pointer"
      onClick={() => setIsEditing(true)}
    >
      <ItemContent>
        <ItemTitle className="font-normal text-muted-foreground">
          {label}
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <span className="text-base">{value}</span>
      </ItemActions>
    </Item>
  );
};
