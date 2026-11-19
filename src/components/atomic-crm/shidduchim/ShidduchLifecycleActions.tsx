import { MoreHorizontal, MoreVertical } from "lucide-react";
import { useDataProvider, useNotify, useRefresh } from "ra-core";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import {
  canManageShidduchLifecycle,
  clearPendingShidduchAction,
  getRetryNotificationKey,
  rememberPendingShidduchAction,
  SHIDDUCH_ACTION_UNDO_MS,
  type ShidduchLifecycleAction,
  type ShidduchLifecycleOrigin,
} from "./shidduchLifecycle";

const nameFor = (record: ShidduchSummary): string =>
  record.name_en ?? record.single_first_name_en ?? `#${record.id}`;

const READ_IN_PROGRESS_MESSAGE =
  "Please wait: this resume is being made easy to read.";

const reconcileArchivedMarker = async (
  dataProvider: Pick<CrmDataProvider, "getOne">,
  marker: Parameters<typeof rememberPendingShidduchAction>[0],
): Promise<boolean> => {
  try {
    const { data } = await dataProvider.getOne("shidduchim", {
      id: marker.id,
    });
    if ((data as { archived_at?: string | null } | null)?.archived_at) {
      rememberPendingShidduchAction(marker);
      return true;
    }
  } catch {
    // An unavailable state read cannot prove that the server archived the
    // suggestion, so fail closed and remove the client-only marker below.
  }
  clearPendingShidduchAction(marker.id);
  return false;
};

type LifecycleMenuVariant = "page" | "active-row" | "archived-row";

