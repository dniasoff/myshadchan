import { useDataProvider } from "ra-core";
import type { Identifier } from "ra-core";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { CrmDataProvider } from "../providers/types";
import type { Interaction } from "../types";

export type ShadchanNote = Interaction & {
  author_name?: string | null;
  can_moderate?: boolean;
};

const NOTE_PAGE_SIZE = 500;

const compareIdsDescending = (left: Identifier, right: Identifier): number => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return rightNumber - leftNumber;
  }
  return String(right).localeCompare(String(left));
};

const compareNewestFirst = (left: ShadchanNote, right: ShadchanNote) => {
  const dateOrder = String(right.created_at).localeCompare(
    String(left.created_at),
  );
  return dateOrder || compareIdsDescending(left.id, right.id);
};

export const useShadchanNotes = (shadchanIds: readonly Identifier[]) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const normalizedIds = useMemo(
    () =>
      Array.from(new Set(shadchanIds.map((id) => String(id)))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [shadchanIds],
  );
  const query = useQuery({
    queryKey: ["shadchanim", "live-note-indicators", normalizedIds],
    enabled: normalizedIds.length > 0,
    queryFn: async () => {
      const result = await dataProvider.getList<ShadchanNote>(
        "interactions_summary",
        {
          filter: {
            target_type: "shadchan",
            kind: "note",
            scope: "account",
            "deleted_at@is": null,
            "target_id@in": `(${normalizedIds.join(",")})`,
          },
          sort: { field: "created_at", order: "DESC" },
          pagination: { page: 1, perPage: NOTE_PAGE_SIZE },
        },
      );
      return result.data;
    },
  });

  const notesByShadchanId = useMemo(() => {
    const visibleIds = new Set(normalizedIds);
    const newestByShadchanId = new Map<string, ShadchanNote>();
    if (query.isPending || query.isFetching || query.error) {
      return newestByShadchanId;
    }
    for (const note of query.data ?? []) {
      const targetId = String(note.target_id);
      if (
        note.target_type !== "shadchan" ||
        note.kind !== "note" ||
        note.scope !== "account" ||
        note.deleted_at != null ||
        !visibleIds.has(targetId)
      ) {
        continue;
      }
      const current = newestByShadchanId.get(targetId);
      if (!current || compareNewestFirst(note, current) < 0) {
        newestByShadchanId.set(targetId, note);
      }
    }
    return newestByShadchanId;
  }, [
    normalizedIds,
    query.data,
    query.error,
    query.isFetching,
    query.isPending,
  ]);

  return {
    notesByShadchanId,
    isPending:
      normalizedIds.length > 0 && (query.isPending || query.isFetching),
    error: normalizedIds.length > 0 ? query.error : null,
  };
};
