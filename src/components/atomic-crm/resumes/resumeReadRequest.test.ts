import { beforeEach, describe, expect, it } from "vitest";

import {
  createResumeReadRequestId,
  resumeReadAttemptKey,
  unresolvedResumeReadAttempts,
} from "./resumeReadRequest";

describe("resume read request identity", () => {
  beforeEach(() => {
    unresolvedResumeReadAttempts.clear();
  });

  it("keeps request ids stable for the same resume and file only in memory", () => {
    const key = resumeReadAttemptKey(22, "10/resumes/33/current.pdf");
    const requestId = createResumeReadRequestId();
    unresolvedResumeReadAttempts.set(key, requestId);

    expect(unresolvedResumeReadAttempts.get(key)).toBe(requestId);
    expect(
      unresolvedResumeReadAttempts.get(
        resumeReadAttemptKey(22, "10/resumes/33/newer.pdf"),
      ),
    ).toBeUndefined();
  });
});
