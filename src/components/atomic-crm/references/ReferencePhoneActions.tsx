import { useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ReferenceLinkSummary } from "../types";
import { CallCaptureSheet } from "./CallCaptureSheet";
import {
  looksLikeMultiplePhoneNumbers,
  normalizePhoneForLinks,
} from "./phoneLinks";
import { useReturnFromCall } from "./useReturnFromCall";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

const useFinePointer = (): boolean => {
  const [isFinePointer, setIsFinePointer] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(FINE_POINTER_QUERY);
    const update = () => setIsFinePointer(media.matches);
    update();
    media.addEventListener?.("change", update);
    media.addListener?.(update);
    return () => {
      media.removeEventListener?.("change", update);
      media.removeListener?.(update);
    };
  }, []);

  return isFinePointer;
};

const copyText = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the old synchronous browser API.
  }

  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
};

export const ReferencePhoneActions = ({
  phone,
  referenceName,
  referenceLink,
  referenceKey,
  onEdit,
  onManualLog,
  manualLogRef,
  className,
}: {
  phone?: string | null;
  referenceName?: string | null;
  referenceLink?: ReferenceLinkSummary | null;
  referenceKey?: Identifier | null;
  onEdit?: () => void;
  onManualLog?: () => void;
  manualLogRef?: Ref<HTMLButtonElement>;
  className?: string;
}) => {
  const displayPhone = phone ?? referenceLink?.reference_phone ?? null;
  const normalized = normalizePhoneForLinks(displayPhone);
  const isMultipleNumberValue = looksLikeMultiplePhoneNumbers(displayPhone);
  const isFinePointer = useFinePointer();
  const [copied, setCopied] = useState(false);
  const callLinkRef = useRef<HTMLAnchorElement>(null);
  const actionLabelName = referenceName?.trim() || "reference";
  const linkKey = referenceKey ?? referenceLink?.id;
  const { arm, isPromptOpen, dismiss } = useReturnFromCall(linkKey);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    if (normalized.status !== "ok" && !isMultipleNumberValue) return;
    if (await copyText(normalized.display)) setCopied(true);
  };

  const restoreCallFocus = () => {
    requestAnimationFrame(() => callLinkRef.current?.focus());
  };

  const hasNumber = normalized.display.trim() !== "";
  const canCaptureReturn = referenceLink != null && linkKey != null;

  return (
    <>
      <div
        dir="auto"
        className={cn("flex min-w-0 flex-col gap-2", className)}
        data-testid="reference-phone-actions"
      >
        {hasNumber ? (
          <span className="break-words text-sm tabular-nums">
            <bdi dir="auto">{normalized.display}</bdi>
          </span>
        ) : null}

        {normalized.status === "ok" ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              ref={callLinkRef}
              href={`tel:${normalized.e164}`}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Call ${actionLabelName}`}
              onClick={arm}
            >
              Call
            </a>
            <a
              href={`https://wa.me/${normalized.waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`WhatsApp ${actionLabelName}`}
              onClick={arm}
            >
              WhatsApp
            </a>
            {isFinePointer ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                aria-live="polite"
                onClick={() => void handleCopy()}
              >
                {copied ? "Copied" : "Copy number"}
              </Button>
            ) : null}
          </div>
        ) : hasNumber ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Check this number before calling</span>
            {onEdit ? (
              <button
                type="button"
                className="min-h-11 font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={onEdit}
              >
                Edit number
              </button>
            ) : (
              <span>Edit number</span>
            )}
            {isFinePointer && isMultipleNumberValue ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                aria-live="polite"
                onClick={() => void handleCopy()}
              >
                {copied ? "Copied" : "Copy number"}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>No number yet</span>
            {onEdit ? (
              <button
                type="button"
                className="min-h-11 font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={onEdit}
              >
                Add number
              </button>
            ) : (
              <span>Add number</span>
            )}
          </div>
        )}

        {onManualLog && referenceLink ? (
          <button
            ref={manualLogRef}
            type="button"
            className="min-h-11 self-start text-xs font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={onManualLog}
          >
            Log call
          </button>
        ) : null}
      </div>

      {canCaptureReturn ? (
        <CallCaptureSheet
          link={referenceLink}
          open={isPromptOpen}
          onOpenChange={(open) => {
            if (!open) {
              dismiss();
              restoreCallFocus();
            }
          }}
          returnFromCall
        />
      ) : null}
    </>
  );
};
