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

const ClockIcon = () => (
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

export const ShidduchCard = ({
  shidduch,
  index,
}: {
  shidduch: ShidduchSummary;
  index: number;
}) => {
  if (!shidduch) return null;
  return (
    <Draggable draggableId={String(shidduch.id)} index={index}>
      {(provided, snapshot) => (
        <ShidduchCardContent
          provided={provided}
          snapshot={snapshot}
          shidduch={shidduch}
        />
      )}
    </Draggable>
  );
};

export const ShidduchCardContent = ({
  provided,
  snapshot,
  shidduch,
}: {
  provided?: DraggableProvided;
  snapshot?: DraggableStateSnapshot;
  shidduch: ShidduchSummary;
}) => {
  const redirect = useRedirect();
  const name = shidduch.name_en ?? shidduch.child_first_name_en ?? "Unnamed";
  const nameHe = shidduch.name_he;
  const monogram = getMonogram(shidduch.name_en);
  const avatarIndex = getAvatarIndex(shidduch.name_en ?? String(shidduch.id));
  const meta = [shidduch.location_en, shidduch.seminary_en]
    .filter(Boolean)
    .join(" · ");
  const nbRedts = shidduch.nb_redts ?? 0;

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
            <div className="text-sm font-semibold leading-tight">
              {name}
              {nameHe ? (
                <span
                  className="font-hebrew mt-px block text-[13px] font-medium text-muted-foreground"
                  dir="rtl"
                >
                  {nameHe}
                </span>
              ) : null}
            </div>
            {meta ? (
              <div className="mt-1.5 text-xs text-muted-foreground">{meta}</div>
            ) : null}
          </div>
        </div>

        {/*
          Catch-chip slot (dedupe / "suggested before" indicator). Intentionally
          empty until real matchIdentity() output exists (Epic-4) — the build
          brief forbids shipping fabricated dedupe data (§3).
        */}

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
