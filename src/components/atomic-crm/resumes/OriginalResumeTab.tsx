import type { Identifier } from "ra-core";
import type { ReactNode } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { buildTabPath } from "../entity360/entityPaths";
import type {
  InboxAttachment,
  InboxItem,
  Resume,
  ShidduchSummary,
} from "../types";
import type { CrmDataProvider } from "../providers/types";
import { signInboxAttachmentUrl } from "../providers/supabase/inboxAttachments";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeDocument } from "./ResumeDocument";
import { canRereadResume } from "./resumeReferenceVisibility";
import { canDeleteResumeFile as canDeleteResumeFileForRole } from "./resumeFileDelete";
import { parseWhatsAppText } from "../inbox/whatsappText";
import { useParseResume } from "../inbox/useParseResume";
import { preserveResumeSourceMarker } from "../inbox/ShareTarget.helpers";

function isPictureAttachment(attachment: InboxAttachment): boolean {
  return (
    (attachment.type ?? "").toLowerCase().startsWith("image/") ||
    /\.(gif|heic|heif|jpeg|jpg|png|webp)$/iu.test(attachment.title ?? "")
  );
}

function hasParsedResumeData(resume?: Resume): boolean {
  if (!resume) return false;
  if (resume.extracted != null) return true;
  const sections = resume.sections;
  return (
    sections != null &&
    typeof sections === "object" &&
    !Array.isArray(sections) &&
    ("learningHistory" in sections || "references" in sections)
  );
}

