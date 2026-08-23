import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";
import type { ResumePhoto } from "../types";

/**
 * One photo that can either be hidden behind an explicit "Reveal"
 * affordance or displayed immediately, according to the account preference.
 * The reveal mode signs a URL only after the click; immediate mode signs it
 * once on mount so ordinary photo previews remain ordinary.
 *
 * Reveal state is local `useState`, which is exactly what "resets on
 * navigating away and back" means in practice here:
 * `Entity360TabPanel` (`entity360/Entity360Tabs.tsx`) only ever mounts the
 * ACTIVE tab's `render()` tree, so switching away from Photo — or away from
 * the shidduch record entirely — unmounts every `PhotoRevealCard`, and
 * coming back mounts fresh ones. No route state or query-cache entry for the
 * signed URL is used, so reveal state remains local to the page.
 */
export function PhotoRevealCard({
  photo,
  onHidden,
  revealOnClick = true,
}: {
  photo: ResumePhoto;
  onHidden: () => void;
  revealOnClick?: boolean;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [autoRevealFailed, setAutoRevealFailed] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const autoRevealAttempted = useRef(false);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);
  const revealOnClickRef = useRef(revealOnClick);
  const previousRevealOnClick = useRef(revealOnClick);
  revealOnClickRef.current = revealOnClick;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  const handleReveal = useCallback(
    async (automatic = false) => {
      if (automatic && revealOnClickRef.current) return;
      const generation = ++requestGeneration.current;
      if (!automatic) setAutoRevealFailed(false);
      setIsRevealing(true);
      try {
        const url = await dataProvider.signResumePhotoUrl({
          storagePath: photo.path,
        });
        if (
          mounted.current &&
          requestGeneration.current === generation &&
          (!automatic || !revealOnClickRef.current)
        ) {
          setSignedUrl(url);
        }
      } catch (error) {
        if (
          !mounted.current ||
          requestGeneration.current !== generation ||
          (automatic && revealOnClickRef.current)
        ) {
          return;
        }
        if (automatic) setAutoRevealFailed(true);
        notify(
          error instanceof Error
            ? error.message
            : translate("crm.entity360.photo.revealError", {
                _: "Failed to reveal the photo",
              }),
          { type: "error" },
        );
      } finally {
        if (mounted.current && requestGeneration.current === generation) {
          setIsRevealing(false);
        }
      }
    },
    [dataProvider, notify, photo.path, translate],
  );

  useEffect(() => {
    if (revealOnClick && !previousRevealOnClick.current) {
      // A preference flip is a privacy boundary, not merely a rendering
      // preference. Invalidate the automatic request and remove any URL it
      // may have produced; only a new explicit click may reveal this photo.
      requestGeneration.current += 1;
      setSignedUrl(null);
      autoRevealAttempted.current = false;
      setIsRevealing(false);
      previousRevealOnClick.current = revealOnClick;
      return;
    }
    previousRevealOnClick.current = revealOnClick;
    if (revealOnClick) return;
    if (signedUrl || autoRevealAttempted.current) return;

    autoRevealAttempted.current = true;
    setAutoRevealFailed(false);
    void handleReveal(true);
  }, [handleReveal, revealOnClick, signedUrl]);

  const handleHide = async () => {
    setIsHiding(true);
    try {
      await dataProvider.hideResumePhoto({ id: photo.id });
      onHidden();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.photo.hideError", {
              _: "Failed to hide the photo",
            }),
        { type: "error" },
      );
    } finally {
      setIsHiding(false);
    }
  };

  const visibilityLabel = translate(
    `crm.entity360.photo.visibilityOption.${photo.visibility}`,
    { _: photo.visibility },
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border">
      <div className="flex aspect-square items-center justify-center bg-muted">
        {signedUrl ? (
          <img
            src={signedUrl}
            alt={translate("crm.entity360.photo.alt", { _: "Photo" })}
            className="h-full w-full object-cover"
          />
        ) : revealOnClick || autoRevealFailed ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isRevealing}
            onClick={() => handleReveal()}
          >
            {revealOnClick
              ? translate("crm.entity360.photo.reveal", { _: "Reveal" })
              : translate("crm.entity360.photo.retry", { _: "Retry" })}
          </Button>
        ) : (
          <Skeleton className="size-full" aria-label="Loading photo" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="text-xs text-muted-foreground">{visibilityLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isHiding}
          onClick={handleHide}
        >
          {translate("crm.entity360.photo.hide", { _: "Hide" })}
        </Button>
      </div>
    </div>
  );
}
