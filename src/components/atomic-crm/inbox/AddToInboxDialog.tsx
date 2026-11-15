import { Check, Copy, FileText, Image, X } from "lucide-react";
import { useDataProvider, useGetOne, useNotify, useRefresh } from "ra-core";
import { useRef, useState } from "react";
import { CancelButton } from "@/components/admin/cancel-button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { looksLikeEmail } from "./looksLikeEmail";
import { INBOX_PRIMARY_CTA_CLASS } from "./inboxMeta";
import {
  MAX_INBOX_FILES,
  MAX_INBOX_TOTAL_BYTES,
  type InboxFileKind,
  validateInboxFile,
} from "../providers/commons/inboxAttachmentValidation";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import { buildCaptureEmail } from "../settings/captureEmail";
import type { CrmDataProvider } from "../providers/types";
import type { Account, InboxAttachment, InboxItem } from "../types";

const ACCEPTED_INBOX_FILES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".pdf",
  ".doc",
  ".docx",
].join(",");

const MAX_INBOX_FILE_SIZE_LABEL = "8 MiB";
const FILE_ADD_FAILURE_COPY =
  "Could not add the files. Nothing was changed. Check the files and try again.";
const FILE_ADD_CLEANUP_FAILURE_COPY =
  "Could not add the files. Please check the Inbox before trying again.";

