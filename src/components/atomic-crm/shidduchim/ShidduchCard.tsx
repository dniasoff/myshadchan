import {
  Draggable,
  type DraggableProvided,
  type DraggableStateSnapshot,
} from "@hello-pangea/dnd";
import { useRedirect } from "ra-core";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ShidduchSummary } from "../types";
import { formatRedtDate, getAvatarIndex, getMonogram } from "./boardUtils";

/** Shared with the 360 detail header's meta row — one small clock glyph. */
export const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3 w-3 shrink-0"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/** The calm recognition glyph on the "Suggested before" catch chip (E3). */
const SparkleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-3 w-3 shrink-0"
    aria-hidden="true"
  >
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
  </svg>
);

export const ShidduchCard = ({
  shidduch,
  index,
  tourAnchor = false,
}: {
  shidduch: ShidduchSummary;
  index: number;
  /** Anchors `data-tour="pipeline-card"` for the walkthrough (first card only). */
  tourAnchor?: boolean;
}) => {
  if (!shidduch) return null;
  return (
    <Draggable draggableId={String(shidduch.id)} index={index}>
      {(provided, snapshot) => (
        <ShidduchCardContent
          provided={provided}
          snapshot={snapshot}
          shidduch={shidduch}
          tourAnchor={tourAnchor}
        />
      )}
    </Draggable>
  );
};

export const ShidduchCardContent = ({
  provided,
  snapshot,
  shidduch,
  tourAnchor = false,
}: {
  provided?: DraggableProvided;
  snapshot?: DraggableStateSnapshot;
  shidduch: ShidduchSummary;
  tourAnchor?: boolean;
}) => {
  const redirect = useRedirect();
  const name = shidduch.name_en ?? shidduch.child_first_name_en ?? "Unnamed";
  const monogram = getMonogram(shidduch.name_en);
  const avatarIndex = getAvatarIndex(shidduch.name_en ?? String(shidduch.id));
  const meta = [shidduch.location_en, shidduch.seminary_en]
    .filter(Boolean)
    .join(" · ");
  const nbRedts = shidduch.nb_redts ?? 0;
  const catchCount = shidduch.catch_count ?? 0;

  const handleClick = () => {
    // Ignore the click that ends a drag.
    if (snapshot?.isDragging) return;
    redirect(
      `/shidduchim/${shidduch.id}/show`,
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  return (
    <div
      className="cursor-pointer"
      data-tour={tourAnchor ? "pipeline-card" : undefined}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
    >
      <Card
        className={cn(
          "gap-0 p-3.5 transition-all duration-150",
          snapshot?.isDragging
            ? "rotate-1 opacity-90 shadow-lg"
            : "shadow-sm hover:-translate-y-px hover:shadow-md",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-[13px] font-bold"
            style={{
              backgroundColor: `var(--avatar-${avatarIndex})`,
              color: "var(--avatar-ink)",
            }}
          >
            {monogram}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">{name}</div>
            {meta ? (
              <div className="mt-1.5 text-xs text-muted-foreground">{meta}</div>
            ) : null}
          </div>
        </div>

        {/*
          Dedupe "catch" chip (E3): a calm "Suggested before" indicator when this
          person looks like one already suggested for another child in the family.
          catch_count rides along on the shidduchim_summary read (no per-card
          query), and the honey --attention token marks recognition, never alarm.
          The full evidence + confirm/dismiss lives on the 360 view (ShidduchCatchSection).
        */}
        {catchCount > 0 ? (
          <div className="mt-2.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium
                text-attention-foreground
                bg-[color-mix(in_oklch,var(--attention)_18%,transparent)]"
            >
              <SparkleIcon />
              Suggested before
            </span>
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-1.5 border-t pt-2.5 text-[11.5px] text-muted-foreground">
          {shidduch.shadchan_name ? (
            <>
              <span>via {shidduch.shadchan_name}</span>
              <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
            </>
          ) : null}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ClockIcon />
            Redt {formatRedtDate(shidduch.redt_date)}
          </span>
          {nbRedts > 1 ? (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
              <span
                className="tabular-nums font-medium"
                title={`Redt ${nbRedts} times`}
              >
                redt ×{nbRedts}
              </span>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
};
