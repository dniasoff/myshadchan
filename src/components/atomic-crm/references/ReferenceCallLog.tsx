import { useState } from "react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecordLink } from "../entity360/RecordLink";
import { EmptyState } from "../misc/EmptyState";
import type { ReferenceLinkSummary } from "../types";
import { CallStatusChip } from "./CallStatusChip";
import { CallCaptureSheet } from "./CallCaptureSheet";
import { GuidedCallSession } from "./GuidedCallSession";
import { sortConversationLog } from "./callStatus";
import { useCallSession } from "./useCallSession";

/**
 * The per-shidduch call log (§5b): one card per shidduch this reference has been
 * asked about, carrying the call status, what they said, and the full
 * conversation log for that link.
 *
 * The candid content lives on reference_links, which has no visibility column of
 * its own — a future single-facing screen (Epic 6) derives what a single may see
 * by joining back to the parent shidduch (AD-3). Nothing here may be given its
 * own visibility flag.
 */

const LinkCard = ({
  link,
  onOpenCallMode,
}: {
  link: ReferenceLinkSummary;
  onOpenCallMode: (linkId: string) => void;
}) => {
  const translate = useTranslate();
  const [isCapturing, setIsCapturing] = useState(false);
  const log = sortConversationLog(link.conversation_log);

  const shidduchName =
    link.shidduch_name_en ||
    translate("crm.references.callLog.unlinked", {
      _: "Not linked to a single",
    });

  return (
    <Card
      className="rounded-2xl shadow-sm transition-[box-shadow,transform]
        duration-[160ms] ease-[var(--ease-out)] hover:shadow-md"
    >
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {link.shidduchim_id ? (
              <RecordLink
                resource="shidduchim"
                id={link.shidduchim_id}
                className="inline-flex min-h-11 items-center text-base font-medium hover:underline md:min-h-0"
              >
                {shidduchName}
              </RecordLink>
            ) : (
              <span className="text-base font-medium">{shidduchName}</span>
            )}
            <p className="text-sm text-muted-foreground">
              {[link.effective_relationship, link.single_first_name_en]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <CallStatusChip status={link.call_status} />
        </div>

        {link.what_they_said ? (
          <p className="whitespace-pre-line text-sm">{link.what_they_said}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("crm.references.callLog.nothingYet", {
              _: "Nothing recorded from this conversation yet.",
            })}
          </p>
        )}

        {log.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {translate("crm.references.callLog.entries", {
                smart_count: log.length,
                _: "%{smart_count} log entries",
              })}
            </summary>
            <ul className="mt-2 flex flex-col gap-2 border-s ps-3">
              {log.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.at).toLocaleString()}
                    {entry.source === "assistant"
                      ? ` · ${translate("crm.references.callLog.viaAssistant", { _: "via the call script" })}`
                      : ""}
                  </span>
                  {entry.text ? (
                    <p className="whitespace-pre-line">{entry.text}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="transition-transform duration-[160ms]
              ease-[var(--ease-spring)] active:scale-[0.97]"
            onClick={() => setIsCapturing(true)}
          >
            {translate("crm.references.callLog.capture", {
              _: "Log a call",
            })}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="transition-transform duration-[160ms]
              ease-[var(--ease-spring)] active:scale-[0.97]"
            onClick={() => onOpenCallMode(String(link.id))}
          >
            {translate("crm.references.callMode.launch", {
              _: "Call mode",
            })}
          </Button>
        </div>

        <CallCaptureSheet
          link={link}
          open={isCapturing}
          onOpenChange={setIsCapturing}
        />
      </CardContent>
    </Card>
  );
};

export const ReferenceCallLog = ({
  links,
}: {
  links: ReferenceLinkSummary[];
}) => {
  const translate = useTranslate();
  const { open } = useCallSession();
  const { activeLinkId } = useCallSession();
  const activeLink = links.find((l) => String(l.id) === activeLinkId);

  if (links.length === 0) {
    return (
      <EmptyState
        title={translate("crm.references.callLog.emptyTitle", {
          _: "Not linked to a single yet",
        })}
        description={translate("crm.references.callLog.empty", {
          _: "This person is not linked to any single yet.",
        })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => (
        <LinkCard key={String(link.id)} link={link} onOpenCallMode={open} />
      ))}
      {activeLink && <GuidedCallSession links={links} />}
    </div>
  );
};
