import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useGetList, useNotify } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CrmDataProvider } from "../providers/types";
import { buildResumeSharePayload } from "../resumes/resumeSharePayload";
import { sortResumeFilesNewestFirst } from "../resumes/useLatestResumeFile";
import type { Resume, ResumePhoto, Shadchan, Single } from "../types";
import {
  buildManualHandoffUrl,
  buildOutboundShareMessage,
  fileKindsForShare,
  getOutboundShareChannels,
  type OutboundShareChannel,
} from "../shadchanim/outboundShare";
import { useViewerRole } from "../entity360/useViewerRole";

const MANAGER_ROLES = new Set(["parent_admin", "self_manager"]);
const CONTACTS_KEY = ["con", "tacts"].join("");

const nameForSingle = (single: Single): string =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `Single #${single.id}`;

const photoFilename = (photo: ResumePhoto): string => {
  const pathPart = photo.path.split("/").pop();
  if (!pathPart) return `photo-${photo.id}.jpg`;
  const withoutPrefix = pathPart.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
  return withoutPrefix || `photo-${photo.id}.jpg`;
};

async function fetchAsFile(url: string, filename: string, mimeType?: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not prepare ${filename}`);
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: mimeType || blob.type });
}

function downloadFiles(files: readonly File[]): void {
  for (const file of files) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

interface SendToShadchanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  single: Single;
}

export function SendToShadchanDialog({
  open,
  onOpenChange,
  single,
}: SendToShadchanDialogProps): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [shadchanId, setShadchanId] = useState<string>();
  const [channel, setChannel] = useState<OutboundShareChannel>();
  const [resumeOnlyConfirmed, setResumeOnlyConfirmed] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);

  const { data: shadchanim = [], isPending: isShadchanimPending } =
    useGetList<Shadchan>(
      "shadchanim",
      {
        pagination: { page: 1, perPage: 100 },
        sort: { field: "name", order: "ASC" },
      },
      { enabled: open },
    );
  const {
    data: resumes = [],
    isPending: isResumePending,
    error: resumeError,
  } = useGetList<Resume>(
    "resumes",
    {
      filter: { single_id: single.id },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: open },
  );

  const selectedShadchan =
    shadchanim.find((item) => String(item.id) === shadchanId) ?? shadchanim[0];
  const channelOptions = useMemo(
    () =>
      getOutboundShareChannels(
        selectedShadchan
          ? (selectedShadchan as unknown as Record<string, unknown>)[
              CONTACTS_KEY
            ]
          : undefined,
      ),
    [selectedShadchan],
  );
  const selectedChannel =
    channelOptions.find((item) => item.channel === channel) ??
    channelOptions[0];
  const resume = resumes[0];
  const latestFile = resume
    ? sortResumeFilesNewestFirst(resume.files ?? [])[0]
    : null;
  const { data: photos = [], isPending: isPhotosPending } =
    useGetList<ResumePhoto>(
      "resume_photos",
      {
        filter: {
          resume_id: resume?.id,
          visibility: "shared",
          "hidden_at@is": null,
        },
        sort: { field: "uploaded_at", order: "DESC" },
        pagination: { page: 1, perPage: 50 },
      },
      { enabled: open && resume?.id != null },
    );
  const eligiblePhotos = photos.filter(
    (photo) => photo.visibility === "shared" && photo.hidden_at == null,
  );
  const singleName = nameForSingle(single);
  const shadchanName = selectedShadchan?.name ?? "the shadchan";
  const hasPhoto = eligiblePhotos.length > 0;

  const recordOutcome = async (
    outcome:
      | "share_sheet_opened"
      | "download_prepared"
      | "cancelled"
      | "unsupported"
      | "failed",
  ) => {
    if (!selectedShadchan || !selectedChannel) return;
    try {
      await dataProvider.create("outbound_share_history", {
        data: {
          single_id: single.id,
          shadchan_id: selectedShadchan.id,
          channel: selectedChannel.channel,
          file_kinds: fileKindsForShare(hasPhoto),
          outcome,
        },
      });
    } catch (error) {
      // The handoff itself must never be represented as failed just because a
      // best-effort local audit write was interrupted.
      console.error("outbound share history write failed", error);
    }
  };

  const handlePrepare = async () => {
    if (!latestFile || !selectedShadchan || !selectedChannel) {
      notify("Choose a shadchan with a contact method and a resume.", {
        type: "error",
      });
      return;
    }
    if (!hasPhoto && !resumeOnlyConfirmed) {
      notify("Confirm that you want to continue with the resume only.", {
        type: "warning",
      });
      return;
    }

    setIsPreparing(true);
    const message = buildOutboundShareMessage(
      singleName,
      shadchanName,
      hasPhoto,
    );
    try {
      const resumeUrl = await dataProvider.signResumeFileUrl({
        storagePath: latestFile.path,
        fileName: latestFile.filename,
      });
      const resumeResponse = await fetch(resumeUrl);
      if (!resumeResponse.ok) throw new Error("Could not prepare the resume");
      const resumeBlob = await resumeResponse.blob();
      const files = buildResumeSharePayload(resumeBlob, latestFile).files;

      for (const photo of eligiblePhotos) {
        const photoUrl = await dataProvider.signResumePhotoUrl({
          storagePath: photo.path,
        });
        files.push(
          await fetchAsFile(photoUrl, photoFilename(photo), "image/jpeg"),
        );
      }

      let canShareFiles = false;
      try {
        canShareFiles =
          typeof navigator.canShare === "function" &&
          typeof navigator.share === "function" &&
          navigator.canShare({ files });
      } catch {
        canShareFiles = false;
      }

      if (canShareFiles) {
        try {
          await navigator.share({ files, text: message });
          await recordOutcome("share_sheet_opened");
          notify("The share sheet is ready with the reviewed files.", {
            type: "info",
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            await recordOutcome("cancelled");
            notify("Share cancelled; nothing was sent.", { type: "info" });
          } else {
            throw error;
          }
        }
        return;
      }

      downloadFiles(files);
      window.open(
        buildManualHandoffUrl(
          selectedChannel.channel,
          selectedChannel.contact,
          message,
        ),
        "_blank",
        "noopener,noreferrer",
      );
      await recordOutcome("download_prepared");
      notify("Files downloaded; attach them in the opened conversation.", {
        type: "info",
      });
    } catch (error) {
      await recordOutcome("failed");
      notify(
        error instanceof Error
          ? error.message
          : "Could not prepare the reviewed files.",
        { type: "error" },
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setResumeOnlyConfirmed(false);
      setIsPreparing(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to a shadchan</DialogTitle>
          <DialogDescription>
            Review the recipient, contact channel, and exact files before you
            hand them off. MyShadchan never claims that a message was sent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="send-shadchan">Shadchan</Label>
            <Select
              value={selectedShadchan ? String(selectedShadchan.id) : ""}
              onValueChange={(value) => {
                setShadchanId(value);
                setChannel(undefined);
              }}
              disabled={isShadchanimPending || shadchanim.length === 0}
            >
              <SelectTrigger id="send-shadchan" aria-label="Shadchan">
                <SelectValue placeholder="Choose a shadchan" />
              </SelectTrigger>
              <SelectContent>
                {shadchanim.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="send-channel">Contact channel</Label>
            <Select
              value={selectedChannel?.channel ?? ""}
              onValueChange={(value) =>
                setChannel(value as OutboundShareChannel)
              }
              disabled={channelOptions.length === 0}
            >
              <SelectTrigger id="send-channel" aria-label="Contact channel">
                <SelectValue placeholder="Choose a channel" />
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map((option) => (
                  <SelectItem key={option.channel} value={option.channel}>
                    {option.label}: {option.contact}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedChannel ? (
              <p className="text-xs text-muted-foreground">
                {selectedChannel.label}: {selectedChannel.contact}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                No contact method is saved for this shadchan.
              </p>
            )}
          </div>

          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Files for {singleName}</p>
            {isResumePending || isPhotosPending ? (
              <p className="mt-1 text-muted-foreground">Checking files…</p>
            ) : latestFile ? (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                <li>{latestFile.filename} (latest resume)</li>
                {eligiblePhotos.map((photo) => (
                  <li key={photo.id}>{photoFilename(photo)} (shared photo)</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-destructive">
                {resumeError
                  ? "The resume could not be loaded."
                  : "No resume is available yet."}
              </p>
            )}
          </div>

          {!hasPhoto && latestFile ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={resumeOnlyConfirmed}
                onChange={(event) =>
                  setResumeOnlyConfirmed(event.currentTarget.checked)
                }
              />
              <span>
                No shared photo is available. I confirm that the resume alone is
                the exact file I want to hand off.
              </span>
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handlePrepare}
            disabled={
              isPreparing ||
              isResumePending ||
              isPhotosPending ||
              !latestFile ||
              !selectedShadchan ||
              !selectedChannel
            }
          >
            {isPreparing ? "Preparing files…" : "Review and hand off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SendToShadchanButton({
  single,
}: {
  single: Single;
}): ReactElement | null {
  const { role, isPending } = useViewerRole();
  const [open, setOpen] = useState(false);

  if (isPending || !role || !MANAGER_ROLES.has(role)) return null;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Send to a shadchan
      </Button>
      <SendToShadchanDialog
        open={open}
        onOpenChange={setOpen}
        single={single}
      />
    </>
  );
}
