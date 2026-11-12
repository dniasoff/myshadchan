import type { Identifier } from "ra-core";
import { ImagePlus, Loader2, Paperclip, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, MutableRefObject } from "react";
import {
  Form,
  useDataProvider,
  useNotify,
  useRedirect,
  useRefresh,
} from "ra-core";
import { useFormContext } from "react-hook-form";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";

import { buildListPath } from "../entity360/entityPaths";
import { FormToolbar } from "../layout/FormToolbar";
import { FormPageFrame } from "../misc/FormPageFrame";
import { useAiEntitlement } from "../references/useAiEntitlement";
import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  InboxItem,
  PipelineState,
  ResumePhotoVisibility,
} from "../types";
import {
  useParseResume,
  type ParsedResumeResponse,
} from "../inbox/useParseResume";
import { useResolveInboxItem } from "../inbox/useResolveInboxItem";
import {
  isAutoFillResumeMimeType,
  friendlyResumeReadError,
  friendlyResumeMimeType,
  friendlyResumeUploadError,
  friendlySuggestionSubmitError,
  RESUME_UPLOAD_ACCEPT,
  resumeReadSuccessMessage,
  resumeMimeType,
  validateResumeUpload,
} from "../inbox/resumeUpload";
import {
  PHOTO_UPLOAD_ACCEPT,
  photoMimeType,
  validatePhotoUpload,
} from "../resumes/photoUpload";
import { EnlargePhotoIcon, PhotoLightbox } from "../resumes/PhotoLightbox";
import { createShadchanInline } from "./createShadchanInline";
import { INITIAL_PIPELINE_STATES } from "./pipelineStates";
import { ShidduchInputs } from "./ShidduchInputs";

