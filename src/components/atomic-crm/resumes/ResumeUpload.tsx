import { useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import type { ResumeSubject } from "./resumeSubject";

/**
 * The upload half of the Resume tab (Story 5.3, AC 1 / AC 2 / AC 5; widened
 * to a single subject by Story 5.8 AC 3). A thin wrapper over
 * `dataProvider.uploadResumeFile` — same shape as
 * `entity360/tabs/FilesTab.tsx`'s own upload button, minus visibility (a
 * resume has none) and minus replace: a resume is versioned by APPENDING
 * (`add_resume_file`), never by replacing an existing entry (AC 2).
 *
 * `useRefresh()` invalidates every active query, not only this component's
 * own — that is what makes a successful upload here show up in the sibling
 * `ResumeVersionList` without any prop-drilled callback between the two.
 */
export function ResumeUpload(subject: ResumeSubject): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const refresh = useRefresh();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      await dataProvider.uploadResumeFile({ ...subject, file });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.resume.uploadError", {
              _: "Failed to upload the resume",
            }),
        { type: "error" },
      );
    } finally {
      setIsUploading(false);
    }
  };

  const uploadLabel = translate("crm.entity360.resume.upload", {
    _: "Upload a new version",
  });

  return (
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
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        aria-label={uploadLabel}
        onChange={handleUpload}
      />
    </div>
  );
}
