import { Languages } from "lucide-react";
import { useLocaleState, useLocales, useTranslate } from "ra-core";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface LanguageSelectorProps {
  className?: string;
}

/**
 * The bilingual identity, made a first-class control (design-language §7):
 * a prominent row, RTL-safe (logical padding, no `ms-`/`me-` next to a
 * `dir="rtl"` span — see design-artifacts note on the Foundation's fix).
 *
 * The UI locale catalog currently registers English + Français
 * (`providers/commons/i18nProvider.ts`, outside this lane's file ownership).
 * A full עברית interface locale needs a Hebrew message catalog wired there;
 * until then this renders whatever `useLocales()` reports, so it stays
 * correct without hardcoding a language that isn't actually translated.
 */
export const LanguageSelector = ({ className }: LanguageSelectorProps) => {
  const translate = useTranslate();
  const locales = useLocales();
  const [locale, setLocale] = useLocaleState();

  if (locales.length <= 1) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/40 px-4 py-3",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Languages
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold">
          {translate("crm.language")}
        </span>
      </div>
      <Select value={locale} onValueChange={setLocale}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((language) => (
            <SelectItem key={language.locale} value={language.locale}>
              {language.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