function readTextField(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readNumberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const DraftResetter = ({
  draft,
  onSnapshot,
  snapshot,
  onRevertRef,
}: {
  draft: ParsedResumeResponse | null;
  onSnapshot: (snapshot: Record<string, unknown> | null) => void;
  snapshot: Record<string, unknown> | null;
  onRevertRef: MutableRefObject<(() => void) | null>;
}) => {
  const { formState, getValues, setValue } =
    useFormContext<Record<string, unknown>>();
  const dirtyFieldsRef = useRef(formState.dirtyFields);
  const snapshottedDraftRef = useRef<ParsedResumeResponse | null>(null);
  dirtyFieldsRef.current = formState.dirtyFields;

  useEffect(() => {
    if (!draft) {
      onRevertRef.current = null;
      return;
    }
    const snapshot = getValues();
    const fieldsToFill = Object.entries(draft.fields).filter(
      ([field, value]) => {
        const currentValue = snapshot[field];
        const isEmpty =
          currentValue === null ||
          currentValue === undefined ||
          currentValue === "";
        return isEmpty && value !== null && value !== "";
      },
    );
    if (snapshottedDraftRef.current !== draft) {
      onSnapshot(fieldsToFill.length > 0 ? snapshot : null);
      snapshottedDraftRef.current = draft;
    }
    for (const [field, value] of Object.entries(draft.fields)) {
      const currentValue = getValues(field);
      const isEmpty =
        currentValue === null ||
        currentValue === undefined ||
        currentValue === "";
      if (
        dirtyFieldsRef.current[field] ||
        !isEmpty ||
        value === null ||
        value === ""
      ) {
        continue;
      }
      setValue(field, value, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [draft, getValues, onRevertRef, onSnapshot, setValue]);

  useEffect(() => {
    if (!draft || !snapshot) {
      onRevertRef.current = null;
      return;
    }
    onRevertRef.current = () => {
      const currentValues = getValues();
      for (const [field, value] of Object.entries(draft.fields)) {
        if (value === null || value === "" || currentValues[field] !== value) {
          continue;
        }
        setValue(field, snapshot[field], {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      }
    };
    return () => {
      onRevertRef.current = null;
    };
  }, [draft, getValues, onRevertRef, setValue, snapshot]);

  return null;
};

const AutoFillUndo = ({
  snapshot,
  onUndo,
}: {
  snapshot: Record<string, unknown> | null;
  onUndo: () => void;
}) => {
  const { setValue } = useFormContext<Record<string, unknown>>();
  if (!snapshot) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-11 self-start"
      onClick={() => {
        for (const [field, value] of Object.entries(snapshot)) {
          setValue(field, value, {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          });
        }
        onUndo();
      }}
    >
      Undo auto-fill
    </Button>
  );
};

const ResumeUploadPanel = ({
  file,
  disabled,
  isParsing,
  message,
  messageIsError,
  onChange,
  onRemove,
  onTryAgain,
  onEnterDetails,
  selectionError,
  onChooseAnother,
  undoSnapshot,
  onUndo,
  showOriginalNote,
}: {
  file: File | null;
  disabled: boolean;
  isParsing: boolean;
  message: string | null;
  messageIsError: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onTryAgain: () => void;
  onEnterDetails: () => void;
  selectionError: string | null;
  onChooseAnother: () => void;
  undoSnapshot: Record<string, unknown> | null;
  onUndo: () => void;
  showOriginalNote: boolean;
}) => {
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      message &&
      !messageIsError &&
      message.startsWith("We found") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement?.tagName ?? "",
      )
    ) {
      messageRef.current?.focus();
    }
  }, [message, messageIsError]);

  return (
    <section
      aria-label="Resume upload"
      className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:p-5"
      aria-busy={isParsing}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Resume (optional)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF, Word (.docx or .doc), JPG, PNG, HEIC or WebP · up to 8 MB. We
            keep the original file.
          </p>
          <div className="mt-1 text-xs text-muted-foreground">
            <span>
              Older Word files (.doc) can be attached, but cannot be read for
              auto-fill yet.
            </span>
            {file?.type === "application/msword" && (
              <Button
                type="button"
                variant="ghost"
                className="ms-2 h-9 px-2"
                onClick={onChooseAnother}
              >
                Upload a .docx or PDF
              </Button>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2"
          disabled={disabled}
          onClick={() => document.getElementById("suggestion-resume")?.click()}
        >
          <Paperclip className="size-4" aria-hidden="true" />
          {file ? "Replace file" : "Attach a resume"}
        </Button>
        <input
          id="suggestion-resume"
          type="file"
          className="hidden"
          accept={RESUME_UPLOAD_ACCEPT}
          aria-label="Attach resume"
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {file && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          <span
            className="min-w-0 break-words font-medium"
            dir="auto"
            style={{ unicodeBidi: "plaintext" }}
            title={file.name}
          >
            {file.name}
          </span>
          <span className="text-muted-foreground">
            {friendlyResumeMimeType(resumeMimeType(file))} ·{" "}
            {formatResumeSize(file.size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove file
          </Button>
        </div>
      )}
      {isParsing && (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Reading your resume… We’re looking for details to save you typing. You
          can still fill in the form yourself.
        </p>
      )}
      {message && (
        <div
          ref={messageRef}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          role={messageIsError ? "alert" : "status"}
          aria-label={
            messageIsError
              ? "Resume auto-fill error"
              : "Resume auto-fill result"
          }
          aria-live={messageIsError ? undefined : "polite"}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          <span>{message}</span>
          {messageIsError && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onTryAgain}
                disabled={disabled}
              >
                Try again
              </Button>
              <Button type="button" variant="ghost" onClick={onEnterDetails}>
                Enter details myself
              </Button>
            </>
          )}
        </div>
      )}
      {selectionError && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span>{selectionError}</span>
          <Button type="button" variant="outline" onClick={onChooseAnother}>
            Choose another file
          </Button>
        </div>
      )}
      {showOriginalNote && (
        <p className="text-sm text-muted-foreground" role="status">
          The original file is still attached and unchanged.
        </p>
      )}
      <AutoFillUndo snapshot={undoSnapshot} onUndo={onUndo} />
    </section>
  );
};

const formatResumeSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const formatPhotoSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const PhotoUploadPanel = ({
  file,
  previewUrl,
  visibility,
  message,
  onChange,
  onRemove,
  onVisibilityChange,
}: {
  file: File | null;
  previewUrl: string | null;
  visibility: ResumePhotoVisibility;
  message: string | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onVisibilityChange: (visibility: ResumePhotoVisibility) => void;
}) => {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const viewerOpenerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPreviewFailed(false);
    setPreviewLoaded(false);
    setIsViewerOpen(false);
  }, [file, previewUrl]);

  const canEnlarge = Boolean(previewUrl && previewLoaded && !previewFailed);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Photo (optional)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a photo of the person being suggested. JPG, PNG, HEIC or WebP ·
            up to 8 MB.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2"
          onClick={() => document.getElementById("suggestion-photo")?.click()}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {file ? "Replace photo" : "Upload a photo"}
        </Button>
        <input
          id="suggestion-photo"
          type="file"
          className="hidden"
          accept={PHOTO_UPLOAD_ACCEPT}
          aria-label={file ? "Choose another photo" : "Upload a photo"}
          onChange={onChange}
        />
      </div>
      {file && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
            {previewUrl && !previewFailed ? (
              canEnlarge ? (
                <button
                  type="button"
                  aria-label="View enlarged photo"
                  className="size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    viewerOpenerRef.current = event.currentTarget;
                    setIsViewerOpen(true);
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="Selected photo preview"
                    className="size-full object-contain"
                    onLoad={() => setPreviewLoaded(true)}
                    onError={() => setPreviewFailed(true)}
                  />
                </button>
              ) : (
                <img
                  src={previewUrl}
                  alt="Selected photo preview"
                  className="size-full object-contain"
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setPreviewFailed(true)}
                />
              )
            ) : (
              <div
                className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground"
                role="img"
                aria-label="Selected photo file"
              >
                <span className="max-w-full truncate font-medium text-foreground">
                  {file.name}
                </span>
                <span>{formatPhotoSize(file.size)}</span>
                <span>{photoMimeType(file)}</span>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium" role="status" aria-live="polite">
              Photo ready to add.
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {file.name} · {formatPhotoSize(file.size)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {canEnlarge ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1.5"
                  aria-label="Enlarge photo"
                  onClick={(event) => {
                    viewerOpenerRef.current = event.currentTarget;
                    setIsViewerOpen(true);
                  }}
                >
                  <EnlargePhotoIcon />
                  Enlarge
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={onRemove}
              >
                Remove photo
              </Button>
            </div>
          </div>
        </div>
      )}
      {canEnlarge && previewUrl && file ? (
        <PhotoLightbox
          open={isViewerOpen}
          onOpenChange={setIsViewerOpen}
          url={previewUrl}
          caption={file.name}
          openerRef={viewerOpenerRef}
        />
      ) : null}
      {file && (
        <fieldset>
          <legend className="text-sm font-medium">Visibility</legend>
          <div
            className="mt-2 flex flex-row gap-4"
            role="radiogroup"
            aria-label="Visibility"
          >
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="suggestion-photo-visibility"
                value="shared"
                checked={visibility === "shared"}
                onChange={() => onVisibilityChange("shared")}
              />
              Shared
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="suggestion-photo-visibility"
                value="private_parent"
                checked={visibility === "private_parent"}
                onChange={() => onVisibilityChange("private_parent")}
              />
              Parents only
            </label>
          </div>
        </fieldset>
      )}
      {message && (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive">{message}</p>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => document.getElementById("suggestion-photo")?.click()}
          >
            Choose another photo
          </Button>
        </div>
      )}
    </section>
  );
};

