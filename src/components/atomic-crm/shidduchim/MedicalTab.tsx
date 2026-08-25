import { useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import {
  useCreate,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import type { MedicalNote, ShidduchSummary } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";

/**
 * Story 5.5 — the sensitive tier's own tab. Never appears in the DOM at all
 * for a `single`/`helper` viewer (`EntityShow.tsx` filters the merged tab
 * array through `hasVisibility()` before `render` is ever invoked, AC 2) —
 * this component itself does no role check of its own; RLS
 * (05_policies.sql) is the authoritative boundary (AC 3), and the
 * descriptor's `visibleTo` is the courtesy that keeps a denied viewer from
 * ever reaching this code path.
 *
 * Plain list + add-a-note form against `public.medical_notes`, filtered by
 * `shidduchim_id`. No edit/delete/visibility control — no AC asks for one,
 * and every viewer who CAN see this tab (`parent_admin`/`self_manager`) is
 * already the same trusted tier, so there is nothing to narrow further
 * within it.
 */

function MedicalSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

function MedicalEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.medical.empty", {
        _: "No medical notes yet.",
      })}
    </p>
  );
}

function MedicalError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.medical.error", {
        _: "Could not load the medical notes.",
      })}
    </p>
  );
}

function AddMedicalNoteForm({
  shidduchimId,
  onAdded,
}: {
  shidduchimId: Identifier;
  onAdded: () => void;
}): ReactElement {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const translate = useTranslate();
  const [body, setBody] = useState("");

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
  };

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "") return;

    try {
      await create(
        "medical_notes",
        { data: { shidduchim_id: shidduchimId, body: text } },
        { returnPromise: true },
      );
      setBody("");
      onAdded();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.medical.addError", {
              _: "Failed to add the note",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* A real <Label>, the same shape SingleInputForm uses: the placeholder
          was the only naming this field had, and a placeholder is gone the
          moment the first character is typed. */}
      <Label htmlFor="medical-note-body">
        {translate("crm.entity360.medical.label", {
          _: "Add a medical note",
        })}
      </Label>
      <Textarea
        id="medical-note-body"
        value={body}
        rows={3}
        onChange={handleChange}
        placeholder={translate("crm.entity360.medical.placeholder", {
          _: "Add a medical note…",
        })}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || body.trim() === ""}
          onClick={handleAdd}
        >
          {translate("crm.entity360.medical.add", { _: "Add note" })}
        </Button>
      </div>
    </div>
  );
}

function MedicalNoteRow({ note }: { note: MedicalNote }): ReactElement {
  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimelineDate(note.created_at)}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm">{note.body}</p>
    </li>
  );
}

function MedicalTabContent({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}): ReactElement {
  const refresh = useRefresh();
  const { data, error, isPending } = useGetList<MedicalNote>("medical_notes", {
    filter: { shidduchim_id: shidduchimId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 50 },
  });

  return (
    <div className="flex flex-col gap-4">
      <AddMedicalNoteForm shidduchimId={shidduchimId} onAdded={refresh} />
      {isPending ? (
        <MedicalSkeleton />
      ) : error ? (
        <MedicalError />
      ) : !data || data.length === 0 ? (
        <MedicalEmpty />
      ) : (
        <ul className="flex flex-col gap-3 border-s border-border ps-4">
          {data.map((note) => (
            <MedicalNoteRow key={String(note.id)} note={note} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The shidduch descriptor's `medical` tab entry point (AC 1, AC 5).
 * `render` is arity-zero (contract §2 rule 4) — reaches the shidduch via
 * `useRecordContext()`, exactly like `ResumeTab`/`PhotoTab`.
 */
export function MedicalTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;

  return <MedicalTabContent shidduchimId={record.id} />;
}