function WhatsAppTextSource({
  record,
  capture,
  resume,
}: {
  record: ShidduchSummary;
  capture: InboxItem;
  resume?: Resume;
}): ReactNode {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [suggestedName, setSuggestedName] = useState(
    record.name_en?.trim() ||
      parseWhatsAppText(capture.raw_text ?? "").firstBoldText ||
      "",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [promotedPhotos, setPromotedPhotos] = useState<Set<string>>(
    () => new Set(),
  );
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});
  const { parse } = useParseResume();
  const pictures = useMemo(
    () => (capture.attachments ?? []).filter(isPictureAttachment),
    [capture.attachments],
  );
  const [readState, setReadState] = useState<
    "idle" | "reading" | "saved" | "failed"
  >(hasParsedResumeData(resume) ? "saved" : "failed");

  useEffect(() => {
    setReadState(hasParsedResumeData(resume) ? "saved" : "failed");
  }, [resume]);

  // The promoted state is a property of the source attachment, not of this
  // mounted tab. Re-check the provider when the tab mounts so a remount or a
  // reload cannot offer to create a duplicate photo.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      pictures.map(async (attachment) => {
        if (!attachment.path) return;
        try {
          const existing = await dataProvider.findResumePhotoBySource({
            shidduchimId: record.id,
            sourceAttachmentPath: attachment.path,
            visibility: "shared",
          });
          if (existing && !cancelled) {
            setPromotedPhotos((current) => {
              const next = new Set(current);
              next.add(attachment.path);
              return next;
            });
          }
        } catch {
          // A lookup failure must not hide the still-safe manual promotion.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [dataProvider, pictures, record.id]);

  const saveSuggestedName = async () => {
    const nextName = suggestedName.trim();
    if (nextName === (record.name_en?.trim() ?? "")) return;
    try {
      await dataProvider.update("shidduchim", {
        id: record.id,
        data: { name_en: nextName || null },
        previousData: record,
      });
      setNameError(null);
    } catch {
      setNameError("We couldn’t save this suggested name. Try again.");
    }
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(capture.raw_text ?? "");
      notify("Copied the original text", { type: "info" });
    } catch {
      notify("Couldn’t copy the original text", { type: "error" });
    }
  };

  const handleUseAsPhoto = async (attachment: InboxAttachment) => {
    if (promotedPhotos.has(attachment.path)) return;
    setPhotoBusy(attachment.path);
    setPhotoErrors((current) => ({ ...current, [attachment.path]: false }));
    try {
      const url = attachment.src.startsWith("data:")
        ? attachment.src
        : await signInboxAttachmentUrl(attachment.path);
      const response = await fetch(url);
      if (!response.ok) throw new Error("photo download failed");
      const blob = await response.blob();
      const file = new File([blob], attachment.title, {
        type: attachment.type || blob.type,
      });
      await dataProvider.uploadResumePhoto({
        shidduchimId: record.id,
        file,
        visibility: "shared",
        sourceAttachmentPath: attachment.path,
      });
      setPromotedPhotos((current) => {
        const next = new Set(current);
        next.add(attachment.path);
        return next;
      });
      notify("This picture is now the Photo", { type: "info" });
    } catch {
      setPhotoErrors((current) => ({ ...current, [attachment.path]: true }));
      notify(
        "We couldn’t use this picture as Photo yet. It is still safe in Files.",
        {
          type: "error",
        },
      );
    } finally {
      setPhotoBusy(null);
    }
  };

  const retryTextRead = async () => {
    setReadState("reading");
    try {
      const result = await parse(capture);
      if (resume) {
        const previousSections =
          resume.sections != null &&
          typeof resume.sections === "object" &&
          !Array.isArray(resume.sections)
            ? (resume.sections as { source_inbox_item_id?: unknown })
            : {};
        const previousSourceId = previousSections.source_inbox_item_id as
          Identifier | null | undefined;
        await dataProvider.update("resumes", {
          id: resume.id,
          data: {
            extracted: result.rawDraft,
            sections: preserveResumeSourceMarker(
              result.sections,
              previousSourceId ?? capture.id,
            ),
          },
          previousData: resume,
        });
      } else {
        await dataProvider.create("resumes", {
          data: {
            shidduchim_id: record.id,
            files: [],
            extracted: result.rawDraft,
            sections: preserveResumeSourceMarker(result.sections, capture.id),
          },
        });
      }
      setReadState("saved");
    } catch {
      setReadState("failed");
    }
  };

  const parsed = parseWhatsAppText(capture.raw_text ?? "");
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-secondary/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">This resume arrived as text. Here it is.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void copySource()}
        >
          Copy
        </Button>
      </div>
      <p
        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
        dir="auto"
      >
        {parsed.parts.map((part, index) =>
          part.bold ? (
            <strong key={index}>{part.text}</strong>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      {parsed.firstBoldText ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="suggested-name" className="text-sm font-medium">
            Suggested name
          </label>
          <Input
            id="suggested-name"
            value={suggestedName}
            onChange={(event) => setSuggestedName(event.target.value)}
            onBlur={() => void saveSuggestedName()}
            className="min-h-11"
          />
          <p className="text-xs text-muted-foreground">
            Taken from the first bold words. You can change it.
          </p>
          {nameError ? (
            <p role="alert" className="text-sm text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        role="status"
        aria-live="polite"
        aria-busy={readState === "reading"}
        className="rounded-xl border border-border bg-background/60 p-3 text-sm"
      >
        <p className="font-medium">
          {readState === "reading"
            ? "Reading the text now…"
            : readState === "saved"
              ? "Resume reading saved"
              : "We couldn’t read this text automatically yet."}
        </p>
        <p className="text-muted-foreground">
          Your original text is still saved in this Inbox capture.
        </p>
        {readState === "failed" ? (
          <Button
            type="button"
            variant="outline"
            className="mt-2 min-h-11"
            onClick={() => void retryTextRead()}
          >
            Try again
          </Button>
        ) : null}
      </div>
      {pictures.map((attachment) => (
        <div
          key={attachment.path}
          className="rounded-xl border border-border p-3"
        >
          <img
            src={attachment.src}
            alt={`Private picture from WhatsApp: ${attachment.title}`}
            className="mb-3 h-24 w-24 rounded-lg object-cover"
          />
          <p className="text-sm font-semibold">Picture from WhatsApp</p>
          <p className="text-sm text-muted-foreground">{attachment.title}</p>
          <p className="text-sm font-medium text-muted-foreground">
            Private in Files
          </p>
          <p className="text-sm text-muted-foreground">
            Shared picture — not a file
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing was turned into a file.
          </p>
          <Button
            type="button"
            className="mt-3 min-h-11"
            disabled={
              photoBusy === attachment.path ||
              promotedPhotos.has(attachment.path)
            }
            onClick={() => void handleUseAsPhoto(attachment)}
          >
            {photoBusy === attachment.path
              ? "Using this picture…"
              : promotedPhotos.has(attachment.path)
                ? "Already your Photo"
                : "Use this picture as Photo"}
          </Button>
          {promotedPhotos.has(attachment.path) ? (
            <p role="status" className="mt-2 text-sm text-green-700">
              This picture is now the Photo.
            </p>
          ) : photoErrors[attachment.path] ? (
            <div role="alert" className="mt-2 text-sm text-destructive">
              <p>We couldn’t use this picture as Photo yet.</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11"
                onClick={() => void handleUseAsPhoto(attachment)}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The original-file surface is deliberately separate from `ResumeTab`: the
 * Resume tab owns upload/inbox and parsed facts, while this tab owns the one
 * full-width original viewer. `ResumeDocument` remains the single preview
 * host, so switching tabs cannot mount a second PDF preview or signed fetch.
 */
export function OriginalResumeTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  const { role, isPending: isRolePending } = useViewerRole();
  const recordId = record?.id;
  const {
    data: captures = [],
    isPending: capturesPending,
    error: capturesError,
    refetch: refetchCaptures,
  } = useGetList<InboxItem>(
    "inbox_items",
    {
      filter: { resolved_shidduchim_id: recordId },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: recordId != null },
  );
  const { data: resumes = [] } = useGetList<Resume>(
    "resumes",
    {
      filter: { shidduchim_id: recordId },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: recordId != null },
  );
  if (!record) return null;

  const canReread = canRereadResume(role, isRolePending);
  const canDelete = canDeleteResumeFileForRole(role, isRolePending);
  const markedCaptures = captures.filter(
    (capture) =>
      (
        capture.resolution_input as {
          resume_source_inbox_item_id?: unknown;
        } | null
      )?.resume_source_inbox_item_id != null &&
      String(
        (
          capture.resolution_input as {
            resume_source_inbox_item_id?: unknown;
          } | null
        )?.resume_source_inbox_item_id,
      ) === String(capture.id) &&
      typeof capture.raw_text === "string" &&
      capture.raw_text.trim().length > 0,
  );
  const resumeSourceId = resumes.find((resume) => {
    const sections = resume.sections;
    return (
      sections != null &&
      typeof sections === "object" &&
      !Array.isArray(sections) &&
      "source_inbox_item_id" in sections
    );
  })?.sections as { source_inbox_item_id?: unknown } | undefined;
  const persistedSourceCaptures = captures.filter(
    (capture) =>
      resumeSourceId?.source_inbox_item_id != null &&
      String(capture.id) === String(resumeSourceId.source_inbox_item_id) &&
      typeof capture.raw_text === "string" &&
      capture.raw_text.trim().length > 0,
  );
  const textCapture = (
    persistedSourceCaptures.length > 0
      ? persistedSourceCaptures
      : markedCaptures.length > 0
        ? markedCaptures
        : captures
  ).find(
    (capture) =>
      typeof capture.raw_text === "string" &&
      capture.raw_text.trim().length > 0,
  );

  return (
    <section
      aria-labelledby="original-resume-heading"
      className="flex min-w-0 max-w-full flex-col gap-4"
    >
      <h2 id="original-resume-heading" className="text-xl font-semibold">
        Original resume
      </h2>
      {capturesPending ? (
        <p role="status">Loading the original resume…</p>
      ) : capturesError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>We couldn’t load the original resume.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetchCaptures()}
          >
            Try again
          </Button>
        </div>
      ) : textCapture ? (
        <WhatsAppTextSource
          record={record}
          capture={textCapture}
          resume={resumes.find(
            (candidate) => candidate.shidduchim_id === record.id,
          )}
        />
      ) : null}
      <ResumeDocument
        shidduchimId={record.id}
        canReread={canReread}
        canDelete={canDelete}
        presentation="picker"
        emptyActionHref={buildTabPath("shidduchim", record.id, "resume")}
      />
    </section>
  );
}
