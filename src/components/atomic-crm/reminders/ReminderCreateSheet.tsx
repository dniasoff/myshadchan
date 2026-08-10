import type { Identifier } from "ra-core";
import {
  useCreate,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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

import { TaskAssigneeSelect } from "../tasks/TaskAssigneeSelect";
import type {
  DeliveryChannel,
  ShidduchSummary,
  Task,
  TaskTargetType,
} from "../types";
import {
  LINKABLE_TARGET_TYPES,
  TARGET_TYPE_LABEL,
  TARGET_TYPE_LABEL_PLURAL,
} from "./reminderEntity";
import {
  requiresShidduchScope,
  useReminderTargetOptions,
} from "./useReminderTargetOptions";

export interface ReminderCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BASE_DELIVERY_CHANNELS: DeliveryChannel[] = ["in_app", "email"];

/** The shidduchim offered as the scope for a reference-linked reminder
 * (RULING 7 — see `useReminderTargetOptions`). Shidduchim are browsable, so a
 * plain roster is legitimate here. */
const useShidduchOptions = (enabled: boolean) => {
  const { data, isPending } = useGetList<ShidduchSummary>(
    "shidduchim",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled },
  );

  return useMemo(
    () => ({
      isPending,
      options: (data ?? []).map((record) => ({
        id: record.id as Identifier,
        label: record.name_en || "Shidduch",
      })),
    }),
    [data, isPending],
  );
};

/**
 * Create a reminder as a bottom sheet (design-language §5.2 glass chrome):
 * what, due date/time, and the linked entity it's about — mandatory, since
 * tasks.target_type/target_id are NOT NULL (AD-13). Delivery is a calm,
 * fixed in-app + email floor — there is deliberately no push option (Story
 * 12.2, AC-3: `task_notifications.channel` is structurally `'email'` only,
 * so a client-offered push toggle would silently queue undeliverable rows)
 * and deliberately no SMS option either, both shown as reassurance rather
 * than a control.
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
  const [shidduchId, setShidduchId] = useState<Identifier | undefined>(
    undefined,
  );
  // AC-3: defaults to the caller's own row (`defaultToSelf` on
  // TaskAssigneeSelect) — a reminder you create for yourself must stay a
  // one-tap flow. `undefined` here means "not yet resolved"; it becomes the
  // caller's own id, or whatever the user explicitly picks (including
  // Unassigned -> null).
  const [memberId, setMemberId] = useState<Identifier | null | undefined>(
    undefined,
  );

  const needsShidduch = requiresShidduchScope(linkType);
  const { options: shidduchOptions, isPending: shidduchPending } =
    useShidduchOptions(needsShidduch);
  const {
    options: entityOptions,
    isPending: optionsPending,
    awaitingShidduch,
  } = useReminderTargetOptions(linkType, shidduchId);

  const handleTypeChange = (value: string) => {
    setLinkType(value as TaskTargetType);
    setTargetId(undefined);
    setShidduchId(undefined);
  };

  const handleShidduchChange = (value: string) => {
    setShidduchId(Number(value));
    // The previously-picked reference may not be attached to the new
    // shidduch — never carry it across a scope change.
    setTargetId(undefined);
  };

  const canSubmit =
    text.trim() !== "" && date !== "" && time !== "" && targetId != null;

  const resetForm = () => {
    setText("");
    setDate("");
    setTime("");
    setTargetId(undefined);
    setShidduchId(undefined);
    setMemberId(undefined);
  };

  const handleSave = async () => {
    if (!canSubmit || isSaving) return;
    const dueDate = new Date(`${date}T${time}`);

    const data: Partial<Task> = {
      type: "reminder",
      text: text.trim(),
      due_date: dueDate.toISOString(),
      target_type: linkType,
      target_id: targetId,
      // AC-3: unconditional — the push channel is never offered, so there is
      // nothing left to branch on.
      delivery_channels: BASE_DELIVERY_CHANNELS,
      // AC-3: omitted only if the self-default effect somehow hasn't
      // resolved yet — the server's own if-null default then applies, same
      // as before this story.
      ...(memberId !== undefined ? { member_id: memberId } : {}),
    };

    try {
      await create("tasks", { data }, { returnPromise: true });
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
        className="max-h-[92vh] overflow-y-auto border-t-[var(--glass-border)]
          bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]"
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
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reminder-link-type">
              {translate("crm.reminders.create.linkedTo", { _: "Linked to" })}
            </Label>
            <Select value={linkType} onValueChange={handleTypeChange}>
              <SelectTrigger id="reminder-link-type" className="w-full">
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

            {/* RULING 7: a reference is only reachable through a shidduch, so
                the reference picker is gated behind one. */}
            {needsShidduch && (
              <Select
                value={shidduchId != null ? String(shidduchId) : ""}
                onValueChange={handleShidduchChange}
                disabled={shidduchPending || shidduchOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={translate(
                      "crm.reminders.create.pickShidduch",
                      { _: "Pick a shidduch first" },
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {shidduchOptions.map((option) => (
                    <SelectItem
                      key={String(option.id)}
                      value={String(option.id)}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={targetId != null ? String(targetId) : ""}
              onValueChange={(value) => setTargetId(Number(value))}
              disabled={
                awaitingShidduch || optionsPending || entityOptions.length === 0
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    awaitingShidduch
                      ? translate("crm.reminders.create.shidduchFirst", {
                          _: "Pick a shidduch first",
                        })
                      : optionsPending
                        ? translate("crm.reminders.create.loading", {
                            _: "Loading…",
                          })
                        : entityOptions.length === 0
                          ? translate("crm.reminders.create.noOptions", {
                              _: `No ${TARGET_TYPE_LABEL_PLURAL[linkType]} yet`,
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

          {/* AC-3: defaults to "me" — see the memberId state's own comment. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="reminder-assignee">
              {translate("crm.tasks.assignee.label", { _: "Assignee" })}
            </Label>
            <TaskAssigneeSelect
              id="reminder-assignee"
              value={memberId}
              onChange={setMemberId}
              defaultToSelf
            />
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/50 p-3">
            {/* Story 12.2 (AC-3), amended by the 12.3 cross-reconciliation
                (F3): must name the RECIPIENT, not just "by email" — 12.3
                made member_id the assignee and does not track the creator,
                so assigning a reminder to someone else silently redirects
                the only notification away from whoever created it. This
                line is what makes that redirection visible before save. */}
            <p className="text-xs text-muted-foreground">
              {translate("crm.reminders.create.deliveryNote", {
                _: "Delivered in-app, and by email to the person it is assigned to. We never send SMS.",
              })}
            </p>
          </div>
        </div>

        <SheetFooter className="border-t">
          <Button
            type="button"
            className="min-h-[48px] md:min-h-[48px] w-full text-base"
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