const useShidduchLifecycle = (
  record: ShidduchSummary,
  origin: ShidduchLifecycleOrigin,
  displayName?: string,
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readInProgress, setReadInProgress] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const name = displayName ?? nameFor(record);
  let getReadState: CrmDataProvider["getShidduchReadState"] | undefined;
  try {
    getReadState = dataProvider.getShidduchReadState;
  } catch {
    // Older test providers and integrations may not expose this optional
    // guard yet; the server-side delete check remains authoritative.
  }

  useEffect(() => {
    let mounted = true;
    if (typeof getReadState !== "function") return undefined;
    try {
      void getReadState(record.id)
        .then((state) => {
          if (mounted) setReadInProgress(state.inProgress);
        })
        .catch(() => {
          if (mounted) setReadInProgress(false);
        });
    } catch {
      if (mounted) setReadInProgress(false);
    }
    return () => {
      mounted = false;
    };
  }, [getReadState, record.id]);

  const closeDelete = () => {
    setDeleteOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  const archive = async () => {
    if (busy) return;
    setBusy(true);
    const deadline = Date.now() + SHIDDUCH_ACTION_UNDO_MS;
    const marker = {
      id: record.id,
      kind: "archive" as const,
      deadline,
      origin,
    };
    try {
      if (!rememberPendingShidduchAction(marker)) {
        notify("Could not archive. Nothing was changed.", { type: "error" });
        return;
      }
      await dataProvider.archiveShidduch(record.id);
      navigate("/shidduchim", {
        state: {
          shidduchLifecycle: {
            kind: "archive",
            id: record.id,
            name,
            deadline,
            origin,
          } satisfies ShidduchLifecycleAction,
        },
      });
    } catch {
      if (await reconcileArchivedMarker(dataProvider, marker)) {
        navigate("/shidduchim", {
          state: { shidduchLifecycle: { ...marker, name } },
        });
      } else {
        notify("Could not archive. Nothing was changed.", { type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await dataProvider.restoreShidduch(record.id);
      notify("Restored.");
      refresh();
    } catch {
      notify("Could not restore. Nothing was changed.", { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (busy) return;
    setBusy(true);
    const deadline = Date.now() + SHIDDUCH_ACTION_UNDO_MS;
    const marker = {
      id: record.id,
      kind: "delete" as const,
      deadline,
      origin,
    };
    try {
      if (typeof getReadState === "function") {
        try {
          const state = await getReadState(record.id);
          setReadInProgress(state.inProgress);
          if (state.inProgress) {
            notify(READ_IN_PROGRESS_MESSAGE, { type: "warning" });
            return;
          }
        } catch {
          // A read-state probe is only an advisory client guard. If it is
          // unavailable, let delete_shidduch enforce the authoritative
          // server-side read lease check instead of aborting the archive step.
          setReadInProgress(false);
        }
      }
      if (!rememberPendingShidduchAction(marker)) {
        notify("Could not delete. Nothing was changed.", { type: "error" });
        return;
      }
      // Archive is the durable first step. A route change or reload can no
      // longer make a suggestion reappear in active lists while the delete
      // undo window is open.
      await dataProvider.archiveShidduch(record.id);
      setDeleteOpen(false);
      navigate("/shidduchim", {
        state: {
          shidduchLifecycle: {
            kind: "delete",
            id: record.id,
            name,
            deadline,
            origin,
          } satisfies ShidduchLifecycleAction,
        },
      });
    } catch {
      if (await reconcileArchivedMarker(dataProvider, marker)) {
        setDeleteOpen(false);
        navigate("/shidduchim", {
          state: { shidduchLifecycle: { ...marker, name } },
        });
      } else {
        closeDelete();
        notify("Could not delete. Nothing was changed.", { type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    archive,
    busy,
    confirmDelete,
    deleteOpen,
    name,
    readInProgress,
    restore,
    closeDelete,
    setDeleteOpen,
    trigger,
  };
};

const ShidduchLifecycleMenu = ({
  record,
  variant,
  displayName,
}: {
  record: ShidduchSummary;
  variant: LifecycleMenuVariant;
  displayName?: string;
}) => {
  const {
    archive,
    busy,
    confirmDelete,
    deleteOpen,
    name,
    readInProgress,
    restore,
    closeDelete,
    setDeleteOpen,
    trigger,
  } = useShidduchLifecycle(
    record,
    variant === "page" ? "page" : "row",
    displayName,
  );
  const isArchivedRow = variant === "archived-row";
  const isPage = variant === "page";
  const isActiveRow = variant === "active-row";
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  const actions = isArchivedRow ? (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto sm:flex-none"
        disabled={busy}
        onClick={() => void restore()}
      >
        Restore
      </Button>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto sm:flex-none"
        disabled={busy || readInProgress}
        onClick={() => setDeleteOpen(true)}
      >
        Delete
      </Button>
    </div>
  ) : (
    <div
      className={
        isPage
          ? "flex items-center justify-end"
          : isActiveRow
            ? "flex min-w-0 flex-1 items-center justify-end sm:w-auto sm:flex-none sm:shrink-0"
            : "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0"
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            className={`min-h-11 gap-2${isActiveRow ? " min-w-0 w-full sm:w-auto" : ""}`}
            aria-label={isPage ? "More actions" : `More actions for ${name}`}
          >
            {isActiveRow ? (
              <MoreHorizontal className="size-4" aria-hidden="true" />
            ) : (
              <MoreVertical className="size-4" aria-hidden="true" />
            )}
            <span className={isPage ? undefined : "hidden md:inline"}>
              {isPage ? "More actions" : "More"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={
            isActiveRow
              ? "motion-reduce:animate-none motion-reduce:transition-none"
              : undefined
          }
        >
          {!record.archived_at ? (
            <DropdownMenuItem
              className={
                isActiveRow
                  ? "min-h-11 cursor-pointer motion-reduce:transition-none"
                  : "min-h-11 cursor-pointer"
              }
              aria-label={isActiveRow ? "Archive suggestion" : undefined}
              onSelect={() => void archive()}
            >
              {isActiveRow ? (
                <span className="flex flex-col text-start">
                  <span>Archive suggestion</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Keeps the file and history
                  </span>
                </span>
              ) : (
                "Archive suggestion"
              )}
            </DropdownMenuItem>
          ) : null}
          {isPage ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            {...(isActiveRow
              ? {
                  className:
                    "min-h-11 cursor-pointer border border-destructive/40 text-destructive focus:bg-destructive/10 focus:text-destructive motion-reduce:transition-none",
                  "aria-label": "Delete suggestion",
                }
              : {
                  variant: "destructive" as const,
                  className: "min-h-11 cursor-pointer",
                })}
            disabled={busy || readInProgress}
            onSelect={() => setDeleteOpen(true)}
          >
            {isActiveRow ? (
              <span className="flex flex-col text-start">
                <span>Delete suggestion</span>
                <span className="text-xs font-normal text-destructive/80">
                  Removes the file and history
                </span>
              </span>
            ) : (
              "Delete suggestion"
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const readStatus = readInProgress ? (
    <p className="text-right text-xs text-muted-foreground" role="status">
      {READ_IN_PROGRESS_MESSAGE}
    </p>
  ) : null;

  return (
    <>
      {isPage ? (
        <div className="flex flex-col gap-4">
          {record.archived_at ? (
            <section
              role="status"
              aria-labelledby="shidduch-archived-heading"
              className="rounded-2xl border border-border bg-secondary p-4"
            >
              <h2
                id="shidduch-archived-heading"
                tabIndex={-1}
                className="font-display text-lg font-semibold"
              >
                This suggestion is archived
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                It is hidden from the active pipeline, dashboard counts, and
                cards while its file and history are kept.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-11"
                disabled={busy}
                onClick={() => void restore()}
              >
                Restore
              </Button>
            </section>
          ) : null}
          {actions}
          {readStatus}
        </div>
      ) : (
        <>
          {actions}
          {readStatus}
        </>
      )}

      {/* UX-DR3 named exemption: this is a delete confirmation action for a
          routed record, not the record surface itself. */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (open) setDeleteOpen(true);
          else closeDelete();
        }}
      >
        <DialogContent
          hideClose
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelButton.current?.focus();
          }}
          className={`top-auto bottom-0 max-w-md translate-y-0 rounded-b-none border-border bg-popover shadow-lg sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-lg${isPage ? "" : " motion-reduce:animate-none motion-reduce:transition-none"}`}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
              Delete {name}?
            </DialogTitle>
            <DialogDescription>
              This also removes its resume files, references links, notes and
              call history. This cannot be undone after the Undo time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
            <Button
              ref={cancelButton}
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              onClick={closeDelete}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void confirmDelete()}
              disabled={busy}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const ShidduchRowLifecycleActions = ({
  record,
  variant,
  displayName,
}: {
  record: ShidduchSummary;
  variant: "active-row" | "archived-row";
  displayName: string;
}) => (
  <ShidduchLifecycleMenu
    record={record}
    variant={variant}
    displayName={displayName}
  />
);

/** Header actions and the manager-only archived state for one shidduch. */
export const ShidduchLifecycleActions = ({
  record,
}: {
  record: ShidduchSummary;
}) => {
  const { role, isPending: rolePending } = useViewerRole();
  if (rolePending || !canManageShidduchLifecycle(role)) return null;

  return <ShidduchLifecycleMenu record={record} variant="page" />;
};

/** The short-lived status bar rendered after landing on the list. */
export const ShidduchPendingActionBar = ({
  action,
  focusOnMount = true,
  onDone,
}: {
  action: ShidduchLifecycleAction;
  /** Page actions retain the original focus-on-mount behavior; row actions
   * leave focus with the post-success row/heading decision in the list. */
  focusOnMount?: boolean;
  onDone: (result: "restored" | "expired" | "failed") => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [purgePending, setPurgePending] = useState(false);
  const completed = useRef(false);
  const undoButton = useRef<HTMLButtonElement | null>(null);
  const retryNotificationKey = useRef<string | null>(null);

  useEffect(() => {
    if (focusOnMount === false || action.origin === "row") return;
    if (
      !action.retryRequired &&
      Date.now() < action.deadline &&
      !completed.current
    ) {
      undoButton.current?.focus();
    }
  }, [action.deadline, action.origin, action.retryRequired, focusOnMount]);

  useEffect(() => {
    if (action.retryRequired) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [action.retryRequired]);

  useEffect(() => {
    if (action.retryRequired) {
      const key = getRetryNotificationKey(action);
      if (retryNotificationKey.current !== key) {
        retryNotificationKey.current = key;
        notify(
          "Could not delete. It is in Archived: you can restore or delete it from there.",
          { type: "error" },
        );
      }
      return;
    }
    retryNotificationKey.current = null;
    if (now < action.deadline || completed.current || busy) return;
    completed.current = true;
    setBusy(true);
    if (action.kind === "archive") {
      clearPendingShidduchAction(action.id);
      notify("Archived.");
      setBusy(false);
      onDone("expired");
      return;
    }
    void dataProvider
      .deleteShidduch(action.id)
      .then((result) => {
        clearPendingShidduchAction(action.id);
        setPurgePending(result.purgePending);
        notify(
          result.purgePending ? "Files are being removed shortly." : "Deleted.",
        );
        onDone("expired");
      })
      .catch((error: unknown) => {
        const readInProgress =
          error instanceof Error && error.message === READ_IN_PROGRESS_MESSAGE;
        void (async () => {
          try {
            await dataProvider.restoreShidduch(action.id);
            clearPendingShidduchAction(action.id);
            notify(
              readInProgress
                ? READ_IN_PROGRESS_MESSAGE
                : "Could not delete. Nothing was changed.",
              { type: "error" },
            );
            onDone("restored");
          } catch {
            rememberPendingShidduchAction({
              id: action.id,
              kind: "delete",
              deadline: action.deadline,
              retryRequired: true,
            });
            notify(
              "Could not delete. It is in Archived: you can restore or delete it from there.",
              { type: "error" },
            );
            onDone("failed");
          }
        })();
      })
      .finally(() => setBusy(false));
  }, [action, busy, dataProvider, notify, now, onDone]);

  const undo = async () => {
    if (completed.current || busy) return;
    completed.current = true;
    if (action.kind === "archive" || action.kind === "delete") {
      setBusy(true);
      try {
        await dataProvider.restoreShidduch(action.id);
        clearPendingShidduchAction(action.id);
      } catch {
        completed.current = false;
        notify("Could not restore. Nothing was changed.", { type: "error" });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    notify("Restored.");
    onDone("restored");
  };

  const remaining = Math.max(0, action.deadline - now);
  const progress = Math.max(
    0,
    Math.min(100, (remaining / SHIDDUCH_ACTION_UNDO_MS) * 100),
  );

  return (
    <div
      className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm motion-reduce:animate-none motion-reduce:transition-none"
      aria-live="polite"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {action.retryRequired
              ? "Could not delete. It is in Archived: you can restore or delete it from there."
              : action.kind === "archive"
                ? "Archived."
                : "Deleted."}
          </p>
          <p className="text-xs text-muted-foreground">
            {action.retryRequired
              ? "Restore it or delete it from the Archived tab."
              : "Undo is available for 10 seconds."}
          </p>
        </div>
        <Button
          ref={undoButton}
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          disabled={busy || remaining === 0 || action.retryRequired}
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
      {purgePending ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Files are being removed shortly.
        </p>
      ) : null}
    </div>
  );
};
