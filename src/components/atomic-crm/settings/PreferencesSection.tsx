import { Moon, Smartphone, Sun } from "lucide-react";
import { useLocaleState, useLocales, useTranslate } from "ra-core";

import { useTheme } from "@/components/admin/use-theme";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { SectionLabel } from "./SectionLabel";

/** Language (prominent, first-class per the ticket) + appearance theme. */
export const PreferencesSection = () => {
  const translate = useTranslate();

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.preferences", { _: "Preferences" })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <LanguageRow />
        <ItemSeparator />
        <ThemeRow />
      </ItemGroup>
    </div>
  );
};

const LanguageRow = () => {
  const translate = useTranslate();
  const locales = useLocales();
  const [locale, setLocale] = useLocaleState();

  if (locales.length <= 1) return null;

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle className="font-normal text-muted-foreground">
          {translate("crm.language")}
        </ItemTitle>
      </ItemContent>
      <ItemActions>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger
            size="sm"
            className="w-auto !h-auto py-0 border-none shadow-none"
          >
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
      </ItemActions>
    </Item>
  );
};

const ThemeRow = () => {
  const translate = useTranslate();
  const { theme, setTheme } = useTheme();

  return (
    <Item size="sm" className="flex-col items-stretch gap-2">
      <ItemTitle className="font-normal text-muted-foreground">
        {translate("crm.theme.label", { _: "Theme" })}
      </ItemTitle>
      <ToggleGroup
        type="single"
        value={theme}
        onValueChange={(value) =>
          value && setTheme(value as "light" | "dark" | "system")
        }
        size="lg"
        variant="outline"
        className="w-full"
      >
        <ToggleGroupItem
          value="system"
          aria-label={translate("crm.theme.system")}
          className="flex-1 gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          <Smartphone className="size-4" />
          {translate("crm.theme.system")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="light"
          aria-label={translate("crm.theme.light")}
          className="flex-1 gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          <Sun className="size-4" />
          {translate("crm.theme.light")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="dark"
          aria-label={translate("crm.theme.dark")}
          className="flex-1 gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          <Moon className="size-4" />
          {translate("crm.theme.dark")}
        </ToggleGroupItem>
      </ToggleGroup>
    </Item>
  );
};
