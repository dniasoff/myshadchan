import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
} from "ra-core";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import type { Shadchan, ShidduchSummary } from "../types";
import {
  clearPendingShadchanAction,
  rememberPendingShadchanAction,
  SHADCHAN_ACTION_UNDO_MS,
  type ShadchanLifecycleAction,
} from "./shadchanLifecycle";

type ShadchanLifecycleProvider = CrmDataProvider & {
  archiveShadchan: (id: Shadchan["id"]) => Promise<void>;
  restoreShadchan: (id: Shadchan["id"]) => Promise<void>;
};

const GENERIC_DELETE_ERROR = "Could not delete. Nothing was changed.";
const GENERIC_RESTORE_ERROR = "Could not restore. Nothing was changed.";

/**
 * Delete is an archive action. The list-level Undo bar restores the row;
 * archived shadchanim remain restorable until the account is deleted.
 */
export const ShadchanLifecycleActions = () => {
  const record = useRecordContext<Shadchan>();
  const { role, isPending: rolePending } = useViewerRole();

  if (rolePending || !record) return null;
  if (role !== "parent_admin" && role !== "self_manager") return null;

  return <ShadchanDeleteAction record={record} />;
};

const ShadchanDeleteAction = ({ record }: { record: Shadchan }) => {
  const dataProvider = useDataProvider<ShadchanLifecycleProvider>();
  const notify = useNotify();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  const {
    data: linkedSuggestions,
    total: linkedSuggestionsTotal,
    isPending: linkedSuggestionsPending,
  } = useGetList<ShidduchSummary>("shidduchim", {
    filter: {
      "shadchan_id@eq": record.id,
    },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: otherShadchanim } = useGetList<Shadchan>("shadchanim", {
    filter: { "id@neq": record.id, "archived_at@is": null },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });

  const linkedCount = Math.max(
    linkedSuggestionsTotal ?? 0,
    linkedSuggestions?.length ?? 0,
  );
  const name = record.name || "this shadchan";

  const close = () => {
    if (busy) return;
    setOpen(false);
    setMoveOpen(false);
    setMoveTarget("");
    requestAnimationFrame(() => cancelButton.current?.focus());
  };

  const deleteShadchan = async () => {
    if (busy) return;
    setBusy(true);
    const deadline = Date.now() + SHADCHAN_ACTION_UNDO_MS;
    const action: ShadchanLifecycleAction = {
      id: record.id,
      name,
      deadline,
    };
    try {
      if (!rememberPendingShadchanAction(action)) {
        notify(GENERIC_DELETE_ERROR, { type: "error" });
        return;
      }
      await dataProvider.archiveShadchan(record.id);
      setOpen(false);
      setMoveOpen(false);
      navigate("/shadchanim", {
        state: { shadchanLifecycle: action },
      });
    } catch {
      clearPendingShadchanAction();
      notify(GENERIC_DELETE_ERROR, { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        Delete shadchan
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else close();
        }}
      >
        <DialogContent
          hideClose
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelButton.current?.focus();
          }}
          className="top-auto bottom-0 max-w-md translate-y-0 rounded-b-none border-border bg-popover shadow-lg sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-lg"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
              Delete {name}?
            </DialogTitle>
            {linkedSuggestionsPending ? (
              <DialogDescription>
                Checking linked suggestions…
              </DialogDescription>
            ) : linkedCount > 0 ? (
              <DialogDescription>
                {linkedCount} suggestions use this shadchan. They will have no
                shadchan.
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {linkedCount > 0 ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="min-h-11 self-start px-1 text-left text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => setMoveOpen((current) => !current)}
                disabled={busy}
              >
                Move them to another shadchan first
              </button>
              {moveOpen ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="move-shadchan-target">
                    Move suggestions to
                  </label>
                  <select
                    id="move-shadchan-target"
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={moveTarget}
                    onChange={(event) => setMoveTarget(event.target.value)}
                  >
                    <option value="">Choose a shadchan</option>
                    {(otherShadchanim ?? []).map((candidate) => (
                      <option key={candidate.id} value={String(candidate.id)}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={!moveTarget || busy}
                    onClick={() =>
                      notify(
                        "Move them first from the suggestion details, then delete this shadchan.",
                      )
                    }
                  >
                    Move
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
            <Button
              ref={cancelButton}
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void deleteShadchan()}
              disabled={busy || linkedSuggestionsPending}
            >
              Delete anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const ShadchanPendingActionBar = ({
  action,
  onDone,
}: {
  action: ShadchanLifecycleAction;
  onDone: (result: "restored" | "expired" | "failed") => void;
}) => {
  const dataProvider = useDataProvider<ShadchanLifecycleProvider>();
  const notify = useNotify();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const completed = useRef(false);
  const undoButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    undoButton.current?.focus();
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (now < action.deadline || completed.current || busy) return;
    completed.current = true;
    clearPendingShadchanAction();
    notify("Deleted.");
    onDone("expired");
  }, [action.deadline, busy, now, notify, onDone]);

  const undo = async () => {
    if (completed.current || busy || now >= action.deadline) return;
    completed.current = true;
    setBusy(true);
    try {
      await dataProvider.restoreShadchan(action.id);
      clearPendingShadchanAction();
      notify("Restored.");
      onDone("restored");
    } catch {
      completed.current = false;
      notify(GENERIC_RESTORE_ERROR, { type: "error" });
      onDone("failed");
    } finally {
      setBusy(false);
    }
  };

  const remaining = Math.max(0, action.deadline - now);
  const progress = Math.max(
    0,
    Math.min(100, (remaining / SHADCHAN_ACTION_UNDO_MS) * 100),
  );

  return (
    <div
      className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
      aria-live="polite"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Deleted.</p>
          <p className="text-xs text-muted-foreground">
            Undo is available for 10 seconds.
          </p>
        </div>
        <Button
          ref={undoButton}
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          disabled={busy || remaining === 0}
          onClick={() => void undo()}
        >
          Undo
        </Button>
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Undo time remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
