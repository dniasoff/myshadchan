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
import { Skeleton } from "@/components/ui/skeleton";

import ImageEditorField from "../misc/ImageEditorField";
import type { CrmDataProvider } from "../providers/types";
import type { MemberFormData } from "../types";
import { SectionLabel } from "./SectionLabel";

/** Avatar + tap-to-edit name/email rows — the mobile Settings account card. */
export const ProfileSection = () => {
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("members", {
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
        "members",
        "getOne",
        { id: String(identity.id), meta: undefined },
      ];
      const previousData = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: any) =>
        old ? { ...old, [field]: value } : old,
      );

      try {
        await dataProvider.memberUpdate(identity.id, {
          ...data,
          [field]: value,
        } as MemberFormData);
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
    async (values: MemberFormData) => {
      if (!data) return;
      try {
        await dataProvider.memberUpdate(data.id, values);
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

  // Bug: this used to `return null` while `useGetIdentity()` /
  // `useGetOne("members", …)` were in flight, so the card popped in ~50-100ms
  // after first paint and pushed every section below it down by its own
  // height (measured 0.33-0.42 CLS on a cold mobile load — see
  // fix-mobile-cls.mjs's diagnosis). `ProfileSectionSkeleton` reserves the
  // same footprint up front (same `Item`/`ItemGroup` primitives, same
  // translated field labels — only the fetched values are placeholders) so
  // the real content lands in a slot that's already the right size.
  if (!identity || !data) return <ProfileSectionSkeleton />;

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
          label={translate("resources.members.fields.first_name")}
          value={data.first_name ?? ""}
          onSave={(v) => saveField("first_name", v)}
        />

        <ItemSeparator />

        <InlineEditRow
          label={translate("resources.members.fields.last_name")}
          value={data.last_name ?? ""}
          onSave={(v) => saveField("last_name", v)}
        />

        <ItemSeparator />

        <InlineEditRow
          label={translate("resources.members.fields.email")}
          value={data.email ?? ""}
          onSave={(v) => saveField("email", v)}
        />
      </ItemGroup>
    </div>
  );
};

/**
 * Placeholder for `ProfileSection` while identity/member data is in flight.
 * Mirrors the settled card's exact structure (`SectionLabel` + `ItemGroup`
 * of four `Item size="sm"` rows) so the two never differ in height: the
 * avatar circle is reserved at the same 50px `AVATAR_SIZE` ImageEditorField
 * renders, and each field row keeps its real translated label — only the
 * fetched value (name/email) is a placeholder — with the value skeleton's
 * height matched to the real value's `text-base` line box so swapping it
 * for real text does not change the row's height either.
 */
const ProfileSectionSkeleton = () => {
  const translate = useTranslate();

  return (
    <div>
      <SectionLabel>
        {translate("crm.profile.title", { _: "Profile" })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Item size="sm">
          <ItemContent>
            <div className="flex flex-row items-center gap-2">
              <Skeleton className="size-[50px] rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          </ItemContent>
        </Item>

        <ItemSeparator />

        <ProfileFieldRowSkeleton
          label={translate("resources.members.fields.first_name")}
        />

        <ItemSeparator />

        <ProfileFieldRowSkeleton
          label={translate("resources.members.fields.last_name")}
        />

        <ItemSeparator />

        <ProfileFieldRowSkeleton
          label={translate("resources.members.fields.email")}
        />
      </ItemGroup>
    </div>
  );
};

const ProfileFieldRowSkeleton = ({ label }: { label: string }) => (
  <Item size="sm">
    <ItemContent>
      <ItemTitle className="font-normal text-muted-foreground">
        {label}
      </ItemTitle>
    </ItemContent>
    <ItemActions>
      <Skeleton className="h-6 w-20" />
    </ItemActions>
  </Item>
);

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
        <ItemContent className="flex-none">
          <ItemTitle className="font-normal text-muted-foreground">
            {label}
          </ItemTitle>
        </ItemContent>
        {/* Same geometry as the settled row below, so tapping a row never
            changes its width or height — only what it contains. */}
        <ItemActions className="min-w-0 flex-1 justify-end">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full min-w-0 bg-transparent text-end !text-base outline-none"
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
      <ItemContent className="flex-none">
        <ItemTitle className="font-normal text-muted-foreground">
          {label}
        </ItemTitle>
      </ItemContent>
      {/* `truncate` keeps this row single-line even for a long email —
          without it, a value wide enough to not fit beside the label wraps
          the whole `ItemActions` flex item onto a second line (`Item`'s own
          `flex-wrap`), making the row ~30px taller than its skeleton
          counterpart and reintroducing exactly the kind of late shift this
          component was fixed to avoid. That is why the truncation stays.

          What changed: the cap used to be a hard `max-w-40` (160px), which
          at 390px cut the user's own email down to `routes-178528194…` while
          ~90px of the row sat empty. `flex-1 min-w-0` is the same guarantee
          — a flex item that may shrink below its content width can never
          force a wrap — but it spends the whole remaining line on the value
          instead of a fixed 160px. `flex-none` on the label stops
          `ItemContent`'s own `flex-1` from claiming that space first.
          `title` restores the full value on hover for pointer users; the
          value is unabridged in the DOM either way, so assistive tech and
          `getByText` both still see all of it. */}
      <ItemActions className="min-w-0 flex-1 justify-end">
        <span className="min-w-0 truncate text-base" title={value}>
          {value}
        </span>
      </ItemActions>
    </Item>
  );
};
