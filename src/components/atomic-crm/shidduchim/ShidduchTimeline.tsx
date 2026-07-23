import { useState } from "react";
import { format } from "date-fns";
import type { Identifier } from "ra-core";
import { useCreate, useGetList, useNotify, useRefresh } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import type { Interaction, InteractionKind } from "../types";

/** Format an ISO timestamp (e.g. interaction.created_at) as "d MMM yyyy, HH:mm". */
const formatTimelineDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format(date, "d MMM yyyy, HH:mm");
};

const KIND_LABELS: Record<InteractionKind, string> = {
  note: "Note",
  call_logged: "Call logged",
  status_change: "Status changed",
  merge: "Merged",
  link_created: "Linked to a reference",
  link_removed: "Unlinked from a reference",
};

/**
 * Notes + timeline for a shidduch (Screen 18 body). A note is just an
 * interaction with kind "note" (same polymorphic table the reference
 * timeline uses — FR36's pattern, not a parallel notes table), scoped
 * directly to this shidduch: target_type = "shidduch", scope = "shidduch",
 * no reference_link_id (interactions_scope_link_check in 01_tables.sql).
 */
const AddNote = ({ shidduchimId }: { shidduchimId: Identifier }) => {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [body, setBody] = useState("");

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "") return;

    try {
      await create(
        "interactions",
        {
          data: {
            target_type: "shidduch",
            target_id: shidduchimId,
            kind: "note",
            body: text,
            scope: "shidduch",
          },
        },
        { returnPromise: true },
      );
      setBody("");
      refresh();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add the note",
        { type: "error" },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add a note about this suggestion"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px]"
          disabled={isPending || body.trim() === ""}
          onClick={handleAdd}
        >
          Add note
        </Button>
      </div>
    </div>
  );
};

export const ShidduchTimeline = ({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}) => {
  const { data, isPending } = useGetList<Interaction>("interactions", {
    filter: { target_type: "shidduch", target_id: shidduchimId },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "created_at", order: "DESC" },
  });

  const interactions = data ?? [];

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="mb-4 font-display text-lg font-semibold">
        Notes &amp; timeline
      </h3>

      <div className="mb-4">
        <AddNote shidduchimId={shidduchimId} />
      </div>

      {isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : interactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing logged for this suggestion yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 border-s border-border ps-4">
          {interactions.map((interaction) => (
            <li key={String(interaction.id)}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">
                  {KIND_LABELS[interaction.kind] ?? "Note"}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatTimelineDate(interaction.created_at)}
                </span>
              </div>
              {interaction.body ? (
                <p className="whitespace-pre-line text-sm">
                  {interaction.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