type SelectedInboxFile = {
  file: File;
  kind: InboxFileKind;
  mimeType: string;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const validationMessage = (reason: "too_big" | "unsupported" | "malformed") => {
  if (reason === "too_big") {
    return `This file is too large. Each new file must be ${MAX_INBOX_FILE_SIZE_LABEL} or smaller. Remove it and choose a smaller file.`;
  }
  if (reason === "unsupported") {
    return "That file type isn't supported. Choose an image, PDF, or Word file.";
  }
  return "We couldn't verify that file. Choose a different image, PDF, or Word file.";
};

const fileKindIcon = (kind: InboxFileKind) =>
  kind === "Picture" ? Image : FileText;

async function retryCleanup(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Manual capture (Epic 2 desktop path): paste a redt or choose one or more
 * files. The row is created before storage objects so an interrupted upload
 * remains attributable, and every failed follow-up is cleaned up here.
 */
export const AddToInboxDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");
  const [files, setFiles] = useState<SelectedInboxFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const { data: account } = useGetOne<Account>(
    "accounts",
    { id: activeContext?.account_id },
    {
      enabled:
        open &&
        activeContext?.kind === "household" &&
        activeContext.account_id != null,
    },
  );
  const captureEmailCandidate = buildCaptureEmail(account?.inbound_email_token);
  const captureEmail =
    captureEmailCandidate && looksLikeEmail(captureEmailCandidate)
      ? captureEmailCandidate
      : null;

  const handleClose = () => {
    setText("");
    setSender("");
    setFiles([]);
    setFileError(null);
    setIsCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const onFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;
    if (files.length + selected.length > MAX_INBOX_FILES) {
      setFileError(
        `You can add up to ${MAX_INBOX_FILES} files at once. Remove a file and try again.`,
      );
      return;
    }

    const validated: SelectedInboxFile[] = [];
    for (const file of selected) {
      try {
        const result = await validateInboxFile(file);
        if (!result.ok) {
          setFileError(validationMessage(result.reason));
          return;
        }
        validated.push({ file, kind: result.kind, mimeType: result.mimeType });
      } catch {
        setFileError(validationMessage("malformed"));
        return;
      }
    }

    const totalBytes =
      files.reduce((total, selectedFile) => total + selectedFile.file.size, 0) +
      validated.reduce(
        (total, selectedFile) => total + selectedFile.file.size,
        0,
      );
    if (totalBytes > MAX_INBOX_TOTAL_BYTES) {
      setFileError(
        "These files are too large together. Choose files totaling 40 MiB or less.",
      );
      return;
    }

    setFileError(null);
    setFiles((current) => [...current, ...validated]);
  };

  const onSave = async () => {
    if (!text.trim() && files.length === 0) return;
    const addingFiles = files.length > 0;
    setSaving(true);
    let created: InboxItem | null = null;
    const uploadedPaths: string[] = [];
    try {
      const response = await dataProvider.create<InboxItem>("inbox_items", {
        data: {
          source: "upload",
          raw_text: text.trim() || null,
          sender: sender.trim() || null,
          status: "unresolved",
          attachments: null,
        },
      });
      created = response.data;
      const createdRow = response.data;

      if (files.length > 0) {
        const attachments: InboxAttachment[] = [];
        for (const selected of files) {
          const attachment = await dataProvider.uploadInboxAttachment({
            file: selected.file,
            inboxItemId: createdRow.id,
            mimeType: selected.mimeType,
          });
          if (!attachment.path.trim()) {
            throw new Error("The uploaded file did not return a storage path");
          }
          uploadedPaths.push(attachment.path);
          attachments.push({ ...attachment, size: selected.file.size });
        }
        await dataProvider.update<InboxItem>("inbox_items", {
          id: createdRow.id,
          data: { attachments },
          previousData: createdRow,
        });
      }

      notify("Added to your inbox", { type: "info" });
      refresh();
      handleClose();
    } catch (error) {
      const cleanupResults: boolean[] = [];
      for (const path of uploadedPaths) {
        cleanupResults.push(
          await retryCleanup(() => dataProvider.removeInboxAttachment(path)),
        );
      }
      if (created) {
        const createdForCleanup = created;
        cleanupResults.push(
          await retryCleanup(() =>
            dataProvider.delete("inbox_items", {
              id: createdForCleanup.id,
              previousData: createdForCleanup,
            }),
          ),
        );
      }
      const cleanupFailed = cleanupResults.some((result) => !result);
      notify(
        addingFiles
          ? cleanupFailed
            ? FILE_ADD_CLEANUP_FAILURE_COPY
            : FILE_ADD_FAILURE_COPY
          : error instanceof Error
            ? error.message
            : "Couldn't add that",
        { type: "error" },
      );
    } finally {
      setSaving(false);
    }
  };

  const hasContent = Boolean(text.trim() || files.length > 0);

  const formBody = (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="inbox-text">What arrived</Label>
          <Textarea
            id="inbox-text"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="text-base md:text-sm"
            placeholder="Paste the WhatsApp/text/email you received…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inbox-sender">From (optional)</Label>
          <Input
            id="inbox-sender"
            value={sender}
            onChange={(event) => setSender(event.target.value)}
            className="text-base md:text-sm"
            placeholder="e.g. Mrs. Feldman"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="inbox-files">Add files or photos</Label>
          <input
            ref={fileInputRef}
            id="inbox-files"
            type="file"
            multiple
            accept={ACCEPTED_INBOX_FILES}
            onChange={onFilesSelected}
            className="sr-only"
          />
          <label
            htmlFor="inbox-files"
            className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-within:ring-2 focus-within:ring-ring"
          >
            <span>
              <strong>Add files or photos</strong>
              <br />
              <small>
                {isMobile
                  ? "Choose a resume and picture together"
                  : "Choose more than one file"}
              </small>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {isMobile
              ? "This opens Photos or Files on your phone. Each file should be 8 MiB or smaller."
              : "On your computer this opens Explorer or Finder. Choose a resume and a picture together."}
          </p>
          <p className="text-xs text-muted-foreground">
            Images, PDF, or Word files · up to {MAX_INBOX_FILE_SIZE_LABEL} each
          </p>
          {fileError ? (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          ) : null}
          {files.length > 0 ? (
            <ul className="space-y-2" aria-label="Selected files">
              {files.map(({ file, kind }, index) => {
                const Icon = fileKindIcon(kind);
                return (
                  <li
                    key={`${file.name}-${file.lastModified}-${index}`}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5"
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span
                        className="block break-words whitespace-normal"
                        dir="auto"
                      >
                        <bdi>{file.name}</bdi>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {kind} · {formatFileSize(file.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="inline-flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
          <p className="font-semibold">From WhatsApp or Messages</p>
          <p className="mt-1 text-muted-foreground">
            On Android, tap Share and choose MyShadchan.
          </p>
          <p className="text-muted-foreground">
            On iPhone, save the file to your phone first.
          </p>
          <p className="text-muted-foreground">
            You can also save it on your computer, then choose it above.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
          <p className="font-semibold">By email</p>
          <p className="mt-1 text-muted-foreground">
            Forward an email with the resume or picture to your household
            MyShadchan address. It will appear here for you.
          </p>
          {captureEmail ? (
            <div className="mt-3 flex items-center gap-2">
              <Input
                readOnly
                value={captureEmail}
                aria-label="Household MyShadchan email address"
                className="font-mono text-xs"
              />
              <button
                type="button"
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(captureEmail)
                    .then(() => setIsCopied(true));
                }}
              >
                {isCopied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {isCopied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
        </div>

        <p className="rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            Pictures stay private.
          </span>{" "}
          They will not become a suggestion picture or be shared until you
          choose to use them.
        </p>
      </div>

      <div className="mt-2 flex flex-row justify-end gap-2">
        <CancelButton className="h-11" onClick={handleClose} />
        <button
          type="button"
          disabled={!hasContent || saving}
          onClick={onSave}
          className={INBOX_PRIMARY_CTA_CLASS + " disabled:opacity-60"}
        >
          {saving ? "Adding…" : "Add to inbox"}
        </button>
      </div>
    </>
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={(next) => !next && handleClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto border-border bg-popover sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl font-semibold tracking-tight">
            Add to inbox
          </SheetTitle>
          <SheetDescription>Add a note or files.</SheetDescription>
        </SheetHeader>
        {formBody}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-border bg-popover shadow-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            Add to inbox
          </DialogTitle>
          <DialogDescription>
            Paste a message or note now. Who it is for can be set later.
          </DialogDescription>
        </DialogHeader>
        {formBody}
      </DialogContent>
    </Dialog>
  );
};
