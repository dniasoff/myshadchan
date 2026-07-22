import { useState } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CallStatus, ReferenceLinkSummary } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { CALL_STATUS_DESCRIPTORS } from "./callStatus";

/**
 * Mid-call capture (§5c, NFR-1). This is used with a phone against one ear, so
 * it is built for one thumb: status is four big chip buttons rather than a
 * select, there is exactly one text field, and one save action.
 *
 * Everything it writes goes through log_reference_call, the same RPC the guided
 * call script uses — there is no second data path.
 */
export const CallCaptureSheet = ({
  link,
  open,
  onOpenChange,
  source = "manual",
}: {
  link: ReferenceLinkSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: "manual" | "assistant";
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  const [status, setStatus] = useState<CallStatus>(
    (link.call_status as CallStatus) ?? "not_started",
  );
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        call_status: status,
        what_they_said: note.trim() === "" ? null : note.trim(),
        source,
      });
      setNote("");
      refresh();
      onOpenChange(false);
      notify("crm.references.call.saved", {
        type: "success",
        messageArgs: { _: "Saved to the call log." },
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to save the call",
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  const subject =
    link.shidduch_name_en || link.shidduch_name_he || link.reference_name_en;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {link.reference_name_en || link.reference_name_he}
          </SheetTitle>
          <SheetDescription>
            {translate("crm.references.call.about", {
              name: subject ?? "",
              _: "About %{name}",
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          <div>
            <p className="mb-2 text-sm font-medium">
              {translate("crm.references.call.howDidItGo", {
                _: "How did the call go?",
              })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CALL_STATUS_DESCRIPTORS.filter(
                (descriptor) => descriptor.id !== "not_started",
              ).map((descriptor) => (
                <button
                  key={descriptor.id}
                  type="button"
                  aria-pressed={status === descriptor.id}
                  onClick={() => setStatus(descriptor.id)}
                  className={cn(
                    "min-h-[56px] rounded-xl border px-4 py-3 text-base font-medium transition",
                    descriptor.className,
                    status === descriptor.id
                      ? "ring-2 ring-primary ring-offset-2"
                      : "opacity-80",
                  )}
                >
                  {translate(descriptor.labelKey, { _: descriptor.label })}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="what-they-said" className="text-sm font-medium">
              {translate("crm.references.call.whatTheySaid", {
                _: "What they said",
              })}
            </label>
            <Textarea
              id="what-they-said"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              className="mt-2 text-base"
              placeholder={translate("crm.references.call.placeholder", {
                _: "Type as much or as little as you like.",
              })}
            />
          </div>

          <Button
            type="button"
            size="lg"
            className="min-h-[48px] w-full text-base"
            disabled={isSaving}
            onClick={handleSave}
          >
            {translate("crm.references.call.save", {
              _: "Save and add to log",
            })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
