import type { Identifier } from "ra-core";
import { useCreate, useGetList, useNotify, useRefresh, useTranslate } from "ra-core";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import type { Task, TaskDeliveryChannel, TaskTargetType } from "../types";
import {
  LINKABLE_TARGET_TYPES,
  RESOURCE_FOR_TARGET,
  TARGET_TYPE_LABEL,
  targetEntityLabel,
} from "./reminderEntity";

export interface ReminderCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BASE_DELIVERY_CHANNELS: TaskDeliveryChannel[] = ["in_app", "email"];

/** Options for the linked-entity select, fetched from whichever resource is picked. */
const useEntityOptions = (linkType: TaskTargetType) => {
  const { data, isPending } = useGetList(RESOURCE_FOR_TARGET[linkType], {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "created_at", order: "DESC" },
  });

  return useMemo(
    () => ({
      isPending,
      options: (data ?? []).map((record) => ({
        id: record.id as Identifier,
        ...targetEntityLabel(linkType, record as Record<string, unknown>),
      })),
    }),
    [data, isPending, linkType],
  );
};

/**
 * Create a reminder as a bottom sheet (design-language §5.2 glass chrome):
 * what, due date/time, and the linked entity it's about — mandatory, since
 * tasks.target_type/target_id are NOT NULL (AD-13). Delivery is a calm,
 * fixed in-app + email floor with an optional push add-on; there is
 * deliberately no SMS option, shown as reassurance rather than a control.
 */
export const ReminderCreateSheet = ({
  open,
  onOpenChange,
}: ReminderCreateSheetProps) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isSaving }] = useCreate<Task>();

  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [linkType, setLinkType] = useState<TaskTargetType>(
    LINKABLE_TARGET_TYPES[0],
  );
  const [targetId, setTargetId] = useState<Identifier | undefined>(undefined);
  const [withPush, setWithPush] = useState(false);

  const { options: entityOptions, isPending: optionsPending } =
    useEntityOptions(linkType);

  const handleTypeChange = (value: string) => {
    setLinkType(value as TaskTargetType);
    setTargetId(undefined);
  };

  const canSubmit =
    text.trim() !== "" && date !== "" && time !== "" && targetId != null;

  const resetForm = () => {
    setText("");
    setDate("");
    setTime("");
    setTargetId(undefined);
    setWithPush(false);
  };

  const handleSave = async () => {
    if (!canSubmit || isSaving) return;
    const dueDate = new Date(`${date}T${time}`);
    const delivery_channels: TaskDeliveryChannel[] = withPush
      ? [...BASE_DELIVERY_CHANNELS, "push"]
      : BASE_DELIVERY_CHANNELS;

    try {
      await create(
        "tasks",
        {
          data: {
            type: "reminder",
            text: text.trim(),
            due_date: dueDate.toISOString(),
            target_type: linkType,
            target_id: targetId,
            delivery_channels,
          },
        },
        { returnPromise: true },
      );
      resetForm();
      refresh();
      onOpenChange(false);
      notify(
        translate("crm.reminders.create.saved", { _: "Reminder added." }),
        { type: "success" },
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add the reminder",
        { type: "error" },
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto border-t-[--glass-border]
          bg-[--glass-bg] backdrop-blur-[var(--glass-blur)]"
      >
        <SheetHeader>
          <SheetTitle>
            {translate("crm.reminders.create.title", { _: "Add a reminder" })}
          </SheetTitle>
          <SheetDescription>
            {translate("crm.reminders.create.description", {
              _: "Pick what it's about, and when it should surface.",
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="reminder-text">
              {translate("crm.reminders.create.what", { _: "Remind me to..." })}
            </Label>
            <Textarea
              id="reminder-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              className="text-base"
              placeholder={translate("crm.reminders.create.whatPlaceholder", {
                _: "Call about the redt from last week",
              })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-date">
                {translate("crm.reminders.create.date", { _: "Due date" })}
              </Label>
              <Input
                id="reminder-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-time">
                {translate("crm.reminders.create.time", { _: "Time" })}
              </Label>
              <Input
                id="reminder-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reminder-link-type">
              {translate("crm.reminders.create.linkedTo", { _: "Linked to" })}
            </Label>
            <Select value={linkType} onValueChange={handleTypeChange}>
              <SelectTrigger id="reminder-link-type" className="min-h-[44px] w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINKABLE_TARGET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TARGET_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={targetId != null ? String(targetId) : ""}
              onValueChange={(value) => setTargetId(Number(value))}
              disabled={optionsPending || entityOptions.length === 0}
            >
              <SelectTrigger className="min-h-[44px] w-full">
                <SelectValue
                  placeholder={
                    optionsPending
                      ? translate("crm.reminders.create.loading", { _: "Loading…" })
                      : entityOptions.length === 0
                        ? translate("crm.reminders.create.noOptions", {
                            _: `No ${TARGET_TYPE_LABEL[linkType].toLowerCase()}s yet`,
                          })
                        : translate("crm.reminders.create.pick", {
                            _: `Pick a ${TARGET_TYPE_LABEL[linkType].toLowerCase()}`,
                          })
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {entityOptions.map((option) => (
                  <SelectItem key={String(option.id)} value={String(option.id)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/50 p-3">
            <p className="text-xs text-muted-foreground">
              {translate("crm.reminders.create.deliveryNote", {
                _: "Delivered in-app and by email. We never send SMS.",
              })}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={withPush}
                onCheckedChange={(checked) => setWithPush(checked === true)}
              />
              {translate("crm.reminders.create.pushToggle", {
                _: "Also send a push notification",
              })}
            </label>
          </div>
        </div>

        <SheetFooter className="border-t">
          <Button
            type="button"
            className="min-h-[48px] w-full text-base"
            disabled={!canSubmit || isSaving}
            onClick={handleSave}
          >
            {translate("crm.reminders.create.save", { _: "Add reminder" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
