import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useGetList, useNotify } from "ra-core";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useViewerRole } from "../entity360/useViewerRole";
import type { CrmDataProvider } from "../providers/types";
import { buildResumeSharePayload } from "../resumes/resumeSharePayload";
import { sortResumeFilesNewestFirst } from "../resumes/useLatestResumeFile";
import {
  buildManualHandoffMessage,
  buildManualHandoffUrl,
  buildOutboundShareMessage,
  fileKindsForShare,
  getOutboundShareChannels,
  type OutboundShareChannel,
} from "../shadchanim/outboundShare";
import type {
  MemberRole,
  OutboundShareHistory,
  Resume,
  ResumePhoto,
  Shadchan,
  Single,
} from "../types";

const MANAGER_ROLES = new Set<MemberRole>(["parent_admin", "self_manager"]);

const OUTCOME_LABELS: Record<OutboundShareHistory["outcome"], string> = {
  share_sheet_opened: "Share sheet opened",
  download_prepared: "Files downloaded",
  cancelled: "Cancelled",
  unsupported: "File sharing not supported",
  failed: "Couldn’t prepare files",
};

const CHANNEL_LABELS: Record<OutboundShareChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "Text message",
  email: "Email",
};

type PhotoWithMetadata = ResumePhoto & {
  mime_type?: string | null;
  size?: number | null;
  size_bytes?: number | null;
};

const nameForSingle = (single: Single): string =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  [single.first_name_he, single.last_name_he].filter(Boolean).join(" ") ||
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

const mimeTypeForFilename = (filename: string): string => {
  const extension = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    heic: "image/heic",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return mimeTypes[extension ?? ""] ?? "application/octet-stream";
};

const formatFileSize = (bytes: number | null | undefined): string | null => {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const describeFile = (
  filename: string,
  mimeType: string,
  size: number | null | undefined,
): string =>
  [filename, mimeType, formatFileSize(size)].filter(Boolean).join(" · ");

const photoMimeType = (photo: ResumePhoto): string => {
  const withMetadata = photo as PhotoWithMetadata;
  return withMetadata.mime_type || mimeTypeForFilename(photoFilename(photo));
};

const photoSize = (photo: ResumePhoto): number | null => {
  const withMetadata = photo as PhotoWithMetadata;
  return withMetadata.size ?? withMetadata.size_bytes ?? null;
};

async function fetchAsFile(
  url: string,
  filename: string,
  mimeType: string | undefined,
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("file-fetch-failed");
  const blob = await response.blob();
  return new File([blob], filename, {
    type: mimeType || blob.type || "application/octet-stream",
  });
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isUnsupportedShareError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "NotAllowedError")
  );
}

interface SendToShadchanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  single: Single;
  singleOptions?: Single[];
  onSingleChange?: (id: Single["id"]) => void;
  viewerRole?: MemberRole;
}

