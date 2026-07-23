import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import { Card } from "@/components/ui/card";

import { getAvatarIndex, getMonogram } from "../shidduchim/boardUtils";
import type { Shadchan } from "../types";
import { ResponsivenessChip } from "./ResponsivenessChip";
import { parseContactInfo } from "./shadchanUtils";

export interface ShadchanHeaderProps {
  shadchan: Shadchan;
}

/**
 * The shadchan detail's hero card (screen 20): monogram + bilingual name,
 * location, a tasteful responsiveness chip, contact info (when present —
 * `contacts` is a free-form jsonb column with no seeded shape yet, so
 * missing fields are simply omitted, never fabricated), and notes.
 */
export const ShadchanHeader = ({ shadchan }: ShadchanHeaderProps) => {
  const monogram = getMonogram(shadchan.name);
  const avatarIndex = getAvatarIndex(shadchan.name ?? String(shadchan.id));
  const contactInfo = parseContactInfo(shadchan.contacts);
  const hasContactInfo =
    contactInfo.phone || contactInfo.email || contactInfo.whatsapp;

  return (
    <Card className="p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-bold"
            style={{
              backgroundColor: `var(--avatar-${avatarIndex})`,
              color: "var(--avatar-ink)",
            }}
          >
            {monogram}
          </div>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-baseline gap-x-2 font-display text-2xl font-bold tracking-tight">
              <span>{shadchan.name}</span>
              {shadchan.name_he ? (
                <span
                  className="font-hebrew text-lg font-medium text-muted-foreground"
                  dir="rtl"
                >
                  {shadchan.name_he}
                </span>
              ) : null}
            </h1>
            {shadchan.location ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {shadchan.location}
              </p>
            ) : null}
          </div>
        </div>
        <ResponsivenessChip
          value={shadchan.responsiveness}
          className="h-7 px-2.5 text-[13px]"
        />
      </div>

      {hasContactInfo ? (
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          {contactInfo.phone ? (
            <a
              href={`tel:${contactInfo.phone}`}
              className="inline-flex items-center gap-1.5 tabular-nums text-foreground outline-none
                transition-colors duration-[160ms] hover:text-primary
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-background rounded-md"
            >
              <Phone className="size-3.5 shrink-0" aria-hidden="true" />
              {contactInfo.phone}
            </a>
          ) : null}
          {contactInfo.whatsapp ? (
            <a
              href={`https://wa.me/${contactInfo.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 tabular-nums text-foreground outline-none
                transition-colors duration-[160ms] hover:text-primary
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-background rounded-md"
            >
              <MessageCircle className="size-3.5 shrink-0" aria-hidden="true" />
              {contactInfo.whatsapp}
            </a>
          ) : null}
          {contactInfo.email ? (
            <a
              href={`mailto:${contactInfo.email}`}
              className="inline-flex items-center gap-1.5 text-foreground outline-none
                transition-colors duration-[160ms] hover:text-primary
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                focus-visible:ring-offset-background rounded-md"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden="true" />
              {contactInfo.email}
            </a>
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
