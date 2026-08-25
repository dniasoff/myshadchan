import { Moon, Smartphone, Sun } from "lucide-react";
import {
  useGetOne,
  useLocaleState,
  useLocales,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";

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
import { Switch } from "@/components/ui/switch";

import { hasVisibility } from "../entity360/visibility";
import { ReminderDeliveryStatus } from "../reminders/ReminderDeliveryStatus";
import { DemoDeliveryHistory } from "../reminders/DemoDeliveryHistory";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";
import { useViewerRole } from "../entity360/useViewerRole";
import type { Account, MemberRole } from "../types";
import { SectionLabel } from "./SectionLabel";

const CAN_SET_ACCOUNT_PREFERENCES: MemberRole[] = [
  "parent_admin",
  "helper",
  "self_manager",
  "shadchan",
];

/** Language (prominent, first-class per the ticket) + appearance theme +
 * (Story 12.2, AC-9) the reminder-email delivery heartbeat. */
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
        <ItemSeparator />
        <PhotoPrivacyRow />
        <ItemSeparator />
        <ReminderDeliveryStatus />
        <DemoDeliveryHistory />
      </ItemGroup>
    </div>
  );
};

/** Account-wide photo display preference. It intentionally follows the same
 * role boundary as CommunicationSection's account default: singles can read
 * the setting through the account row but cannot be offered a control that
 * the database would reject. */
export const PhotoPrivacyRow = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { role, isPending: isRolePending } = useViewerRole();
  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const { data: account, refetch } = useGetOne<Account>(
    "accounts",
    { id: activeContext?.account_id },
    { enabled: activeContext?.account_id != null },
  );
  const [update, { isPending: isSaving }] = useUpdate();

  const canConfigure =
    !isRolePending &&
    hasVisibility(CAN_SET_ACCOUNT_PREFERENCES, role) &&
    account != null;

  if (!canConfigure || !account) return null;

  const handleChange = (enabled: boolean) => {
    if (enabled === (account.photo_reveal_on_click === true)) return;

    update(
      "accounts",
      {
        id: account.id,
        data: { photo_reveal_on_click: enabled },
        previousData: { id: account.id },
      },
      {
        onSuccess: () => refetch(),
        onError: () => {
          notify("crm.settings.photo_privacy.save_error", {
            type: "error",
            messageArgs: { _: "Couldn't save that. Try again." },
          });
        },
      },
    );
  };

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle className="font-normal">
          {translate("crm.settings.photo_privacy.title", {
            _: "Photo privacy",
          })}
        </ItemTitle>
        <p className="text-sm text-muted-foreground">
          {translate("crm.settings.photo_privacy.reveal_on_click_hint", {
            _: "Keep photos hidden until you choose to reveal each one.",
          })}
        </p>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={account.photo_reveal_on_click === true}
          onCheckedChange={handleChange}
          disabled={isSaving}
          aria-label={translate("crm.settings.photo_privacy.reveal_on_click", {
            _: "Require click to reveal photos",
          })}
        />
      </ItemActions>
    </Item>
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
          {/* Borderless to stay quiet in the row, but NOT shrunk: this used
              to be `size="sm" !h-auto py-0`, which discarded the trigger's
              height entirely and left the only way to change language a
              ~20px run of text. The default size carries the mobile touch
              floor (`min-h-11 md:min-h-9` in `ui/select.tsx`), so keeping it
              is what makes the row tappable; the chevron the trigger always
              renders is the remaining affordance that it is a control. */}
          <SelectTrigger className="w-auto border-none shadow-none">
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