export function SendToShadchanDialog({
  open,
  onOpenChange,
  single,
  singleOptions = [single],
  onSingleChange,
  viewerRole,
}: SendToShadchanDialogProps): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [shadchanId, setShadchanId] = useState<string>();
  const [shadchanSearch, setShadchanSearch] = useState("");
  const [channel, setChannel] = useState<OutboundShareChannel>();
  const [resumeSelected, setResumeSelected] = useState(true);
  const [photoSelected, setPhotoSelected] = useState(false);
  const [resumeOnlyConfirmed, setResumeOnlyConfirmed] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [liveStatus, setLiveStatus] = useState("");
  const [showKidPicker, setShowKidPicker] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [manualFiles, setManualFiles] = useState<File[] | null>(null);
  const [manualMessage, setManualMessage] = useState("");
  const [manualStatus, setManualStatus] = useState("");
  const preparingRef = useRef(false);
  const wasPreparingRef = useRef(false);
  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const finalButtonRef = useRef<HTMLButtonElement>(null);
  const isManager = viewerRole != null && MANAGER_ROLES.has(viewerRole);

  const {
    data: shadchanim = [],
    isPending: isShadchanimPending,
    error: shadchanimError,
    refetch: refetchShadchanim,
  } = useGetList<Shadchan>(
    "shadchanim",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "name", order: "ASC" },
    },
    { enabled: open && isManager },
  );
  const {
    data: resumes = [],
    isPending: isResumePending,
    error: resumeError,
    refetch: refetchResumes,
  } = useGetList<Resume>(
    "resumes",
    {
      filter: { single_id: single.id },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: open && isManager },
  );

  const resume = resumes[0];
  const latestFile = resume
    ? sortResumeFilesNewestFirst(resume.files ?? [])[0]
    : null;
  const {
    data: photos = [],
    isPending: isPhotosPending,
    error: photosError,
    refetch: refetchPhotos,
  } = useGetList<ResumePhoto>(
    "resume_photos",
    {
      filter: { resume_id: resume?.id },
      sort: { field: "uploaded_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: open && isManager && resume?.id != null },
  );
  const eligiblePhotos = useMemo(
    () =>
      [...photos]
        .filter(
          (photo) => photo.visibility === "shared" && photo.hidden_at == null,
        )
        .sort((a, b) =>
          String(b.uploaded_at).localeCompare(String(a.uploaded_at)),
        ),
    [photos],
  );
  const newestEligiblePhoto = eligiblePhotos[0];
  const hasHiddenPhoto = photos.some((photo) => photo.hidden_at != null);
  const hasPrivatePhoto = photos.some(
    (photo) => photo.visibility === "private_parent" && photo.hidden_at == null,
  );

  const selectedShadchan = shadchanim.find(
    (item) => String(item.id) === shadchanId,
  );
  const channelOptions = useMemo(
    () => getOutboundShareChannels(selectedShadchan?.contacts),
    [selectedShadchan],
  );
  const selectedChannel =
    channelOptions.find((item) => item.channel === channel) ?? null;
  const filteredShadchanim = shadchanim.filter((item) =>
    item.name.toLocaleLowerCase().includes(shadchanSearch.toLocaleLowerCase()),
  );
  const isMetadataPending =
    isShadchanimPending ||
    isResumePending ||
    (resume?.id != null && isPhotosPending);
  const hasMetadataError = Boolean(
    shadchanimError || resumeError || photosError,
  );
  const includesPhoto = Boolean(photoSelected && newestEligiblePhoto);
  const needsResumeOnlyConfirmation = Boolean(latestFile && !includesPhoto);
  const canSubmit = Boolean(
    !isPreparing &&
    !isMetadataPending &&
    !hasMetadataError &&
    latestFile &&
    resumeSelected &&
    selectedShadchan &&
    selectedChannel?.contact &&
    (!needsResumeOnlyConfirmation || resumeOnlyConfirmed),
  );
  const singleName = nameForSingle(single);
  const shadchanName = selectedShadchan?.name ?? "the shadchan";

  const {
    data: history = [],
    isPending: isHistoryPending,
    error: historyError,
    refetch: refetchHistory,
  } = useGetList<OutboundShareHistory>(
    "outbound_share_history",
    {
      filter: { single_id: single.id },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: open && historyVisible && isManager },
  );

  useEffect(() => {
    setShadchanId(undefined);
    setShadchanSearch("");
    setChannel(undefined);
    setResumeOnlyConfirmed(false);
    setManualFiles(null);
    setManualMessage("");
    setManualStatus("");
    setErrorMessage(undefined);
    setLiveStatus("");
  }, [single.id]);

  useEffect(() => {
    if (!open) {
      runIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      preparingRef.current = false;
      setShadchanId(undefined);
      setShadchanSearch("");
      setChannel(undefined);
      setResumeOnlyConfirmed(false);
      setIsPreparing(false);
      setManualFiles(null);
      setManualMessage("");
      setManualStatus("");
      setErrorMessage(undefined);
      setLiveStatus("");
      setHistoryVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && wasPreparingRef.current && !isPreparing && canSubmit) {
      finalButtonRef.current?.focus();
    }
    wasPreparingRef.current = isPreparing;
  }, [canSubmit, isPreparing, open]);

  useEffect(() => {
    setResumeSelected(Boolean(latestFile));
    setPhotoSelected(Boolean(newestEligiblePhoto));
    setResumeOnlyConfirmed(false);
  }, [latestFile, newestEligiblePhoto]);

  const recordOutcome = async (
    outcome: OutboundShareHistory["outcome"],
    hasPhoto: boolean,
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
      if (historyVisible) void refetchHistory();
    } catch {
      console.error("outbound share history write failed");
    }
  };

  const isCurrentRun = (runId: number): boolean =>
    runId === runIdRef.current && open;

  const clearManualState = () => {
    setManualFiles(null);
    setManualMessage("");
    setManualStatus("");
  };

  const fetchFilesForSelection = async (
    runId: number,
    signal: AbortSignal,
    hasPhoto: boolean,
  ): Promise<File[]> => {
    if (!latestFile) throw new Error("resume-not-available");
    const resumeUrl = await dataProvider.signResumeFileUrl({
      storagePath: latestFile.path,
      fileName: latestFile.filename,
    });
    if (!isCurrentRun(runId)) throw new Error("run-cancelled");
    const resumeFile = await fetchAsFile(
      resumeUrl,
      latestFile.filename,
      latestFile.mime_type,
      signal,
    );
    const files = buildResumeSharePayload(
      new Blob([resumeFile], { type: resumeFile.type }),
      latestFile,
    ).files;

    if (hasPhoto && newestEligiblePhoto) {
      const photoUrl = await dataProvider.signResumePhotoUrl({
        storagePath: newestEligiblePhoto.path,
      });
      files.push(
        await fetchAsFile(
          photoUrl,
          photoFilename(newestEligiblePhoto),
          photoMimeType(newestEligiblePhoto),
          signal,
        ),
      );
    }
    if (!isCurrentRun(runId)) throw new Error("run-cancelled");
    return files;
  };

  const openManualComposer = (url: string): boolean => {
    if (!url) return false;
    try {
      const popup = window.open(url, "_blank");
      if (popup) popup.opener = null;
      return popup != null || !url.startsWith("https://wa.me/");
    } catch {
      return false;
    }
  };

  const completeManualDownload = async (
    files: File[],
    message: string,
    hasPhoto: boolean,
    runId: number,
  ) => {
    downloadFiles(files);
    const url = buildManualHandoffUrl(
      selectedChannel?.channel ?? "email",
      selectedChannel?.contact ?? "",
      message,
    );
    const opened = openManualComposer(url);
    await recordOutcome("download_prepared", hasPhoto);
    if (!isCurrentRun(runId)) return;
    setManualFiles(files);
    setManualMessage(message);
    const status = opened
      ? "Files downloaded. Attach them to the message before you send."
      : "The files were downloaded. Your message app did not open, so attach them manually.";
    setManualStatus(status);
    setLiveStatus(status);
  };

  const setManualFallback = async (
    files: File[],
    message: string,
    hasPhoto: boolean,
    runId: number,
  ) => {
    if (!isCurrentRun(runId)) return;
    await recordOutcome("unsupported", hasPhoto);
    if (!isCurrentRun(runId)) return;
    setManualFiles(files);
    setManualMessage(message);
    setManualStatus(
      "This device can’t share these files directly. Download them and attach them manually.",
    );
    setLiveStatus(
      "This device can’t share these files directly. Download them and attach them manually.",
    );
  };

  const handlePrepare = async () => {
    if (
      !canSubmit ||
      !latestFile ||
      !selectedShadchan ||
      !selectedChannel?.contact
    ) {
      return;
    }
    if (preparingRef.current) return;
    preparingRef.current = true;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const hasPhoto = includesPhoto;
    const nativeMessage = buildOutboundShareMessage(
      singleName,
      shadchanName,
      hasPhoto,
    );
    const manualMessage = buildManualHandoffMessage(
      singleName,
      shadchanName,
      hasPhoto,
    );
    setIsPreparing(true);
    setErrorMessage(undefined);
    setManualStatus("");
    setLiveStatus("Preparing the files…");

    try {
      const files = await fetchFilesForSelection(
        runId,
        controller.signal,
        hasPhoto,
      );

      if (!nativeShareAvailable) {
        await completeManualDownload(files, manualMessage, hasPhoto, runId);
        return;
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

      if (!canShareFiles || typeof navigator.share !== "function") {
        await setManualFallback(files, manualMessage, hasPhoto, runId);
        return;
      }

      try {
        await navigator.share({
          files,
          text: nativeMessage,
          title: `Send ${hasPhoto ? "resume and photo" : "resume"}`,
        });
        if (!isCurrentRun(runId)) return;
        await recordOutcome("share_sheet_opened", hasPhoto);
        setLiveStatus(
          "Share sheet opened. MyShadchan can’t see whether the message was sent.",
        );
        notify(
          "Share sheet opened. MyShadchan can’t see whether the message was sent.",
          { type: "info" },
        );
      } catch (error) {
        if (!isCurrentRun(runId)) return;
        if (isAbortError(error)) {
          await recordOutcome("cancelled", hasPhoto);
          setLiveStatus("Share cancelled. Nothing was sent.");
          notify("Share cancelled. Nothing was sent.", { type: "info" });
        } else if (isUnsupportedShareError(error)) {
          await setManualFallback(files, manualMessage, hasPhoto, runId);
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (!isCurrentRun(runId) || isAbortError(error)) return;
      await recordOutcome("failed", hasPhoto);
      setErrorMessage(
        "We couldn’t prepare these files. Nothing was handed off. Try again.",
      );
      setLiveStatus("");
    } finally {
      if (runId === runIdRef.current) {
        preparingRef.current = false;
        setIsPreparing(false);
      }
    }
  };

  const handleManualDownload = async () => {
    if (
      !manualFiles ||
      !canSubmit ||
      !latestFile ||
      !selectedShadchan ||
      !selectedChannel?.contact
    )
      return;
    if (preparingRef.current) return;
    preparingRef.current = true;
    const hasPhoto = includesPhoto;
    const runId = ++runIdRef.current;
    const message = buildManualHandoffMessage(
      singleName,
      shadchanName,
      hasPhoto,
    );
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsPreparing(true);
    setErrorMessage(undefined);
    setManualStatus("");
    setLiveStatus("Preparing the files…");
    try {
      const files = await fetchFilesForSelection(
        runId,
        controller.signal,
        hasPhoto,
      );
      await completeManualDownload(files, message, hasPhoto, runId);
    } catch {
      if (isCurrentRun(runId)) {
        setErrorMessage(
          "We couldn’t prepare these files. Nothing was handed off. Try again.",
        );
      }
    } finally {
      if (runId === runIdRef.current) {
        preparingRef.current = false;
        setIsPreparing(false);
      }
    }
  };

  const handleCopyMessage = async () => {
    if (!manualMessage || !navigator.clipboard) return;
    await navigator.clipboard.writeText(manualMessage);
    setManualStatus(
      "Message copied. Attach the downloaded files before sending.",
    );
  };

  const retryMetadata = () => {
    setErrorMessage(undefined);
    void refetchShadchanim();
    void refetchResumes();
    if (resume?.id != null) void refetchPhotos();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      runIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      preparingRef.current = false;
      setIsPreparing(false);
      setShadchanId(undefined);
      setShadchanSearch("");
      setChannel(undefined);
      setResumeOnlyConfirmed(false);
      setManualFiles(null);
      setManualMessage("");
      setManualStatus("");
      setErrorMessage(undefined);
      setLiveStatus("");
      setHistoryVisible(false);
    }
    onOpenChange(nextOpen);
  };

  const metadataStatus = isMetadataPending
    ? "Checking the available files…"
    : liveStatus;
  const photoReason = photosError
    ? "We couldn’t check the available photos. Try again."
    : hasHiddenPhoto
      ? "A photo is hidden and cannot be sent."
      : hasPrivatePhoto
        ? "A photo is private to parents and cannot be sent."
        : "No shared photo available.";
  const nativeShareAvailable =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function";
  const finalActionLabel = nativeShareAvailable
    ? includesPhoto
      ? "Share resume and photo"
      : "Share resume only"
    : includesPhoto
      ? "Download files and prepare message"
      : "Download resume and prepare message";
  const finalActionHelp = !selectedShadchan
    ? "Choose a shadchan to continue."
    : !selectedChannel
      ? "Choose a contact channel to continue."
      : !latestFile || !resumeSelected
        ? "No resume available"
        : needsResumeOnlyConfirmation && !resumeOnlyConfirmed
          ? "Confirm that you want to continue with the resume only."
          : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        aria-busy={isPreparing}
      >
        <DialogHeader>
          <DialogTitle>Send files to a shadchan</DialogTitle>
          <DialogDescription>
            Review the recipient, channel, and exact files before handing them
            to your own device or messaging app.
          </DialogDescription>
        </DialogHeader>

        {!isManager ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              This action is available only to the household manager.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-5">
            <section className="grid gap-2" aria-labelledby="send-kid-label">
              <div className="flex items-center justify-between gap-3">
                <Label id="send-kid-label">Kid</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowKidPicker((visible) => !visible)}
                  disabled={isPreparing}
                >
                  Change kid
                </Button>
              </div>
              <p dir="auto" className="rounded-md border px-3 py-2 text-sm">
                {singleName}
              </p>
              {showKidPicker ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="send-kid-picker">
                    Choose a different kid
                  </Label>
                  <Select
                    value={String(single.id)}
                    disabled={isPreparing}
                    onValueChange={(value) => {
                      const nextSingle = singleOptions.find(
                        (option) => String(option.id) === value,
                      );
                      if (nextSingle) {
                        clearManualState();
                        onSingleChange?.(nextSingle.id);
                      }
                      setShowKidPicker(false);
                    }}
                  >
                    <SelectTrigger id="send-kid-picker" aria-label="Kid">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {singleOptions.map((option) => (
                        <SelectItem key={option.id} value={String(option.id)}>
                          {nameForSingle(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </section>

            <section
              className="grid gap-2"
              aria-labelledby="send-shadchan-label"
            >
              <Label id="send-shadchan-label" htmlFor="send-shadchan-search">
                Shadchan
              </Label>
              <Input
                id="send-shadchan-search"
                aria-label="Search shadchan"
                placeholder="Search shadchan"
                value={shadchanSearch}
                onChange={(event) => setShadchanSearch(event.target.value)}
                disabled={
                  isPreparing || isShadchanimPending || Boolean(shadchanimError)
                }
              />
              <Select
                value={shadchanId ?? ""}
                onValueChange={(value) => {
                  clearManualState();
                  setShadchanId(value);
                  setChannel(undefined);
                  setErrorMessage(undefined);
                }}
                disabled={
                  isPreparing ||
                  isShadchanimPending ||
                  Boolean(shadchanimError) ||
                  filteredShadchanim.length === 0
                }
              >
                <SelectTrigger id="send-shadchan" aria-label="Shadchan">
                  <SelectValue placeholder="Choose a shadchan" />
                </SelectTrigger>
                <SelectContent>
                  {filteredShadchanim.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {shadchanimError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    We couldn’t load your shadchan list. Try again.
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={retryMetadata}
                    >
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : shadchanim.length === 0 && !isShadchanimPending ? (
                <p className="text-sm text-muted-foreground">
                  No shadchan saved yet.
                </p>
              ) : null}
            </section>

            <section
              className="grid gap-2"
              aria-labelledby="send-channel-label"
            >
              <Label id="send-channel-label">
                How would you like to contact them?
              </Label>
              <RadioGroup
                aria-label="How would you like to contact them?"
                value={channel ?? ""}
                onValueChange={(value) => {
                  clearManualState();
                  setChannel(value as OutboundShareChannel);
                }}
                disabled={isPreparing}
                className="gap-2"
              >
                {channelOptions.map((option) => {
                  const reasonId = `send-${option.channel}-reason`;
                  return (
                    <div
                      key={option.channel}
                      className="flex items-start gap-3 rounded-md border p-3"
                    >
                      <RadioGroupItem
                        value={option.channel}
                        id={`send-channel-${option.channel}`}
                        aria-label={option.label}
                        disabled={!option.contact}
                        aria-describedby={reasonId}
                      />
                      <div className="grid gap-0.5">
                        <Label htmlFor={`send-channel-${option.channel}`}>
                          {option.label}
                        </Label>
                        <p
                          id={reasonId}
                          className="text-sm text-muted-foreground"
                        >
                          {option.contact ?? option.missingReason}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </RadioGroup>
              {selectedShadchan &&
              channelOptions.every((option) => !option.contact) ? (
                <p className="text-sm text-muted-foreground">
                  Add a phone, WhatsApp number, or email for this shadchan
                  before sending.
                </p>
              ) : null}
            </section>

            <section
              className="grid gap-3 rounded-md border p-3"
              aria-labelledby="send-files-label"
              aria-busy={isMetadataPending}
            >
              <div>
                <p id="send-files-label" className="font-medium">
                  Files
                </p>
                <p className="text-sm text-muted-foreground">
                  Nothing leaves MyShadchan until you confirm in the next step.
                </p>
              </div>
              {isMetadataPending ? (
                <div aria-live="polite" className="grid gap-2">
                  <span className="sr-only">Checking the available files…</span>
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id="send-resume"
                      aria-label="Resume"
                      checked={resumeSelected}
                      disabled={isPreparing || !latestFile}
                      onCheckedChange={(checked) => {
                        clearManualState();
                        setResumeSelected(checked === true);
                        setResumeOnlyConfirmed(false);
                      }}
                      aria-describedby="send-resume-details"
                    />
                    <div id="send-resume-details" className="grid gap-0.5">
                      <Label htmlFor="send-resume">Resume</Label>
                      {latestFile ? (
                        <p dir="auto" className="text-sm text-muted-foreground">
                          {describeFile(
                            latestFile.filename,
                            latestFile.mime_type,
                            latestFile.size,
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-destructive">
                          No resume available
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id="send-photo"
                      aria-label="Photo"
                      checked={photoSelected}
                      disabled={
                        isPreparing ||
                        !newestEligiblePhoto ||
                        Boolean(photosError)
                      }
                      onCheckedChange={(checked) => {
                        clearManualState();
                        setPhotoSelected(checked === true);
                        setResumeOnlyConfirmed(false);
                      }}
                      aria-describedby="send-photo-details"
                    />
                    <div id="send-photo-details" className="grid gap-0.5">
                      <Label htmlFor="send-photo">Photo</Label>
                      {newestEligiblePhoto ? (
                        <p dir="auto" className="text-sm text-muted-foreground">
                          {describeFile(
                            photoFilename(newestEligiblePhoto),
                            photoMimeType(newestEligiblePhoto),
                            photoSize(newestEligiblePhoto),
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {photoReason}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>

            {needsResumeOnlyConfirmation ? (
              <div className="grid gap-2 rounded-md border border-amber-500/50 p-3 text-sm">
                <p>
                  Only the resume will be included because no photo is selected
                  or available. Please confirm before continuing.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={resumeOnlyConfirmed ? "default" : "outline"}
                    onClick={() => setResumeOnlyConfirmed(true)}
                    disabled={!latestFile || !resumeSelected}
                  >
                    Continue with resume only
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      clearManualState();
                      setPhotoSelected(Boolean(newestEligiblePhoto));
                      setResumeOnlyConfirmed(false);
                    }}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            ) : null}

            <p
              id="send-safety-notice"
              className="rounded-md bg-muted p-3 text-sm"
            >
              Please check the kid, shadchan, channel, and files. Once a file
              leaves MyShadchan, we can’t take it back.
            </p>

            {metadataStatus ? (
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {metadataStatus}
              </p>
            ) : null}
            {resumeError || photosError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  {resumeError
                    ? "We couldn’t load the resume. Try again."
                    : "We couldn’t check the available photos. Try again."}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={retryMetadata}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {errorMessage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  {errorMessage}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePrepare}
                  >
                    Try again
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setErrorMessage(undefined)}
                  >
                    Cancel
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {manualFiles ? (
              <div className="grid gap-2 rounded-md border p-3 text-sm">
                <p aria-live="polite">{manualStatus}</p>
                <Button
                  type="button"
                  onClick={handleManualDownload}
                  disabled={isPreparing}
                >
                  Download files
                </Button>
                {manualStatus.includes("did not open") ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopyMessage}
                  >
                    Copy message
                  </Button>
                ) : null}
              </div>
            ) : null}

            {isManager ? (
              <section
                className="grid gap-2 border-t pt-4"
                aria-labelledby="send-history-title"
              >
                <Button
                  type="button"
                  variant="outline"
                  className="justify-between"
                  onClick={() => setHistoryVisible((visible) => !visible)}
                >
                  <span id="send-history-title">
                    {historyVisible ? "Hide send history" : "View send history"}
                  </span>
                </Button>
                {historyVisible ? (
                  <div className="grid gap-2" aria-live="polite">
                    {isHistoryPending ? (
                      <Skeleton className="h-12 w-full" />
                    ) : null}
                    {historyError ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          Couldn’t load send history. Try again.
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void refetchHistory()}
                          >
                            Try again
                          </Button>
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {!isHistoryPending &&
                    !historyError &&
                    history.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No send history yet.
                      </p>
                    ) : null}
                    {history.map((row) => (
                      <div
                        key={row.id}
                        className="grid gap-0.5 rounded-md border p-3 text-sm"
                      >
                        <p className="font-medium">
                          {OUTCOME_LABELS[row.outcome]}
                        </p>
                        <p className="text-muted-foreground">
                          {shadchanim.find(
                            (item) =>
                              String(item.id) === String(row.shadchan_id),
                          )?.name ?? "Shadchan"}{" "}
                          · {CHANNEL_LABELS[row.channel]} ·{" "}
                          {row.file_kinds.includes("photo")
                            ? "Resume + photo"
                            : "Resume"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(row.created_at))}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            ref={finalButtonRef}
            type="button"
            onClick={handlePrepare}
            disabled={!canSubmit}
            aria-describedby="send-safety-notice send-action-help"
          >
            {isPreparing ? "Preparing the files…" : finalActionLabel}
          </Button>
          <span id="send-action-help" className="sr-only" aria-live="polite">
            {finalActionHelp}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SendToShadchanButton({
  single,
  singleOptions,
  onSingleChange,
}: {
  single: Single;
  singleOptions?: Single[];
  onSingleChange?: (id: Single["id"]) => void;
}): ReactElement | null {
  const { role, isPending } = useViewerRole();
  const [open, setOpen] = useState(false);

  if (isPending || !role || !MANAGER_ROLES.has(role)) return null;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Send resume and photo
      </Button>
      <SendToShadchanDialog
        open={open}
        onOpenChange={setOpen}
        single={single}
        singleOptions={singleOptions}
        onSingleChange={onSingleChange}
        viewerRole={role}
      />
    </>
  );
}
