import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";
import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../providers/types";
import type { ReferenceLinkSummary } from "../types";
import { CallCaptureSheet } from "./CallCaptureSheet";
import { CallStatusChip } from "./CallStatusChip";
import { getCallStatusDescriptor } from "./callStatus";
import { ReferencePhoneActions } from "./ReferencePhoneActions";
import { splitPhoneValue } from "./phoneLinks";

export type ReferenceRowIdentity = {
  name: string;
  relationship?: string | null;
  phone?: string | null;
};

const phoneActionsClassName = (phone?: string | null): string => {
  const phoneValue = splitPhoneValue(phone);
  return phoneValue.hadExplicitSeparator && phoneValue.parts.length > 1
    ? ""
    : "sm:flex-row sm:items-center sm:justify-between";
};

/**
 * The shared linked-reference row used by resume references and Reference
 * calls. Keep call capture, notes, phone actions, and call state in one place
 * so the two entry points cannot drift apart.
 */
export const ReferenceLinkRow = ({
  reference,
  link,
  rowIndex,
  nameContent,
  badge,
}: {
  reference: ReferenceRowIdentity;
  link: ReferenceLinkSummary;
  rowIndex?: number;
  nameContent?: (name: string) => ReactNode;
  badge?: ReactNode;
}): ReactElement => {
  const translate = useTranslate();
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [isCallCaptureOpen, setIsCallCaptureOpen] = useState(false);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const manualLogTriggerRef = useRef<HTMLButtonElement>(null);
  const didOpenNote = useRef(false);

  useEffect(() => {
    if (isNoteOpen) {
      didOpenNote.current = true;
    } else if (didOpenNote.current) {
      didOpenNote.current = false;
      requestAnimationFrame(() => noteTriggerRef.current?.focus());
    }
  }, [isNoteOpen]);

  const displayRelationship =
    link.effective_relationship || reference.relationship;
  const displayPhone = link.reference_phone || reference.phone;
  const displayName =
    asText(link.reference_name_en) ||
    asText(link.reference_name_he) ||
    reference.name;
  const noteExists = Boolean(link.what_they_said?.trim());
  const noteAriaLabel = `${translate("crm.entity360.resume.readable.noteOpen", {
    name: displayName,
    _: "Open note for %{name}",
  })}${
    noteExists
      ? `; ${translate("crm.entity360.resume.readable.noteSavedAria", {
          _: "note saved",
        })}`
      : ""
  }`;

  const callStatus = getCallStatusDescriptor(link.call_status);
  const lastCallAt = [...(link.conversation_log ?? [])].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  )[0]?.at;
  const formattedCallDate = lastCallAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(lastCallAt))
    : null;

  return (
    <article
      className="min-w-0 rounded-xl border p-3 outline-none"
      data-reference-row-index={rowIndex}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="auto" className="break-words text-sm font-semibold">
            {nameContent ? nameContent(displayName) : displayName}
          </p>
          {badge ? <div className="mt-1">{badge}</div> : null}
          {displayRelationship ? (
            <p
              dir="auto"
              className="mt-1 break-words text-sm text-muted-foreground"
            >
              {displayRelationship}
            </p>
          ) : null}
          <ReferencePhoneActions
            phone={displayPhone}
            referenceName={displayName}
            referenceLink={link}
            manualLogRef={manualLogTriggerRef}
            onManualLog={() => setIsCallCaptureOpen(true)}
            className={phoneActionsClassName(displayPhone)}
          />
        </div>
        <Button
          ref={noteTriggerRef}
          type="button"
          variant="outline"
          size="icon"
          aria-label={noteAriaLabel}
          aria-expanded={isNoteOpen}
          aria-haspopup="dialog"
          className="relative shrink-0"
          onClick={() => setIsNoteOpen(true)}
        >
          <MessageSquare aria-hidden="true" />
          {noteExists ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {callStatus.id === "not_started" ? (
          <span className="text-muted-foreground">Not logged</span>
        ) : (
          <>
            <CallStatusChip status={link.call_status} />
            {formattedCallDate ? (
              <span className="text-muted-foreground">
                · {formattedCallDate}
              </span>
            ) : null}
            <span aria-label="Logged" className="font-semibold text-primary">
              ✓
            </span>
          </>
        )}
      </div>
      <ReferenceNoteEditor
        link={link}
        referenceName={displayName}
        open={isNoteOpen}
        onOpenChange={setIsNoteOpen}
      />
      <CallCaptureSheet
        link={link}
        open={isCallCaptureOpen}
        onOpenChange={(open) => {
          setIsCallCaptureOpen(open);
          if (!open) {
            requestAnimationFrame(() => manualLogTriggerRef.current?.focus());
          }
        }}
      />
    </article>
  );
};

function ReferenceNoteEditor({
  link,
  referenceName,
  open,
  onOpenChange,
}: {
  link: ReferenceLinkSummary;
  referenceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [note, setNote] = useState(link.what_they_said ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const noteDirty = useRef(false);

  useEffect(() => {
    if (open && !noteDirty.current) setNote(link.what_they_said ?? "");
  }, [link.what_they_said, open]);

  const saveNote = async () => {
    const nextNote = note.trim();
    const previousNote = (link.what_they_said ?? "").trim();
    if (!nextNote && previousNote) return;
    if (nextNote === previousNote) {
      noteDirty.current = false;
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        what_they_said: nextNote,
        source: "manual",
      });
      refresh();
      noteDirty.current = false;
      onOpenChange(false);
      notify(
        translate("crm.entity360.resume.readable.noteSaved", {
          _: "Saved to the call log.",
        }),
        { type: "success" },
      );
    } catch {
      notify(
        translate("crm.entity360.resume.readable.saveError", {
          _: "We could not save this. Nothing was changed. Try again.",
        }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !noteDirty.current) {
          setNote(link.what_they_said ?? "");
        }
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:w-[min(92vw,32rem)] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-xl md:border"
      >
        <SheetHeader className="pe-12">
          <SheetTitle>
            {translate("crm.entity360.resume.readable.noteTitle", {
              name: referenceName,
              _: "Note for %{name}",
            })}
          </SheetTitle>
          <SheetDescription>
            {translate("crm.entity360.resume.readable.noteDescription", {
              _: "Write only what the reference said.",
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4 md:px-6">
          <Textarea
            aria-label={`What ${referenceName} said`}
            dir="auto"
            value={note}
            onChange={(event) => {
              noteDirty.current = true;
              setNote(event.target.value);
            }}
            rows={5}
            className="text-base"
          />
          <Button
            type="button"
            size="lg"
            disabled={
              isSaving || (!note.trim() && Boolean(link.what_they_said?.trim()))
            }
            onClick={() => void saveNote()}
            className="min-h-11 w-full"
          >
            {translate("crm.entity360.resume.readable.saveNote", {
              _: "Save note",
            })}
          </Button>
          {!note.trim() && link.what_they_said?.trim() ? (
            <p className="text-xs text-muted-foreground">
              {translate("crm.entity360.resume.readable.noteEmpty", {
                _: "Write a note to save it.",
              })}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const asText = (value?: string | null): string => value?.trim() ?? "";
