import { useEffect, useRef, useState } from "react";
import type { RefObject, ReactElement } from "react";
import { Maximize2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PhotoLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  caption?: string;
  alt?: string;
  openerRef: RefObject<HTMLElement | null>;
  title?: string;
  description?: string;
  closeLabel?: string;
  errorMessage?: string;
}

/**
 * The shared viewer for already-authorized photos. The caller owns the URL's
 * lifetime and only mounts this with a URL that has already passed its
 * surface-specific visibility and image-load checks.
 */
export function PhotoLightbox({
  open,
  onOpenChange,
  url,
  caption,
  alt = "Photo",
  openerRef,
  title = "Enlarged photo",
  description = caption ?? "Photo",
  closeLabel = "Close photo viewer",
  errorMessage = "This photo couldn’t be opened.",
}: PhotoLightboxProps): ReactElement {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(90dvh,60rem)] max-h-[90dvh] w-[min(90vw,60rem)] max-w-[min(90vw,60rem)] flex-col gap-3 overflow-hidden border-slate-800 bg-slate-950 p-4 text-slate-50 sm:max-w-[min(90vw,60rem)] sm:p-6"
        hideClose
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current?.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-300">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md bg-black/40 p-2 [touch-action:pan-x_pan-y_pinch-zoom]">
          {imageFailed ? (
            <p
              role="alert"
              className="flex h-full items-center justify-center text-center text-sm text-slate-300"
            >
              {errorMessage}
            </p>
          ) : (
            <img
              src={url}
              alt={alt}
              className="mx-auto block h-full max-h-full max-w-full object-contain [touch-action:pan-x_pan-y_pinch-zoom]"
              onError={() => setImageFailed(true)}
            />
          )}
        </div>

        {caption ? (
          <p className="shrink-0 truncate text-sm text-slate-300">{caption}</p>
        ) : null}

        <div className="flex shrink-0 justify-end">
          <Button
            ref={closeButtonRef}
            type="button"
            variant="outline"
            aria-label={closeLabel}
            className="min-h-11 border-slate-700 bg-slate-900 text-slate-50 hover:bg-slate-800 hover:text-slate-50"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EnlargePhotoIcon(): ReactElement {
  return <Maximize2 aria-hidden="true" className="size-4" />;
}
