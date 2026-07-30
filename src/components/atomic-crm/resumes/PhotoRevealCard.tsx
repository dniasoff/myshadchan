import { useState } from "react";
import type { ReactElement } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import type { ResumePhoto } from "../types";

/**
 * One photo, hidden behind an explicit "Reveal" affordance by default
 * (AC 1) — clicking it signs a URL and shows the image; nothing is fetched
 * or placed in the DOM before that click (no `<img src>`, no signed-URL
 * request happens on mount).
 *
 * Reveal state is local `useState`, which is exactly what "resets on
 * navigating away and back" means in practice here:
 * `Entity360TabPanel` (`entity360/Entity360Tabs.tsx`) only ever mounts the
 * ACTIVE tab's `render()` tree, so switching away from Photo — or away from
 * the shidduch record entirely — unmounts every `PhotoRevealCard`, and
 * coming back mounts fresh ones with reveal state back to hidden. No route
 * state, no query-cache entry for the signed URL, nothing to reset by hand.
 */
export function PhotoRevealCard({
  photo,
  onHidden,
}: {
  photo: ResumePhoto;
  onHidden: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isHiding, setIsHiding] = useState(false);

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      const url = await dataProvider.signResumePhotoUrl({
        storagePath: photo.path,
      });
      setSignedUrl(url);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.photo.revealError", {
              _: "Failed to reveal the photo",
            }),
        { type: "error" },
      );
    } finally {
      setIsRevealing(false);
    }
  };

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
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={isRevealing}
            onClick={handleReveal}
          >
            {translate("crm.entity360.photo.reveal", { _: "Reveal" })}
          </Button>
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
