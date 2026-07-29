import { describe, expect, test } from "vitest";

import { formatDueMoment } from "./formatDueMoment";

describe("formatDueMoment", () => {
  test("renders a timestamp as day, month and 12-hour time", () => {
    // Arrange — a local-time timestamp, so the expectation does not depend
    // on the machine's zone.
    const dueDate = "2026-07-24T14:00:00";

    // Act
    const result = formatDueMoment(dueDate);

    // Assert
    expect(result).toBe("24 Jul, 2:00 PM");
  });

  test("uses the same shape for a morning time", () => {
    // Arrange
    const dueDate = "2026-01-09T09:05:00";

    // Act
    const result = formatDueMoment(dueDate);

    // Assert
    expect(result).toBe("9 Jan, 9:05 AM");
  });

  test("does not pad the day of the month", () => {
    // Arrange
    const dueDate = "2026-03-05T23:30:00";

    // Act
    const result = formatDueMoment(dueDate);

    // Assert
    expect(result).toBe("5 Mar, 11:30 PM");
  });
});
