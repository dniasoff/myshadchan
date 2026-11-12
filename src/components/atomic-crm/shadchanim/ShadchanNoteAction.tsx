import { NotebookPen } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import type { Shadchan } from "../types";
import { buildTabPath } from "../entity360/entityPaths";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import type { ShadchanNote } from "./useShadchanNotes";

export const ShadchanNotesLookupStatus = ({
  isPending,
  error,
}: {
  isPending: boolean;
  error: unknown;
}) => {
  const translate = useTranslate();
  if (!isPending && !error) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-sm text-muted-foreground"
    >
      {isPending
        ? translate("crm.shadchanim.notes.checking", {
            _: "Checking for notes…",
          })
        : translate("crm.shadchanim.notes.error", {
            _: "Could not load note indicators.",
          })}
    </p>
  );
};

export const ShadchanNoteAction = ({
  shadchan,
  note,
}: {
  shadchan: Pick<Shadchan, "id" | "name">;
  note: ShadchanNote;
}) => {
  const translate = useTranslate();
  const body = note.body?.trim()
    ? note.body
    : translate("crm.shadchanim.notes.noText", {
        _: "This note has no text.",
      });
  const metadata = [
    note.author_name
      ? translate("crm.shadchanim.notes.writtenBy", {
          author: note.author_name,
          _: "Written by %{author}",
        })
      : null,
    note.created_at ? formatTimelineDate(note.created_at) : null,
  ].filter((value): value is string => value != null);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-label={translate("crm.shadchanim.notes.open", {
            name: shadchan.name,
            _: "Open note for %{name}",
          })}
        >
          <NotebookPen aria-hidden="true" />
          <span>{translate("crm.shadchanim.notes.label", { _: "Note" })}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[70vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {translate("crm.shadchanim.notes.title", {
              name: shadchan.name,
              _: "%{name} — note",
            })}
          </DialogTitle>
          <DialogDescription
            className={metadata.length > 0 ? undefined : "sr-only"}
          >
            {metadata.length > 0
              ? metadata.join(" · ")
              : translate("crm.shadchanim.notes.noMetadata", {
                  _: "Note details unavailable.",
                })}
          </DialogDescription>
        </DialogHeader>
        <div
          dir="auto"
          className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm"
          style={{ unicodeBidi: "plaintext" }}
        >
          {body}
        </div>
        <DialogFooter>
          <Button asChild variant="link">
            <Link to={buildTabPath("shadchanim", shadchan.id, "notes")}>
              {translate("crm.shadchanim.notes.viewAll", {
                _: "View all notes",
              })}
            </Link>
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {translate("crm.shadchanim.notes.close", { _: "Close" })}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
