export type ParsedTaskTime = {
  /** The value accepted by the existing task date builder. */
  value: string;
  /** The value shown back to the user after blur or Enter. */
  display: string;
};

const pad = (value: number): string => String(value).padStart(2, "0");

const toDisplay = (hours: number, minutes: number): string => {
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${pad(minutes)} ${suffix}`;
};

/**
 * Parse the forgiving time forms used by the reminder editor. The parser
 * deliberately accepts only a clock value; words and impossible times are
 * rejected instead of being silently turned into a different reminder.
 */
export const parseTaskTime = (input: string): ParsedTaskTime | null => {
  const value = input.trim().replace(/\./g, "").replace(/\s+/g, " ");
  if (value === "") return null;

  const compact = value.match(/^(\d{3,4})\s*(am|pm)?$/i);
  const match = compact
    ? [
        value,
        compact[1].length === 3
          ? compact[1].slice(0, 1)
          : compact[1].slice(0, 2),
        compact[1].slice(-2),
        compact[2],
      ]
    : value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  const meridiem = match[3]?.toUpperCase();
  let hours = Number(match[1]);
  const minutes = match[2] == null ? 0 : Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) {
    return null;
  }

  if (meridiem != null) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "AM") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else {
    // A compact 3/4 digit value is useful on phone keyboards: 934 => 9:34.
    // Without a suffix, a one- or two-digit value means the top of the hour.
    if (hours > 23) return null;
  }

  return {
    value: `${pad(hours)}:${pad(minutes)}`,
    display: toDisplay(hours, minutes),
  };
};

export const formatTaskTime = (value: string): string => {
  const parsed = parseTaskTime(value);
  return parsed?.display ?? value;
};

export const isEmptyTaskTime = (value: string): boolean => value.trim() === "";
