import { Mail, MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { EntityAvatar } from "../entity360/EntityAvatar";
import type { Shadchan } from "../types";
import { ResponsivenessChip } from "./ResponsivenessChip";
import { parseContactInfo } from "./shadchanUtils";

export interface ShadchanHeaderProps {
  shadchan: Shadchan;
}

/**
 * Formats an ISO timestamp as "Jan 2026" for the header's joined meta line.
 * `created_at` is typed as a required string, but a freshly-created record
 * (seen live against FakeRest's `create`, which does not stamp one) can
 * still arrive missing or unparsable — never trust external data even when
 * the type says it's safe. Returns `null` rather than throwing, so a bad
 * timestamp degrades the meta line instead of crashing the whole page.
 */
const formatBookSince = (
  createdAt: string | null | undefined,
): string | null => {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(date);
};

/**
 * The shadchan detail's hero card (screen 20, mobile-redesign-plan.md §4
 * S-C): monogram + name, a joined location/tenure meta line (never empty —
 * "In your book since {month year}" is the non-null fallback, since most
 * shadchanim have no location yet), a tasteful responsiveness chip, contact
 * quick actions (when present — `contacts` is a free-form jsonb column with
 * no seeded shape yet, so missing fields are simply omitted, never
 * fabricated), and notes.
 *
 * The name/meta group and the chip share a `flex-wrap` row (wave S review,
 * F3): most records fit on one line at any width, but the chip drops to its
 * own row rather than squeezing the meta line into a clipped 3rd line when
 * it can't — the same mechanism the pre-density-pass header used, restored
 * here because the joined meta line is longer than the old location-only
 * line and needs it more, not less.
 */
export const ShadchanHeader = ({ shadchan }: ShadchanHeaderProps) => {
  const contactInfo = parseContactInfo(shadchan.contacts);
  const hasContactInfo =
    contactInfo.phone || contactInfo.email || contactInfo.whatsapp;
  const bookSince = formatBookSince(shadchan.created_at);
  const metaLine = [
    shadchan.location,
    bookSince ? `In your book since ${bookSince}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="gap-3 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar
            seed={shadchan.name ?? String(shadchan.id)}
            monogramSource={shadchan.name}
            className="size-10 shrink-0 rounded-xl text-sm"
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">
              {shadchan.name}
            </h1>
            {metaLine ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1">
                {metaLine}
              </p>
            ) : null}
          </div>
        </div>
        <ResponsivenessChip
          value={shadchan.responsiveness}
          className="shrink-0"
        />
      </div>

      {hasContactInfo ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {contactInfo.phone ? (
            <Button variant="outline" asChild>
              <a href={`tel:${contactInfo.phone}`}>
                <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                Call {contactInfo.phone}
              </a>
            </Button>
          ) : null}
          {contactInfo.whatsapp ? (
            <Button variant="outline" asChild>
              <a
                href={`https://wa.me/${contactInfo.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                WhatsApp
              </a>
            </Button>
          ) : null}
          {contactInfo.email ? (
            <Button variant="outline" asChild>
              <a href={`mailto:${contactInfo.email}`}>
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                Email
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      {shadchan.notes ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Notes
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
            {shadchan.notes}
          </p>
        </div>
      ) : null}
    </Card>
  );
};
