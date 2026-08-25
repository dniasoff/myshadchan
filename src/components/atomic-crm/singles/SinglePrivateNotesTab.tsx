import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../providers/types";
import type { Single, SingleNote } from "../types";

function NotesSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-6 w-5/6" />
    </div>
  );
}

function NotesEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.singles.privateNotes.empty", {
        _: "Nothing here yet. This space is yours.",
      })}
    </p>
  );
}

function NotesError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.singles.privateNotes.error", {
        _: "Could not load your notes.",
      })}
    </p>
  );
}

function NoteRow({ note }: { note: SingleNote }): ReactElement {
  const translate = useTranslate();
  return (
    <li>
      <p className="whitespace-pre-line text-sm">{note.body}</p>
      <div className="mt-1 flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 text-xs">
          {note.visible_to_manager
            ? translate("crm.singles.privateNotes.visibleToManager", {
                _: "Shared with your manager",
              })
            : translate("crm.singles.privateNotes.hiddenFromManager", {
                _: "Private to you",
              })}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Date(note.created_at).toLocaleDateString()}
        </span>
      </div>
    </li>
  );
}

function AddNoteForm({
  singleId,
  onAdded,
}: {
  singleId: string | number | undefined;
  onAdded: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [body, setBody] = useState("");
  const [visibleToManager, setVisibleToManager] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "" || !singleId) return;

    setIsPending(true);
    try {
      await dataProvider.create("single_notes", {
        data: {
          single_id: singleId,
          body: text,
          visible_to_manager: visibleToManager,
        },
      });
      setBody("");
      setVisibleToManager(false);
      onAdded();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.singles.privateNotes.addError", {
              _: "Failed to add the note",
            }),
        { type: "error" },
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder={translate("crm.singles.privateNotes.placeholder", {
          _: "Write a note…",
        })}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          {/* Same string as the <span> beside it; Radix makes this a
           * `<button role="switch">`, which no adjacent label can name. */}
          <Switch
            aria-label={translate(
              "crm.singles.privateNotes.visibleToManagerLabel",
              {
                _: "Share this note with whoever manages your process",
              },
            )}
            checked={visibleToManager}
            onCheckedChange={setVisibleToManager}
          />
          <span>
            {translate("crm.singles.privateNotes.visibleToManagerLabel", {
              _: "Share this note with whoever manages your process",
            })}
          </span>
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || body.trim() === "" || !singleId}
          onClick={handleAdd}
        >
          {translate("crm.singles.privateNotes.add", { _: "Add note" })}
        </Button>
      </div>
    </div>
  );
}

export function SinglePrivateNotesTab(): ReactNode {
  const record = useRecordContext<Single>();
  const refresh = useRefresh();

  const { data, error, isPending } = useGetList<SingleNote>(
    "single_notes",
    {
      filter: { single_id: record?.id },
      sort: { field: "created_at", order: "ASC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: !!record },
  );

  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <AddNoteForm singleId={record.id} onAdded={refresh} />
      {isPending ? (
        <NotesSkeleton />
      ) : error ? (
        <NotesError />
      ) : !data || data.length === 0 ? (
        <NotesEmpty />
      ) : (
        <ul className="flex flex-col gap-4 border-s border-border ps-4">
          {data.map((note) => (
            <NoteRow key={String(note.id)} note={note} />
          ))}
        </ul>
      )}
    </div>
  );
}
