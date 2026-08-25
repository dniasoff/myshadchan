import { useState } from "react";
import type { ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../../providers/types";
import type { Interaction } from "../../types";
import { insertNoteInteraction } from "./insertNoteInteraction";
import { formatTimelineDate } from "./interactionLabels";
import type { UniversalTabProps } from "./types";

/**
 * A note is an interaction with `kind: "note"` (contract §8). This tab is
 * the ONLY place `interactions_summary` is read — Story 5.1 removed the
 * inline `AddNote` this generalises from the shidduch's own routed-dialog
 * timeline component (deleted along with the dialog it lived in). The
 * INSERT itself goes through `insertNoteInteraction.ts` (Story 10.1 Task 2)
 * — that helper, not this tab, is the sole writer of a `kind: "note"` row;
 * `inbox/useResolveInboxItem.ts`'s `resolveAsLinkToExisting` is its other
 * caller.
 */
type NoteRow = Interaction & {
  author_name: string | null;
  can_moderate: boolean;
};

function NotesSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

/** AC 9 — an inline translated empty message, ActivityTab's idiom. */
function NotesEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.notes.empty", { _: "No notes yet." })}
    </p>
  );
}

/** AC 9 — a translated fetch-error message; never a blank tab. */
function NotesError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.notes.error", {
        _: "Could not load the notes.",
      })}
    </p>
  );
}

/**
 * AC 6's add form. `actor_member_id` is NEVER sent — 3.5's
 * `set_interaction_actor_member_id` trigger stamps it server-side, and the
 * trigger overwrites any client-supplied value regardless.
 */
function AddNoteForm({
  targetType,
  targetId,
  onAdded,
}: UniversalTabProps & { onAdded: () => void }): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [body, setBody] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "") return;

    setIsPending(true);
    try {
      await insertNoteInteraction(dataProvider, targetType, targetId, text);
      setBody("");
      onAdded();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.notes.addError", {
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
      {/* A placeholder is not an accessible name, and it is not even a
       * visible one for long: it disappears on the first keystroke, which
       * on a phone leaves the field as the only thing on screen with
       * nothing saying what it is. `aria-label` names it permanently. */}
      <Textarea
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        aria-label={translate("crm.entity360.notes.addLabel", {
          _: "Add a note",
        })}
        placeholder={translate("crm.entity360.notes.placeholder", {
          _: "Add a note…",
        })}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || body.trim() === ""}
          onClick={handleAdd}
        >
          {translate("crm.entity360.notes.add", { _: "Add note" })}
        </Button>
      </div>
    </div>
  );
}

/**
 * AC 6's edit/soft-delete controls. Both write to the `interactions` TABLE,
 * never the `interactions_summary` view. Rendered only when `can_moderate`
 * is true — a client-side convenience; AC 3's policy is the real boundary,
 * and a denied attempt (e.g. a stale row) surfaces through `useNotify`
 * exactly as the old shidduch timeline dialog's `AddNote` did.
 */
function NoteRowView({
  note,
  onChanged,
}: {
  note: NoteRow;
  onChanged: () => void;
}): ReactElement {
  const [update, { isPending: isSaving }] = useUpdate();
  const notify = useNotify();
  const translate = useTranslate();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note.body ?? "");

  const startEditing = () => {
    setDraft(note.body ?? "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    const text = draft.trim();
    if (text === "") return;
    try {
      await update(
        "interactions",
        { id: note.id, data: { body: text }, previousData: note },
        { returnPromise: true },
      );
      setIsEditing(false);
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.notes.editError", {
              _: "Failed to update the note",
            }),
        { type: "error" },
      );
    }
  };

  const handleDelete = async () => {
    try {
      await update(
        "interactions",
        {
          id: note.id,
          data: { deleted_at: new Date().toISOString() },
          previousData: note,
        },
        { returnPromise: true },
      );
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.notes.deleteError", {
              _: "Failed to delete the note",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">
          {note.author_name ??
            translate("crm.entity360.notes.unknownAuthor", {
              _: "Unknown",
            })}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimelineDate(note.created_at)}
        </span>
      </div>
      {isEditing ? (
        <div className="flex flex-col gap-2">
          {/* The edit field had no name at all — no label, no aria-label,
           * not even a placeholder to fall back on. */}
          <Textarea
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={translate("crm.entity360.notes.editLabel", {
              _: "Edit note",
            })}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              {translate("crm.entity360.notes.cancel", { _: "Cancel" })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSaving || draft.trim() === ""}
              onClick={handleSave}
            >
              {translate("crm.entity360.notes.save", { _: "Save" })}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {note.body ? (
            <p className="whitespace-pre-line text-sm">{note.body}</p>
          ) : null}
          {note.can_moderate ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={startEditing}
              >
                {translate("crm.entity360.notes.edit", { _: "Edit" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
              >
                {translate("crm.entity360.notes.delete", { _: "Delete" })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * The universal Notes tab (Story 3.6, contract §8): read/add/edit/soft-delete
 * for any of the four `EntityTargetType`s. Takes exactly `UniversalTabProps`
 * — no extra props, no per-entity variants.
 *
 * Reads `interactions_summary` (author identity + moderation resolved
 * server-side); writes `interactions` (the table). Because the read
 * resource differs from the write resource, ra-core's per-resource
 * invalidation never refreshes this list on its own — every successful
 * mutation calls `useRefresh()`, the same remedy `AddNote` uses today.
 */
export function NotesTab({
  targetType,
  targetId,
}: UniversalTabProps): ReactElement {
  const refresh = useRefresh();
  const { data, error, isPending } = useGetList<NoteRow>(
    "interactions_summary",
    {
      filter: {
        target_type: targetType,
        target_id: targetId,
        kind: "note",
        "deleted_at@is": null,
      },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
  );

  return (
    <div className="flex flex-col gap-4">
      <AddNoteForm
        targetType={targetType}
        targetId={targetId}
        onAdded={refresh}
      />
      {isPending ? (
        <NotesSkeleton />
      ) : error ? (
        <NotesError />
      ) : !data || data.length === 0 ? (
        <NotesEmpty />
      ) : (
        <ul className="flex flex-col gap-3 border-s border-border ps-4">
          {data.map((note) => (
            <NoteRowView
              key={String(note.id)}
              note={note}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
