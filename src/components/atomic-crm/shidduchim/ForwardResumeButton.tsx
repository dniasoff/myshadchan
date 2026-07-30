import { useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import { buildResumeSharePayload } from "../resumes/resumeSharePayload";
import { useLatestResumeFile } from "../resumes/useLatestResumeFile";

/**
 * "Forward resume and share" (Story 5.7, AC 4): the OS-native share/download
 * of the shidduch's newest resume file. Does NOT generate a link, a token,
 * or anything Epic 9 will later own (Dev Notes, "Two ambiguities…") — it
 * mints a signed, expiring URL exactly like `ResumeVersionList`'s own
 * download button, then either hands the fetched bytes to
 * `navigator.share()` (when the browser supports sharing files) or opens
 * the same signed URL as a plain download, the identical fallback
 * `ResumeVersionList` already uses.
 */
export function ForwardResumeButton({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const { latestFile, isPending } = useLatestResumeFile(shidduchimId);
  const [isSending, setIsSending] = useState(false);

  const disabledReason =
    !isPending && !latestFile
      ? translate("crm.entity360.rail.forward.noResume", {
          _: "No resume to forward yet.",
        })
      : null;

  const handleForward = async () => {
    if (!latestFile) return;
    setIsSending(true);
    try {
      const url = await dataProvider.signResumeFileUrl({
        storagePath: latestFile.path,
        fileName: latestFile.filename,
      });

      const canShareFiles =
        typeof navigator.canShare === "function" &&
        typeof navigator.share === "function";

      if (canShareFiles) {
        const response = await fetch(url);
        const blob = await response.blob();
        const payload = buildResumeSharePayload(blob, latestFile);
        if (navigator.canShare(payload)) {
          await navigator.share(payload);
          return;
        }
      }

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      // The user cancelling the native share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.rail.forward.error", {
              _: "Failed to forward the resume",
            }),
        { type: "error" },
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button
      type="button"
      disabled={isPending || isSending || !latestFile}
      title={disabledReason ?? undefined}
      onClick={handleForward}
    >
      {translate("crm.entity360.rail.forward.action", {
        _: "Forward resume",
      })}
    </Button>
  );
}
