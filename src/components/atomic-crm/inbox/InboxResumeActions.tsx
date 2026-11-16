import { useEffect, useMemo, useState } from "react";
import type { Identifier } from "ra-core";
import { useGetList, useNotify, useRedirect, useRefresh } from "ra-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { buildTabPath } from "../entity360/entityPaths";
import type { ShidduchSummary, Single, InboxItem } from "../types";
import { RESUME_AUTO_READ_COPY } from "../resumes/resumeAutoReadHelpers";
import {
  hasResumeDocumentAttachment,
  isResumeDocument,
  type InboxResumeAction,
  useResolveInboxItem,
} from "./useResolveInboxItem";

export type { InboxResumeAction } from "./useResolveInboxItem";

const FAILURE_COPY =
  "Could not make this resume easy to read. Nothing was lost. The item is still in your Inbox.";
const NEWEST_FIRST_COPY = "Your suggestions · newest first";

function readOutcomeCopy(outcome: string): string {
  switch (outcome) {
    case "not_entitled":
      return RESUME_AUTO_READ_COPY.notEntitled;
    case "no_allowance":
      return RESUME_AUTO_READ_COPY.noAllowance;
    case "timeout":
      return RESUME_AUTO_READ_COPY.timeout;
    default:
      return FAILURE_COPY;
  }
}

function suggestionLabel(suggestion: Pick<ShidduchSummary, "id" | "name_en">) {
  return suggestion.name_en?.trim() || "New suggestion";
}

function singleLabel(single: Single): string {
  const name = [single.first_name_en, single.last_name_en]
    .filter((part) => part?.trim())
    .join(" ");
  return name || "Single";
}

export const InboxResumeActionButtons = ({
  item,
  enabled,
  onChoose,
}: {
  item: InboxItem;
  enabled: boolean;
  onChoose: (action: InboxResumeAction) => void;
}) => {
  const hasResume = hasResumeDocumentAttachment(item);
  const disabled = !enabled || !hasResume;
  const reason = !enabled ? "Trust sender first." : "Add a resume file first.";
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        type="button"
        variant="default"
        disabled={disabled}
        title={disabled ? reason : undefined}
        aria-label={`Attach to a suggestion${disabled ? ` — ${reason}` : ""}`}
        onClick={() => onChoose("attach")}
        className="min-h-11 w-full sm:flex-1"
      >
        Attach to a suggestion
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        title={disabled ? reason : undefined}
        aria-label={`Make a new suggestion${disabled ? ` — ${reason}` : ""}`}
        onClick={() => onChoose("new")}
        className="min-h-11 w-full sm:flex-1"
      >
        Make a new suggestion
      </Button>
      {disabled ? (
        <span className="text-xs text-muted-foreground sm:sr-only">
          {reason}
        </span>
      ) : null}
    </div>
  );
};

