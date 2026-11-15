import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  type GetListResult,
} from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion, ShidduchSummary } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";
import {
  flattenEligibleResumeAttachments,
  formatResumeInboxSize,
  toResumeInboxPickerItem,
  type ResumeInboxPickerItem,
  type ResumeInboxRow,
} from "./resumeInbox";
import {
  resumeAutoReadFeedbackText,
  useResumeAutoRead,
} from "./resumeAutoRead";

const EMPTY_COPY =
  "No resumes are waiting in your Inbox. On Android you can share a resume from WhatsApp, Messages or email to MyShadChan and it will appear here. On iPhone, save the file to your phone and use Attach resume.";
const SUCCESS_COPY =
  "Resume attached. It is now a new version. The file is still in your Inbox.";
const FAILURE_COPY =
  "Could not attach this file. It may be too large or no longer available. The Inbox item was not changed.";

const PICKER_INBOX_COLUMNS = [
  "id",
  "created_at",
  "sender",
  "sender_email",
  "status",
  "attachments",
] as const;

function PickerBody({
  rows,
  targetLabel,
  selected,
  isAttaching,
  onSelect,
  onCancel,
  onAttach,
}: {
  rows: ResumeInboxRow[];
  targetLabel: string;
  selected: ResumeInboxRow | null;
  isAttaching: boolean;
  onSelect: (row: ResumeInboxRow) => void;
  onCancel: () => void;
  onAttach: () => void;
}): ReactElement {
  const translate = useTranslate();

  return (
    <>
      <div
        role="listbox"
        aria-label={translate("crm.entity360.resume.inboxList", {
          _: "Resume files waiting in Inbox",
        })}
        className="flex min-w-0 flex-col gap-2"
      >
        {rows.map((row) => {
          const isSelected =
            selected?.attachmentPath === row.attachmentPath &&
            selected != null &&
            String(selected.inboxItemId) === String(row.inboxItemId);
          return (
            <button
              key={`${row.inboxItemId}:${row.attachmentPath}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={row.alreadyAttached || isAttaching}
              disabled={row.alreadyAttached || isAttaching}
              onClick={() => onSelect(row)}
              className="flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-xl border p-3 text-start transition-colors hover:bg-muted/60 aria-selected:border-primary aria-selected:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">
                  {row.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {row.sourceLabel} · {formatTimelineDate(row.receivedAt)} ·{" "}
                  {formatResumeInboxSize(row.size)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {row.alreadyAttached
                  ? translate("crm.entity360.resume.inboxAlreadyAttached", {
                      _: "Already attached",
                    })
                  : isSelected && isAttaching
                    ? translate("crm.entity360.resume.inboxAttaching", {
                        _: "Attaching…",
                      })
                    : isSelected
                      ? translate("crm.entity360.resume.inboxSelected", {
                          _: "Selected",
                        })
                      : translate("crm.entity360.resume.inboxAttach", {
                          _: "Attach",
                        })}
              </span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">{EMPTY_COPY}</p>
      ) : null}
      {rows.some((row) => row.alreadyAttached) ? (
        <p className="text-sm text-muted-foreground">
          This file is already attached to {targetLabel}&apos;s resume.
        </p>
      ) : null}
      {selected ? (
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Attach this file to {targetLabel}&apos;s resume?
          </p>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {selected.title} · The file stays in your Inbox.
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isAttaching}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onAttach} disabled={isAttaching}>
              {isAttaching ? "Attaching…" : "Attach"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PickerContent({
  rows,
  targetLabel,
  selected,
  isAttaching,
  onSelect,
  onCancel,
  onAttach,
}: Parameters<typeof PickerBody>[0]): ReactElement {
  return (
    <PickerBody
      rows={rows}
      targetLabel={targetLabel}
      selected={selected}
      isAttaching={isAttaching}
      onSelect={onSelect}
      onCancel={onCancel}
      onAttach={onAttach}
    />
  );
}

export function ResumeInboxPicker({
  shidduchimId,
  targetLabel,
  autoRead = false,
}: {
  shidduchimId: ShidduchSummary["id"];
  targetLabel: string;
  autoRead?: boolean;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<ResumeInboxRow | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const { feedback, readResume } = useResumeAutoRead();
  const open = dialogOpen || sheetOpen;

  const {
    data: inboxItems,
    isPending: isInboxPending,
    error: inboxError,
  } = useGetList<ResumeInboxPickerItem>(
    "inbox_items",
    {
      filter: { status: "unresolved" },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "created_at", order: "DESC" },
      meta: {
        columns: PICKER_INBOX_COLUMNS,
        resumeInboxPicker: true,
      },
    },
    {
      enabled: open,
      select: (result: GetListResult<ResumeInboxPickerItem>) => ({
        ...result,
        data: result.data.map(toResumeInboxPickerItem),
      }),
    },
  );
  const { data: resumes } = useGetList<Resume>(
    "resumes",
    {
      filter: { shidduchim_id: shidduchimId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: open },
  );

  const rows = useMemo(
    () =>
      flattenEligibleResumeAttachments(
        inboxItems ?? [],
        (resumes?.[0]?.files ?? []) as ResumeFileVersion[],
      ),
    [inboxItems, resumes],
  );

  const close = () => {
    if (isAttaching) return;
    setDialogOpen(false);
    setSheetOpen(false);
    setSelected(null);
  };

  const handleAttach = async () => {
    if (!selected || isAttaching) return;
    setIsAttaching(true);
    try {
      const resume = await dataProvider.attachInboxAttachmentToResumeFile({
        shidduchimId,
        inboxItemId: selected.inboxItemId,
        attachment: selected.attachment,
      });
      if (autoRead) {
        const attached = resume.files?.find(
          (file) =>
            String(file.source_inbox_item_id) ===
              String(selected.inboxItemId) &&
            file.source_inbox_attachment_path === selected.attachment.path,
        );
        if (attached) await readResume(resume.id, attached);
      }
      notify(SUCCESS_COPY, { type: "info" });
      refresh();
      setDialogOpen(false);
      setSheetOpen(false);
      setSelected(null);
    } catch {
      notify(FAILURE_COPY, { type: "error" });
    } finally {
      setIsAttaching(false);
    }
  };

  const body = inboxError ? (
    <p role="alert" className="text-sm text-destructive">
      Could not load resumes from your Inbox.
    </p>
  ) : isInboxPending ? (
    <p className="text-sm text-muted-foreground">
      Loading resumes from your Inbox…
    </p>
  ) : (
    <PickerContent
      rows={rows}
      targetLabel={targetLabel}
      selected={selected}
      isAttaching={isAttaching}
      onSelect={setSelected}
      onCancel={() => setSelected(null)}
      onAttach={() => void handleAttach()}
    />
  );

  const trigger = (className: string) => (
    <Button type="button" variant="outline" className={className}>
      Pick a resume from your Inbox
    </Button>
  );

  return (
    <div>
      <div className="hidden sm:block">
        <Dialog
          open={dialogOpen}
          onOpenChange={(nextOpen) =>
            nextOpen ? setDialogOpen(true) : close()
          }
        >
          <DialogTrigger asChild>{trigger("w-full sm:w-auto")}</DialogTrigger>
          <DialogContent className="hidden sm:grid">
            <DialogHeader>
              <DialogTitle>Pick a resume from your Inbox</DialogTitle>
              <DialogDescription>
                Choose one file waiting in your Inbox. It will be copied to this
                suggestion; the file stays in your Inbox.
              </DialogDescription>
            </DialogHeader>
            {body}
            <DialogFooter />
          </DialogContent>
        </Dialog>
      </div>
      <div className="sm:hidden">
        <Sheet
          open={sheetOpen}
          onOpenChange={(nextOpen) => (nextOpen ? setSheetOpen(true) : close())}
        >
          <SheetTrigger asChild>{trigger("w-full")}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[90dvh] overflow-y-auto sm:hidden"
          >
            <SheetHeader>
              <SheetTitle>Pick a resume from your Inbox</SheetTitle>
              <SheetDescription>
                Choose one file waiting in your Inbox.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">{body}</div>
            <SheetFooter />
          </SheetContent>
        </Sheet>
      </div>
      {feedback ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-muted-foreground"
        >
          {resumeAutoReadFeedbackText(feedback)}
        </p>
      ) : null}
    </div>
  );
}
