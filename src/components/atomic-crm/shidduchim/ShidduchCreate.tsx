import type { Identifier } from "ra-core";
import { Loader2, Paperclip, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
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
import type { CreateShidduchInput, InboxItem, PipelineState } from "../types";
import {
  useParseResume,
  type ParsedResumeResponse,
} from "../inbox/useParseResume";
import { useResolveInboxItem } from "../inbox/useResolveInboxItem";
import {
  isAutoFillResumeMimeType,
  friendlyResumeReadError,
  friendlyResumeUploadError,
  friendlySuggestionSubmitError,
  RESUME_UPLOAD_ACCEPT,
  resumeMimeType,
  validateResumeUpload,
} from "../inbox/resumeUpload";
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

const DraftResetter = ({ draft }: { draft: ParsedResumeResponse | null }) => {
  const { formState, getValues, setValue } =
    useFormContext<Record<string, unknown>>();

  useEffect(() => {
    if (!draft) return;
    for (const [field, value] of Object.entries(draft.fields)) {
      const currentValue = getValues(field);
      const isEmpty =
        currentValue === null ||
        currentValue === undefined ||
        currentValue === "";
      if (
        formState.dirtyFields[field] ||
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
  }, [draft, formState.dirtyFields, getValues, setValue]);

  return null;
};

const ResumeUploadPanel = ({
  file,
  disabled,
  isParsing,
  message,
  onChange,
}: {
  file: File | null;
  disabled: boolean;
  isParsing: boolean;
  message: string | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) => (
  <section className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Resume
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF, Word, JPG, PNG, HEIC, HEIF, or WebP · 8 MB maximum
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2"
        disabled={disabled}
        onClick={() => document.getElementById("suggestion-resume")?.click()}
      >
        <Paperclip className="size-4" aria-hidden="true" />
        {file ? "Replace resume" : "Attach resume"}
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
      <p className="text-sm text-foreground" role="status">
        Attached: <span className="font-medium">{file.name}</span>
      </p>
    )}
    {isParsing && (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading your resume…
      </p>
    )}
    {message && (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {message}
      </p>
    )}
  </section>
);

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
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const attemptedCaptureId = useRef<Identifier | null>(null);
  // Once resolution starts, keep the capture even if a later persistence step
  // fails. The suggestion may already exist, and the uploaded resume is the
  // only copy available for a retry.
  const submittedCaptureId = useRef<Identifier | null>(null);

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
      notify(validationError, { type: "error" });
      return;
    }

    const mimeType = resumeMimeType(selected);
    const file =
      selected.type === mimeType
        ? selected
        : new File([selected], selected.name, { type: mimeType });

    setIsUploading(true);
    try {
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
      setResumeCapture(updatedItem ?? { ...item, attachments: [attachment] });
      setParsedDraft(null);
      setResumeMessage(null);
    } catch {
      setResumeFile(null);
      setResumeCapture(null);
      setResumeMessage(null);
      notify(friendlyResumeUploadError(), { type: "error" });
    } finally {
      setIsUploading(false);
    }
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
        "Word auto-fill isn’t available yet, but your file is attached.",
      );
      return;
    }
    if (!isEntitled) {
      setResumeMessage(
        "Your resume is attached. AI auto-fill isn’t available on this plan.",
      );
      return;
    }

    setResumeMessage(null);
    void parse(resumeCapture)
      .then((draft) => {
        setParsedDraft(draft);
        setResumeMessage(
          "Resume read. Please review the highlighted fields before saving.",
        );
      })
      .catch((error: unknown) => {
        setResumeMessage(friendlyResumeReadError(error));
      });
  }, [isEntitled, isEntitlementLoading, parse, resumeCapture, resumeFile]);

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
      if (resumeCapture?.attachments?.[0]) {
        submittedCaptureId.current = resumeCapture.id;
        await resolveAsNewShidduch(resumeCapture, input, {
          attachment: resumeCapture.attachments[0],
          rawDraft: parsedDraft?.rawDraft ?? null,
          sections: parsedDraft?.sections ?? null,
        });
      } else {
        await dataProvider.createShidduch(input);
      }
      notify("Shidduch added", { type: "info" });
      refresh();
      redirect(buildListPath("shidduchim"));
    } catch (error) {
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
          disabled={isUploading || isParsing}
          isParsing={isParsing}
          message={resumeMessage}
          onChange={handleResumeChange}
        />
        <DraftResetter draft={parsedDraft} />
        <ShidduchInputs
          onCreateShadchan={handleCreateShadchan}
          lowConfidenceFields={parsedDraft?.lowConfidenceFields ?? []}
        />
        <FormToolbar saveLabel="Add a suggestion" />
      </Form>
    </FormPageFrame>
  );
};
