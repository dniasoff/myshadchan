import type { ConfigurationContextValue } from "./ConfigurationContext";

export const defaultDarkModeLogo = "./logos/logo_myshadchan_dark.svg";
export const defaultLightModeLogo = "./logos/logo_myshadchan_light.svg";

export const defaultTitle = "MyShadchan";

export const defaultTaskTypes = [
  { value: "none", label: "None" },
  { value: "email", label: "Email" },
  { value: "demo", label: "Demo" },
  { value: "lunch", label: "Lunch" },
  { value: "meeting", label: "Meeting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "thank-you", label: "Thank you" },
  { value: "ship", label: "Ship" },
  { value: "call", label: "Call" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
