import { useRef, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import {
  useDataProvider,
  useGetOne,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";
import type {
  Account,
  Resume,
  ResumePhoto,
  ResumePhotoVisibility,
  ShidduchSummary,
} from "../types";
import { PhotoRevealCard } from "./PhotoRevealCard";
import { resumeSubjectFilter, type ResumeSubject } from "./resumeSubject";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";

const VISIBILITY_OPTIONS: readonly ResumePhotoVisibility[] = [
  "shared",
  "private_parent",
];

function PhotoSkeleton(): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="aspect-square w-full" />
    </div>
  );
}

/** AC 3 (parity with ResumeVersionList/FilesTab): no resume row yet, or a
 * resume with zero photos — the SAME empty state either way. */
function PhotoEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.photo.empty", {
        _: "No photos uploaded yet.",
      })}
    </p>
  );
}

function PhotoError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.photo.error", {
        _: "Could not load the photos.",
      })}
    </p>
  );
}

/**
 * The upload control (AC 2; widened to a single subject by Story 5.8 AC 3):
 * a plain two-option visibility radio group, `shared` preselected, plus a
 * file picker. Visibility is chosen at upload time only — there is no
 * UPDATE policy to change it afterward (AC 4's consequence); hide +
 * re-upload is the only path to change it.
 */
function PhotoUpload({ subject }: { subject: ResumeSubject }): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const refresh = useRefresh();
  const inputRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<ResumePhotoVisibility>("shared");
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      await dataProvider.uploadResumePhoto({
        ...subject,
        file,
        visibility,
      });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.photo.uploadError", {
              _: "Failed to upload the photo",
            }),
        { type: "error" },
      );
    } finally {
      setIsUploading(false);
    }
  };

  const uploadLabel = translate("crm.entity360.photo.upload", {
    _: "Upload a photo",
  });

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={visibility}
        onValueChange={(value) => setVisibility(value as ResumePhotoVisibility)}
        className="flex flex-row gap-4"
      >
        {VISIBILITY_OPTIONS.map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem value={option} id={`photo-visibility-${option}`} />
            <Label htmlFor={`photo-visibility-${option}`}>
              {translate(`crm.entity360.photo.visibilityOption.${option}`, {
                _: option,
              })}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div>
        <Button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploadLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={uploadLabel}
          onChange={handleUpload}
        />
      </div>
    </div>
  );
}

/**
 * AC 1 / AC 2 / AC 7: reads the subject's `resumes` row to resolve its
 * `resume_id` (the same lookup `ResumeVersionList` performs — resume_photos
 * has no `shidduchim_id`/`single_id` column of its own to filter by
 * directly, AC 5's structural separation), then lists `resume_photos`
 * filtered `hidden_at is null`. The `resume_photos` query is disabled until
 * a `resume_id` resolves, so a subject with no resume row yet renders the
 * SAME empty state as one with a resume and zero photos — never a second
 * network request for a resource that cannot exist yet.
 */
function PhotoTabContent({
  subject,
}: {
  subject: ResumeSubject;
}): ReactElement {
  const refresh = useRefresh();
  const {
    data: contexts,
    isPending: isContextsPending,
    isError: isContextsError,
  } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const accountId = activeContext?.account_id;
  const {
    data: account,
    isPending: isAccountPending,
    isError: isAccountError,
  } = useGetOne<Account>(
    "accounts",
    { id: accountId },
    {
      enabled: accountId != null,
    },
  );

  const {
    data: resumes,
    isPending: isResumePending,
    error: resumeError,
  } = useGetList<Resume>("resumes", {
    filter: resumeSubjectFilter(subject),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const resumeId = resumes?.[0]?.id;

  const {
    data: photos,
    isPending: isPhotosPending,
    error: photosError,
  } = useGetList<ResumePhoto>(
    "resume_photos",
    {
      filter: { resume_id: resumeId, "hidden_at@is": null },
      sort: { field: "uploaded_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: resumeId != null },
  );

  const isPending = isResumePending || (resumeId != null && isPhotosPending);
  const error = resumeError ?? photosError;
  const items = resumeId == null ? [] : (photos ?? []);
  const isPhotoPreferencePending =
    isContextsPending || (accountId != null && isAccountPending);
  const isPhotoPreferenceUnavailable =
    isContextsError ||
    isAccountError ||
    (!isContextsPending && (accountId == null || account == null));
  // Privacy defaults fail closed: a missing/failed context or account read
  // must never be interpreted as the ordinary immediate-display preference.
  const revealOnClick =
    isPhotoPreferencePending || isPhotoPreferenceUnavailable
      ? true
      : account?.photo_reveal_on_click === true;

  return (
    <div className="flex flex-col gap-4">
      <PhotoUpload subject={subject} />

      {isPending ? (
        <PhotoSkeleton />
      ) : error ? (
        <PhotoError />
      ) : items.length === 0 ? (
        <PhotoEmpty />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((photo) => (
            <PhotoRevealCard
              key={String(photo.id)}
              photo={photo}
              onHidden={refresh}
              revealOnClick={revealOnClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The shidduch descriptor's `photo` tab entry point (Story 5.4, AC 1 / AC 2
 * / AC 7). `render` is arity-zero (contract §2 rule 4) — this reaches the
 * shidduch via `useRecordContext()`, exactly like `ResumeTab`. Story 5.8's
 * single-owned Photo tab mounts `PhotoTabContent` directly with a
 * `{ singleId }` subject instead — this wrapper stays shidduch-only.
 */
export function PhotoTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;

  return <PhotoTabContent subject={{ shidduchimId: record.id }} />;
}

export { PhotoTabContent };