export const InboxResumeActionsDialog = ({
  item,
  open,
  action,
  onClose,
}: {
  item: InboxItem;
  open: boolean;
  action: InboxResumeAction;
  onClose: () => void;
}) => {
  const notify = useNotify();
  const redirect = useRedirect();
  const refresh = useRefresh();
  const { resolveInboxResume } = useResolveInboxItem();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<Identifier | null>(null);
  const [selectedSingle, setSelectedSingle] = useState<Identifier | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setMessageIsError(false);
    setSearch("");
    setDebouncedSearch("");
    setSelectedSuggestion(null);
    setSelectedSingle(null);
  }, [action, item.id, open]);

  const { data: suggestions = [], isPending: suggestionsPending } =
    useGetList<ShidduchSummary>(
      "shidduchim",
      {
        filter: debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {},
        pagination: { page: 1, perPage: 50 },
        sort: { field: "created_at", order: "DESC" },
      },
      { enabled: open && action === "attach" },
    );

  const { data: singles = [], isPending: singlesPending } = useGetList<Single>(
    "singles",
    {
      filter: { status: "active" },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: open && action === "new" },
  );

  const resumeAttachment = useMemo(
    () => item.attachments?.find(isResumeDocument),
    [item.attachments],
  );

  useEffect(() => {
    if (action !== "new" || singles.length !== 1) return;
    setSelectedSingle(singles[0].id);
  }, [action, singles]);

  const selectedSuggestionRecord = suggestions.find(
    (suggestion) => String(suggestion.id) === String(selectedSuggestion),
  );
  const selectedSingleRecord = singles.find(
    (single) => String(single.id) === String(selectedSingle),
  );

  const handleSubmit = async () => {
    if (busy) return;
    if (action === "attach" && selectedSuggestion == null) return;
    if (action === "new" && selectedSingle == null) return;
    setBusy(true);
    setMessage(RESUME_AUTO_READ_COPY.reading);
    setMessageIsError(false);
    try {
      const result = await resolveInboxResume(item, action, {
        shidduchimId: selectedSuggestion ?? undefined,
        singleId: selectedSingle ?? undefined,
      });
      if (result.outcome === "completed" || result.outcome === "empty") {
        refresh();
        if (result.shidduch) {
          if (action === "new") {
            const displayName =
              result.shidduch.name_en?.trim() ||
              `New suggestion (from ${resumeAttachment?.title ?? "resume"})`;
            notify(
              result.shidduch.name_en?.trim()
                ? "Created. Open it"
                : `Created. Open it — ${displayName}`,
              { type: "info" },
            );
          } else {
            notify(RESUME_AUTO_READ_COPY.completed, { type: "info" });
          }
          redirect(buildTabPath("shidduchim", result.shidduch.id, "resume"));
        }
        onClose();
        return;
      }
      setMessage(readOutcomeCopy(result.outcome));
      setMessageIsError(true);
      refresh();
    } catch {
      setMessage(FAILURE_COPY);
      setMessageIsError(true);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    resumeAttachment != null &&
    (action === "attach" ? selectedSuggestion != null : selectedSingle != null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {action === "attach"
              ? "Choose a suggestion"
              : "Make a new suggestion"}
          </DialogTitle>
          <DialogDescription>
            {action === "attach"
              ? "Choose a suggestion. The newest suggestions are shown first."
              : "No form. The resume supplies the name and details. You can fix anything later."}
          </DialogDescription>
        </DialogHeader>

        {action === "attach" ? (
          <div className="flex flex-col gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              aria-label="Search by name"
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">{NEWEST_FIRST_COPY}</p>
            {suggestionsPending ? (
              <p className="text-sm text-muted-foreground">
                Loading suggestions…
              </p>
            ) : suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No suggestions found.
              </p>
            ) : (
              <div
                className="flex flex-col gap-2"
                role="listbox"
                aria-label="Suggestions"
              >
                {suggestions.map((suggestion) => {
                  const selected =
                    String(suggestion.id) === String(selectedSuggestion);
                  return (
                    <button
                      key={String(suggestion.id)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={busy}
                      onClick={() => setSelectedSuggestion(suggestion.id)}
                      className="flex min-h-14 items-center justify-between rounded-xl border border-border px-3 text-start aria-selected:border-primary aria-selected:bg-primary/5"
                    >
                      <span className="font-medium">
                        {suggestionLabel(suggestion)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {suggestion.created_at?.split("T")[0] ?? ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : singlesPending ? (
          <p className="text-sm text-muted-foreground">Loading singles…</p>
        ) : singles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no singles in this household yet.
          </p>
        ) : singles.length === 1 ? (
          <p className="rounded-xl bg-muted/50 p-3 text-sm">
            This suggestion will be for {singleLabel(singles[0])}.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-medium">Who is this suggestion for?</p>
              <p className="text-sm text-muted-foreground">
                Choose one of the singles in this household.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {singles.map((single) => (
                <button
                  key={String(single.id)}
                  type="button"
                  disabled={busy}
                  aria-pressed={String(single.id) === String(selectedSingle)}
                  onClick={() => setSelectedSingle(single.id)}
                  className="min-h-14 rounded-xl border border-border px-3 text-start font-medium aria-pressed:border-primary aria-pressed:bg-primary/5"
                >
                  {singleLabel(single)}
                </button>
              ))}
            </div>
          </div>
        )}

        {message ? (
          <p
            role={messageIsError ? "alert" : "status"}
            aria-live={messageIsError ? undefined : "polite"}
            className="text-sm text-muted-foreground"
          >
            {message}
          </p>
        ) : null}

        {action === "new" && selectedSingleRecord ? (
          <p className="text-xs text-muted-foreground">
            The suggestion will be for {singleLabel(selectedSingleRecord)}.
          </p>
        ) : null}
        {action === "attach" && selectedSuggestionRecord ? (
          <p className="text-xs text-muted-foreground">
            The resume will be attached to{" "}
            {suggestionLabel(selectedSuggestionRecord)}.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {busy
              ? RESUME_AUTO_READ_COPY.reading
              : action === "attach"
                ? `Attach to ${selectedSuggestionRecord ? suggestionLabel(selectedSuggestionRecord) : "a suggestion"}`
                : "Make a new suggestion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