/**
 * The page at `/shidduchim/new` (UX-DR3 — records live at URLs, not in
 * modals; Story 3.13). Submits straight to createShidduch (AD-4 invariant
 * 1) — the sole INSERT path — never a raw dataProvider.create. The starting
 * column comes from a `?state=` query param (set by the per-column "Add
 * here"), defaulting to New. A page has no open state; closing it is
 * `CancelButton`'s `navigate(-1)`, reached via `FormToolbar` below.
 */
export const ShidduchCreate = ({ singleId }: { singleId?: Identifier }) => {
  const redirect = useRedirect();
  const refresh = useRefresh();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [searchParams] = useSearchParams();
  const { isEntitled, isLoading: isEntitlementLoading } = useAiEntitlement();
  const { parse, isParsing } = useParseResume();
  const { resolveAsNewShidduch } = useResolveInboxItem();
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeCapture, setResumeCapture] = useState<InboxItem | null>(null);
  const [parsedDraft, setParsedDraft] = useState<ParsedResumeResponse | null>(
    null,
  );
  const [draftSnapshot, setDraftSnapshot] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [isSubmitStarted, setIsSubmitStarted] = useState(false);
  const [resumeRetryCount, setResumeRetryCount] = useState(0);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);
  const [resumeMessageIsError, setResumeMessageIsError] = useState(false);
  const [resumeSelectionError, setResumeSelectionError] = useState<
    string | null
  >(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoVisibility, setPhotoVisibility] =
    useState<ResumePhotoVisibility>("shared");
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const attemptedCaptureId = useRef<Identifier | null>(null);
  const revertAutoFilledFieldsRef = useRef<(() => void) | null>(null);
  // Once resolution starts, keep the capture even if a later persistence step
  // fails. The suggestion may already exist, and the uploaded resume is the
  // only copy available for a retry.
  const submittedCaptureId = useRef<Identifier | null>(null);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const stateParam = searchParams.get("state") as PipelineState | null;
  const initialState =
    stateParam && INITIAL_PIPELINE_STATES.includes(stateParam)
      ? stateParam
      : "new";

  // FR78's inline "+ Add a shadchan" (review fix F4, Story 10.1): the manual
  // "Add a suggestion" flow is the OTHER `ShidduchInputs` caller the story's
  // own comment names ("consistent wherever ShidduchInputs is reused") —
  // wired here with the same shared helper as ShareTarget.tsx and
  // InboxResolveDialog.tsx.
  const handleCreateShadchan = createShadchanInline(dataProvider);

  const discardResumeCapture = useCallback(
    async (capture: InboxItem) => {
      const attachmentPath = capture.attachments?.[0]?.path;
      await Promise.allSettled([
        dataProvider.update<InboxItem>("inbox_items", {
          id: capture.id,
          data: { status: "dismissed", attachments: null },
          previousData: capture,
        }),
        attachmentPath
          ? dataProvider.removeInboxAttachment(attachmentPath)
          : Promise.resolve(),
      ]);
    },
    [dataProvider],
  );

  useEffect(() => {
    const capture = resumeCapture;
    if (!capture) return;
    return () => {
      if (submittedCaptureId.current === capture.id) return;
      void discardResumeCapture(capture);
    };
  }, [discardResumeCapture, resumeCapture]);

  const handleResumeChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isUploading || isParsing) return;
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;

    const validationError = validateResumeUpload(selected);
    if (validationError) {
      setResumeSelectionError(validationError);
      return;
    }
    setResumeSelectionError(null);
    if (resumeCapture) submittedCaptureId.current = null;
    revertAutoFilledFieldsRef.current?.();

    const mimeType = resumeMimeType(selected);
    const file =
      selected.type === mimeType
        ? selected
        : new File([selected], selected.name, { type: mimeType });

    setIsUploading(true);
    try {
      setResumeMessageIsError(false);
      setResumeMessage("Saving your resume…");
      const { data: item } = await dataProvider.create<InboxItem>(
        "inbox_items",
        {
          data: {
            source: "upload",
            raw_text: null,
            attachments: null,
            status: "unresolved",
          },
        },
      );
      const attachment = await dataProvider.uploadInboxAttachment({
        file,
        inboxItemId: item.id,
      });
      const { data: updatedItem } = await dataProvider.update<InboxItem>(
        "inbox_items",
        {
          id: item.id,
          data: { attachments: [attachment] },
          previousData: item,
        },
      );
      setResumeFile(file);
      attemptedCaptureId.current = null;
      setResumeRetryCount(0);
      setResumeCapture(updatedItem ?? { ...item, attachments: [attachment] });
      setParsedDraft(null);
      setDraftSnapshot(null);
      setResumeMessage(null);
      setResumeMessageIsError(false);
    } catch {
      setResumeFile(null);
      setResumeCapture(null);
      setResumeMessage(null);
      setResumeMessageIsError(false);
      notify(friendlyResumeUploadError(), { type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;

    const validationError = validatePhotoUpload(selected);
    if (validationError) {
      setPhotoMessage(validationError);
      return;
    }

    const mimeType = photoMimeType(selected);
    const file =
      selected.type === mimeType
        ? selected
        : new File([selected], selected.name, { type: mimeType });
    setPhotoFile(file);
    setPhotoMessage(null);
  };

  useEffect(() => {
    if (
      !resumeCapture ||
      !resumeFile ||
      isEntitlementLoading ||
      attemptedCaptureId.current === resumeCapture.id
    ) {
      return;
    }
    attemptedCaptureId.current = resumeCapture.id;

    const mimeType = resumeMimeType(resumeFile);
    if (!isAutoFillResumeMimeType(mimeType)) {
      setResumeMessage(
        "This older Word file (.doc) cannot be read for auto-fill yet. Save it as .docx or PDF, then upload it again. You can still enter the details yourself.",
      );
      setResumeMessageIsError(false);
      return;
    }
    if (!isEntitled) {
      setResumeMessage(
        "Auto-fill isn’t available on this account right now. Your file is still attached; you can enter the details yourself.",
      );
      setResumeMessageIsError(false);
      return;
    }

    setResumeMessageIsError(false);
    setResumeMessage(null);
    let active = true;
    void parse(resumeCapture)
      .then((draft) => {
        if (!active) return;
        setParsedDraft(draft);
        setResumeMessage(resumeReadSuccessMessage(draft.fields));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResumeMessage(friendlyResumeReadError(error, mimeType));
        setResumeMessageIsError(true);
      });
    return () => {
      active = false;
    };
  }, [
    isEntitled,
    isEntitlementLoading,
    parse,
    resumeCapture,
    resumeFile,
    resumeRetryCount,
  ]);

  const onSubmit = async (values: Record<string, unknown>) => {
    if (isUploading || isParsing) {
      notify(
        "Please wait while your resume is being read. Your changes are safe.",
        {
          type: "info",
        },
      );
      return;
    }
    try {
      const input: CreateShidduchInput = {
        single_id: values.single_id as Identifier,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        name_en: readTextField(values.name_en),
        name_he: readTextField(values.name_he),
        father_en: readTextField(values.father_en),
        father_he: readTextField(values.father_he),
        mother_en: readTextField(values.mother_en),
        mother_he: readTextField(values.mother_he),
        seminary_en: readTextField(values.seminary_en),
        seminary_he: readTextField(values.seminary_he),
        shul_en: readTextField(values.shul_en),
        shul_he: readTextField(values.shul_he),
        location_en: readTextField(values.location_en),
        location_he: readTextField(values.location_he),
        age: readNumberField(values.age),
        height: readTextField(values.height),
        dob: readTextField(values.dob),
        background: readTextField(values.background),
        marital_status: readTextField(values.marital_status),
        person_gender: readTextField(values.person_gender),
        kohen_status: readTextField(values.kohen_status) ?? "unknown",
        existing_children_note: readTextField(values.existing_children_note),
        origin: "manual",
        initial_state: (values.initial_state as PipelineState) ?? initialState,
        visibility: "shared",
        redt_date: (values.redt_date as string) ?? null,
      };
      let created;
      if (resumeCapture?.attachments?.[0]) {
        setIsSubmitStarted(true);
        submittedCaptureId.current = resumeCapture.id;
        created = await resolveAsNewShidduch(resumeCapture, input, {
          attachment: resumeCapture.attachments[0],
          rawDraft: parsedDraft?.rawDraft ?? null,
          sections: parsedDraft?.sections ?? null,
        });
      } else {
        created = await dataProvider.createShidduch(input);
      }
      if (photoFile) {
        try {
          await dataProvider.uploadResumePhoto({
            shidduchimId: created.id,
            file: photoFile,
            visibility: photoVisibility,
          });
          notify("Suggestion saved. Photo added.", { type: "info" });
        } catch {
          notify(
            "We couldn’t save the photo. The suggestion was saved, and you can add the photo later.",
            { type: "error", autoHideDuration: null },
          );
        }
      } else {
        notify("Shidduch added", { type: "info" });
      }
      refresh();
      redirect(buildListPath("shidduchim"));
    } catch (error) {
      setIsSubmitStarted(false);
      notify(friendlySuggestionSubmitError(error), { type: "error" });
    }
  };

  return (
    <FormPageFrame
      eyebrow="Pipeline"
      heading="Add a suggestion"
      description="Fill in what you know now. The rest can be added later."
    >
      <Form
        onSubmit={onSubmit}
        mode="onBlur"
        defaultValues={{
          single_id: singleId,
          initial_state: initialState,
          redt_date: new Date().toISOString().split("T")[0],
        }}
      >
        <ResumeUploadPanel
          file={resumeFile}
          disabled={isUploading || isParsing || isSubmitStarted}
          isParsing={isParsing}
          message={resumeMessage}
          messageIsError={resumeMessageIsError}
          onChange={handleResumeChange}
          selectionError={resumeSelectionError}
          onChooseAnother={() =>
            document.getElementById("suggestion-resume")?.click()
          }
          undoSnapshot={draftSnapshot}
          showOriginalNote={Boolean(parsedDraft)}
          onUndo={() => {
            setParsedDraft(null);
            setDraftSnapshot(null);
            setResumeMessage(
              "Auto-fill undone. The original file is still attached and unchanged.",
            );
            setResumeMessageIsError(false);
          }}
          onTryAgain={() => {
            attemptedCaptureId.current = null;
            setResumeRetryCount((count) => count + 1);
            setResumeMessage(null);
            setResumeMessageIsError(false);
          }}
          onEnterDetails={() => {
            setResumeMessage(null);
            setResumeMessageIsError(false);
          }}
          onRemove={() => {
            if (isUploading || isParsing || isSubmitStarted) {
              return;
            }
            submittedCaptureId.current = null;
            revertAutoFilledFieldsRef.current?.();
            setResumeFile(null);
            setResumeCapture(null);
            setParsedDraft(null);
            setResumeMessage(null);
            setResumeMessageIsError(false);
          }}
        />
        <PhotoUploadPanel
          file={photoFile}
          previewUrl={photoPreviewUrl}
          visibility={photoVisibility}
          message={photoMessage}
          onChange={handlePhotoChange}
          onRemove={() => {
            setPhotoFile(null);
            setPhotoMessage(null);
          }}
          onVisibilityChange={setPhotoVisibility}
        />
        <DraftResetter
          draft={parsedDraft}
          onSnapshot={setDraftSnapshot}
          snapshot={draftSnapshot}
          onRevertRef={revertAutoFilledFieldsRef}
        />
        <ShidduchInputs
          onCreateShadchan={handleCreateShadchan}
          lowConfidenceFields={parsedDraft?.lowConfidenceFields ?? []}
        />
        <FormToolbar saveLabel="Add a suggestion" />
      </Form>
    </FormPageFrame>
  );
};
