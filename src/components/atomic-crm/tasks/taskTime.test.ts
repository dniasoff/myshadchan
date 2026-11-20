import { describe, expect, it } from "vitest";

import { formatTaskTime, parseTaskTime } from "./taskTime";

describe("parseTaskTime", () => {
  it.each([
    ["9:34 PM", "21:34", "9:34 PM"],
    ["9:34pm", "21:34", "9:34 PM"],
    ["934 pm", "21:34", "9:34 PM"],
    ["9 pm", "21:00", "9:00 PM"],
    ["9pm", "21:00", "9:00 PM"],
    ["21:34", "21:34", "9:34 PM"],
    ["00:30", "00:30", "12:30 AM"],
    ["12 AM", "00:00", "12:00 AM"],
    ["12 PM", "12:00", "12:00 PM"],
    [" 9:34 p.m. ", "21:34", "9:34 PM"],
  ])("normalises %s", (input, value, display) => {
    expect(parseTaskTime(input)).toEqual({ value, display });
  });

  it.each(["24:00", "13:00 PM", "9:60 PM", "noon", "25", "12:3"])(
    "rejects %s",
    (input) => {
      expect(parseTaskTime(input)).toBeNull();
    },
  );

  it("formats an already-normalised task value in the user's 12-hour form", () => {
    expect(formatTaskTime("21:34")).toBe("9:34 PM");
  });
});
