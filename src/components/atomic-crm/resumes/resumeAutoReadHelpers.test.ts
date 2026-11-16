import { describe, expect, it } from "vitest";

import {
  RESUME_AUTO_READ_COPY,
  resumeAutoReadFeedbackText,
} from "./resumeAutoReadHelpers";

describe("resume auto-read copy", () => {
  it("uses the easy-to-read action copy and exposes the timeout outcome", () => {
    expect(RESUME_AUTO_READ_COPY.reading).toBe(
      "Making it easy to read. Please wait.",
    );
    expect(RESUME_AUTO_READ_COPY.completed).toBe(
      "Done. The easy-to-read details are ready below.",
    );
    expect(RESUME_AUTO_READ_COPY.failed).toBe(
      "Could not make this resume easy to read. The file was saved; you can try again.",
    );
    expect(resumeAutoReadFeedbackText("timeout")).toBe(
      "This is taking too long. Nothing was changed. Please try again later.",
    );
    expect(resumeAutoReadFeedbackText("provider_busy")).toBe(
      "The reading service is busy right now. Nothing was changed. Please try again in a few minutes.",
    );
  });
});
