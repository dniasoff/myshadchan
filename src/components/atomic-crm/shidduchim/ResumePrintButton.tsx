import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useGetList, useRefresh, useTranslate } from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumePhoto } from "../types";
import { sortResumeFilesNewestFirst } from "../resumes/useLatestResumeFile";
import {
  downloadResumeFiles,
  getResumePrintMode,
  isIphoneFormatFile,
  printResume,
  selectNewestEligiblePhoto,
} from "../resumes/resumePrint";

export function ResumePrintButton({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [isPreparing, setIsPreparing] = useState(false);
  const [includePicture, setIncludePicture] = useState(false);
  const [includePictureContext, setIncludePictureContext] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  const [printError, setPrintError] = useState(false);
  const printButtonRef = useRef<HTMLButtonElement>(null);

  const {
    data: resumes,
    error: resumeError,
    isPending: isResumePending,
  } = useGetList<Resume>("resumes", {
    filter: { shidduchim_id: shidduchimId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const resume = resumes?.[0] ?? null;
  const latestFile = sortResumeFilesNewestFirst(resume?.files ?? [])[0] ?? null;
  const {
    data: photos,
    error: photoError,
    isPending: isPhotoPending,
  } = useGetList<ResumePhoto>(
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
    { enabled: resume?.id != null && latestFile != null },
  );

  const eligiblePhoto = selectNewestEligiblePhoto(photos ?? []);
  const isPending = isResumePending || (latestFile != null && isPhotoPending);
  const error = resumeError ?? photoError;
  const photoContext = eligiblePhoto
    ? `${String(eligiblePhoto.id)}:${eligiblePhoto.uploaded_at}`
    : "none";
  useEffect(() => {
    setIncludePicture(photoContext !== "none");
    setIncludePictureContext(photoContext);
  }, [photoContext]);
  const selectedIncludePicture =
    includePictureContext === photoContext
      ? includePicture
      : photoContext !== "none";

  const noResumeReason = translate("crm.entity360.rail.print.noResume", {
    _: "No resume available to print.",
  });
  const noPhotoReason = translate("crm.entity360.rail.print.noPicture", {
    _: "No shared picture is available to print.",
  });

  const handlePrint = async () => {
    if (!latestFile || isPreparing) return;
    setIsPreparing(true);
    setPrintError(false);
    setStatus(
      translate("crm.entity360.rail.print.preparing", {
        _: "Preparing files for printing…",
      }),
    );
    try {
      const result = await printResume({
        dataProvider,
        resume: latestFile,
        photo: eligiblePhoto,
        includePicture: selectedIncludePicture,
      });
      setStatus(
        result === "printed"
          ? translate("crm.entity360.rail.print.opened", {
              _: "Print dialog opened.",
            })
          : result === "printed-without-picture"
            ? translate("crm.entity360.rail.print.pictureOmitted", {
                _: "The picture could not be included (iPhone-format photo); the resume was printed.",
              })
            : translate("crm.entity360.rail.print.downloaded", {
                _: isIphoneFormatFile(latestFile)
                  ? "The iPhone-format resume was downloaded. Open it to print it."
                  : selectedIncludePicture
                    ? "The Word resume and picture were downloaded. Open the Word file to print it; the picture is a separate file."
                    : "The Word file was downloaded. Open it in Word or another document app to print it.",
              }),
      );
    } catch (caught) {
      setPrintError(getResumePrintMode(latestFile) === "browser");
      const message =
        getResumePrintMode(latestFile) === "download"
          ? translate("crm.entity360.rail.print.downloadError", {
              _: "We couldn’t download the Word file for printing. Try again.",
            })
          : caught instanceof Error &&
              "code" in caught &&
              caught.code === "popup-blocked"
            ? translate("crm.entity360.rail.print.popupError", {
                _: "We couldn’t open the print dialog. Allow pop-ups for MyShadchan and try again, or download the file to print it.",
              })
            : translate("crm.entity360.rail.print.prepareError", {
                _: "We couldn’t prepare these files for printing. Nothing was printed. Try again.",
              });
      setStatus(message);
    } finally {
      setIsPreparing(false);
      printButtonRef.current?.focus();
    }
  };

  const handleDownloadFallback = async () => {
    if (!latestFile || isPreparing) return;
    setIsPreparing(true);
    setPrintError(false);
    setStatus(
      translate("crm.entity360.rail.print.preparing", {
        _: "Preparing files for printing…",
      }),
    );
    try {
      await downloadResumeFiles({
        dataProvider,
        resume: latestFile,
        photo: eligiblePhoto,
        includePicture: selectedIncludePicture,
      });
      setStatus(
        translate("crm.entity360.rail.print.downloadedFallback", {
          _: "The files were downloaded. Open the resume to print it.",
        }),
      );
    } catch {
      setStatus(
        translate("crm.entity360.rail.print.prepareError", {
          _: "We couldn’t prepare these files for printing. Nothing was printed. Try again.",
        }),
      );
    } finally {
      setIsPreparing(false);
      printButtonRef.current?.focus();
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          ref={printButtonRef}
          disabled={isPending || isPreparing || !latestFile || !!error}
          onClick={handlePrint}
          aria-describedby={
            !isPending && !latestFile ? "print-resume-reason" : undefined
          }
        >
          {translate("crm.entity360.rail.print.action", { _: "Print" })}
        </Button>
      </div>

      {isPending ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {translate("crm.entity360.rail.print.checking", {
            _: "Checking files for printing…",
          })}
        </p>
      ) : error ? (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-xs text-destructive">
            {translate("crm.entity360.rail.print.loadError", {
              _: "We couldn’t load the files for printing. Try again.",
            })}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={refresh}>
            {translate("crm.entity360.rail.print.retry", { _: "Try again" })}
          </Button>
        </div>
      ) : !latestFile ? (
        <p id="print-resume-reason" className="text-xs text-muted-foreground">
          {noResumeReason}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Checkbox
              id="include-resume-picture"
              checked={selectedIncludePicture}
              disabled={!eligiblePhoto || isPreparing}
              onCheckedChange={(checked) => setIncludePicture(checked === true)}
              aria-label={translate("crm.entity360.rail.print.includePicture", {
                _: "Include picture",
              })}
              aria-describedby="include-resume-picture-help"
            />
            <label
              htmlFor="include-resume-picture"
              className="text-sm font-medium leading-none"
            >
              {translate("crm.entity360.rail.print.includePicture", {
                _: "Include picture",
              })}
            </label>
          </div>
          <p
            id="include-resume-picture-help"
            className="text-xs text-muted-foreground"
          >
            {eligiblePhoto
              ? selectedIncludePicture
                ? translate("crm.entity360.rail.print.summaryWithPicture", {
                    _: "The latest resume and picture will be printed.",
                  })
                : translate("crm.entity360.rail.print.summaryResumeOnly", {
                    _: "Only the latest resume will be printed.",
                  })
              : noPhotoReason}
          </p>
        </div>
      )}

      {status ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {status}
        </p>
      ) : null}
      {printError && latestFile ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPreparing}
          onClick={handleDownloadFallback}
        >
          {translate("crm.entity360.rail.print.downloadFallback", {
            _: "Download to print",
          })}
        </Button>
      ) : null}
    </div>
  );
}
